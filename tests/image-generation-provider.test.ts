import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "slack-signing-secret";
process.env.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID ?? "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C_ALLOWED";

test("resolveImageGenerationProviderName defaults and production safety", async () => {
  const { resolveImageGenerationProviderName } = await import("@/lib/image-generation");

  assert.equal(
    resolveImageGenerationProviderName({ provider: "luma", vercelEnv: "production" }),
    "luma",
  );
  assert.equal(
    resolveImageGenerationProviderName({ provider: "", vercelEnv: "production" }),
    "luma",
  );
  assert.equal(
    resolveImageGenerationProviderName({ provider: "", vercelEnv: "preview" }),
    "fake",
  );
  assert.equal(
    resolveImageGenerationProviderName({ provider: "fake", vercelEnv: "preview" }),
    "fake",
  );
  assert.equal(
    resolveImageGenerationProviderName({ provider: "fake", vercelEnv: "" }),
    "fake",
  );

  assert.throws(
    () => resolveImageGenerationProviderName({ provider: "fake", vercelEnv: "production" }),
    /refused when VERCEL_ENV=production/,
  );
  assert.throws(
    () => resolveImageGenerationProviderName({ provider: "other", vercelEnv: "preview" }),
    /Invalid IMAGE_GENERATION_PROVIDER/,
  );
});

test("fake provider never calls Luma and returns three distinct demo candidates", async () => {
  const { createFakeGenerationProvider, FAKE_CANDIDATE_DEMO_PATHS } = await import(
    "@/lib/image-generation-fake"
  );
  const { runCandidateImagePipeline } = await import("@/lib/candidate-pipeline");

  let sleepCalls = 0;
  const provider = createFakeGenerationProvider({
    appUrl: "https://studio-shots.example",
    delayMs: 5,
    sleep: async () => {
      sleepCalls += 1;
    },
  });

  assert.equal(provider.name, "fake");

  const urls: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const result = await runCandidateImagePipeline(provider, {
      candidateId: `cand-${index}`,
      candidateIndex: index,
      productSku: "SS-001",
      photoUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      prompt: "sunlit console table",
    });
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.match(result.lumaGenerationId, /^[0-9a-f-]{36}$/);
      assert.equal(result.lumaState, "completed");
      assert.match(result.blobUrl, /\/demo\//);
      urls.push(result.blobUrl);
    }
  }

  assert.equal(new Set(urls).size, 3);
  assert.deepEqual(
    urls.map((url) => url.replace("https://studio-shots.example", "")),
    [...FAKE_CANDIDATE_DEMO_PATHS],
  );
  assert.ok(sleepCalls >= 6, "expected create+poll delays for loading-state simulation");
});

test("fake mode works without LUMA_AGENTS_API_KEY and never loads the Luma provider", async () => {
  const previousKey = process.env.LUMA_AGENTS_API_KEY;
  const previousProvider = process.env.IMAGE_GENERATION_PROVIDER;
  delete process.env.LUMA_AGENTS_API_KEY;
  process.env.IMAGE_GENERATION_PROVIDER = "fake";
  delete process.env.VERCEL_ENV;

  const { resetImageGenerationProviderForTests } = await import(
    "@/lib/image-generation-provider"
  );
  const { resetImageGenerationProviderLogForTests } = await import("@/lib/image-generation");
  resetImageGenerationProviderForTests();
  resetImageGenerationProviderLogForTests();

  try {
    const { getImageGenerationProvider } = await import("@/lib/image-generation-provider");
    const provider = getImageGenerationProvider();
    assert.equal(provider.name, "fake");

    const created = await provider.createGeneration({
      prompt: "test",
      photoUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      candidateId: "cand-no-luma",
      candidateIndex: 1,
    });
    const finished = await provider.pollUntilDone(created.id);
    assert.equal(finished.state, "completed");
    assert.match(finished.outputUrl ?? "", /ss-001-lilac-vase/);
  } finally {
    if (previousKey === undefined) {
      delete process.env.LUMA_AGENTS_API_KEY;
    } else {
      process.env.LUMA_AGENTS_API_KEY = previousKey;
    }
    if (previousProvider === undefined) {
      delete process.env.IMAGE_GENERATION_PROVIDER;
    } else {
      process.env.IMAGE_GENERATION_PROVIDER = previousProvider;
    }
    resetImageGenerationProviderForTests();
    resetImageGenerationProviderLogForTests();
  }
});

