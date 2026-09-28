import test from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_CATALOG_PRODUCTS,
  assembleCampaignPageData,
  buildCampaignPagePath,
  buildCampaignPageUrl,
  buildCampaignProductCards,
  formatWorkflowStatusLabel,
  mapStudioStatusToCampaignTotals,
} from "@/lib/campaigns";
import { filterApprovedCandidates } from "@/lib/products";
import { aggregateStudioStatus, formatStudioStatusMessage } from "@/lib/status";
import { buildImportPreviewText, requestPlanFromCounts } from "@/lib/request-planning";

test("mapStudioStatusToCampaignTotals preserves aggregateStudioStatus counts", () => {
  const summary = aggregateStudioStatus({
    appUrl: "https://studio-shots.example",
    productSkus: ["SS-001", "SS-002", "SS-003"],
    requests: [
      { productSku: "SS-001", workflowStatus: "approved" },
      { productSku: "SS-002", workflowStatus: "imported_unconfirmed" },
      { productSku: "SS-003", workflowStatus: "awaiting_review" },
      { productSku: "SS-003", workflowStatus: "generating" },
      { productSku: "SS-002", workflowStatus: "needs_regeneration" },
      { productSku: "SS-001", workflowStatus: "failed" },
    ],
    candidates: [
      {
        productSku: "SS-001",
        status: "ready",
        reviewDecision: "approved",
        lumaGenerationId: "g1",
      },
      {
        productSku: "SS-001",
        status: "ready",
        reviewDecision: "approved",
        lumaGenerationId: "g2",
      },
      {
        productSku: "SS-003",
        status: "ready",
        reviewDecision: null,
        lumaGenerationId: "g3",
      },
    ],
  });

  const totals = mapStudioStatusToCampaignTotals(summary);
  assert.equal(totals.totalProducts, 3);
  assert.equal(totals.actionableProducts, 1);
  assert.equal(totals.generating, 1);
  assert.equal(totals.awaitingReview, 1);
  assert.equal(totals.completed, 1);
  assert.equal(totals.needsRegeneration, 1);
  assert.equal(totals.failed, 1);
  assert.equal(totals.candidatesGenerated, 3);
  assert.equal(totals.imagesApproved, 2);
  assert.equal(totals.estimatedSpendLabel, "$0.13");
});

test("campaign product cards include status labels and product links", () => {
  const cards = buildCampaignProductCards({
    products: [
      {
        sku: "SS-001",
        productName: "Lilac Ceramic Vase",
        photoUrl: "/demo/ss-001-lilac-vase.png",
      },
    ],
    requests: [
      {
        id: "req-1",
        productSku: "SS-001",
        shotIdea: "sunlit console",
        workflowStatus: "awaiting_review",
      },
    ],
    prioritiesBySku: new Map([["SS-001", "high"]]),
    approvedCountBySku: new Map([["SS-001", 2]]),
  });

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.priority, "high");
  assert.equal(cards[0]?.workflowStatusLabel, "Awaiting review");
  assert.equal(cards[0]?.approvedImageCount, 2);
  assert.equal(cards[0]?.productPagePath, "/products/SS-001");
  assert.equal(formatWorkflowStatusLabel("imported_unconfirmed"), "Ready to generate");
});

