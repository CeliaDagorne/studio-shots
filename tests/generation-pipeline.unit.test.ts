import test from "node:test";
import assert from "node:assert/strict";

import { runCandidateImagePipeline } from "@/lib/candidate-pipeline";

test("runCandidateImagePipeline stores blob URL from mocked Luma + Blob deps", async () => {
  let created = false;
  let polled = false;
  let uploaded = false;

  const result = await runCandidateImagePipeline(
    {
      createImageRefGeneration: async () => {
        created = true;
        return {
          id: "luma-gen-1",
          state: "queued",
          outputUrl: null,
          failureReason: null,
        };
      },
      pollGenerationUntilDone: async (id) => {
        polled = true;
        assert.equal(id, "luma-gen-1");
        return {
          id,
          state: "completed",
          outputUrl: "https://luma.example/presigned-expiring.jpg",
          failureReason: null,
        };
      },
      downloadAndStoreCandidateImage: async (params) => {
        uploaded = true;
        assert.equal(params.sourceUrl, "https://luma.example/presigned-expiring.jpg");
        assert.equal(params.sku, "SS-001");
        return {
          blobPath: `candidates/${params.sku}/${params.candidateId}.jpg`,
          blobUrl: `https://blob.vercel-storage.com/candidates/${params.sku}/${params.candidateId}.jpg`,
        };
      },
    },
    {
      candidateId: "cand-1",
      productSku: "SS-001",
      photoUrl: "/demo/ss-001-lilac-vase.png",
      prompt: "morning kitchen counter",
    },
  );

  assert.equal(created && polled && uploaded, true);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.lumaGenerationId, "luma-gen-1");
    assert.match(result.blobUrl, /blob\.vercel-storage\.com/);
    assert.doesNotMatch(result.blobUrl, /presigned-expiring/);
  }
});

test("runCandidateImagePipeline records failure without calling Blob when Luma fails", async () => {
  let uploaded = false;

  const result = await runCandidateImagePipeline(
    {
      createImageRefGeneration: async () => ({
        id: "luma-gen-fail",
        state: "queued",
        outputUrl: null,
        failureReason: null,
      }),
      pollGenerationUntilDone: async () => ({
        id: "luma-gen-fail",
        state: "failed",
        outputUrl: null,
        failureReason: "content_moderated",
      }),
      downloadAndStoreCandidateImage: async () => {
        uploaded = true;
        return { blobPath: "x", blobUrl: "y" };
      },
    },
    {
      candidateId: "cand-fail",
      productSku: "SS-001",
      photoUrl: "/demo/ss-001-lilac-vase.png",
      prompt: "test",
    },
  );

  assert.equal(uploaded, false);
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.errorMessage, "content_moderated");
  }
});
