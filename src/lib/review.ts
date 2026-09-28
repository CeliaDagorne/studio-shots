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

export type RequestResolution =
  | { status: typeof WORKFLOW.awaitingReview }
  | { status: typeof WORKFLOW.approved; approvedCount: number }
  | { status: typeof WORKFLOW.needsRegeneration; approvedCount: number };

/**
 * Resolve a shot request only after every available (non-failed) candidate
 * has an approve/reject decision.
 */
export const resolveRequestAfterReviews = (candidates: Array<{
  status: string;
  reviewDecision: string | null;
}>): RequestResolution => {
  const available = candidates.filter((candidate) => candidate.status === CANDIDATE_STATUS.ready);
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
    return `${base}\nStatus: Approved`;
  }
  if (params.reviewDecision === REVIEW_DECISION.rejected) {
    return `${base}\nStatus: Rejected`;
  }
  return `${base}\nReview this candidate independently.`;
};
