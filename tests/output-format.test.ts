import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import type { RequestPlanSummary } from "@/types";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET =
  process.env.SLACK_SIGNING_SECRET ?? "slack-signing-secret";
process.env.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID ?? "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C_ALLOWED";
process.env.IMAGE_GENERATION_PROVIDER = "fake";

test("output format helpers parse and compare ratios", async () => {
  const {
    parseOutputAspectRatio,
    isNearOutputAspectRatio,
    outputAspectRatioLabel,
    FORMAT_MISMATCH_WARNING,
  } = await import("@/lib/output-format");

  assert.equal(parseOutputAspectRatio("1:1"), "1:1");
  assert.equal(parseOutputAspectRatio("nope"), "4:5");
  assert.equal(outputAspectRatioLabel("3:2"), "3:2 Landscape");
  assert.equal(isNearOutputAspectRatio(1080, 1350, "4:5"), true);
  assert.equal(isNearOutputAspectRatio(1000, 1000, "4:5"), false);
  assert.match(FORMAT_MISMATCH_WARNING, /Format warning/);
});

test("normalizeImageToAspectRatio letterboxes without cropping", async () => {
  const { normalizeImageToAspectRatio } = await import("@/lib/image-normalize");
  const { isNearOutputAspectRatio } = await import("@/lib/output-format");

  const source = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .png()
    .toBuffer();

  const normalized = await normalizeImageToAspectRatio({
    bytes: source,
    aspectRatio: "4:5",
  });

  assert.equal(normalized.contentType, "image/jpeg");
  assert.ok(isNearOutputAspectRatio(normalized.width, normalized.height, "4:5"));
  assert.equal(normalized.height, 2048);
});

test("Slack import preview shows Output format actions and selected style", async () => {
  const {
    buildSlackImportPreviewBlocks,
    SLACK_ACTION_IDS,
    parseSlackFormatValue,
    encodeSlackFormatValue,
  } = await import("@/lib/slack-blocks");
  const { requestPlanFromCounts } = await import("@/lib/request-planning");

  const summary = requestPlanFromCounts({
    importId: "imp-format-1",
    totalCatalogRows: 2,
    rowsWithShotIdea: 2,
    newRequests: 2,
    changedRequests: 0,
    unchangedExistingRequests: 0,
    existingPendingRequests: 0,
    warnings: [],
    priorityRequestSku: "SS-001",
    priorityRequestPriority: "high",
    actionableProducts: [
      { requestId: "r1", sku: "SS-001", priority: "high" },
      { requestId: "r2", sku: "SS-002", priority: "normal" },
    ],
    outputAspectRatio: "1:1",
    outputAspectRatioLocked: false,
  });

  const blocks = buildSlackImportPreviewBlocks(summary, {
    campaignPageUrl: "https://studio-shots.example/campaigns/imp-format-1",
  });

  const formatSection = blocks.find(
    (block) =>
      block.type === "section" &&
      typeof (block as { text?: { text?: string } }).text?.text === "string" &&
      String((block as { text: { text: string } }).text.text).includes("*Output format*"),
  ) as { text: { text: string } } | undefined;
  assert.ok(formatSection);
  assert.match(formatSection!.text.text, /1:1 Square/);

  const formatActions = blocks.find(
    (block) =>
      block.type === "actions" &&
      String((block as { block_id?: string }).block_id ?? "").startsWith("ss_imp_format:"),
  ) as
    | {
        elements: Array<{ action_id?: string; style?: string; value?: string; text?: { text?: string } }>;
      }
    | undefined;
  assert.ok(formatActions);
  assert.equal(formatActions!.elements.length, 3);

  const selected = formatActions!.elements.find((el) => el.style === "primary");
  assert.ok(selected);
  assert.equal(selected!.action_id, `${SLACK_ACTION_IDS.format}:1:1`);
  assert.equal(selected!.value, encodeSlackFormatValue("imp-format-1", "1:1"));
  assert.deepEqual(parseSlackFormatValue(selected!.value!), {
    importId: "imp-format-1",
    ratio: "1:1",
  });

  const locked = buildSlackImportPreviewBlocks({
    ...summary,
    outputAspectRatioLocked: true,
  });
  assert.equal(
    locked.some(
      (block) =>
        block.type === "actions" &&
        String((block as { block_id?: string }).block_id ?? "").startsWith("ss_imp_format:"),
    ),
    false,
  );
  assert.ok(
    locked.some(
      (block) =>
        block.type === "section" &&
        String((block as { text?: { text?: string } }).text?.text ?? "").includes("locked"),
    ),
  );
});

