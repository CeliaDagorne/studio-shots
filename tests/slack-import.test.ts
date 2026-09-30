import assert from "node:assert/strict";
import test from "node:test";

import type { RequestPlanSummary } from "@/types";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.LUMA_AGENTS_API_KEY = process.env.LUMA_AGENTS_API_KEY ?? "luma-key";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "slack-signing-secret-for-tests";
process.env.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID ?? "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C_ALLOWED";

const VALID_CSV = [
  "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes,Priority",
  'SS-001,Lilac Ceramic Vase,Ceramics,Lilac,Stoneware,$48,/demo/ss-001.png,"sunlit console",Hero,high',
  'SS-002,Amber Candle,Decor,Amber,Glass,$32,/demo/ss-002.png,"evening table",,normal',
].join("\n");

const sampleSummary = (): RequestPlanSummary => ({
  importId: "import-slack-1",
  totalCatalogRows: 2,
  rowsWithShotIdea: 2,
  newRequests: 2,
  changedRequests: 0,
  unchangedExistingRequests: 0,
  existingPendingRequests: 0,
  requestsReadyToGenerate: 2,
  plannedGenerations: 6,
  additionalEstimatedCostMicrosUsd: 260_400,
  warnings: [{ sku: "SS-002", message: "Photo path is demo-only" }],
  actionableProducts: [
    { requestId: "req-1", sku: "SS-001", priority: "high" },
    { requestId: "req-2", sku: "SS-002", priority: "normal" },
  ],
  priorityRequestSku: "SS-001",
  priorityRequestPriority: "high",
});

test("isSlackImportIntent detects import after a bot mention", async () => {
  const { isSlackImportIntent } = await import("@/lib/slack-import");
  assert.equal(isSlackImportIntent("<@U_BOT> import"), true);
  assert.equal(isSlackImportIntent("<@U_BOT> please Import this"), true);
  assert.equal(isSlackImportIntent("<@U_BOT> help"), false);
  assert.equal(isSlackImportIntent(undefined), false);
});

test("selectSlackCsvAttachment requires exactly one CSV under the size limit", async () => {
  const { selectSlackCsvAttachment, SLACK_IMPORT_MESSAGES, MAX_SLACK_CSV_BYTES } = await import(
    "@/lib/slack-import"
  );

  assert.equal(selectSlackCsvAttachment(undefined).ok, false);
  assert.equal(
    (selectSlackCsvAttachment(undefined) as { message: string }).message,
    SLACK_IMPORT_MESSAGES.missingFile,
  );

  assert.equal(
    (
      selectSlackCsvAttachment([
        { id: "F1", name: "a.csv", filetype: "csv", size: 10 },
        { id: "F2", name: "b.csv", filetype: "csv", size: 10 },
      ]) as { message: string }
    ).message,
    SLACK_IMPORT_MESSAGES.multipleFiles,
  );

  assert.equal(
    (
      selectSlackCsvAttachment([
        { id: "F1", name: "photo.png", filetype: "png", mimetype: "image/png", size: 10 },
      ]) as { message: string }
    ).message,
    SLACK_IMPORT_MESSAGES.wrongType,
  );

  assert.equal(
    (
      selectSlackCsvAttachment([
        {
          id: "F1",
          name: "big.csv",
          filetype: "csv",
          size: MAX_SLACK_CSV_BYTES + 1,
        },
      ]) as { message: string }
    ).message,
    SLACK_IMPORT_MESSAGES.tooLarge,
  );

  const ok = selectSlackCsvAttachment([
    {
      id: "F1",
      name: "catalog.csv",
      filetype: "csv",
      mimetype: "text/csv",
      size: 128,
      url_private_download: "https://files.slack.com/files-pri/catalog.csv",
    },
  ]);
  assert.equal(ok.ok, true);
});

