import assert from "node:assert/strict";
import test from "node:test";

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

test("initial generation progress message uses portable creating copy", async () => {
  const {
    buildSlackGenerationStartedBlocks,
    buildSlackGenerationStartedFallbackText,
  } = await import("@/lib/slack-blocks");

  const blocks = buildSlackGenerationStartedBlocks({
    sku: "SS-001",
    shotIdea: "ignored for progress UX",
    testMode: false,
    outputAspectRatio: "4:5",
  });
  const serialized = JSON.stringify(blocks);
  assert.match(serialized, /⏳ Creating 3 candidates for SS-001/);
  assert.match(serialized, /4:5 Portrait/);
  assert.match(serialized, /~\$0\.13/);
  assert.match(serialized, /Usually ready in 1–3 minutes/);
  assert.match(serialized, /You can leave this channel/);
  assert.doesNotMatch(serialized, /Creative direction/);
  assert.doesNotMatch(serialized, /✨ Generating/);
  assert.doesNotMatch(serialized, /Luma/);
  assert.doesNotMatch(serialized, /generation[_ ]?id/i);

  const fallback = buildSlackGenerationStartedFallbackText({
    sku: "SS-001",
    testMode: false,
    outputAspectRatio: "1:1",
  });
  assert.match(fallback, /⏳ Creating 3 candidates for SS-001/);
  assert.match(fallback, /1:1 Square · ~\$0\.13/);
  assert.match(fallback, /Usually ready in 1–3 minutes/);
  assert.doesNotMatch(fallback, /Creative direction/);
});

test("partial complete timeout and failure progress states", async () => {
  const {
    buildSlackGenerationProgressPartialBlocks,
    buildSlackGenerationProgressCompleteBlocks,
    buildSlackGenerationProgressTimeoutBlocks,
    buildSlackGenerationFailedBlocks,
    userFacingGenerationFailureReason,
  } = await import("@/lib/slack-blocks");

  const partial = buildSlackGenerationProgressPartialBlocks({
    sku: "SS-001",
    ready: 1,
    total: 3,
    outputAspectRatio: "3:2",
  });
  assert.match(partial.text, /🎨 1 of 3 candidates ready/);
  assert.match(partial.text, /3:2 Landscape/);
  assert.doesNotMatch(partial.text, /Luma|gen_/i);

  const partialTwo = buildSlackGenerationProgressPartialBlocks({
    sku: "SS-001",
    ready: 2,
    total: 3,
  });
  assert.match(partialTwo.text, /🎨 2 of 3 candidates ready/);

  const complete = buildSlackGenerationProgressCompleteBlocks({
    sku: "SS-001",
    ready: 3,
    total: 3,
  });
  assert.match(complete.text, /✅ 3 candidates ready — review them below/);

  const timeout = buildSlackGenerationProgressTimeoutBlocks({
    sku: "SS-001",
    ready: 2,
    stillProcessing: 1,
    total: 3,
  });
  assert.match(timeout.text, /⏳ 2 of 3 ready · 1 still processing/);
  assert.match(timeout.text, /No new generation was started/);
  assert.doesNotMatch(timeout.text, /Luma|generation id/i);

  const failed = buildSlackGenerationFailedBlocks({
    sku: "SS-001",
    importId: "import-1",
    requestId: "req-1",
    detail: "poll timed out for gen_abc123 with Luma state dreaming",
  });
  assert.match(failed.text, /⚠️ Generation failed for SS-001/);
  assert.match(failed.text, /still processing/i);
  assert.doesNotMatch(failed.text, /gen_abc123/);
  assert.doesNotMatch(failed.text, /Luma/);
  assert.match(JSON.stringify(failed.blocks), /Retry SS-001/);
  assert.match(JSON.stringify(failed.blocks), /Choose another product/);

  assert.match(
    userFacingGenerationFailureReason("source photo normalize failed"),
    /product photo/i,
  );
  assert.match(
    userFacingGenerationFailureReason(null),
    /Retry this product/i,
  );
});

