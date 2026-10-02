import assert from "node:assert/strict";
import test from "node:test";

import {
  excludeForeignSkuDemoUrls,
  filterApprovedCandidates,
  groupApprovedCandidatesByAttempt,
  toApprovedCandidateView,
} from "@/lib/products";
import { createFakeGenerationProvider } from "@/lib/image-generation-fake";
import { runCandidateImagePipeline } from "@/lib/candidate-pipeline";

test("SS-001 product views never keep another product's demo candidate URLs", () => {
  const views = filterApprovedCandidates([
    {
      id: "vase-1",
      candidateIndex: 4,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      blobPath: "candidates/SS-001/vase-1.jpg",
    },
    {
      id: "candle",
      candidateIndex: 5,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://studio-shots.example/demo/ss-002-amber-candle.png",
      blobPath: "candidates/SS-001/candle.jpg",
    },
    {
      id: "bag",
      candidateIndex: 6,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://studio-shots.example/demo/ss-003-olive-weekend-bag.png",
      blobPath: "candidates/SS-001/bag.jpg",
    },
    {
      id: "other-campaign",
      candidateIndex: 1,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/campaign-b/ss-002.jpg",
      blobPath: "candidates/SS-002/x.jpg",
    },
  ]);

  const forSs001 = excludeForeignSkuDemoUrls("SS-001", views);
  assert.deepEqual(
    forSs001.map((row) => row.id).sort(),
    ["other-campaign", "vase-1"],
  );
  assert.ok(forSs001.every((row) => !row.blobUrl.includes("ss-002-amber")));
  assert.ok(forSs001.every((row) => !row.blobUrl.includes("ss-003-olive")));
});

test("fake generation for SS-001 only uses SS-001 source image across retries", async () => {
  const provider = createFakeGenerationProvider({
    appUrl: "https://studio-shots.example",
    delayMs: 0,
    sleep: async () => undefined,
  });
  const source = "https://studio-shots.example/demo/ss-001-lilac-vase.png";

  for (const index of [1, 2, 3, 4, 5, 6]) {
    const result = await runCandidateImagePipeline(provider, {
      candidateId: `ss001-${index}`,
      candidateIndex: index,
      productSku: "SS-001",
      photoUrl: source,
      prompt: "editorial",
    });
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.equal(result.blobUrl, source);
      assert.doesNotMatch(result.blobUrl, /ss-002|ss-003|ss-004/);
    }
  }
});

test("retry attempt candidates display as local 1–3 not Shot 4/5/6", () => {
  const retry = [4, 5, 6].map((candidateIndex) =>
    toApprovedCandidateView({
      id: `c-${candidateIndex}`,
      candidateIndex,
      blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      blobPath: null,
    }),
  );
  const grouped = groupApprovedCandidatesByAttempt(retry);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.attemptNumber, 2);
  assert.deepEqual(
    grouped[0]?.candidates.map((c) => ({
      displayIndex: c.displayIndex,
      total: c.totalInAttempt,
      raw: c.candidateIndex,
    })),
    [
      { displayIndex: 1, total: 3, raw: 4 },
      { displayIndex: 2, total: 3, raw: 5 },
      { displayIndex: 3, total: 3, raw: 6 },
    ],
  );
});

test("candidates from another SKU are excluded by foreign-demo filter for SS-001 pages", () => {
  const mixed = excludeForeignSkuDemoUrls("SS-001", [
    toApprovedCandidateView({
      id: "own",
      candidateIndex: 1,
      blobUrl: "/demo/ss-001-lilac-vase.png",
      blobPath: null,
    }),
    toApprovedCandidateView({
      id: "foreign-sku",
      candidateIndex: 2,
      blobUrl: "/demo/ss-004-whatever.png",
      blobPath: null,
    }),
  ]);
  assert.deepEqual(
    mixed.map((row) => row.id),
    ["own"],
  );
});
