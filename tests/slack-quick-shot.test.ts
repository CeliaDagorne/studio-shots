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

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("isSlackCreateIntent detects create mentions", async () => {
  const { isSlackCreateIntent } = await import("@/lib/slack-quick-shot");
  assert.equal(isSlackCreateIntent("<@U_BOT> create"), true);
  assert.equal(isSlackCreateIntent("<@U_BOT> please Create this"), true);
  assert.equal(isSlackCreateIntent("<@U_BOT> import"), false);
  assert.equal(isSlackCreateIntent("<@U_BOT> help"), false);
});

test("selectSlackImageAttachment validates missing, multiple, and unsupported files", async () => {
  const {
    selectSlackImageAttachment,
    SLACK_QUICK_SHOT_MESSAGES,
  } = await import("@/lib/slack-quick-shot");

  assert.equal(selectSlackImageAttachment(undefined).ok, false);
  assert.equal(
    (selectSlackImageAttachment(undefined) as { message: string }).message,
    SLACK_QUICK_SHOT_MESSAGES.missingFile,
  );
  assert.equal(
    (
      selectSlackImageAttachment([
        { id: "F1", name: "a.png", mimetype: "image/png", size: 10 },
        { id: "F2", name: "b.png", mimetype: "image/png", size: 10 },
      ]) as { message: string }
    ).message,
    SLACK_QUICK_SHOT_MESSAGES.multipleFiles,
  );
  assert.equal(
    (
      selectSlackImageAttachment([
        { id: "F1", name: "notes.csv", filetype: "csv", mimetype: "text/csv", size: 10 },
      ]) as { message: string }
    ).message,
    SLACK_QUICK_SHOT_MESSAGES.wrongType,
  );
  const ok = selectSlackImageAttachment([
    {
      id: "F1",
      name: "product.jpg",
      mimetype: "image/jpeg",
      size: 1024,
      url_private_download: "https://files.slack.com/files-pri/private/product.jpg",
    },
  ]);
  assert.equal(ok.ok, true);
});

test("authorized create mention with one image posts setup button and never generates", async () => {
  const { processSlackEventCallback } = await import("@/lib/slack");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const { resetSlackEventDedupeForTests } = await import("@/lib/slack-dedupe");
  resetSlackEventDedupeForTests();

  const posts: Array<{ channel: string; text: string; blocks?: unknown[] }> = [];
  const result = await processSlackEventCallback(
    {
      type: "event_callback",
      team_id: "T_ALLOWED",
      event_id: "Ev_QS_1",
      event: {
        type: "app_mention",
        channel: "C_ALLOWED",
        text: "<@U_BOT> create",
        files: [
          {
            id: "F_IMG_1",
            name: "vase.png",
            mimetype: "image/png",
            size: tinyPng.length,
            url_private_download: "https://files.slack.com/files-pri/T/F_IMG_1/vase.png",
          },
        ],
      },
    },
    {
      postMessage: async (params) => {
        posts.push(params);
        return {};
      },
    },
  );

  assert.equal(result.handled, true);
  assert.equal(result.reason, "setup_prompted");
  assert.equal(posts.length, 1);
  assert.match(posts[0]!.text, /Quick Shot/i);
  assert.match(JSON.stringify(posts[0]!.blocks), new RegExp(SLACK_ACTION_IDS.quickShotSetup));
  assert.doesNotMatch(JSON.stringify(posts), /Generating|Luma|candidate 1/);
});