test("progress updater chat.updates only when ready count changes", async () => {
  const { createSlackGenerationProgressUpdater } = await import(
    "@/lib/slack-generation-progress"
  );

  const updates: Array<{ text: string; ts: string }> = [];
  const updater = createSlackGenerationProgressUpdater({
    target: { channel: "C_ALLOWED", ts: "111.222" },
    sku: "SS-001",
    total: 3,
    testMode: true,
    outputAspectRatio: "4:5",
    updateMessage: async (params) => {
      updates.push({ text: params.text, ts: params.ts });
    },
  });

  await updater.onReadyCount(1);
  await updater.onReadyCount(1); // unchanged — skipped
  await updater.onReadyCount(2);
  await updater.onComplete(3);

  assert.equal(updates.length, 3);
  assert.equal(updates.every((entry) => entry.ts === "111.222"), true);
  assert.match(updates[0]!.text, /🎨 1 of 3 candidates ready/);
  assert.match(updates[1]!.text, /🎨 2 of 3 candidates ready/);
  assert.match(updates[2]!.text, /✅ 3 candidates ready — review them below/);
});

test("progress updater timeout and failure never throw on Slack errors", async () => {
  const { createSlackGenerationProgressUpdater } = await import(
    "@/lib/slack-generation-progress"
  );

  let calls = 0;
  const updater = createSlackGenerationProgressUpdater({
    target: { channel: "C_ALLOWED", ts: "333.444" },
    sku: "SS-002",
    total: 3,
    updateMessage: async () => {
      calls += 1;
      throw new Error("Slack chat.update failed: channel_not_found");
    },
  });

  await updater.onReadyCount(1);
  await updater.onTimeout({ ready: 2, stillProcessing: 1 });
  await updater.onFailed({
    importId: "import-1",
    requestId: "req-1",
    detail: "all candidates failed",
  });

  assert.equal(calls, 3);
});

test("progress updater is a no-op without a target message", async () => {
  const { createSlackGenerationProgressUpdater } = await import(
    "@/lib/slack-generation-progress"
  );

  let calls = 0;
  const updater = createSlackGenerationProgressUpdater({
    target: null,
    sku: "SS-001",
    updateMessage: async () => {
      calls += 1;
    },
  });

  await updater.onReadyCount(1);
  await updater.onComplete(3);
  await updater.onTimeout({ ready: 1, stillProcessing: 2 });
  assert.equal(calls, 0);
});

test("generation action passes Slack progress message ts into runSelected", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS, encodeSlackGenValue } = await import("@/lib/slack-blocks");

  const actionable = [
    { requestId: "req-normal", sku: "SS-002", priority: "normal" as const },
  ];
  let seenProgress: { channel: string; ts: string } | null | undefined;

  const result = await handleSlackBlockAction(
    {
      type: "block_actions",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      user: { id: "U1" },
      trigger_id: "trig-progress-1",
      response_url: "https://hooks.slack.com/actions/T/B/XXX",
      message: { ts: "999.001" },
      actions: [
        {
          action_id: SLACK_ACTION_IDS.gen,
          value: encodeSlackGenValue("import-aaa", "req-normal", "SS-002"),
        },
      ],
    },
    {
      isAllowedTeam: () => true,
      isAllowedChannel: () => true,
      isFakeGeneration: () => true,
      claimAction: () => true,
      releaseAction: () => undefined,
      getImportById: async () =>
        ({
          id: "import-aaa",
          filename: "catalog.csv",
          totalCatalogRows: 1,
          rowsWithShotIdea: 1,
          newRequests: 1,
          changedRequests: 0,
          unchangedExistingRequests: 0,
          existingPendingRequests: 0,
          requestsReadyToGenerate: 1,
          plannedGenerations: 3,
          additionalEstimatedCostMicrosUsd: 0,
          warnings: { warnings: [], actionable },
          priorityRequestSku: "SS-002",
          outputAspectRatio: "4:5",
          platform: "slack",
          conversationId: "C_ALLOWED",
          externalEventId: "Ev1",
          previewMessageId: null,
          confirmationAction: null,
          confirmedAt: null,
          createdAt: new Date(),
        }) as never,
      listActionableProductsForImport: () => actionable,
      loadStillActionableProductsForImport: async () => actionable,
      getShotRequestById: async () => ({
        id: "req-normal",
        productSku: "SS-002",
        workflowStatus: "imported_unconfirmed",
        shotIdea: "evening coffee table",
      }),
      runSelectedRequestGeneration: async (params) => {
        seenProgress = params.slackProgressMessage;
      },
    },
  );

  assert.match(result.httpBody.text, /⏳ Creating 3 candidates for SS-002/);
  assert.equal(result.httpBody.replace_original, true);
  await result.background!();
  assert.deepEqual(seenProgress, { channel: "C_ALLOWED", ts: "999.001" });
});
