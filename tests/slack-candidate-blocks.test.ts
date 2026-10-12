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
process.env.IMAGE_GENERATION_PROVIDER = "fake";

test("validateSlackCandidateBlocks accepts a complete public HTTPS payload", async () => {
  const { buildSlackCandidateBlocks, validateSlackCandidateBlocks, SLACK_ACTION_IDS } =
    await import("@/lib/slack-blocks");

  const built = buildSlackCandidateBlocks({
    caption: "SS-001 candidate 1/3\nReview this candidate independently.",
    blobUrl: "https://cdn.example.com/demo/ss-001-lilac-vase.png",
    candidateId: "cand-1",
    sku: "SS-001",
    candidateIndex: 1,
    total: 3,
    testMode: true,
  });

  assert.deepEqual(validateSlackCandidateBlocks(built.blocks), []);

  const image = built.blocks.find((block) => block.type === "image") as {
    type: string;
    image_url: string;
    alt_text: string;
  };
  assert.equal(image.type, "image");
  assert.equal(image.image_url, "https://cdn.example.com/demo/ss-001-lilac-vase.png");
  assert.equal(image.alt_text, "SS-001 candidate 1");
  assert.match(JSON.stringify(built.blocks), new RegExp(SLACK_ACTION_IDS.approve));
  assert.match(JSON.stringify(built.blocks), new RegExp(SLACK_ACTION_IDS.reject));
});

test("validateSlackCandidateBlocks rejects relative image URLs", async () => {
  const { validateSlackCandidateBlocks } = await import("@/lib/slack-blocks");
  const problems = validateSlackCandidateBlocks([
    {
      type: "image",
      image_url: "/demo/ss-001-lilac-vase.png",
      alt_text: "SS-001 candidate 1",
    },
  ]);
  assert.ok(problems.some((problem) => /relative path/i.test(problem)));
});

test("validateSlackCandidateBlocks rejects localhost image URLs", async () => {
  const { validateSlackCandidateBlocks } = await import("@/lib/slack-blocks");
  const problems = validateSlackCandidateBlocks([
    {
      type: "image",
      image_url: "http://localhost:3000/demo/ss-001-lilac-vase.png",
      alt_text: "SS-001 candidate 1",
    },
  ]);
  assert.ok(problems.some((problem) => /localhost/i.test(problem)));
});

test("validateSlackCandidateBlocks rejects missing alt_text", async () => {
  const { validateSlackCandidateBlocks } = await import("@/lib/slack-blocks");
  const problems = validateSlackCandidateBlocks([
    {
      type: "image",
      image_url: "https://cdn.example.com/cand.jpg",
      alt_text: "   ",
    },
  ]);
  assert.ok(problems.some((problem) => /alt_text/i.test(problem)));
});

test("validateSlackCandidateBlocks rejects malformed blocks", async () => {
  const { validateSlackCandidateBlocks } = await import("@/lib/slack-blocks");
  const problems = validateSlackCandidateBlocks([
    { type: "section" },
    { type: "actions", elements: [] },
  ]);
  assert.ok(problems.some((problem) => /image block/i.test(problem)));
  assert.ok(problems.some((problem) => /elements must be a non-empty array/i.test(problem)));
});

test("resolveSlackImageUrl rewrites localhost paths onto public APP_URL", async () => {
  const { resolveSlackImageUrl, isSlackAccessibleImageUrl } = await import(
    "@/lib/slack-image-url"
  );

  assert.equal(
    resolveSlackImageUrl(
      "http://localhost:3000/demo/ss-003-olive-weekend-bag.png",
      "https://abc123.ngrok-free.app",
    ),
    "https://abc123.ngrok-free.app/demo/ss-003-olive-weekend-bag.png",
  );
  assert.equal(
    resolveSlackImageUrl("/demo/ss-001-lilac-vase.png", "http://localhost:3000"),
    null,
  );
  assert.equal(isSlackAccessibleImageUrl("https://abc123.ngrok-free.app/demo/x.png"), true);
  assert.equal(isSlackAccessibleImageUrl("http://localhost:3000/demo/x.png"), false);
});

test("fake storeCandidateImage prefers Slack-accessible absolute HTTPS URLs", async () => {
  const { createFakeGenerationProvider } = await import("@/lib/image-generation-fake");
  const provider = createFakeGenerationProvider({
    appUrl: "https://tunnel.example",
    delayMs: 0,
    sleep: async () => undefined,
  });

  const stored = await provider.storeCandidateImage({
    sourceUrl: "/demo/ss-002-amber-candle.png",
    sku: "SS-002",
    candidateId: "cand-store-1",
  });
  assert.equal(stored.blobUrl, "https://tunnel.example/demo/ss-002-amber-candle.png");
});