test("generation-started messages use the persisted campaign format", async () => {
  const {
    buildSlackGenerationStartedBlocks,
    buildSlackGenerationStartedFallbackText,
  } = await import("@/lib/slack-blocks");

  const blocks = buildSlackGenerationStartedBlocks({
    sku: "SS-001",
    shotIdea: "sunlit bench",
    testMode: true,
    outputAspectRatio: "3:2",
  });
  const summary = blocks.find(
    (block) =>
      block.type === "section" &&
      String((block as { text?: { text?: string } }).text?.text ?? "").includes("demo candidates"),
  ) as { text: { text: string } };
  assert.match(summary.text.text, /3:2 Landscape/);

  const fallback = buildSlackGenerationStartedFallbackText({
    sku: "SS-001",
    testMode: true,
    outputAspectRatio: "3:2",
  });
  assert.match(fallback, /3:2 Landscape/);
});

test("format mismatch warning is delivered without discarding the image", async () => {
  const { evaluateOutputFormatMatch } = await import("@/lib/generation-delivery");
  const { FORMAT_MISMATCH_WARNING } = await import("@/lib/output-format");
  const { buildSlackCandidateBlocks } = await import("@/lib/slack-blocks");

  const mismatch = await evaluateOutputFormatMatch({
    blobUrl: "https://blob.example/candidate.jpg",
    expectedAspectRatio: "4:5",
    fetchDimensions: async () => ({ width: 1200, height: 1200 }),
  });
  assert.equal(mismatch.formatWarning, FORMAT_MISMATCH_WARNING);

  const match = await evaluateOutputFormatMatch({
    blobUrl: "https://blob.example/candidate.jpg",
    expectedAspectRatio: "4:5",
    fetchDimensions: async () => ({ width: 1080, height: 1350 }),
  });
  assert.equal(match.formatWarning, null);

  const built = buildSlackCandidateBlocks({
    caption: "SS-001 candidate 1/3\nReview this candidate independently.",
    blobUrl: "https://blob.example/candidate.jpg",
    candidateId: "cand-1",
    sku: "SS-001",
    candidateIndex: 1,
    total: 3,
    formatWarning: FORMAT_MISMATCH_WARNING,
  });
  assert.match(built.text, /Format warning/);
  assert.ok(built.blocks.some((block) => block.type === "image"));
  assert.ok(
    built.blocks.some(
      (block) =>
        block.type === "actions" &&
        Array.isArray((block as { elements?: unknown[] }).elements),
    ),
  );
});