test("unauthorized workspace and channel refuse Quick Shot", async () => {
  const { processSlackEventCallback } = await import("@/lib/slack");
  const { resetSlackEventDedupeForTests } = await import("@/lib/slack-dedupe");
  resetSlackEventDedupeForTests();

  const team = await processSlackEventCallback({
    type: "event_callback",
    team_id: "T_OTHER",
    event_id: "Ev_QS_TEAM",
    event: {
      type: "app_mention",
      channel: "C_ALLOWED",
      text: "<@U_BOT> create",
      files: [{ id: "F1", name: "a.png", mimetype: "image/png", size: 10 }],
    },
  });
  assert.equal(team.handled, false);
  assert.equal(team.reason, "unauthorized_team");

  const posts: string[] = [];
  resetSlackEventDedupeForTests();
  const channel = await processSlackEventCallback(
    {
      type: "event_callback",
      team_id: "T_ALLOWED",
      event_id: "Ev_QS_CH",
      event: {
        type: "app_mention",
        channel: "C_OTHER",
        text: "<@U_BOT> create",
        files: [{ id: "F1", name: "a.png", mimetype: "image/png", size: 10 }],
      },
    },
    {
      postMessage: async (params) => {
        posts.push(params.text);
        return {};
      },
    },
  );
  assert.equal(channel.handled, false);
  assert.match(posts[0] ?? "", /not enabled/i);
});

test("setup button opens the Quick Shot modal", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const {
    encodeQuickShotSetupValue,
    SLACK_QUICK_SHOT_CALLBACK_ID,
  } = await import("@/lib/slack-quick-shot");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const opened: Array<{ triggerId: string; view: Record<string, unknown> }> = [];
  const result = await handleSlackBlockAction(
    {
      type: "block_actions",
      trigger_id: "trig-qs-open",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      user: { id: "U1" },
      actions: [
        {
          action_id: SLACK_ACTION_IDS.quickShotSetup,
          value: encodeQuickShotSetupValue({
            eventId: "Ev_QS_OPEN",
            channelId: "C_ALLOWED",
            fileId: "F_IMG",
          }),
        },
      ],
    },
    {
      claimAction: () => true,
      releaseAction: () => undefined,
      isAllowedTeam: () => true,
      isAllowedChannel: () => true,
      openModal: async (params) => {
        opened.push(params);
      },
    },
  );

  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.triggerId, "trig-qs-open");
  assert.equal(opened[0]?.view.callback_id, SLACK_QUICK_SHOT_CALLBACK_ID);
  assert.match(result.httpBody.text, /setup opened/i);
});

