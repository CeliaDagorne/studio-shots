import { CANDIDATES_PER_REQUEST } from "@/lib/request-planning";

export const WORKFLOW = {
  importedUnconfirmed: "imported_unconfirmed",
  generating: "generating",
  awaitingReview: "awaiting_review",
  approved: "approved",
  needsRegeneration: "needs_regeneration",
  failed: "failed",
} as const;

export const CANDIDATE_STATUS = {
  pending: "pending",
  submitted: "submitted",
  ready: "ready",
  failed: "failed",
} as const;

export const REVIEW_DECISION = {
  approved: "approved",
  rejected: "rejected",
} as const;

export const MIN_APPROVALS_TO_COMPLETE = 2;
export const PRIORITY_CANDIDATE_COUNT = CANDIDATES_PER_REQUEST;

/** Stable attempt label derived from 1-based candidate indices (1–3 → attempt-1, …). */
export const generationAttemptId = (candidateIndex: number): string =>
  `attempt-${Math.ceil(candidateIndex / PRIORITY_CANDIDATE_COUNT)}`;

/** 1-based attempt number for a candidate index (4 → 2). */
export const generationAttemptNumber = (candidateIndex: number): number =>
  Math.ceil(candidateIndex / PRIORITY_CANDIDATE_COUNT);

/** Display index within an attempt (4 → 1, 5 → 2, 6 → 3). */
export const displayCandidateIndexInAttempt = (candidateIndex: number): number =>
  ((candidateIndex - 1) % PRIORITY_CANDIDATE_COUNT) + 1;

/** Next 1-based candidateIndex to start a new generation attempt. */
export const nextGenerationAttemptStartIndex = (
  existingCandidates: Array<{ candidateIndex: number }>,
): number => {
  if (existingCandidates.length === 0) {
    return 1;
  }
  const maxIndex = Math.max(
    ...existingCandidates.map((candidate) => candidate.candidateIndex),
  );
  return Math.ceil(maxIndex / PRIORITY_CANDIDATE_COUNT) * PRIORITY_CANDIDATE_COUNT + 1;
};

/**
 * Keep only candidates from the latest generation attempt.
 * Prior attempts stay immutable for history.
 */
export const filterLatestGenerationAttempt = <T extends { candidateIndex: number }>(
  candidates: T[],
): T[] => {
  if (candidates.length === 0) {
    return [];
  }
  const maxIndex = Math.max(...candidates.map((candidate) => candidate.candidateIndex));
  const attemptStart =
    Math.floor((maxIndex - 1) / PRIORITY_CANDIDATE_COUNT) * PRIORITY_CANDIDATE_COUNT + 1;
  const attemptEnd = attemptStart + PRIORITY_CANDIDATE_COUNT - 1;
  return candidates.filter(
    (candidate) =>
      candidate.candidateIndex >= attemptStart && candidate.candidateIndex <= attemptEnd,
  );
};

export type RequestResolution =
  | { status: typeof WORKFLOW.awaitingReview }
  | { status: typeof WORKFLOW.approved; approvedCount: number }
  | { status: typeof WORKFLOW.needsRegeneration; approvedCount: number };

/**
 * Resolve a shot request only after every available (non-failed) candidate
 * in the latest generation attempt has an approve/reject decision.
 * Pass already-filtered latest-attempt candidates, or full history (auto-filtered).
 */
export const resolveRequestAfterReviews = (candidates: Array<{
  status: string;
  reviewDecision: string | null;
  candidateIndex?: number;
}>): RequestResolution => {
  const latest =
    candidates.length > 0 &&
    candidates.every((candidate) => typeof candidate.candidateIndex === "number")
      ? filterLatestGenerationAttempt(
          candidates as Array<{
            status: string;
            reviewDecision: string | null;
            candidateIndex: number;
          }>,
        )
      : candidates;

  const available = latest.filter((candidate) => candidate.status === CANDIDATE_STATUS.ready);
  if (available.length === 0) {
    return { status: WORKFLOW.needsRegeneration, approvedCount: 0 };
  }

  const unresolved = available.filter((candidate) => !candidate.reviewDecision);
  if (unresolved.length > 0) {
    return { status: WORKFLOW.awaitingReview };
  }

  const approvedCount = available.filter(
    (candidate) => candidate.reviewDecision === REVIEW_DECISION.approved,
  ).length;

  if (approvedCount >= MIN_APPROVALS_TO_COMPLETE) {
    return { status: WORKFLOW.approved, approvedCount };
  }

  return { status: WORKFLOW.needsRegeneration, approvedCount };
};

export const candidateCaption = (params: {
  sku: string;
  index: number;
  total: number;
  reviewDecision?: string | null;
}): string => {
  const base = `${params.sku} candidate ${params.index}/${params.total}`;
  if (params.reviewDecision === REVIEW_DECISION.approved) {
    return `${base}\n✅ Approved`;
  }
  if (params.reviewDecision === REVIEW_DECISION.rejected) {
    return `${base}\n❌ Rejected`;
  }
  return `${base}\nReview this candidate independently.`;
};
