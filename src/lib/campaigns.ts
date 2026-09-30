import { desc, eq, inArray, notInArray } from "drizzle-orm";

import { parseImportWarningsPayload } from "@/lib/import-meta";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { buildProductPageUrl } from "@/lib/products";
import { WORKFLOW } from "@/lib/review";
import { aggregateStudioStatus, type StudioStatusSummary } from "@/lib/status";
import { generationCandidates, imports, products, shotRequests } from "@/lib/schema";
import type { ActionableProductOption, CatalogPriority } from "@/types";

export const PUBLIC_GITHUB_REPO_URL = "https://github.com/CeliaDagorne/studio-shots";
export const PUBLIC_README_URL = `${PUBLIC_GITHUB_REPO_URL}/blob/main/README.md`;
export const PUBLIC_ARCHITECTURE_URL = `${PUBLIC_GITHUB_REPO_URL}/blob/main/ARCHITECTURE.md`;

/** Static demo catalog shown on the marketing homepage (no DB required). */
export const DEMO_CATALOG_PRODUCTS = [
  {
    sku: "SS-001",
    productName: "Lilac Ceramic Vase",
    photoUrl: "/demo/ss-001-lilac-vase.png",
    priority: "high" as CatalogPriority,
    shotIdea: "sunlit console table by a window, soft morning light",
  },
  {
    sku: "SS-002",
    productName: "Amber Glass Candle",
    photoUrl: "/demo/ss-002-amber-candle.png",
    priority: "normal" as CatalogPriority,
    shotIdea: "evening coffee table, warm lamplight",
  },
  {
    sku: "SS-003",
    productName: "Olive Canvas Weekend Bag",
    photoUrl: "/demo/ss-003-olive-weekend-bag.png",
    priority: "normal" as CatalogPriority,
    shotIdea: "hotel lobby bench, travel day daylight",
  },
  {
    sku: "SS-004",
    productName: "Cobalt Glass Table Lamp",
    photoUrl: "/demo/ss-004-cobalt-table-lamp.png",
    priority: "low" as CatalogPriority,
    shotIdea: "bedside nightstand at dusk, lamp on",
  },
] as const;

export type CampaignTotals = {
  totalProducts: number;
  actionableProducts: number;
  generating: number;
  awaitingReview: number;
  completed: number;
  needsRegeneration: number;
  failed: number;
  candidatesGenerated: number;
  imagesApproved: number;
  estimatedSpendMicrosUsd: number;
  estimatedSpendLabel: string;
};

export type CampaignProductCard = {
  sku: string;
  productName: string;
  photoUrl: string;
  priority: CatalogPriority | null;
  shotIdea: string;
  workflowStatus: string;
  workflowStatusLabel: string;
  approvedImageCount: number;
  productPagePath: string;
};

export type CampaignPageData = {
  importId: string;
  importedAt: Date;
  importedAtLabel: string;
  filename: string;
  totals: CampaignTotals;
  products: CampaignProductCard[];
  campaignPageUrl: string;
};

export type LatestCampaignSummary = {
  importId: string;
  importedAt: Date;
  importedAtLabel: string;
  filename: string;
  totalCatalogRows: number;
  requestsReadyToGenerate: number;
  campaignPagePath: string;
  campaignPageUrl: string;
};

