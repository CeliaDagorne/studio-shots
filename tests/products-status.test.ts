import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProductPageUrl,
  filterApprovedCandidates,
  formatApprovalCompletionMessage,
  formatPriceCents,
} from "@/lib/products";
import { aggregateStudioStatus, formatStudioStatusMessage } from "@/lib/status";

test("filterApprovedCandidates keeps only ready + approved + blob-backed images", () => {
  const filtered = filterApprovedCandidates([
    {
      id: "a",
      candidateIndex: 2,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/a.jpg",
      blobPath: "candidates/SS-001/a.jpg",
    },
    {
      id: "b",
      candidateIndex: 1,
      status: "ready",
      reviewDecision: "rejected",
      blobUrl: "https://blob.example/b.jpg",
      blobPath: "candidates/SS-001/b.jpg",
    },
    {
      id: "c",
      candidateIndex: 3,
      status: "failed",
      reviewDecision: "approved",
      blobUrl: null,
      blobPath: null,
    },
    {
      id: "d",
      candidateIndex: 4,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/d.jpg",
      blobPath: "candidates/SS-001/d.jpg",
    },
  ]);

  assert.deepEqual(
    filtered.map((row) => row.id),
    ["a", "d"],
  );
  assert.equal(filtered[0]?.candidateIndex, 2);
  assert.equal(filtered.every((row) => row.blobUrl.includes("blob.example")), true);
});

test("buildProductPageUrl and approval completion message use APP_URL", () => {
  const url = buildProductPageUrl("https://studio-shots.vercel.app/", "SS-001");
  assert.equal(url, "https://studio-shots.vercel.app/products/SS-001");
  assert.match(
    formatApprovalCompletionMessage({
      sku: "SS-001",
      approvedCount: 2,
      productPageUrl: url,
    }),
    /Product page: https:\/\/studio-shots\.vercel\.app\/products\/SS-001/,
  );
});

test("formatPriceCents stays precision-safe", () => {
  assert.equal(formatPriceCents(2800), "$28.00");
  assert.equal(formatPriceCents(5), "$0.05");
});

test("aggregateStudioStatus rolls up campaign metrics and approved links", () => {
  const summary = aggregateStudioStatus({
    appUrl: "https://studio-shots.vercel.app",
    productSkus: ["SS-002", "SS-001", "SS-003"],
    requests: [
      { productSku: "SS-001", workflowStatus: "approved" },
      { productSku: "SS-002", workflowStatus: "imported_unconfirmed" },
      { productSku: "SS-003", workflowStatus: "awaiting_review" },
      { productSku: "SS-003", workflowStatus: "generating" },
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
        productSku: "SS-001",
        status: "ready",
        reviewDecision: "rejected",
        lumaGenerationId: "g3",
      },
      {
        productSku: "SS-003",
        status: "pending",
        reviewDecision: null,
        lumaGenerationId: null,
      },
    ],
  });

  assert.equal(summary.totalProducts, 3);
  assert.equal(summary.productsWithShotIdeas, 3);
  assert.equal(summary.doneApprovedProducts, 1);
  assert.equal(summary.awaitingReviewRequests, 1);
  assert.equal(summary.generatingRequests, 1);
  assert.equal(summary.readyNotStartedRequests, 1);
  assert.equal(summary.totalCandidatesGenerated, 3);
  assert.equal(summary.totalImagesApproved, 2);
  assert.equal(summary.estimatedGenerationSpendMicrosUsd, 3 * 43_400);
  assert.equal(summary.estimatedGenerationSpendLabel, "$0.13");
  assert.deepEqual(summary.approvedProducts, [
    {
      sku: "SS-001",
      productPageUrl: "https://studio-shots.vercel.app/products/SS-001",
    },
  ]);

  const message = formatStudioStatusMessage(summary);
  assert.match(message, /Campaign status/);
  assert.match(message, /Done \/ approved products: 1/);
  assert.match(message, /SS-001: https:\/\/studio-shots\.vercel\.app\/products\/SS-001/);
});