test("Slack generation-started shows test-mode context for fake provider", async () => {
  const {
    buildSlackGenerationStartedBlocks,
    buildSlackGenerationStartedFallbackText,
  } = await import("@/lib/slack-blocks");
  const { SLACK_FAKE_GENERATION_CONTEXT } = await import("@/lib/image-generation");

  const blocks = JSON.stringify(
    buildSlackGenerationStartedBlocks({
      sku: "SS-001",
      shotIdea: "warm editorial interior",
      testMode: true,
    }),
  );
  assert.match(blocks, new RegExp(SLACK_FAKE_GENERATION_CONTEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    buildSlackGenerationStartedFallbackText({
      sku: "SS-001",
      testMode: true,
    }),
    /Test mode/,
  );
  assert.doesNotMatch(
    buildSlackGenerationStartedFallbackText({ sku: "SS-001", testMode: false }),
    /Test mode/,
  );
});

test("fake candidate delivery supports approve, reject, and campaign continuation messaging", async () => {
  const { createFakeGenerationProvider } = await import("@/lib/image-generation-fake");
  const { runCandidateImagePipeline } = await import("@/lib/candidate-pipeline");
  const {
    buildSlackCandidateBlocks,
    buildSlackProductResolutionBlocks,
    finalizeSlackCandidateMessageBlocks,
  } = await import("@/lib/slack-blocks");
  const { candidateCaption } = await import("@/lib/review");

  const provider = createFakeGenerationProvider({
    appUrl: "https://studio-shots.example",
    delayMs: 0,
    sleep: async () => undefined,
  });

  const ready = [];
  for (let index = 1; index <= 3; index += 1) {
    const result = await runCandidateImagePipeline(provider, {
      candidateId: `cand-flow-${index}`,
      candidateIndex: index,
      productSku: "SS-001",
      photoUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      prompt: "editorial",
    });
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      ready.push(result);
    }
  }

  const first = buildSlackCandidateBlocks({
    caption: candidateCaption({ sku: "SS-001", index: 1, total: 3 }),
    blobUrl: ready[0]!.blobUrl,
    candidateId: "cand-flow-1",
    sku: "SS-001",
    candidateIndex: 1,
    total: 3,
  });
  assert.match(JSON.stringify(first.blocks), /cand-flow-1/);
  assert.match(JSON.stringify(first.blocks), /ss-001-lilac-vase/);

  const approvedBlocks = finalizeSlackCandidateMessageBlocks(first.blocks, "approved");
  assert.match(JSON.stringify(approvedBlocks), /Approved/);
  assert.doesNotMatch(JSON.stringify(approvedBlocks), /ss_cand_approve/);

  const rejectedBlocks = finalizeSlackCandidateMessageBlocks(first.blocks, "rejected");
  assert.match(JSON.stringify(rejectedBlocks), /Rejected/);

  const continuation = buildSlackProductResolutionBlocks({
    outcome: "approved",
    sku: "SS-001",
    approvalCount: 2,
    productPageUrl: "https://studio-shots.example/products/SS-001",
    campaignPageUrl: "https://studio-shots.example/campaigns/import-1",
    importId: "import-1",
    nextProduct: { requestId: "req-2", sku: "SS-002", priority: "normal" },
  });
  assert.match(JSON.stringify(continuation.blocks), /➡️ \*Next up\*/);
  assert.match(JSON.stringify(continuation.blocks), /Generate SS-002/);
});

test("existing Luma create params adapter remains image_edit shaped", async () => {
  const { buildImageEditCreateParams, buildImageEditPrompt } = await import("@/lib/luma");
  const prompt = buildImageEditPrompt({ shotIdea: "sunlit console" });
  const body = buildImageEditCreateParams({
    prompt,
    photoUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
  });
  assert.equal(body.type, "image_edit");
  assert.deepEqual(body.source, {
    url: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
  });
  assert.equal(body.image_ref, undefined);
});