export const buildCampaignPageUrl = (appUrl: string, importId: string): string => {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/campaigns/${encodeURIComponent(importId)}`;
};

export const buildCampaignPagePath = (importId: string): string =>
  `/campaigns/${encodeURIComponent(importId)}`;

export const formatWorkflowStatusLabel = (status: string): string => {
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

export const formatCampaignImportedAt = (date: Date): string =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);

export const mapStudioStatusToCampaignTotals = (
  summary: StudioStatusSummary,
): CampaignTotals => ({
  totalProducts: summary.totalProducts,
  actionableProducts: summary.readyNotStartedRequests,
  generating: summary.generatingRequests,
  awaitingReview: summary.awaitingReviewRequests,
  completed: summary.doneApprovedProducts,
  needsRegeneration: summary.needsRegenerationRequests,
  failed: summary.failedRequests,
  candidatesGenerated: summary.totalCandidatesGenerated,
  imagesApproved: summary.totalImagesApproved,
  estimatedSpendMicrosUsd: summary.estimatedGenerationSpendMicrosUsd,
  estimatedSpendLabel: summary.estimatedGenerationSpendLabel,
});

export const buildCampaignProductCards = (params: {
  products: Array<{
    sku: string;
    productName: string;
    photoUrl: string;
  }>;
  requests: Array<{
    id: string;
    productSku: string;
    shotIdea: string;
    workflowStatus: string;
  }>;
  prioritiesBySku: Map<string, CatalogPriority>;
  approvedCountBySku: Map<string, number>;
}): CampaignProductCard[] => {
  const productBySku = new Map(params.products.map((product) => [product.sku, product]));
  const cards: CampaignProductCard[] = [];

  for (const request of params.requests) {
    const product = productBySku.get(request.productSku);
    if (!product) {
      continue;
    }
    cards.push({
      sku: product.sku,
      productName: product.productName,
      photoUrl: product.photoUrl,
      priority: params.prioritiesBySku.get(product.sku) ?? null,
      shotIdea: request.shotIdea,
      workflowStatus: request.workflowStatus,
      workflowStatusLabel: formatWorkflowStatusLabel(request.workflowStatus),
      approvedImageCount: params.approvedCountBySku.get(product.sku) ?? 0,
      productPagePath: `/products/${encodeURIComponent(product.sku)}`,
    });
  }

  return cards;
};

const uniqueBySkuKeepFirst = <T extends { productSku: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (seen.has(row.productSku)) continue;
    seen.add(row.productSku);
    result.push(row);
  }
  return result;
};

type CampaignRequestRow = {
  id: string;
  productSku: string;
  shotIdea: string;
  workflowStatus: string;
};

/**
 * Prefer the ordered catalog showcase list (includes completed SKUs), then any
 * remaining actionable / import-owned requests.
 */
export const orderCampaignRequests = (params: {
  catalogProducts: ActionableProductOption[];
  actionable: ActionableProductOption[];
  ownedRequests: CampaignRequestRow[];
  linkedRequests: CampaignRequestRow[];
}): CampaignRequestRow[] => {
  const byId = new Map<string, CampaignRequestRow>();
  for (const request of params.linkedRequests) {
    byId.set(request.id, request);
  }
  for (const request of params.ownedRequests) {
    if (!byId.has(request.id)) {
      byId.set(request.id, request);
    }
  }

  const preferredIds =
    params.catalogProducts.length > 0
      ? params.catalogProducts.map((option) => option.requestId)
      : params.actionable.map((option) => option.requestId);

  const preferredSeen = new Set<string>();
  const ordered: CampaignRequestRow[] = [];
  for (const id of preferredIds) {
    const request = byId.get(id);
    if (!request || preferredSeen.has(request.productSku)) continue;
    preferredSeen.add(request.productSku);
    ordered.push(request);
  }

  for (const request of params.ownedRequests) {
    if (preferredSeen.has(request.productSku)) continue;
    preferredSeen.add(request.productSku);
    ordered.push(request);
  }

  return ordered;
};

export const assembleCampaignPageData = (params: {
  importId: string;
  createdAt: Date;
  filename: string;
  appUrl: string;
  products: Array<{ sku: string; productName: string; photoUrl: string }>;
  requests: Array<{
    id: string;
    productSku: string;
    shotIdea: string;
    workflowStatus: string;
  }>;
  candidates: Array<{
    productSku: string;
    status: string;
    reviewDecision: string | null;
    lumaGenerationId: string | null;
  }>;
  prioritiesBySku: Map<string, CatalogPriority>;
}): CampaignPageData => {
  const orderedRequests = uniqueBySkuKeepFirst(params.requests);
  const summary = aggregateStudioStatus({
    appUrl: params.appUrl,
    productSkus: orderedRequests.map((request) => request.productSku),
    requests: orderedRequests.map((request) => ({
      productSku: request.productSku,
      workflowStatus: request.workflowStatus,
    })),
    candidates: params.candidates,
  });

  const approvedCountBySku = new Map<string, number>();
  for (const candidate of params.candidates) {
    if (candidate.reviewDecision !== "approved") continue;
    approvedCountBySku.set(
      candidate.productSku,
      (approvedCountBySku.get(candidate.productSku) ?? 0) + 1,
    );
  }

  return {
    importId: params.importId,
    importedAt: params.createdAt,
    importedAtLabel: formatCampaignImportedAt(params.createdAt),
    filename: params.filename,
    totals: mapStudioStatusToCampaignTotals(summary),
    products: buildCampaignProductCards({
      products: params.products,
      requests: orderedRequests,
      prioritiesBySku: params.prioritiesBySku,
      approvedCountBySku,
    }),
    campaignPageUrl: buildCampaignPageUrl(params.appUrl, params.importId),
  };
};

export const getCampaignPageData = async (
  importId: string,
): Promise<CampaignPageData | null> => {
  const db = getDb();
  const importRows = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  const importRecord = importRows[0];
  if (!importRecord) {
    return null;
  }

  const payload = parseImportWarningsPayload(importRecord.warnings);
  const catalogProducts = payload.catalogProducts ?? [];
  const actionable = payload.actionable;
  const linkedIds = [
    ...new Set([
      ...catalogProducts.map((option) => option.requestId),
      ...actionable.map((option) => option.requestId),
    ]),
  ];

  const prioritiesBySku = new Map<string, CatalogPriority>();
  for (const option of catalogProducts) {
    prioritiesBySku.set(option.sku, option.priority);
  }
  for (const option of actionable) {
    if (!prioritiesBySku.has(option.sku)) {
      prioritiesBySku.set(option.sku, option.priority);
    }
  }

  const ownedRequests = await db
    .select({
      id: shotRequests.id,
      productSku: shotRequests.productSku,
      shotIdea: shotRequests.shotIdea,
      workflowStatus: shotRequests.workflowStatus,
    })
    .from(shotRequests)
    .where(eq(shotRequests.importId, importId));

  const linkedRequests =
    linkedIds.length > 0
      ? await db
          .select({
            id: shotRequests.id,
            productSku: shotRequests.productSku,
            shotIdea: shotRequests.shotIdea,
            workflowStatus: shotRequests.workflowStatus,
          })
          .from(shotRequests)
          .where(inArray(shotRequests.id, linkedIds))
      : [];

  let requests = orderCampaignRequests({
    catalogProducts,
    actionable,
    ownedRequests,
    linkedRequests,
  });

  // Legacy imports only stored actionable SKUs. Pull in completed unchanged
  // requests so earlier work (e.g. the vase) still appears on the overview.
  if (catalogProducts.length === 0) {
    const visibleSkus = new Set(requests.map((request) => request.productSku));
    const missingCount = Math.max(
      0,
      importRecord.rowsWithShotIdea - visibleSkus.size,
    );
    if (missingCount > 0) {
      const extrasQuery = db
        .select({
          id: shotRequests.id,
          productSku: shotRequests.productSku,
          shotIdea: shotRequests.shotIdea,
          workflowStatus: shotRequests.workflowStatus,
          updatedAt: shotRequests.updatedAt,
        })
        .from(shotRequests);

      const extras =
        visibleSkus.size > 0
          ? await extrasQuery
              .where(notInArray(shotRequests.productSku, [...visibleSkus]))
              .orderBy(desc(shotRequests.updatedAt))
          : await extrasQuery.orderBy(desc(shotRequests.updatedAt));

      const showcaseExtras = uniqueBySkuKeepFirst(extras)
        .filter((request) => request.workflowStatus !== WORKFLOW.importedUnconfirmed)
        .sort((left, right) => left.productSku.localeCompare(right.productSku))
        .slice(0, missingCount);

      if (showcaseExtras.length > 0) {
        requests = [...showcaseExtras, ...requests];
      }
    }
  }

  const skus = [...new Set(requests.map((request) => request.productSku))];
  const productRows =
    skus.length > 0
      ? await db
          .select({
            sku: products.sku,
            productName: products.productName,
            photoUrl: products.photoUrl,
          })
          .from(products)
          .where(inArray(products.sku, skus))
      : [];

  const requestIds = requests.map((request) => request.id);
  const candidateRows =
    requestIds.length > 0
      ? await db
          .select({
            productSku: generationCandidates.productSku,
            status: generationCandidates.status,
            reviewDecision: generationCandidates.reviewDecision,
            lumaGenerationId: generationCandidates.lumaGenerationId,
          })
          .from(generationCandidates)
          .where(inArray(generationCandidates.shotRequestId, requestIds))
      : [];

  return assembleCampaignPageData({
    importId: importRecord.id,
    createdAt: importRecord.createdAt,
    filename: importRecord.filename,
    appUrl: env.appUrl,
    products: productRows,
    requests,
    candidates: candidateRows,
    prioritiesBySku,
  });
};

export const getLatestCampaignSummary = async (): Promise<LatestCampaignSummary | null> => {
  const db = getDb();
  const rows = await db.select().from(imports).orderBy(desc(imports.createdAt)).limit(1);
  const latest = rows[0];
  if (!latest) {
    return null;
  }

  return {
    importId: latest.id,
    importedAt: latest.createdAt,
    importedAtLabel: formatCampaignImportedAt(latest.createdAt),
    filename: latest.filename,
    totalCatalogRows: latest.totalCatalogRows,
    requestsReadyToGenerate: latest.requestsReadyToGenerate,
    campaignPagePath: buildCampaignPagePath(latest.id),
    campaignPageUrl: buildCampaignPageUrl(env.appUrl, latest.id),
  };
};

/** Homepage-safe: returns null when DB is unavailable or empty. */
export const tryGetLatestCampaignSummary = async (): Promise<LatestCampaignSummary | null> => {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  try {
    return await getLatestCampaignSummary();
  } catch {
    return null;
  }
};
