import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductHistoryPagePath,
  buildProductPagePath,
  deriveAttemptStatus,
  excludeForeignSkuDemoUrls,
  filterApprovedCandidates,
  formatAttemptCostLabel,
  groupHistoryCandidatesByAttempt,
  inferAttemptEnvironment,
  toApprovedCandidateView,
} from "@/lib/products";

test("product and history paths keep campaign query scoping", () => {
  assert.equal(buildProductPagePath("SS-001"), "/products/SS-001");
  assert.equal(
    buildProductPagePath("SS-001", { campaignImportId: "imp-1" }),
    "/products/SS-001?campaign=imp-1",
  );
  assert.equal(buildProductHistoryPagePath("SS-001"), "/products/SS-001/history");
  assert.equal(
    buildProductHistoryPagePath("SS-001", { campaignImportId: "imp-1" }),
    "/products/SS-001/history?campaign=imp-1",
  );
});

test("approved-only filter drops rejected and failed candidates", () => {
  const approved = filterApprovedCandidates([
    {
      id: "ok",
      candidateIndex: 1,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/ok.jpg",
      blobPath: "candidates/SS-001/ok.jpg",
    },
    {
      id: "rejected",
      candidateIndex: 2,
      status: "ready",
      reviewDecision: "rejected",
      blobUrl: "https://blob.example/rejected.jpg",
      blobPath: "candidates/SS-001/rejected.jpg",
    },
    {
      id: "failed",
      candidateIndex: 3,
      status: "failed",
      reviewDecision: null,
      blobUrl: null,
      blobPath: null,
    },
    {
      id: "pending-review",
      candidateIndex: 4,
      status: "ready",
      reviewDecision: null,
      blobUrl: "https://blob.example/pending.jpg",
      blobPath: "candidates/SS-001/pending.jpg",
    },
  ]);

  assert.deepEqual(
    approved.map((row) => row.id),
    ["ok"],
  );
});

test("history groups attempts newest first with local candidate numbering", () => {
  const photoUrl = "https://studio-shots.example/demo/ss-001-lilac-vase.png";
  const attempts = groupHistoryCandidatesByAttempt({
    productPhotoUrl: photoUrl,
    shotIdea: "sunlit console",
    candidates: [
      {
        id: "a1",
        candidateIndex: 1,
        status: "ready",
        reviewDecision: "rejected",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "fake-1",
        externalMessageId: "m1",
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        id: "a2",
        candidateIndex: 2,
        status: "ready",
        reviewDecision: "rejected",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "fake-2",
        externalMessageId: "m2",
        createdAt: new Date("2026-01-01T10:01:00Z"),
      },
      {
        id: "a3",
        candidateIndex: 3,
        status: "failed",
        reviewDecision: null,
        blobUrl: null,
        errorMessage: "delivery timeout",
        lumaGenerationId: null,
        externalMessageId: null,
        createdAt: new Date("2026-01-01T10:02:00Z"),
      },
      {
        id: "b1",
        candidateIndex: 4,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "fake-4",
        externalMessageId: "m4",
        createdAt: new Date("2026-01-02T12:00:00Z"),
      },
      {
        id: "b2",
        candidateIndex: 5,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "fake-5",
        externalMessageId: "m5",
        createdAt: new Date("2026-01-02T12:01:00Z"),
      },
      {
        id: "b3",
        candidateIndex: 6,
        status: "ready",
        reviewDecision: "rejected",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "fake-6",
        externalMessageId: "m6",
        createdAt: new Date("2026-01-02T12:02:00Z"),
      },
    ],
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.attemptNumber, 2);
  assert.equal(attempts[0]?.label, "Attempt 2");
  assert.equal(attempts[1]?.attemptNumber, 1);
  assert.equal(attempts[1]?.label, "Attempt 1");
  assert.equal(attempts[0]?.isLegacy, false);
  assert.deepEqual(
    attempts[0]?.candidates.map((c) => c.displayIndex),
    [1, 2, 3],
  );
  assert.deepEqual(
    attempts[1]?.candidates.map((c) => c.displayIndex),
    [1, 2, 3],
  );
  assert.equal(attempts[0]?.environmentLabel, "Test mode");
  assert.equal(attempts[0]?.status, "completed");
  assert.equal(attempts[1]?.status, "needs_regeneration");
  assert.equal(attempts[1]?.candidates[2]?.errorMessage, "delivery timeout");
  assert.match(attempts[0]?.costLabel ?? "", /test mode/i);
});

test("history environment and cost distinguish test mode from Luma", () => {
  assert.equal(
    inferAttemptEnvironment({
      productPhotoUrl: "/demo/ss-001-lilac-vase.png",
      candidates: [{ blobUrl: "/demo/ss-001-lilac-vase.png", lumaGenerationId: "x" }],
    }),
    "test",
  );
  assert.equal(
    inferAttemptEnvironment({
      productPhotoUrl: "/demo/ss-001-lilac-vase.png",
      candidates: [
        {
          blobUrl: "https://blob.vercel-storage.com/candidates/SS-001/a.jpg",
          lumaGenerationId: "luma-1",
        },
      ],
    }),
    "luma",
  );
  assert.equal(
    formatAttemptCostLabel({ environment: "test", chargedCandidateCount: 3 }),
    "$0.00 (test mode)",
  );
  assert.match(
    formatAttemptCostLabel({ environment: "luma", chargedCandidateCount: 3 }),
    /\$0\./,
  );
});

test("attempt status derives from latest candidate decisions", () => {
  assert.equal(
    deriveAttemptStatus([
      { status: "pending", reviewDecision: null },
      { status: "ready", reviewDecision: null },
    ]),
    "generating",
  );
  assert.equal(
    deriveAttemptStatus([
      { status: "ready", reviewDecision: null },
      { status: "ready", reviewDecision: "approved" },
    ]),
    "awaiting_review",
  );
  assert.equal(
    deriveAttemptStatus([
      { status: "ready", reviewDecision: "approved" },
      { status: "ready", reviewDecision: "approved" },
      { status: "ready", reviewDecision: "rejected" },
    ]),
    "completed",
  );
  assert.equal(
    deriveAttemptStatus([
      { status: "failed", reviewDecision: null },
      { status: "failed", reviewDecision: null },
    ]),
    "failed",
  );
});

test("approved gallery views stay SKU-scoped after foreign demo exclusion", () => {
  const views = excludeForeignSkuDemoUrls(
    "SS-001",
    filterApprovedCandidates([
      {
        id: "own",
        candidateIndex: 1,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: "/demo/ss-001-lilac-vase.png",
        blobPath: null,
      },
      {
        id: "foreign",
        candidateIndex: 2,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: "/demo/ss-002-amber-candle.png",
        blobPath: null,
      },
    ]),
  );
  assert.deepEqual(
    views.map((row) => row.id),
    ["own"],
  );
  assert.equal(toApprovedCandidateView(views[0]!).displayIndex, 1);
});
