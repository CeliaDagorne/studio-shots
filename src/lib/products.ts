import { and, asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  formatGenerationAttemptLabel,
  localDisplayIndexForCandidate,
  planAttemptBackfillForRequest,
  type PlannedAttempt,
} from "@/lib/generation-attempts";
import { parseImportWarningsPayload } from "@/lib/import-meta";
import {
  CANDIDATE_STATUS,
  MIN_APPROVALS_TO_COMPLETE,
  PRIORITY_CANDIDATE_COUNT,
  REVIEW_DECISION,
  WORKFLOW,
  displayCandidateIndexInAttempt,
  generationAttemptNumber,
} from "@/lib/review";
import {
  CANDIDATES_PER_REQUEST,
  IMAGE_REF_COST_USD_MICROS,
  MVP_ASPECT_RATIO,
  formatUsdMicros,
} from "@/lib/request-planning";
import {
  generationAttempts,
  generationCandidates,
  imports,
  products,
  shotRequests,
} from "@/lib/schema";

export type ApprovedCandidateView = {
  id: string;
  /** Raw DB candidate_index (may be 4+ across retries). */
  candidateIndex: number;
  /** 1-based generation attempt. */
  attemptNumber: number;
  /** Display index within the attempt (1–3). */
  displayIndex: number;
  totalInAttempt: number;
  blobUrl: string;
  blobPath: string | null;
};

export type ApprovedAttemptView = {
  attemptNumber: number;
  candidates: ApprovedCandidateView[];
};

export type ProductPageData = {
  sku: string;
  productName: string;
  category: string;
  colorOrFinish: string;
  material: string;
  priceCents: number;
  photoUrl: string;
  shotIdea: string | null;
  workflowStatus: string | null;
  workflowStatusLabel: string | null;
  requestId: string | null;
  /** Approved candidates only (campaign + request scoped). */
  approvedCandidates: ApprovedCandidateView[];
  generationAttemptCount: number;
  campaignPagePath: string | null;
  historyPagePath: string | null;
  productPagePath: string;
  scopedImportId: string | null;
};

export type HistoryCandidateView = {
  id: string;
  candidateIndex: number;
  displayIndex: number;
  totalInAttempt: number;
  status: string;
  reviewDecision: string | null;
  reviewDecisionLabel: string;
  blobUrl: string | null;
  errorMessage: string | null;
  lumaGenerationId: string | null;
  externalMessageId: string | null;
  createdAt: Date;
};

export type HistoryAttemptView = {
  id: string;
  attemptNumber: number | null;
  isLegacy: boolean;
  label: string;
  createdAt: Date;
  createdAtLabel: string;
  environment: "test" | "luma";
  environmentLabel: string;
  shotIdea: string;
  aspectRatio: string;
  costLabel: string;
  status: string;
  statusLabel: string;
  candidates: HistoryCandidateView[];
};

export type ProductHistoryPageData = {
  sku: string;
  productName: string;
  photoUrl: string;
  shotIdea: string | null;
  workflowStatus: string | null;
  workflowStatusLabel: string | null;
  requestId: string | null;
  attempts: HistoryAttemptView[];
  generationAttemptCount: number;
  campaignPagePath: string | null;
  productPagePath: string;
  scopedImportId: string | null;
};

