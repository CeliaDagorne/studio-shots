import { createHash } from "node:crypto";

import {
  PRIORITY_CANDIDATE_COUNT,
  displayCandidateIndexInAttempt,
  generationAttemptNumber,
} from "@/lib/review";
import { MVP_ASPECT_RATIO } from "@/lib/request-planning";

export const LEGACY_GENERATION_LABEL = "Legacy generation";

export type AttemptEnvironment = "test" | "luma";

export type BackfillCandidate = {
  id: string;
  shotRequestId: string;
  productSku: string;
  candidateIndex: number;
  status: string;
  reviewDecision: string | null;
  blobUrl: string | null;
  errorMessage: string | null;
  lumaGenerationId: string | null;
  createdAt: Date;
  generationAttemptId: string | null;
};

export type PlannedAttempt = {
  id: string;
  shotRequestId: string;
  productSku: string;
  /** Null for legacy buckets that must not invent attempt numbers. */
  attemptNumber: number | null;
  isLegacy: boolean;
  label: string;
  shotIdea: string;
  aspectRatio: string;
  environment: AttemptEnvironment;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  candidateIds: string[];
};

const hashToUuid = (hex: string): string =>
  [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

export const stableGenerationAttemptId = (
  shotRequestId: string,
  attemptNumber: number,
): string =>
  hashToUuid(
    createHash("sha256")
      .update(`generation-attempt:${shotRequestId}:${attemptNumber}`)
      .digest("hex"),
  );

export const stableLegacyGenerationAttemptId = (shotRequestId: string): string =>
  hashToUuid(
    createHash("sha256")
      .update(`generation-attempt:${shotRequestId}:legacy`)
      .digest("hex"),
  );

export const formatGenerationAttemptLabel = (params: {
  attemptNumber: number | null;
  isLegacy: boolean;
}): string => {
  if (params.isLegacy || params.attemptNumber == null) {
    return LEGACY_GENERATION_LABEL;
  }
  return `Attempt ${params.attemptNumber}`;
};

/**
 * Shared attempt key used historically: shot request + candidate_index batch.
 * Indices 1–3 → attempt 1, 4–6 → attempt 2, etc.
 */
export const sharedAttemptKeyFromCandidateIndex = (candidateIndex: number): number =>
  generationAttemptNumber(candidateIndex);

export const expectedIndexesForAttempt = (attemptNumber: number): number[] => {
  const start = (attemptNumber - 1) * PRIORITY_CANDIDATE_COUNT + 1;
  return Array.from({ length: PRIORITY_CANDIDATE_COUNT }, (_, i) => start + i);
};

/**
 * A batch is unambiguous when every index belongs to the expected slot for
 * ceil(index / 3) and no foreign indices appear in that group.
 */
export const isUnambiguousAttemptBatch = (
  attemptNumber: number,
  indexes: number[],
): boolean => {
  if (indexes.length === 0) {
    return false;
  }
  const expected = new Set(expectedIndexesForAttempt(attemptNumber));
  return indexes.every((index) => expected.has(index));
};

export const inferEnvironmentFromCandidates = (params: {
  productPhotoUrl: string;
  candidates: Array<{ blobUrl: string | null; lumaGenerationId: string | null }>;
}): AttemptEnvironment => {
  const withUrl = params.candidates.filter((candidate) => candidate.blobUrl);
  if (withUrl.length > 0) {
    const allTestLike = withUrl.every((candidate) => {
      const url = candidate.blobUrl!;
      return (
        url.includes("/demo/") ||
        url === params.productPhotoUrl ||
        url.endsWith(params.productPhotoUrl)
      );
    });
    return allTestLike ? "test" : "luma";
  }
  return params.candidates.some((candidate) => candidate.lumaGenerationId) ? "luma" : "test";
};

export const deriveStatusFromCandidates = (
  candidates: Array<{ status: string; reviewDecision: string | null }>,
): string => {
  if (candidates.length === 0) {
    return "empty";
  }
  if (candidates.some((c) => c.status === "pending" || c.status === "submitted")) {
    return "generating";
  }
  const ready = candidates.filter((c) => c.status === "ready");
  if (ready.length === 0) {
    return "failed";
  }
  if (ready.some((c) => !c.reviewDecision)) {
    return "awaiting_review";
  }
  const approvedCount = ready.filter((c) => c.reviewDecision === "approved").length;
  if (approvedCount >= 2) {
    return "completed";
  }
  return "needs_regeneration";
};

export type PlanAttemptBackfillParams = {
  shotRequestId: string;
  productSku: string;
  shotIdea: string;
  productPhotoUrl: string;
  candidates: BackfillCandidate[];
};

/**
 * Plan attempt rows for candidates that are not yet linked.
 * Uses only the historical shared key (request + candidate_index batch).
 * Invalid indexes (or otherwise unsafe batches) collapse into one Legacy generation
 * without inventing attempt numbers.
 */
export const planAttemptBackfillForRequest = (
  params: PlanAttemptBackfillParams,
): PlannedAttempt[] => {
  const unlinked = params.candidates.filter((candidate) => !candidate.generationAttemptId);
  if (unlinked.length === 0) {
    return [];
  }

  const buildLegacy = (rows: BackfillCandidate[]): PlannedAttempt => {
    const sorted = [...rows].sort((a, b) => a.candidateIndex - b.candidateIndex);
    const environment = inferEnvironmentFromCandidates({
      productPhotoUrl: params.productPhotoUrl,
      candidates: sorted,
    });
    const createdAt = sorted.reduce(
      (earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest),
      sorted[0]!.createdAt,
    );
    const errorMessage =
      sorted.map((row) => row.errorMessage).find((message) => Boolean(message)) ?? null;

    return {
      id: stableLegacyGenerationAttemptId(params.shotRequestId),
      shotRequestId: params.shotRequestId,
      productSku: params.productSku,
      attemptNumber: null,
      isLegacy: true,
      label: LEGACY_GENERATION_LABEL,
      shotIdea: params.shotIdea,
      aspectRatio: MVP_ASPECT_RATIO,
      environment,
      status: deriveStatusFromCandidates(sorted),
      errorMessage,
      createdAt,
      candidateIds: sorted.map((row) => row.id),
    };
  };

  // Unsafe: non-positive indexes are outside the historical attempt scheme.
  if (unlinked.some((candidate) => candidate.candidateIndex < 1)) {
    return [buildLegacy(unlinked)];
  }

  const byBatch = new Map<number, BackfillCandidate[]>();
  for (const candidate of unlinked) {
    const key = sharedAttemptKeyFromCandidateIndex(candidate.candidateIndex);
    const list = byBatch.get(key) ?? [];
    list.push(candidate);
    byBatch.set(key, list);
  }

  const unambiguous: PlannedAttempt[] = [];
  const ambiguousCandidates: BackfillCandidate[] = [];

  for (const [attemptNumber, rows] of [...byBatch.entries()].sort((a, b) => a[0] - b[0])) {
    const indexes = rows.map((row) => row.candidateIndex);
    if (!isUnambiguousAttemptBatch(attemptNumber, indexes)) {
      ambiguousCandidates.push(...rows);
      continue;
    }

    const sorted = [...rows].sort((a, b) => a.candidateIndex - b.candidateIndex);
    const environment = inferEnvironmentFromCandidates({
      productPhotoUrl: params.productPhotoUrl,
      candidates: sorted,
    });
    const createdAt = sorted.reduce(
      (earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest),
      sorted[0]!.createdAt,
    );
    const errorMessage =
      sorted.map((row) => row.errorMessage).find((message) => Boolean(message)) ?? null;

    unambiguous.push({
      id: stableGenerationAttemptId(params.shotRequestId, attemptNumber),
      shotRequestId: params.shotRequestId,
      productSku: params.productSku,
      attemptNumber,
      isLegacy: false,
      label: formatGenerationAttemptLabel({ attemptNumber, isLegacy: false }),
      shotIdea: params.shotIdea,
      aspectRatio: MVP_ASPECT_RATIO,
      environment,
      status: deriveStatusFromCandidates(sorted),
      errorMessage,
      createdAt,
      candidateIds: sorted.map((row) => row.id),
    });
  }

  if (ambiguousCandidates.length > 0) {
    // Do not invent numbers for unsafe rows; keep one Legacy bucket for the request.
    return [buildLegacy(unlinked)];
  }

  return unambiguous;
};

export const localDisplayIndexForCandidate = (params: {
  candidateIndex: number;
  isLegacy: boolean;
  positionInAttempt: number;
}): number => {
  if (params.isLegacy) {
    return params.positionInAttempt;
  }
  return displayCandidateIndexInAttempt(params.candidateIndex);
};
