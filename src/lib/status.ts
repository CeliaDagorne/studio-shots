import { IMAGE_REF_COST_USD_MICROS, formatUsdMicros } from "@/lib/request-planning";
import { WORKFLOW } from "@/lib/review";
import { buildProductPageUrl } from "@/lib/products";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { generationCandidates, products, shotRequests } from "@/lib/schema";

export type StudioStatusSummary = {
  totalProducts: number;
  productsWithShotIdeas: number;
  doneApprovedProducts: number;
  awaitingReviewRequests: number;
  generatingRequests: number;
  readyNotStartedRequests: number;
  needsRegenerationRequests: number;
  failedRequests: number;
  totalCandidatesGenerated: number;
  totalImagesApproved: number;
  estimatedGenerationSpendMicrosUsd: number;
  estimatedGenerationSpendLabel: string;
  approvedProducts: Array<{ sku: string; productPageUrl: string }>;
};

export const aggregateStudioStatus = (params: {
  productSkus: string[];
  requests: Array<{ productSku: string; workflowStatus: string }>;
  candidates: Array<{
    productSku: string;
    status: string;
    reviewDecision: string | null;
    lumaGenerationId: string | null;
  }>;
  appUrl: string;
}): StudioStatusSummary => {
  const productsWithShotIdeas = new Set(params.requests.map((request) => request.productSku)).size;

  const approvedSkus = new Set(
    params.requests
      .filter((request) => request.workflowStatus === WORKFLOW.approved)
      .map((request) => request.productSku),
  );

  const countByStatus = (status: string) =>
    params.requests.filter((request) => request.workflowStatus === status).length;

  const totalCandidatesGenerated = params.candidates.filter((candidate) =>
    Boolean(candidate.lumaGenerationId),
  ).length;

  const totalImagesApproved = params.candidates.filter(
    (candidate) => candidate.reviewDecision === "approved",
  ).length;

  const estimatedGenerationSpendMicrosUsd = totalCandidatesGenerated * IMAGE_REF_COST_USD_MICROS;

  const approvedProducts = [...approvedSkus]
    .sort()
    .map((sku) => ({
      sku,
      productPageUrl: buildProductPageUrl(params.appUrl, sku),
    }));

  return {
    totalProducts: params.productSkus.length,
    productsWithShotIdeas,
    doneApprovedProducts: approvedSkus.size,
    awaitingReviewRequests: countByStatus(WORKFLOW.awaitingReview),
    generatingRequests: countByStatus(WORKFLOW.generating),
    readyNotStartedRequests: countByStatus(WORKFLOW.importedUnconfirmed),
    needsRegenerationRequests: countByStatus(WORKFLOW.needsRegeneration),
    failedRequests: countByStatus(WORKFLOW.failed),
    totalCandidatesGenerated,
    totalImagesApproved,
    estimatedGenerationSpendMicrosUsd,
    estimatedGenerationSpendLabel: formatUsdMicros(estimatedGenerationSpendMicrosUsd),
    approvedProducts,
  };
};

export const formatStudioStatusMessage = (
  summary: StudioStatusSummary,
  options?: { campaignPageUrl?: string | null },
): string => {
  const lines = [
    "Campaign status",
    "",
    `- Total products: ${summary.totalProducts}`,
    `- Products with shot ideas: ${summary.productsWithShotIdeas}`,
    `- Done / approved products: ${summary.doneApprovedProducts}`,
    `- Awaiting review: ${summary.awaitingReviewRequests}`,
    `- Generating: ${summary.generatingRequests}`,
    `- Ready / not started: ${summary.readyNotStartedRequests}`,
    `- Needs regeneration: ${summary.needsRegenerationRequests}`,
    `- Failed: ${summary.failedRequests}`,
    `- Candidates generated: ${summary.totalCandidatesGenerated}`,
    `- Images approved: ${summary.totalImagesApproved}`,
    `- Estimated generation spend: ${summary.estimatedGenerationSpendLabel}`,
  ];

  if (options?.campaignPageUrl) {
    lines.push("", `Campaign overview: ${options.campaignPageUrl}`);
  }

  if (summary.approvedProducts.length > 0) {
    lines.push("", "Approved products:");
    for (const product of summary.approvedProducts) {
      lines.push(`- ${product.sku}: ${product.productPageUrl}`);
    }
  }

  return lines.join("\n");
};
export const getStudioStatusSummary = async (): Promise<StudioStatusSummary> => {
  const db = getDb();
  const [productRows, requestRows, candidateRows] = await Promise.all([
    db.select({ sku: products.sku }).from(products),
    db
      .select({
        productSku: shotRequests.productSku,
        workflowStatus: shotRequests.workflowStatus,
      })
      .from(shotRequests),
    db
      .select({
        productSku: generationCandidates.productSku,
        status: generationCandidates.status,
        reviewDecision: generationCandidates.reviewDecision,
        lumaGenerationId: generationCandidates.lumaGenerationId,
      })
      .from(generationCandidates),
  ]);

  return aggregateStudioStatus({
    productSkus: productRows.map((row) => row.sku),
    requests: requestRows,
    candidates: candidateRows,
    appUrl: env.appUrl,
  });
};