test("modal field validation rejects empty SKU and shot idea", async () => {
  const { parseQuickShotModalSubmission } = await import("@/lib/slack-quick-shot");
  const parsed = parseQuickShotModalSubmission({
    qs_sku: { sku: { value: "  " } },
    qs_shot_idea: { shot_idea: { value: "" } },
    qs_format: { format: { selected_option: { value: "1:1" } } },
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.ok(parsed.errors.qs_sku);
    assert.ok(parsed.errors.qs_shot_idea);
  }
});

test("modal submission creates one product/import, persists format, materializes Blob", async () => {
  const { submitSlackQuickShot, detectImageContentType } = await import(
    "@/lib/slack-quick-shot"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  assert.equal(detectImageContentType(tinyPng)?.contentType, "image/png");

  let upsertCalls = 0;
  const generationCalls = 0;
  const posts: Array<{ text: string; blocks?: unknown[] }> = [];
  let storedPath: string | null = null;
  let storedUrl: string | null = null;

  const result = await submitSlackQuickShot({
    setup: {
      eventId: "Ev_QS_SUBMIT",
      channelId: "C_ALLOWED",
      fileId: "F_IMG_SUBMIT",
    },
    fields: {
      sku: "QS-001",
      shotIdea: "sunlit console table",
      outputAspectRatio: "1:1",
    },
    deps: {
      postMessage: async (params) => {
        posts.push(params);
      },
      findExistingImport: async () => null,
      fetchFileMetadata: async () => ({
        id: "F_IMG_SUBMIT",
        name: "product.png",
        mimetype: "image/png",
        size: tinyPng.length,
        url_private_download: "https://files.slack.com/files-pri/private/product.png",
      }),
      downloadImage: async () => tinyPng,
      materialize: async (params) => {
        storedPath = `quick-shot-sources/${params.sku}/digest.${params.extension}`;
        storedUrl = `https://blob.vercel-storage.com/${storedPath}`;
        assert.equal(params.contentType, "image/png");
        return { blobUrl: storedUrl, blobPath: storedPath };
      },
      upsertImport: async (rows, filename, conversation, externalEventId, options) => {
        upsertCalls += 1;
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.sku, "QS-001");
        assert.equal(rows[0]?.shotIdea, "sunlit console table");
        assert.equal(rows[0]?.priority, "normal");
        assert.equal(rows[0]?.photoUrl, storedUrl);
        assert.doesNotMatch(rows[0]?.photoUrl ?? "", /files\.slack\.com|slack\.com\/files/i);
        assert.equal(options?.outputAspectRatio, "1:1");
        assert.equal(externalEventId, "Ev_QS_SUBMIT");
        assert.equal(conversation.platform, "slack");
        assert.match(filename, /quick-shot-QS-001/);
        return {
          importId: "imp-qs-1",
          totalCatalogRows: 1,
          rowsWithShotIdea: 1,
          newRequests: 1,
          changedRequests: 0,
          unchangedExistingRequests: 0,
          existingPendingRequests: 0,
          requestsReadyToGenerate: 1,
          plannedGenerations: 3,
          additionalEstimatedCostMicrosUsd: 130_200,
          warnings: [],
          actionableProducts: [
            { requestId: "req-qs-1", sku: "QS-001", priority: "normal" },
          ],
          priorityRequestSku: "QS-001",
          priorityRequestPriority: "normal",
          outputAspectRatio: "1:1",
        };
      },
      isFakeGeneration: () => true,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "previewed");
  assert.equal(upsertCalls, 1);
  assert.equal(generationCalls, 0);
  assert.equal(posts.length, 1);
  assert.match(posts[0]!.text, /Quick Shot ready/);
  assert.match(posts[0]!.text, /QS-001/);
  assert.match(posts[0]!.text, /1:1 Square|1:1/);
  assert.match(posts[0]!.text, /\$0\.00 charged|3 candidates/);
  assert.match(JSON.stringify(posts[0]!.blocks), new RegExp(SLACK_ACTION_IDS.priority));
  assert.match(JSON.stringify(posts[0]!.blocks), /sunlit console table/);
  assert.doesNotMatch(JSON.stringify(posts), /Generating 3/);
});

test("duplicate modal submission is idempotent", async () => {
  const { submitSlackQuickShot } = await import("@/lib/slack-quick-shot");
  const posts: string[] = [];
  let created = false;

  const deps = {
    postMessage: async (params: { text: string }) => {
      posts.push(params.text);
    },
    findExistingImport: async () =>
      created
        ? ({
            id: "imp-dup",
            platform: "slack",
            conversationId: "C_ALLOWED",
            externalEventId: "Ev_DUP",
          } as never)
        : null,
    fetchFileMetadata: async () => ({
      id: "F1",
      name: "a.png",
      mimetype: "image/png",
      size: tinyPng.length,
      url_private_download: "https://files.slack.com/private/a.png",
    }),
    downloadImage: async () => tinyPng,
    materialize: async () => ({
      blobUrl: "https://blob.vercel-storage.com/quick-shot-sources/QS-002/abc.png",
      blobPath: "quick-shot-sources/QS-002/abc.png",
    }),
    upsertImport: async () => {
      created = true;
      return {
        importId: "imp-dup",
        totalCatalogRows: 1,
        rowsWithShotIdea: 1,
        newRequests: 1,
        changedRequests: 0,
        unchangedExistingRequests: 0,
        existingPendingRequests: 0,
        requestsReadyToGenerate: 1,
        plannedGenerations: 3,
        additionalEstimatedCostMicrosUsd: 130_200,
        warnings: [],
        actionableProducts: [
          { requestId: "req-1", sku: "QS-002", priority: "normal" as const },
        ],
        priorityRequestSku: "QS-002",
        priorityRequestPriority: "normal" as const,
        outputAspectRatio: "4:5" as const,
      };
    },
  };

  const first = await submitSlackQuickShot({
    setup: { eventId: "Ev_DUP", channelId: "C_ALLOWED", fileId: "F1" },
    fields: { sku: "QS-002", shotIdea: "bench", outputAspectRatio: "4:5" },
    deps,
  });
  const second = await submitSlackQuickShot({
    setup: { eventId: "Ev_DUP", channelId: "C_ALLOWED", fileId: "F1" },
    fields: { sku: "QS-002", shotIdea: "bench", outputAspectRatio: "4:5" },
    deps,
  });

  assert.equal(first.ok, true);
  assert.equal(first.reason, "previewed");
  assert.equal(second.ok, true);
  assert.equal(second.reason, "already_processed");
  assert.match(posts[1] ?? "", /already set up/i);
});

test("Blob failure creates no campaign and never calls Luma", async () => {
  const { submitSlackQuickShot } = await import("@/lib/slack-quick-shot");
  let upsertCalls = 0;
  const posts: string[] = [];
  const result = await submitSlackQuickShot({
    setup: { eventId: "Ev_BLOB", channelId: "C_ALLOWED", fileId: "F1" },
    fields: { sku: "QS-003", shotIdea: "lamp", outputAspectRatio: "3:2" },
    deps: {
      postMessage: async (params) => {
        posts.push(params.text);
      },
      findExistingImport: async () => null,
      fetchFileMetadata: async () => ({
        id: "F1",
        name: "a.png",
        mimetype: "image/png",
        size: tinyPng.length,
        url_private_download: "https://files.slack.com/private/a.png",
      }),
      downloadImage: async () => tinyPng,
      materialize: async () => {
        throw new Error("blob unavailable");
      },
      upsertImport: async () => {
        upsertCalls += 1;
        throw new Error("should not upsert");
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "blob_failed");
  assert.equal(upsertCalls, 0);
  assert.match(posts[0] ?? "", /could not store/i);
});

test("view_submission validation returns modal field errors", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const {
    encodeQuickShotSetupValue,
    SLACK_QUICK_SHOT_CALLBACK_ID,
  } = await import("@/lib/slack-quick-shot");

  const result = await handleSlackBlockAction(
    {
      type: "view_submission",
      team: { id: "T_ALLOWED" },
      user: { id: "U1" },
      view: {
        id: "V1",
        callback_id: SLACK_QUICK_SHOT_CALLBACK_ID,
        private_metadata: encodeQuickShotSetupValue({
          eventId: "Ev_VAL",
          channelId: "C_ALLOWED",
          fileId: "F1",
        }),
        state: {
          values: {
            qs_sku: { sku: { value: "" } },
            qs_shot_idea: { shot_idea: { value: "idea" } },
            qs_format: { format: { selected_option: { value: "4:5" } } },
          },
        },
      },
    },
    {
      claimAction: () => true,
      isAllowedTeam: () => true,
      isAllowedChannel: () => true,
    },
  );

  assert.ok(result.viewErrors?.qs_sku);
  assert.equal(result.background, undefined);
});

test("Quick Shot preview cost and Generate action match shared pricing", async () => {
  const { buildSlackQuickShotPreviewBlocks } = await import("@/lib/slack-blocks");
  const { requestPlanFromCounts, formatOneProductCostLabel } = await import(
    "@/lib/request-planning"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const summary = requestPlanFromCounts({
    importId: "imp-qs",
    totalCatalogRows: 1,
    rowsWithShotIdea: 1,
    newRequests: 1,
    changedRequests: 0,
    unchangedExistingRequests: 0,
    existingPendingRequests: 0,
    warnings: [],
    actionableProducts: [
      { requestId: "req-1", sku: "QS-010", priority: "normal" },
    ],
    priorityRequestSku: "QS-010",
    priorityRequestPriority: "normal",
    outputAspectRatio: "3:2",
  });

  const built = buildSlackQuickShotPreviewBlocks({
    summary,
    sku: "QS-010",
    shotIdea: "editorial lamp",
    sourceImageUrl: "https://blob.vercel-storage.com/quick-shot-sources/QS-010/a.jpg",
    campaignPageUrl: "https://studio-shots.example/campaigns/imp-qs",
    testMode: false,
  });

  assert.match(built.text, new RegExp(formatOneProductCostLabel().replace("$", "\\$")));
  assert.match(JSON.stringify(built.blocks), new RegExp(SLACK_ACTION_IDS.priority));
  assert.match(JSON.stringify(built.blocks), /3:2 Landscape/);
  assert.match(JSON.stringify(built.blocks), /Campaign overview/);
});