export const buildProductPageUrl = (appUrl: string, sku: string): string => {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/products/${encodeURIComponent(sku)}`;
};

export const buildProductPagePath = (
  sku: string,
  options?: { campaignImportId?: string | null },
): string => {
  const path = `/products/${encodeURIComponent(sku)}`;
  if (!options?.campaignImportId) {
    return path;
  }
  return `${path}?campaign=${encodeURIComponent(options.campaignImportId)}`;
};

export const buildProductHistoryPagePath = (
  sku: string,
  options?: { campaignImportId?: string | null },
): string => {
  const path = `/products/${encodeURIComponent(sku)}/history`;
  if (!options?.campaignImportId) {
    return path;
  }
  return `${path}?campaign=${encodeURIComponent(options.campaignImportId)}`;
};

export const formatPriceCents = (priceCents: number): string => {
  const dollars = Math.floor(priceCents / 100);
  const cents = priceCents % 100;
  return `$${dollars}.${String(cents).padStart(2, "0")}`;
};

export const readCampaignImportId = (
  value: string | string[] | undefined,
): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim());
    return first?.trim() ?? null;
  }
  return null;
};

export const toApprovedCandidateView = (candidate: {
  id: string;
  candidateIndex: number;
  blobUrl: string;
  blobPath: string | null;
}): ApprovedCandidateView => ({
  id: candidate.id,
  candidateIndex: candidate.candidateIndex,
  attemptNumber: generationAttemptNumber(candidate.candidateIndex),
  displayIndex: displayCandidateIndexInAttempt(candidate.candidateIndex),
  totalInAttempt: PRIORITY_CANDIDATE_COUNT,
  blobUrl: candidate.blobUrl,
  blobPath: candidate.blobPath,
});

export const isApprovedGalleryCandidate = (candidate: {
  status: string;
  reviewDecision: string | null;
  blobUrl: string | null;
}): boolean =>
  candidate.status === CANDIDATE_STATUS.ready &&
  candidate.reviewDecision === REVIEW_DECISION.approved &&
  Boolean(candidate.blobUrl);

export const filterApprovedCandidates = <
  T extends {
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    id: string;
    candidateIndex: number;
    blobPath: string | null;
  },
>(
  candidates: T[],
): ApprovedCandidateView[] =>
  candidates
    .filter(isApprovedGalleryCandidate)
    .sort((a, b) => a.candidateIndex - b.candidateIndex)
    .map((candidate) =>
      toApprovedCandidateView({
        id: candidate.id,
        candidateIndex: candidate.candidateIndex,
        blobUrl: candidate.blobUrl!,
        blobPath: candidate.blobPath,
      }),
    );

/**
 * Shared approved-image count used by campaign cards and product pages.
 * Requires ready + approved + blob-backed — never depends on generation_attempt_id.
 */
export const countApprovedGalleryImages = (
  candidates: Array<{
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
  }>,
): number => candidates.filter(isApprovedGalleryCandidate).length;

/**
 * Group approved candidates into attempts (newest first).
 * Display indices are always 1–3 within each attempt.
 */
export const groupApprovedCandidatesByAttempt = (
  candidates: ApprovedCandidateView[],
): ApprovedAttemptView[] => {
  const byAttempt = new Map<number, ApprovedCandidateView[]>();
  for (const candidate of candidates) {
    const list = byAttempt.get(candidate.attemptNumber) ?? [];
    list.push(candidate);
    byAttempt.set(candidate.attemptNumber, list);
  }

  return [...byAttempt.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([attemptNumber, rows]) => ({
      attemptNumber,
      candidates: [...rows].sort((a, b) => a.displayIndex - b.displayIndex),
    }));
};

/**
 * Drop any candidate whose URL clearly belongs to another catalog SKU's demo asset.
 */
export const excludeForeignSkuDemoUrls = <T extends { blobUrl: string | null }>(
  sku: string,
  candidates: T[],
): T[] => {
  const normalizedSku = sku.trim().toLowerCase();
  return candidates.filter((candidate) => {
    if (!candidate.blobUrl) {
      return true;
    }
    const url = candidate.blobUrl.toLowerCase();
    const demoMatch = url.match(/\/demo\/(ss-\d{3})-/i);
    if (!demoMatch) {
      return true;
    }
    return demoMatch[1] === normalizedSku;
  });
};

export const formatReviewDecisionLabel = (decision: string | null): string => {
  if (decision === REVIEW_DECISION.approved) {
    return "Approved";
  }
  if (decision === REVIEW_DECISION.rejected) {
    return "Rejected";
  }
  return "Pending review";
};

export const formatProductWorkflowStatusLabel = (status: string): string => {
  switch (status) {
    case WORKFLOW.importedUnconfirmed:
      return "Ready to generate";
    case WORKFLOW.generating:
      return "Generating";
    case WORKFLOW.awaitingReview:
      return "Awaiting review";
    case WORKFLOW.approved:
      return "Completed";
    case WORKFLOW.needsRegeneration:
      return "Needs regeneration";
    case WORKFLOW.failed:
      return "Failed";
    default:
      return status.replaceAll("_", " ");
  }
};

export const inferAttemptEnvironment = (params: {
  productPhotoUrl: string;
  candidates: Array<{ blobUrl: string | null; lumaGenerationId: string | null }>;
}): "test" | "luma" => {
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
    if (allTestLike) {
      return "test";
    }
    return "luma";
  }
  return params.candidates.some((candidate) => candidate.lumaGenerationId) ? "luma" : "test";
};

export const deriveAttemptStatus = (
  candidates: Array<{ status: string; reviewDecision: string | null }>,
): string => {
  if (candidates.length === 0) {
    return "empty";
  }
  if (
    candidates.some(
      (candidate) =>
        candidate.status === CANDIDATE_STATUS.pending ||
        candidate.status === CANDIDATE_STATUS.submitted,
    )
  ) {
    return "generating";
  }

  const ready = candidates.filter((candidate) => candidate.status === CANDIDATE_STATUS.ready);
  if (ready.length === 0) {
    return "failed";
  }
  if (ready.some((candidate) => !candidate.reviewDecision)) {
    return "awaiting_review";
  }

  const approvedCount = ready.filter(
    (candidate) => candidate.reviewDecision === REVIEW_DECISION.approved,
  ).length;
  if (approvedCount >= MIN_APPROVALS_TO_COMPLETE) {
    return "completed";
  }
  return "needs_regeneration";
};

export const formatAttemptStatusLabel = (status: string): string => {
  switch (status) {
    case "generating":
      return "Generating";
    case "awaiting_review":
      return "Awaiting review";
    case "completed":
      return "Completed";
    case "needs_regeneration":
      return "Needs regeneration";
    case "failed":
      return "Failed";
    case "empty":
      return "No candidates";
    default:
      return status.replaceAll("_", " ");
  }
};

export const formatAttemptTimestamp = (date: Date): string =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);

export const formatAttemptCostLabel = (params: {
  environment: "test" | "luma";
  chargedCandidateCount: number;
}): string => {
  if (params.environment === "test") {
    return "$0.00 (test mode)";
  }
  if (params.chargedCandidateCount <= 0) {
    return `~${formatUsdMicros(CANDIDATES_PER_REQUEST * IMAGE_REF_COST_USD_MICROS)} estimated`;
  }
  return formatUsdMicros(params.chargedCandidateCount * IMAGE_REF_COST_USD_MICROS);
};

export const groupHistoryCandidatesByAttempt = (params: {
  productPhotoUrl: string;
  shotIdea: string;
  candidates: Array<{
    id: string;
    candidateIndex: number;
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    errorMessage: string | null;
    lumaGenerationId: string | null;
    externalMessageId: string | null;
    createdAt: Date;
    generationAttemptId?: string | null;
  }>;
}): HistoryAttemptView[] => {
  // This helper reconstructs from the historical shared candidate_index batch key.
  // Linked attempt ids are ignored here; callers with stored attempts use the DB path.
  const planned = planAttemptBackfillForRequest({
    shotRequestId: "history-preview",
    productSku: "history-preview",
    shotIdea: params.shotIdea,
    productPhotoUrl: params.productPhotoUrl,
    candidates: params.candidates.map((candidate) => ({
      id: candidate.id,
      shotRequestId: "history-preview",
      productSku: "history-preview",
      candidateIndex: candidate.candidateIndex,
      status: candidate.status,
      reviewDecision: candidate.reviewDecision,
      blobUrl: candidate.blobUrl,
      errorMessage: candidate.errorMessage,
      lumaGenerationId: candidate.lumaGenerationId,
      createdAt: candidate.createdAt,
      generationAttemptId: null,
    })),
  });

  return plannedAttemptsToHistoryViews({
    planned,
    productPhotoUrl: params.productPhotoUrl,
    candidates: params.candidates,
  });
};

const plannedAttemptsToHistoryViews = (params: {
  planned: PlannedAttempt[];
  productPhotoUrl: string;
  candidates: Array<{
    id: string;
    candidateIndex: number;
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    errorMessage: string | null;
    lumaGenerationId: string | null;
    externalMessageId: string | null;
    createdAt: Date;
  }>;
}): HistoryAttemptView[] => {
  const byId = new Map(params.candidates.map((candidate) => [candidate.id, candidate]));

  return [...params.planned]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((attempt) => {
      const rows = attempt.candidateIds
        .map((id) => byId.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => a.candidateIndex - b.candidateIndex);
      const environment = (attempt.environment === "test" ? "test" : "luma") as
        | "test"
        | "luma";
      const chargedCandidateCount = rows.filter((row) => Boolean(row.lumaGenerationId)).length;

      return {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        isLegacy: attempt.isLegacy,
        label: attempt.label,
        createdAt: attempt.createdAt,
        createdAtLabel: formatAttemptTimestamp(attempt.createdAt),
        environment,
        environmentLabel: environment === "test" ? "Test mode" : "Luma",
        shotIdea: attempt.shotIdea,
        aspectRatio: attempt.aspectRatio,
        costLabel: formatAttemptCostLabel({ environment, chargedCandidateCount }),
        status: attempt.status,
        statusLabel: formatAttemptStatusLabel(attempt.status),
        candidates: rows.map((candidate, position) => ({
          id: candidate.id,
          candidateIndex: candidate.candidateIndex,
          displayIndex: localDisplayIndexForCandidate({
            candidateIndex: candidate.candidateIndex,
            isLegacy: attempt.isLegacy,
            positionInAttempt: position + 1,
          }),
          totalInAttempt: attempt.isLegacy ? rows.length : PRIORITY_CANDIDATE_COUNT,
          status: candidate.status,
          reviewDecision: candidate.reviewDecision,
          reviewDecisionLabel: formatReviewDecisionLabel(candidate.reviewDecision),
          blobUrl: candidate.blobUrl,
          errorMessage: candidate.errorMessage,
          lumaGenerationId: candidate.lumaGenerationId,
          externalMessageId: candidate.externalMessageId,
          createdAt: candidate.createdAt,
        })),
      };
    });
};

const historyViewsFromStoredAttempts = (params: {
  attempts: Array<{
    id: string;
    attemptNumber: number | null;
    isLegacy: boolean;
    shotIdea: string;
    aspectRatio: string;
    environment: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: Date;
  }>;
  productPhotoUrl: string;
  candidates: Array<{
    id: string;
    generationAttemptId: string | null;
    candidateIndex: number;
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    errorMessage: string | null;
    lumaGenerationId: string | null;
    externalMessageId: string | null;
    createdAt: Date;
  }>;
}): HistoryAttemptView[] => {
  const byAttempt = new Map<string, typeof params.candidates>();
  for (const candidate of params.candidates) {
    if (!candidate.generationAttemptId) continue;
    const list = byAttempt.get(candidate.generationAttemptId) ?? [];
    list.push(candidate);
    byAttempt.set(candidate.generationAttemptId, list);
  }

  return [...params.attempts]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((attempt) => {
      const rows = [...(byAttempt.get(attempt.id) ?? [])].sort(
        (a, b) => a.candidateIndex - b.candidateIndex,
      );
      const environment =
        attempt.environment === "test" || attempt.environment === "luma"
          ? attempt.environment
          : inferAttemptEnvironment({
              productPhotoUrl: params.productPhotoUrl,
              candidates: rows,
            });
      const chargedCandidateCount = rows.filter((row) => Boolean(row.lumaGenerationId)).length;
      const status = attempt.status || deriveAttemptStatus(rows);

      return {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        isLegacy: attempt.isLegacy,
        label: formatGenerationAttemptLabel({
          attemptNumber: attempt.attemptNumber,
          isLegacy: attempt.isLegacy,
        }),
        createdAt: attempt.createdAt,
        createdAtLabel: formatAttemptTimestamp(attempt.createdAt),
        environment,
        environmentLabel: environment === "test" ? "Test mode" : "Luma",
        shotIdea: attempt.shotIdea,
        aspectRatio: attempt.aspectRatio || MVP_ASPECT_RATIO,
        costLabel: formatAttemptCostLabel({ environment, chargedCandidateCount }),
        status,
        statusLabel: formatAttemptStatusLabel(status),
        candidates: rows.map((candidate, position) => ({
          id: candidate.id,
          candidateIndex: candidate.candidateIndex,
          displayIndex: localDisplayIndexForCandidate({
            candidateIndex: candidate.candidateIndex,
            isLegacy: attempt.isLegacy,
            positionInAttempt: position + 1,
          }),
          totalInAttempt: attempt.isLegacy ? rows.length : PRIORITY_CANDIDATE_COUNT,
          status: candidate.status,
          reviewDecision: candidate.reviewDecision,
          reviewDecisionLabel: formatReviewDecisionLabel(candidate.reviewDecision),
          blobUrl: candidate.blobUrl,
          errorMessage: candidate.errorMessage ?? attempt.errorMessage,
          lumaGenerationId: candidate.lumaGenerationId,
          externalMessageId: candidate.externalMessageId,
          createdAt: candidate.createdAt,
        })),
      };
    });
};

export const formatApprovalCompletionMessage = (params: {
  sku: string;
  approvedCount: number;
  productPageUrl: string;
  campaignPageUrl?: string | null;
}): string => {
  const lines = [
    `${params.sku} marked approved (${params.approvedCount} approvals).`,
    `Product page: ${params.productPageUrl}`,
  ];
  if (params.campaignPageUrl) {
    lines.push(`Campaign: ${params.campaignPageUrl}`);
  }
  return lines.join("\n");
};

const resolveScopedImportId = async (
  sku: string,
  preferredImportId?: string | null,
): Promise<string | null> => {
  const db = getDb();

  if (preferredImportId) {
    const preferred = await db
      .select({ id: imports.id })
      .from(imports)
      .where(eq(imports.id, preferredImportId))
      .limit(1);
    // Explicit campaign query must not silently fall back to another Neon branch's import.
    return preferred[0]?.id ?? null;
  }

  const latestForSku = await db
    .select({ importId: shotRequests.importId })
    .from(shotRequests)
    .where(eq(shotRequests.productSku, sku))
    .orderBy(desc(shotRequests.updatedAt))
    .limit(1);

  return latestForSku[0]?.importId ?? null;
};

const loadScopedRequest = async (params: {
  sku: string;
  importId: string;
}) => {
  const db = getDb();
  const owned = await db
    .select({
      id: shotRequests.id,
      shotIdea: shotRequests.shotIdea,
      workflowStatus: shotRequests.workflowStatus,
      approvedCount: shotRequests.approvedCount,
    })
    .from(shotRequests)
    .where(
      and(
        eq(shotRequests.productSku, params.sku),
        eq(shotRequests.importId, params.importId),
      ),
    )
    .orderBy(desc(shotRequests.updatedAt))
    .limit(1);
  if (owned[0]) {
    return owned[0];
  }

  // Campaign overviews may surface a SKU via catalogProducts.requestId even when
  // that shot request row is owned by an earlier import (unchanged hash). Follow
  // the same linkage so product/history pages match the campaign card.
  const importRows = await db
    .select({ warnings: imports.warnings })
    .from(imports)
    .where(eq(imports.id, params.importId))
    .limit(1);
  const payload = parseImportWarningsPayload(importRows[0]?.warnings);
  const linkedOptions = [
    ...(payload.catalogProducts ?? []),
    ...payload.actionable,
  ];
  const linkedRequestId = linkedOptions.find((option) => option.sku === params.sku)
    ?.requestId;
  if (!linkedRequestId) {
    return null;
  }

  const linked = await db
    .select({
      id: shotRequests.id,
      shotIdea: shotRequests.shotIdea,
      workflowStatus: shotRequests.workflowStatus,
      approvedCount: shotRequests.approvedCount,
    })
    .from(shotRequests)
    .where(
      and(eq(shotRequests.id, linkedRequestId), eq(shotRequests.productSku, params.sku)),
    )
    .limit(1);
  return linked[0] ?? null;
};

const emptyProductPageData = (product: {
  sku: string;
  productName: string;
  category: string;
  colorOrFinish: string;
  material: string;
  priceCents: number;
  photoUrl: string;
}): ProductPageData => ({
  sku: product.sku,
  productName: product.productName,
  category: product.category,
  colorOrFinish: product.colorOrFinish,
  material: product.material,
  priceCents: product.priceCents,
  photoUrl: product.photoUrl,
  shotIdea: null,
  workflowStatus: null,
  workflowStatusLabel: null,
  requestId: null,
  approvedCandidates: [],
  generationAttemptCount: 0,
  campaignPagePath: null,
  historyPagePath: null,
  productPagePath: buildProductPagePath(product.sku),
  scopedImportId: null,
});

export const getProductPageData = async (
  sku: string,
  options?: { campaignImportId?: string | null },
): Promise<ProductPageData | null> => {
  const db = getDb();
  const productRows = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
  const product = productRows[0];
  if (!product) {
    return null;
  }

  const scopedImportId = await resolveScopedImportId(sku, options?.campaignImportId);
  if (!scopedImportId) {
    return emptyProductPageData(product);
  }

  const request = await loadScopedRequest({ sku, importId: scopedImportId });
  const campaignPagePath = `/campaigns/${encodeURIComponent(scopedImportId)}`;
  const productPagePath = buildProductPagePath(sku, { campaignImportId: scopedImportId });
  const historyPagePath = buildProductHistoryPagePath(sku, {
    campaignImportId: scopedImportId,
  });

  if (!request) {
    return {
      ...emptyProductPageData(product),
      campaignPagePath,
      historyPagePath,
      productPagePath,
      scopedImportId,
    };
  }

  let candidateRows: Array<{
    id: string;
    generationAttemptId: string | null;
    candidateIndex: number;
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    blobPath: string | null;
    errorMessage: string | null;
    lumaGenerationId: string | null;
    externalMessageId: string | null;
    createdAt: Date;
  }>;

  try {
    candidateRows = await db
      .select({
        id: generationCandidates.id,
        generationAttemptId: generationCandidates.generationAttemptId,
        candidateIndex: generationCandidates.candidateIndex,
        status: generationCandidates.status,
        reviewDecision: generationCandidates.reviewDecision,
        blobUrl: generationCandidates.blobUrl,
        blobPath: generationCandidates.blobPath,
        errorMessage: generationCandidates.errorMessage,
        lumaGenerationId: generationCandidates.lumaGenerationId,
        externalMessageId: generationCandidates.externalMessageId,
        createdAt: generationCandidates.createdAt,
      })
      .from(generationCandidates)
      .where(
        and(
          eq(generationCandidates.shotRequestId, request.id),
          eq(generationCandidates.productSku, sku),
        ),
      )
      .orderBy(asc(generationCandidates.candidateIndex));
  } catch {
    // Pre-migration schemas may lack generation_attempt_id.
    const withoutAttemptId = await db
      .select({
        id: generationCandidates.id,
        candidateIndex: generationCandidates.candidateIndex,
        status: generationCandidates.status,
        reviewDecision: generationCandidates.reviewDecision,
        blobUrl: generationCandidates.blobUrl,
        blobPath: generationCandidates.blobPath,
        errorMessage: generationCandidates.errorMessage,
        lumaGenerationId: generationCandidates.lumaGenerationId,
        externalMessageId: generationCandidates.externalMessageId,
        createdAt: generationCandidates.createdAt,
      })
      .from(generationCandidates)
      .where(
        and(
          eq(generationCandidates.shotRequestId, request.id),
          eq(generationCandidates.productSku, sku),
        ),
      )
      .orderBy(asc(generationCandidates.candidateIndex));
    candidateRows = withoutAttemptId.map((row) => ({
      ...row,
      generationAttemptId: null,
    }));
  }

  const scopedCandidates = excludeForeignSkuDemoUrls(sku, candidateRows);
  // Approved gallery never depends on generation_attempt_id (may be null pre-backfill).
  const approvedCandidates = filterApprovedCandidates(scopedCandidates);

  const historyAttempts = await buildHistoryAttemptsForRequest({
    shotRequestId: request.id,
    shotIdea: request.shotIdea,
    productPhotoUrl: product.photoUrl,
    sku,
    candidates: scopedCandidates,
  });

  return {
    sku: product.sku,
    productName: product.productName,
    category: product.category,
    colorOrFinish: product.colorOrFinish,
    material: product.material,
    priceCents: product.priceCents,
    photoUrl: product.photoUrl,
    shotIdea: request.shotIdea,
    workflowStatus: request.workflowStatus,
    workflowStatusLabel: formatProductWorkflowStatusLabel(request.workflowStatus),
    requestId: request.id,
    approvedCandidates,
    generationAttemptCount: historyAttempts.length,
    campaignPagePath,
    historyPagePath,
    productPagePath,
    scopedImportId,
  };
};

export const getProductHistoryPageData = async (
  sku: string,
  options?: { campaignImportId?: string | null },
): Promise<ProductHistoryPageData | null> => {
  const db = getDb();
  const productRows = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
  const product = productRows[0];
  if (!product) {
    return null;
  }

  const scopedImportId = await resolveScopedImportId(sku, options?.campaignImportId);
  if (!scopedImportId) {
    return {
      sku: product.sku,
      productName: product.productName,
      photoUrl: product.photoUrl,
      shotIdea: null,
      workflowStatus: null,
      workflowStatusLabel: null,
      requestId: null,
      attempts: [],
      generationAttemptCount: 0,
      campaignPagePath: null,
      productPagePath: buildProductPagePath(sku),
      scopedImportId: null,
    };
  }

  const request = await loadScopedRequest({ sku, importId: scopedImportId });
  const campaignPagePath = `/campaigns/${encodeURIComponent(scopedImportId)}`;
  const productPagePath = buildProductPagePath(sku, { campaignImportId: scopedImportId });

  if (!request) {
    return {
      sku: product.sku,
      productName: product.productName,
      photoUrl: product.photoUrl,
      shotIdea: null,
      workflowStatus: null,
      workflowStatusLabel: null,
      requestId: null,
      attempts: [],
      generationAttemptCount: 0,
      campaignPagePath,
      productPagePath,
      scopedImportId,
    };
  }

  let candidateRows: Array<{
    id: string;
    generationAttemptId: string | null;
    candidateIndex: number;
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    errorMessage: string | null;
    lumaGenerationId: string | null;
    externalMessageId: string | null;
    createdAt: Date;
  }>;

  try {
    candidateRows = await db
      .select({
        id: generationCandidates.id,
        generationAttemptId: generationCandidates.generationAttemptId,
        candidateIndex: generationCandidates.candidateIndex,
        status: generationCandidates.status,
        reviewDecision: generationCandidates.reviewDecision,
        blobUrl: generationCandidates.blobUrl,
        errorMessage: generationCandidates.errorMessage,
        lumaGenerationId: generationCandidates.lumaGenerationId,
        externalMessageId: generationCandidates.externalMessageId,
        createdAt: generationCandidates.createdAt,
      })
      .from(generationCandidates)
      .where(
        and(
          eq(generationCandidates.shotRequestId, request.id),
          eq(generationCandidates.productSku, sku),
        ),
      )
      .orderBy(asc(generationCandidates.candidateIndex));
  } catch {
    const withoutAttemptId = await db
      .select({
        id: generationCandidates.id,
        candidateIndex: generationCandidates.candidateIndex,
        status: generationCandidates.status,
        reviewDecision: generationCandidates.reviewDecision,
        blobUrl: generationCandidates.blobUrl,
        errorMessage: generationCandidates.errorMessage,
        lumaGenerationId: generationCandidates.lumaGenerationId,
        externalMessageId: generationCandidates.externalMessageId,
        createdAt: generationCandidates.createdAt,
      })
      .from(generationCandidates)
      .where(
        and(
          eq(generationCandidates.shotRequestId, request.id),
          eq(generationCandidates.productSku, sku),
        ),
      )
      .orderBy(asc(generationCandidates.candidateIndex));
    candidateRows = withoutAttemptId.map((row) => ({
      ...row,
      generationAttemptId: null,
    }));
  }

  const scopedCandidates = excludeForeignSkuDemoUrls(sku, candidateRows);

  const attempts = await buildHistoryAttemptsForRequest({
    shotRequestId: request.id,
    shotIdea: request.shotIdea,
    productPhotoUrl: product.photoUrl,
    sku,
    candidates: scopedCandidates,
  });

  return {
    sku: product.sku,
    productName: product.productName,
    photoUrl: product.photoUrl,
    shotIdea: request.shotIdea,
    workflowStatus: request.workflowStatus,
    workflowStatusLabel: formatProductWorkflowStatusLabel(request.workflowStatus),
    requestId: request.id,
    attempts,
    generationAttemptCount: attempts.length,
    campaignPagePath,
    productPagePath,
    scopedImportId,
  };
};

const buildHistoryAttemptsForRequest = async (params: {
  shotRequestId: string;
  shotIdea: string;
  productPhotoUrl: string;
  sku: string;
  candidates: Array<{
    id: string;
    generationAttemptId: string | null;
    candidateIndex: number;
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    errorMessage: string | null;
    lumaGenerationId: string | null;
    externalMessageId: string | null;
    createdAt: Date;
  }>;
}): Promise<HistoryAttemptView[]> => {
  const db = getDb();
  let storedAttempts: Array<{
    id: string;
    attemptNumber: number | null;
    isLegacy: boolean;
    shotIdea: string;
    aspectRatio: string;
    environment: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: Date;
  }> = [];

  try {
    storedAttempts = await db
      .select({
        id: generationAttempts.id,
        attemptNumber: generationAttempts.attemptNumber,
        isLegacy: generationAttempts.isLegacy,
        shotIdea: generationAttempts.shotIdea,
        aspectRatio: generationAttempts.aspectRatio,
        environment: generationAttempts.environment,
        status: generationAttempts.status,
        errorMessage: generationAttempts.errorMessage,
        createdAt: generationAttempts.createdAt,
      })
      .from(generationAttempts)
      .where(eq(generationAttempts.shotRequestId, params.shotRequestId))
      .orderBy(desc(generationAttempts.createdAt));
  } catch {
    // Pre-migration databases have no generation_attempts table yet.
    storedAttempts = [];
  }

  return historyViewsIncludingLegacyUnlinked({
    storedAttempts,
    productPhotoUrl: params.productPhotoUrl,
    shotRequestId: params.shotRequestId,
    sku: params.sku,
    shotIdea: params.shotIdea,
    candidates: params.candidates,
  });
};

/**
 * History UI: linked attempt rows first; any candidates with null
 * generation_attempt_id are grouped under "Legacy generation" so pre-migration
 * approvals remain visible and the CTA never reports 0 attempts when they exist.
 */
export const historyViewsIncludingLegacyUnlinked = (params: {
  storedAttempts: Array<{
    id: string;
    attemptNumber: number | null;
    isLegacy: boolean;
    shotIdea: string;
    aspectRatio: string;
    environment: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: Date;
  }>;
  productPhotoUrl: string;
  shotRequestId: string;
  sku: string;
  shotIdea: string;
  candidates: Array<{
    id: string;
    generationAttemptId: string | null;
    candidateIndex: number;
    status: string;
    reviewDecision: string | null;
    blobUrl: string | null;
    errorMessage: string | null;
    lumaGenerationId: string | null;
    externalMessageId: string | null;
    createdAt: Date;
  }>;
}): HistoryAttemptView[] => {
  const unlinked = params.candidates.filter((candidate) => !candidate.generationAttemptId);

  if (params.storedAttempts.length === 0) {
    if (unlinked.length === 0) {
      return [];
    }
    return plannedAttemptsToHistoryViews({
      planned: [
        {
          id: `legacy:${params.shotRequestId}`,
          shotRequestId: params.shotRequestId,
          productSku: params.sku,
          attemptNumber: null,
          isLegacy: true,
          label: formatGenerationAttemptLabel({ attemptNumber: null, isLegacy: true }),
          shotIdea: params.shotIdea,
          aspectRatio: MVP_ASPECT_RATIO,
          environment: inferAttemptEnvironment({
            productPhotoUrl: params.productPhotoUrl,
            candidates: unlinked,
          }),
          status: deriveAttemptStatus(unlinked),
          errorMessage:
            unlinked.map((row) => row.errorMessage).find((message) => Boolean(message)) ??
            null,
          createdAt: unlinked.reduce(
            (earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest),
            unlinked[0]!.createdAt,
          ),
          candidateIds: [...unlinked]
            .sort((a, b) => a.candidateIndex - b.candidateIndex)
            .map((row) => row.id),
        },
      ],
      productPhotoUrl: params.productPhotoUrl,
      candidates: unlinked,
    });
  }

  const linkedViews = historyViewsFromStoredAttempts({
    attempts: params.storedAttempts,
    productPhotoUrl: params.productPhotoUrl,
    candidates: params.candidates,
  });

  if (unlinked.length === 0) {
    return linkedViews;
  }

  const legacyPlanned = planAttemptBackfillForRequest({
    shotRequestId: params.shotRequestId,
    productSku: params.sku,
    shotIdea: params.shotIdea,
    productPhotoUrl: params.productPhotoUrl,
    candidates: unlinked.map((candidate) => ({
      ...candidate,
      productSku: params.sku,
      shotRequestId: params.shotRequestId,
      generationAttemptId: null,
    })),
  }).map((attempt) => ({
    ...attempt,
    isLegacy: true,
    attemptNumber: null,
    label: formatGenerationAttemptLabel({ attemptNumber: null, isLegacy: true }),
  }));

  const legacyViews = plannedAttemptsToHistoryViews({
    planned: legacyPlanned,
    productPhotoUrl: params.productPhotoUrl,
    candidates: unlinked,
  });

  return [...linkedViews, ...legacyViews].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
};
