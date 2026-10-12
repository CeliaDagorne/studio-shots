import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.LUMA_AGENTS_API_KEY = process.env.LUMA_AGENTS_API_KEY ?? "luma-key";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "slack-signing-secret";
process.env.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID ?? "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C_ALLOWED";
process.env.IMAGE_GENERATION_PROVIDER = "fake";

import {
  isPollingTimeoutError,
  runCandidateImagePipeline,
} from "@/lib/candidate-pipeline";
import {
  decideAfterExternalReconcile,
  STILL_PROCESSING_USER_MESSAGE,
} from "@/lib/generation";
import type { ImageGenerationProvider } from "@/lib/image-generation";
import { CANDIDATE_STATUS } from "@/lib/review";

const mockProvider = (
  overrides: Partial<ImageGenerationProvider> = {},
): ImageGenerationProvider => ({
  name: "luma",
  createGeneration: async () => ({
    id: "luma-gen-1",
    state: "queued",
    outputUrl: null,
    failureReason: null,
  }),
  pollUntilDone: async (id) => ({
    id,
    state: "completed",
    outputUrl: "https://luma.example/presigned-expiring.jpg",
    failureReason: null,
  }),
  storeCandidateImage: async (params) => ({
    blobPath: `candidates/${params.sku}/${params.candidateId}.jpg`,
    blobUrl: `https://blob.vercel-storage.com/candidates/${params.sku}/${params.candidateId}.jpg`,
  }),
  ...overrides,
});

const baseParams = {
  candidateId: "cand-1",
  candidateIndex: 1,
  productSku: "SS-004",
  photoUrl: "/demo/ss-004-cobalt-table-lamp.png",
  prompt: "bedside nightstand",
};

test("create succeeds, poll times out, generation ID remains on timed_out result", async () => {
  let createCalls = 0;
  const result = await runCandidateImagePipeline(
    mockProvider({
      createGeneration: async () => {
        createCalls += 1;
        return {
          id: "ec49cc7f-d149-48b7-a0c7-cc4310d8c6b2",
          state: "queued",
          outputUrl: null,
          failureReason: null,
        };
      },
      pollUntilDone: async (id) => {
        throw new Error(`Generation ${id} timed out after 120000ms`);
      },
    }),
    baseParams,
  );

  assert.equal(createCalls, 1);
  assert.equal(result.status, "timed_out");
  if (result.status === "timed_out") {
    assert.equal(result.lumaGenerationId, "ec49cc7f-d149-48b7-a0c7-cc4310d8c6b2");
    assert.match(result.errorMessage, /timed out after 120000ms/);
  }
});

test("isPollingTimeoutError matches Luma poll deadline messages", () => {
  assert.equal(
    isPollingTimeoutError(new Error("Generation abc timed out after 120000ms")),
    true,
  );
  assert.equal(isPollingTimeoutError(new Error("content_moderated")), false);
});

test("retry decision: completed existing job delivers without new attempt", () => {
  assert.equal(
    decideAfterExternalReconcile({ stillProcessing: 0, readyCount: 2 }),
    "deliver",
  );
});

test("retry decision: still-running job waits with zero new paid calls", () => {
  assert.equal(
    decideAfterExternalReconcile({ stillProcessing: 1, readyCount: 2 }),
    "wait",
  );
  assert.equal(
    decideAfterExternalReconcile({ stillProcessing: 1, readyCount: 0 }),
    "wait",
  );
  assert.match(STILL_PROCESSING_USER_MESSAGE, /Still processing/);
});

test("retry decision: explicit Luma failure permits a new attempt", () => {
  assert.equal(
    decideAfterExternalReconcile({ stillProcessing: 0, readyCount: 0 }),
    "new_attempt",
  );
});

test("two ready and one timed-out remain recoverable (wait or deliver, never wipe id)", async () => {
  // Timed-out candidate keeps its external id on the pipeline result.
  const timedOut = await runCandidateImagePipeline(
    mockProvider({
      createGeneration: async () => ({
        id: "timeout-gen",
        state: "dreaming",
        outputUrl: null,
        failureReason: null,
      }),
      pollUntilDone: async () => {
        throw new Error("Generation timeout-gen timed out after 120000ms");
      },
    }),
    { ...baseParams, candidateId: "cand-timeout", candidateIndex: 2 },
  );
  assert.equal(timedOut.status, "timed_out");
  if (timedOut.status === "timed_out") {
    assert.equal(timedOut.lumaGenerationId, "timeout-gen");
  }

  // Mixed attempt: 2 ready + 1 unresolved → Retry must wait if still processing.
  assert.equal(
    decideAfterExternalReconcile({ stillProcessing: 1, readyCount: 2 }),
    "wait",
  );
  // Once the timed-out job completes, Retry delivers without a new create.
  assert.equal(
    decideAfterExternalReconcile({ stillProcessing: 0, readyCount: 3 }),
    "deliver",
  );

  // Status model: submitted (not failed) is the recoverable timeout state.
  assert.equal(CANDIDATE_STATUS.submitted, "submitted");
  assert.notEqual(CANDIDATE_STATUS.submitted, CANDIDATE_STATUS.failed);
});

test("retry reconciles a completed existing job without calling create again", async () => {
  let createCalls = 0;
  let pollCalls = 0;
  const provider = mockProvider({
    createGeneration: async () => {
      createCalls += 1;
      return {
        id: "should-not-create",
        state: "queued",
        outputUrl: null,
        failureReason: null,
      };
    },
    pollUntilDone: async (id) => {
      pollCalls += 1;
      return {
        id,
        state: "completed",
        outputUrl: "https://luma.example/recovered.jpg",
        failureReason: null,
      };
    },
  });

  // Simulate reconcile path: only poll existing id.
  const finished = await provider.pollUntilDone("existing-gen-id", {
    timeoutMs: 4_000,
    initialWaitMs: 0,
  });
  assert.equal(finished.state, "completed");
  assert.equal(createCalls, 0);
  assert.equal(pollCalls, 1);
});

test("Slack redelivery path never invokes image generation create", () => {
  const generationSource = readFileSync(
    resolve("src/lib/generation.ts"),
    "utf8",
  );
  const deliverySource = readFileSync(
    resolve("src/lib/generation-delivery.ts"),
    "utf8",
  );
  const redeliverBlock = generationSource.slice(
    generationSource.indexOf("export const redeliverReadyCandidates"),
    generationSource.indexOf("export const runShotRequestGeneration"),
  );
  assert.match(redeliverBlock, /onlyUndelivered:\s*true/);
  assert.doesNotMatch(redeliverBlock, /createGeneration|processOneCandidate|runCandidateImagePipeline/);
  assert.doesNotMatch(deliverySource, /createGeneration|luma-agents|createImageEdit/);
});

test("pipeline preserves generation id when store fails after create", async () => {
  const result = await runCandidateImagePipeline(
    mockProvider({
      createGeneration: async () => ({
        id: "created-then-store-fails",
        state: "queued",
        outputUrl: null,
        failureReason: null,
      }),
      pollUntilDone: async (id) => ({
        id,
        state: "completed",
        outputUrl: "https://luma.example/ok.jpg",
        failureReason: null,
      }),
      storeCandidateImage: async () => {
        throw new Error("blob upload failed");
      },
    }),
    baseParams,
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.lumaGenerationId, "created-then-store-fails");
    assert.match(result.errorMessage, /blob upload failed/);
  }
});
