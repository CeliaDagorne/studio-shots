import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { CANDIDATE_STATUS, REVIEW_DECISION } from "@/lib/review";
import { generationCandidates, products } from "@/lib/schema";

export type ApprovedCandidateView = {
  id: string;
  candidateIndex: number;
  blobUrl: string;
  blobPath: string | null;
};

export type ProductPageData = {
  sku: string;
  productName: string;
  category: string;
  colorOrFinish: string;
  material: string;
  priceCents: number;
  photoUrl: string;
  approvedCandidates: ApprovedCandidateView[];
};

export const buildProductPageUrl = (appUrl: string, sku: string): string => {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/products/${encodeURIComponent(sku)}`;
};

export const formatPriceCents = (priceCents: number): string => {
  const dollars = Math.floor(priceCents / 100);
  const cents = priceCents % 100;
  return `$${dollars}.${String(cents).padStart(2, "0")}`;
};

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
    .filter(
      (candidate) =>
        candidate.status === CANDIDATE_STATUS.ready &&
        candidate.reviewDecision === REVIEW_DECISION.approved &&
        Boolean(candidate.blobUrl),
    )
    .sort((a, b) => a.candidateIndex - b.candidateIndex)
    .map((candidate) => ({
      id: candidate.id,
      candidateIndex: candidate.candidateIndex,
      blobUrl: candidate.blobUrl!,
      blobPath: candidate.blobPath,
    }));

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
export const getProductPageData = async (sku: string): Promise<ProductPageData | null> => {
  const db = getDb();
  const productRows = await db.select().from(products).where(eq(products.sku, sku)).limit(1);
  const product = productRows[0];
  if (!product) {
    return null;
  }

  const candidateRows = await db
    .select()
    .from(generationCandidates)
    .where(
      and(
        eq(generationCandidates.productSku, sku),
        eq(generationCandidates.status, CANDIDATE_STATUS.ready),
        eq(generationCandidates.reviewDecision, REVIEW_DECISION.approved),
      ),
    )
    .orderBy(asc(generationCandidates.candidateIndex));

  return {
    sku: product.sku,
    productName: product.productName,
    category: product.category,
    colorOrFinish: product.colorOrFinish,
    material: product.material,
    priceCents: product.priceCents,
    photoUrl: product.photoUrl,
    approvedCandidates: filterApprovedCandidates(candidateRows),
  };
};