test("Slack format action updates preview and rejects stale locked clicks", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { OUTPUT_FORMAT_STALE_MESSAGE } = await import("@/lib/import-output-format");
  const { encodeSlackFormatValue, SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const { serializeImportWarningsPayload } = await import("@/lib/import-meta");

  let currentRatio: "4:5" | "1:1" | "3:2" = "4:5";
  const warnings = serializeImportWarningsPayload(
    [],
    [{ requestId: "req-1", sku: "SS-001", priority: "high" }],
    [],
  );

  const importRow = () =>
    ({
      id: "imp-lock-1",
      filename: "catalog.csv",
      totalCatalogRows: 1,
      rowsWithShotIdea: 1,
      newRequests: 1,
      changedRequests: 0,
      unchangedExistingRequests: 0,
      existingPendingRequests: 0,
      requestsReadyToGenerate: 1,
      plannedGenerations: 3,
      additionalEstimatedCostMicrosUsd: 130_200,
      warnings,
      priorityRequestSku: "SS-001",
      outputAspectRatio: currentRatio,
      platform: "slack",
      conversationId: "C_ALLOWED",
      externalEventId: "evt-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as const;

  const baseDeps = {
    claimAction: () => true,
    releaseAction: () => undefined,
    isAllowedTeam: () => true,
    isAllowedChannel: () => true,
    isFakeGeneration: () => true,
    getImportById: async () => importRow() as never,
    withImportOutputFormatLock: async (summary: RequestPlanSummary) => ({
      ...summary,
      outputAspectRatioLocked: false,
    }),
  };

  const updated = await handleSlackBlockAction(
    {
      type: "block_actions",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      user: { id: "U1" },
      trigger_id: "trig-format-ok",
      actions: [
        {
          action_id: `${SLACK_ACTION_IDS.format}:1:1`,
          value: encodeSlackFormatValue("imp-lock-1", "1:1"),
        },
      ],
    },
    {
      ...baseDeps,
      setImportOutputAspectRatio: async ({ ratio }) => {
        currentRatio = ratio as "1:1";
        return { ok: true as const, ratio: "1:1", locked: false as const };
      },
    },
  );

  assert.equal((updated.httpBody as { replace_original?: boolean }).replace_original, true);
  assert.match(String((updated.httpBody as { text?: string }).text ?? ""), /1:1/);
  const blocks = (updated.httpBody as { blocks?: Array<Record<string, unknown>> }).blocks ?? [];
  assert.ok(
    blocks.some(
      (block) =>
        block.type === "section" &&
        String((block as { text?: { text?: string } }).text?.text ?? "").includes("1:1 Square"),
    ),
  );

  const stale = await handleSlackBlockAction(
    {
      type: "block_actions",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      user: { id: "U1" },
      trigger_id: "trig-format-stale",
      actions: [
        {
          action_id: `${SLACK_ACTION_IDS.format}:3:2`,
          value: encodeSlackFormatValue("imp-lock-1", "3:2"),
        },
      ],
    },
    {
      ...baseDeps,
      setImportOutputAspectRatio: async () => ({
        ok: false as const,
        reason: "locked" as const,
        ratio: "1:1",
      }),
    },
  );
  assert.equal((stale.httpBody as { response_type?: string }).response_type, "ephemeral");
  assert.equal((stale.httpBody as { text?: string }).text, OUTPUT_FORMAT_STALE_MESSAGE);
});

test("canvas fill constraints are included in Luma prompts", async () => {
  const { buildImageEditPrompt, CANVAS_FILL_CONSTRAINTS } = await import("@/lib/luma");
  const prompt = buildImageEditPrompt({ shotIdea: "hotel lobby bench" });
  assert.match(prompt, /hotel lobby bench/);
  assert.ok(prompt.includes(CANVAS_FILL_CONSTRAINTS));
  assert.match(prompt, /Fill the entire canvas/);
  assert.match(prompt, /letterboxing|padding|borders/i);
});

test("fake provider returns the normalized source URL it receives", async () => {
  const { createFakeGenerationProvider } = await import("@/lib/image-generation-fake");
  const { runCandidateImagePipeline } = await import("@/lib/candidate-pipeline");

  const provider = createFakeGenerationProvider({
    appUrl: "https://studio-shots.example",
    delayMs: 1,
    sleep: async () => undefined,
  });

  const normalized =
    "https://blob.vercel-storage.com/luma-sources/SS-001/1x1-normalized.jpg";
  const result = await runCandidateImagePipeline(provider, {
    candidateId: "cand-norm",
    candidateIndex: 1,
    productSku: "SS-001",
    photoUrl: normalized,
    prompt: "square lifestyle",
  });
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.blobUrl, normalized);
  }
});