test("successful Slack catalog import posts Block Kit preview via shared planning summary", async () => {
  const { runSlackCatalogImport } = await import("@/lib/slack-import");
  const posts: Array<{ channel: string; text: string; blocks?: unknown[] }> = [];

  const result = await runSlackCatalogImport({
    channel: "C_ALLOWED",
    externalEventId: "Ev_IMPORT_OK",
    files: [
      {
        id: "F_CSV",
        name: "catalog.csv",
        filetype: "csv",
        mimetype: "text/csv",
        size: VALID_CSV.length,
        url_private_download: "https://files.slack.test/catalog.csv",
      },
    ],
    deps: {
      downloadFile: async () => VALID_CSV,
      upsertImport: async (_rows, filename, conversation, externalEventId) => {
        assert.equal(filename, "catalog.csv");
        assert.equal(conversation.platform, "slack");
        assert.equal(conversation.conversationId, "C_ALLOWED");
        assert.equal(externalEventId, "Ev_IMPORT_OK");
        assert.equal(_rows.length, 2);
        return sampleSummary();
      },
      postMessage: async (params) => {
        posts.push(params);
      },
      appUrl: "https://studio-shots.example",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "imported");
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.channel, "C_ALLOWED");
  assert.match(posts[0]!.text, /Catalog ready/);
  assert.match(posts[0]!.text, /SS-001/);
  assert.match(
    posts[0]!.text,
    /Campaign overview: https:\/\/studio-shots\.example\/campaigns\/import-slack-1/,
  );
  assert.ok(Array.isArray(posts[0]?.blocks));
  assert.ok((posts[0]?.blocks?.length ?? 0) > 0);
  const serialized = JSON.stringify(posts[0]?.blocks);
  assert.match(serialized, /Catalog ready/);
  assert.match(serialized, /Total estimated cost/);
  assert.match(serialized, /Up next/);
  assert.match(serialized, /SS-001/);
  assert.match(serialized, /Campaign overview/);
  assert.match(
    serialized,
    /https:\/\/studio-shots\.example\/campaigns\/import-slack-1/,
  );
  assert.doesNotMatch(serialized, /campaigns\/<importId>/);
});

test("Slack import reports a clear message when the CSV file is missing", async () => {
  const { runSlackCatalogImport, SLACK_IMPORT_MESSAGES } = await import("@/lib/slack-import");
  const posts: Array<{ text: string }> = [];

  const result = await runSlackCatalogImport({
    channel: "C_ALLOWED",
    externalEventId: "Ev_MISSING",
    files: undefined,
    deps: {
      postMessage: async (params) => {
        posts.push(params);
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(posts[0]?.text, SLACK_IMPORT_MESSAGES.missingFile);
});

test("Slack import rejects a non-CSV attachment", async () => {
  const { runSlackCatalogImport, SLACK_IMPORT_MESSAGES } = await import("@/lib/slack-import");
  const posts: Array<{ text: string }> = [];

  const result = await runSlackCatalogImport({
    channel: "C_ALLOWED",
    externalEventId: "Ev_TYPE",
    files: [
      {
        id: "F_IMG",
        name: "packshot.png",
        filetype: "png",
        mimetype: "image/png",
        size: 100,
        url_private_download: "https://files.slack.test/packshot.png",
      },
    ],
    deps: {
      postMessage: async (params) => {
        posts.push(params);
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(posts[0]?.text, SLACK_IMPORT_MESSAGES.wrongType);
});

test("Slack import reports a clear message for malformed CSV content", async () => {
  const { runSlackCatalogImport } = await import("@/lib/slack-import");
  const posts: Array<{ text: string }> = [];

  const result = await runSlackCatalogImport({
    channel: "C_ALLOWED",
    externalEventId: "Ev_BAD_CSV",
    files: [
      {
        id: "F_CSV",
        name: "bad.csv",
        filetype: "csv",
        size: 20,
        url_private_download: "https://files.slack.test/bad.csv",
      },
    ],
    deps: {
      downloadFile: async () => "not,a,valid,catalog\n1,2,3",
      postMessage: async (params) => {
        posts.push(params);
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_catalog");
  assert.match(posts[0]!.text, /could not be imported|Studio Shots catalog/i);
  assert.doesNotMatch(posts[0]!.text, /xoxb|Bearer|postgres|secret/i);
});

test("Slack import reports download failures without exposing internals", async () => {
  const { runSlackCatalogImport, SLACK_IMPORT_MESSAGES } = await import("@/lib/slack-import");
  const posts: Array<{ text: string }> = [];

  const result = await runSlackCatalogImport({
    channel: "C_ALLOWED",
    externalEventId: "Ev_DL",
    files: [
      {
        id: "F_CSV",
        name: "catalog.csv",
        filetype: "csv",
        size: 20,
        url_private_download: "https://files.slack.test/catalog.csv",
      },
    ],
    deps: {
      downloadFile: async () => {
        throw new Error("Bearer xoxb-secret failed against https://internal");
      },
      postMessage: async (params) => {
        posts.push(params);
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(posts[0]?.text, SLACK_IMPORT_MESSAGES.downloadFailed);
  assert.doesNotMatch(posts[0]!.text, /xoxb|Bearer|https:\/\//i);
});

test("app_mention import in an unauthorized channel posts a refusal", async () => {
  const { processSlackEventCallback } = await import("@/lib/slack");
  const { SLACK_IMPORT_MESSAGES } = await import("@/lib/slack-import");
  const posts: Array<{ text: string }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("chat.postMessage")) {
      posts.push(JSON.parse(String(init?.body ?? "{}")) as { text: string });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const result = await processSlackEventCallback({
      type: "event_callback",
      team_id: "T_ALLOWED",
      event_id: "Ev_UNAUTH_CHANNEL_IMPORT",
      event: {
        type: "app_mention",
        channel: "C_OTHER",
        text: "<@U_BOT> import",
        files: [
          {
            id: "F1",
            name: "catalog.csv",
            filetype: "csv",
            size: 10,
            url_private_download: "https://files.slack.test/catalog.csv",
          },
        ],
      },
    });
    assert.equal(result.handled, false);
    assert.equal(result.reason, "unauthorized_channel");
    assert.equal(posts[0]?.text, SLACK_IMPORT_MESSAGES.unauthorizedChannel);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unauthorized workspace import does not post", async () => {
  const { processSlackEventCallback } = await import("@/lib/slack");
  const posts: unknown[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("chat.postMessage")) {
      posts.push(init?.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const result = await processSlackEventCallback({
      type: "event_callback",
      team_id: "T_OTHER",
      event_id: "Ev_UNAUTH_TEAM_IMPORT",
      event: {
        type: "app_mention",
        channel: "C_ALLOWED",
        text: "<@U_BOT> import",
        files: [{ id: "F1", name: "catalog.csv", filetype: "csv", size: 10 }],
      },
    });
    assert.equal(result.handled, false);
    assert.equal(result.reason, "unauthorized_team");
    assert.equal(posts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("already-processed Slack import event posts a short notice instead of a new preview", async () => {
  const { runSlackCatalogImport, SLACK_IMPORT_MESSAGES } = await import("@/lib/slack-import");
  const posts: Array<{ text: string; blocks?: unknown[] }> = [];

  const result = await runSlackCatalogImport({
    channel: "C_ALLOWED",
    externalEventId: "Ev_DUP_IMPORT",
    files: [
      {
        id: "F_CSV",
        name: "catalog.csv",
        filetype: "csv",
        size: VALID_CSV.length,
        url_private_download: "https://files.slack.test/catalog.csv",
      },
    ],
    deps: {
      downloadFile: async () => VALID_CSV,
      upsertImport: async () => ({
        ...sampleSummary(),
        alreadyProcessed: true,
      }),
      postMessage: async (params) => {
        posts.push(params);
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "already_processed");
  assert.equal(posts[0]?.text, SLACK_IMPORT_MESSAGES.alreadyProcessed);
  assert.equal(posts[0]?.blocks, undefined);
});

test("Slack import Block Kit mirrors shared preview totals", async () => {
  const { buildSlackImportPreviewBlocks } = await import("@/lib/slack-blocks");
  const blocks = buildSlackImportPreviewBlocks(sampleSummary(), {
    campaignPageUrl: "https://studio-shots.example/campaigns/import-slack-1",
  });
  const serialized = JSON.stringify(blocks);
  assert.match(serialized, /Catalog ready/);
  assert.match(serialized, /2 products ready to generate/);
  assert.match(serialized, /Total estimated cost/);
  assert.match(serialized, /\$0\.26/);
  assert.match(serialized, /Up next/);
  assert.match(serialized, /SS-001/);
  assert.match(serialized, /Photo path is demo-only/);
  assert.match(serialized, /campaigns\/import-slack-1/);
});