test("assembleCampaignPageData builds totals and product links for a campaign", () => {
  const page = assembleCampaignPageData({
    importId: "import-abc",
    createdAt: new Date("2026-09-28T12:00:00.000Z"),
    filename: "catalog.csv",
    appUrl: "https://studio-shots.example",
    products: [
      {
        sku: "SS-001",
        productName: "Lilac Ceramic Vase",
        photoUrl: "/demo/ss-001-lilac-vase.png",
      },
      {
        sku: "SS-002",
        productName: "Amber Glass Candle",
        photoUrl: "/demo/ss-002-amber-candle.png",
      },
    ],
    requests: [
      {
        id: "req-1",
        productSku: "SS-001",
        shotIdea: "soft light",
        workflowStatus: "approved",
      },
      {
        id: "req-2",
        productSku: "SS-002",
        shotIdea: "evening table",
        workflowStatus: "imported_unconfirmed",
      },
    ],
    candidates: [
      {
        productSku: "SS-001",
        status: "ready",
        reviewDecision: "approved",
        lumaGenerationId: "g1",
      },
      {
        productSku: "SS-001",
        status: "ready",
        reviewDecision: "approved",
        lumaGenerationId: "g2",
      },
    ],
    prioritiesBySku: new Map([
      ["SS-001", "high"],
      ["SS-002", "normal"],
    ]),
  });

  assert.equal(page.importId, "import-abc");
  assert.equal(page.totals.totalProducts, 2);
  assert.equal(page.totals.actionableProducts, 1);
  assert.equal(page.totals.completed, 1);
  assert.equal(page.totals.imagesApproved, 2);
  assert.equal(page.products[0]?.productPagePath, "/products/SS-001");
  assert.equal(page.products[1]?.priority, "normal");
  assert.equal(
    page.campaignPageUrl,
    "https://studio-shots.example/campaigns/import-abc",
  );
  assert.equal(buildCampaignPagePath("import-abc"), "/campaigns/import-abc");
  assert.equal(
    buildCampaignPageUrl("https://studio-shots.example/", "import-abc"),
    "https://studio-shots.example/campaigns/import-abc",
  );
});

test("empty campaign still has zeroed totals and no product cards", () => {
  const page = assembleCampaignPageData({
    importId: "empty-import",
    createdAt: new Date("2026-09-28T12:00:00.000Z"),
    filename: "empty.csv",
    appUrl: "https://studio-shots.example",
    products: [],
    requests: [],
    candidates: [],
    prioritiesBySku: new Map(),
  });

  assert.equal(page.totals.totalProducts, 0);
  assert.equal(page.totals.actionableProducts, 0);
  assert.deepEqual(page.products, []);
});

test("homepage demo catalog is available without database campaign data", () => {
  assert.equal(DEMO_CATALOG_PRODUCTS.length, 4);
  assert.equal(DEMO_CATALOG_PRODUCTS[0]?.sku, "SS-001");
  assert.equal(DEMO_CATALOG_PRODUCTS[0]?.photoUrl.startsWith("/demo/"), true);
  assert.equal(
    DEMO_CATALOG_PRODUCTS.every((product) => product.photoUrl.startsWith("/demo/")),
    true,
  );
});

test("import preview and status messages can include campaign overview URLs", () => {
  const summary = requestPlanFromCounts({
    importId: "import-1",
    totalCatalogRows: 4,
    rowsWithShotIdea: 4,
    newRequests: 4,
    changedRequests: 0,
    unchangedExistingRequests: 0,
    existingPendingRequests: 0,
    warnings: [],
    priorityRequestSku: "SS-001",
    priorityRequestPriority: "high",
  });
  const preview = buildImportPreviewText(summary, {
    campaignPageUrl: "https://studio-shots.example/campaigns/import-1",
  });
  assert.match(preview, /Campaign overview: https:\/\/studio-shots\.example\/campaigns\/import-1/);

  const status = formatStudioStatusMessage(
    aggregateStudioStatus({
      appUrl: "https://studio-shots.example",
      productSkus: ["SS-001"],
      requests: [{ productSku: "SS-001", workflowStatus: "approved" }],
      candidates: [],
    }),
    { campaignPageUrl: "https://studio-shots.example/campaigns/import-1" },
  );
  assert.match(status, /Campaign overview: https:\/\/studio-shots\.example\/campaigns\/import-1/);
});

test("approved images remain filtered to ready + approved + blob-backed", () => {
  const filtered = filterApprovedCandidates([
    {
      id: "keep",
      candidateIndex: 1,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/keep.jpg",
      blobPath: "candidates/SS-001/keep.jpg",
    },
    {
      id: "reject",
      candidateIndex: 2,
      status: "ready",
      reviewDecision: "rejected",
      blobUrl: "https://blob.example/reject.jpg",
      blobPath: "candidates/SS-001/reject.jpg",
    },
    {
      id: "noluma",
      candidateIndex: 3,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: null,
      blobPath: null,
    },
  ]);
  assert.deepEqual(
    filtered.map((row) => row.id),
    ["keep"],
  );
});
