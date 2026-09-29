import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import type { SlackInteractionResponse } from "@/lib/slack-actions";
import type { ImportRow } from "@/lib/schema";
import type { ActionableProductOption, RequestPlanSummary } from "@/types";

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

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

const sampleSummary = (): RequestPlanSummary => ({
  importId: "import-aaa",
  totalCatalogRows: 3,
  rowsWithShotIdea: 3,
  newRequests: 3,
  changedRequests: 0,
  unchangedExistingRequests: 0,
  existingPendingRequests: 0,
  requestsReadyToGenerate: 3,
  plannedGenerations: 9,
  additionalEstimatedCostMicrosUsd: 390_600,
  warnings: [],
  actionableProducts: [
    { requestId: "req-high", sku: "SS-001", priority: "high" },
    { requestId: "req-normal", sku: "SS-002", priority: "normal" },
    { requestId: "req-low", sku: "SS-003", priority: "low" },
  ],
  priorityRequestSku: "SS-001",
  priorityRequestPriority: "high",
});

const sampleImportRow = (overrides?: Partial<ImportRow>): ImportRow =>
  ({
    id: "import-aaa",
    filename: "catalog.csv",
    totalCatalogRows: 3,
    rowsWithShotIdea: 3,
    newRequests: 3,
    changedRequests: 0,
    unchangedExistingRequests: 0,
    existingPendingRequests: 0,
    requestsReadyToGenerate: 3,
    plannedGenerations: 9,
    additionalEstimatedCostMicrosUsd: 390_600,
    warnings: {
      warnings: [],
      actionable: sampleSummary().actionableProducts,
    },
    priorityRequestSku: "SS-001",
    platform: "slack",
    conversationId: "C_ALLOWED",
    externalEventId: "Ev_IMPORT",
    previewMessageId: null,
    confirmationAction: null,
    confirmedAt: null,
    createdAt: new Date(),
    ...overrides,
  }) as ImportRow;

const signBody = (rawBody: string, timestamp: string): string => {
  const base = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac("sha256", SIGNING_SECRET).update(base, "utf8").digest("hex")}`;
};

const interactionRequest = (payload: unknown) => {
  const rawBody = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://studio-shots.example/api/slack/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signBody(rawBody, timestamp),
    },
    body: rawBody,
  });
};

const blockActionPayload = (params: {
  actionId: string;
  value: string;
  triggerId: string;
  teamId?: string;
  channelId?: string;
  responseUrl?: string;
}) => ({
  type: "block_actions",
  trigger_id: params.triggerId,
  team: { id: params.teamId ?? "T_ALLOWED" },
  channel: { id: params.channelId ?? "C_ALLOWED" },
  user: { id: "U_USER" },
  message: { ts: "111.222" },
  response_url: params.responseUrl ?? "https://hooks.slack.com/actions/test",
  actions: [
    {
      action_id: params.actionId,
      value: params.value,
      action_ts: "111.222",
    },
  ],
});

const baseDeps = () => {
  const seen = new Set<string>();
  const responsePosts: SlackInteractionResponse[] = [];
  const deps = {
    getImportById: async () => sampleImportRow(),
    listActionableProductsForImport: () => sampleSummary().actionableProducts,
    loadStillActionableProductsForImport: async () => sampleSummary().actionableProducts,
    getShotRequestById: async (id: string) => {
      const option = sampleSummary().actionableProducts.find((entry) => entry.requestId === id);
      if (!option) return null;
      return {
        id: option.requestId,
        productSku: option.sku,
        workflowStatus: "imported_unconfirmed",
      };
    },
    claimAction: (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    postResponseUrl: async (_url: string, body: SlackInteractionResponse) => {
      responsePosts.push(body);
    },
    appUrl: "https://studio-shots.example",
    isAllowedTeam: (teamId: string) => teamId === "T_ALLOWED",
    isAllowedChannel: (channelId: string) => channelId === "C_ALLOWED",
  };
  return { deps, responsePosts };
};

test("import preview Block Kit includes Generate priority, Choose a product, and Cancel", async () => {
  const { buildSlackImportPreviewBlocks, SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const blocks = buildSlackImportPreviewBlocks(sampleSummary(), {
    campaignPageUrl: "https://studio-shots.example/campaigns/import-aaa",
  });
  const serialized = JSON.stringify(blocks);
  assert.match(serialized, /Generate priority: SS-001 · ~\$0\.13/);
  assert.match(serialized, /Choose a product/);
  assert.match(serialized, /Cancel/);
  assert.match(serialized, /per product/);
  assert.match(serialized, /Aspect ratio/);
  assert.match(serialized, /4:5/);
  assert.match(serialized, new RegExp(SLACK_ACTION_IDS.priority));
});

test("product picker stays within Slack action block limits", async () => {
  const {
    buildSlackProductPickerBlocks,
    countSlackActionBlocks,
    SLACK_MAX_ACTIONS_BLOCKS_PER_MESSAGE,
    SLACK_PRODUCT_PICKER_PAGE_SIZE,
  } = await import("@/lib/slack-blocks");
  const products: ActionableProductOption[] = Array.from({ length: 8 }, (_, index) => ({
    requestId: `req-${index}`,
    sku: `SS-${String(index + 1).padStart(3, "0")}`,
    priority: "normal" as const,
  }));
  const page0 = buildSlackProductPickerBlocks({
    importId: "import-aaa",
    products,
    page: 0,
    pageSize: SLACK_PRODUCT_PICKER_PAGE_SIZE,
  });
  assert.ok(
    countSlackActionBlocks(page0.blocks) <= SLACK_MAX_ACTIONS_BLOCKS_PER_MESSAGE,
    `expected at most ${SLACK_MAX_ACTIONS_BLOCKS_PER_MESSAGE} action blocks`,
  );
});

test("product picker paginates with SKU, priority, and estimated cost", async () => {
  const { buildSlackProductPickerBlocks, SLACK_PRODUCT_PICKER_PAGE_SIZE } = await import(
    "@/lib/slack-blocks"
  );
  const products: ActionableProductOption[] = Array.from({ length: 8 }, (_, index) => ({
    requestId: `req-${index}`,
    sku: `SS-${String(index + 1).padStart(3, "0")}`,
    priority: index === 0 ? ("high" as const) : ("normal" as const),
  }));

  const page0 = buildSlackProductPickerBlocks({
    importId: "import-aaa",
    products,
    page: 0,
    pageSize: SLACK_PRODUCT_PICKER_PAGE_SIZE,
  });
  assert.match(page0.text, /Page 1 of 2/);
  assert.match(JSON.stringify(page0.blocks), /SS-001 · high · ~\$0\.13/);
  assert.match(JSON.stringify(page0.blocks), /Next/);
  assert.doesNotMatch(JSON.stringify(page0.blocks), /"text":"Previous"/);

  const page1 = buildSlackProductPickerBlocks({
    importId: "import-aaa",
    products,
    page: 1,
    pageSize: SLACK_PRODUCT_PICKER_PAGE_SIZE,
  });
  assert.match(page1.text, /Page 2 of 2/);
  assert.match(JSON.stringify(page1.blocks), /Previous/);
  assert.match(JSON.stringify(page1.blocks), /SS-007/);
});

test("priority generation action starts the shared generation path", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  let priorityCalls = 0;
  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.priority,
      value: "import-aaa",
      triggerId: "trig-priority-1",
    }),
    {
      ...baseDeps().deps,
      runPriorityGeneration: async (params) => {
        priorityCalls += 1;
        assert.equal(params.importId, "import-aaa");
        assert.equal(params.conversation.platform, "slack");
        assert.equal(params.conversation.conversationId, "C_ALLOWED");
      },
    },
  );

  assert.match(result.httpBody.text, /Confirmed: generating priority product SS-001 in the background \(~\$0\.13 for 3 candidates\)/);
  assert.equal(result.httpBody.replace_original, true);
  await result.background!();
  assert.equal(priorityCalls, 1);
});

test("manual SKU selection validates request id and sku server-side", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS, encodeSlackGenValue } = await import("@/lib/slack-blocks");

  let selectedCalls = 0;
  const ok = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.gen,
      value: encodeSlackGenValue("import-aaa", "req-normal", "SS-002"),
      triggerId: "trig-gen-1",
    }),
    {
      ...baseDeps().deps,
      runSelectedRequestGeneration: async (params) => {
        selectedCalls += 1;
        assert.equal(params.shotRequestId, "req-normal");
        assert.equal(params.conversation.platform, "slack");
      },
    },
  );
  assert.match(ok.httpBody.text, /Confirmed: generating SS-002 \(normal\) in the background \(~\$0\.13 for 3 candidates\)/);
  await ok.background!();
  assert.equal(selectedCalls, 1);

  const mismatch = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.gen,
      value: encodeSlackGenValue("import-aaa", "req-normal", "SS-HACKED"),
      triggerId: "trig-gen-mismatch",
    }),
    baseDeps().deps,
  );
  assert.match(mismatch.httpBody.text, /does not match/i);
  assert.equal(mismatch.background, undefined);
});

test("cancel updates the Slack message without changing the import", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.cancel,
      value: "import-aaa",
      triggerId: "trig-cancel-1",
    }),
    baseDeps().deps,
  );
  assert.match(result.httpBody.text, /Cancelled/);
  assert.equal(result.httpBody.replace_original, true);
  assert.equal(result.background, undefined);
});

test("duplicate Slack interaction trigger ids are ignored", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const { deps } = baseDeps();

  const payload = blockActionPayload({
    actionId: SLACK_ACTION_IDS.cancel,
    value: "import-aaa",
    triggerId: "trig-dup-1",
  });
  const first = await handleSlackBlockAction(payload, deps);
  assert.match(first.httpBody.text, /Cancelled/);
  const second = await handleSlackBlockAction(payload, deps);
  assert.match(second.httpBody.text, /already handled/i);
});

test("stale imports and invalid SKUs are rejected", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS, encodeSlackGenValue } = await import("@/lib/slack-blocks");

  const stale = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.priority,
      value: "missing-import",
      triggerId: "trig-stale",
    }),
    {
      ...baseDeps().deps,
      getImportById: async () => null,
    },
  );
  assert.match(stale.httpBody.text, /no longer available/i);

  const invalid = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.gen,
      value: encodeSlackGenValue("import-aaa", "req-missing", "SS-001"),
      triggerId: "trig-invalid-sku",
    }),
    {
      ...baseDeps().deps,
      getShotRequestById: async () => null,
    },
  );
  assert.match(invalid.httpBody.text, /not part of this import|no longer available/i);
});

test("unauthorized workspace and channel actions return ephemeral refusals", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const team = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.cancel,
      value: "import-aaa",
      triggerId: "trig-team",
      teamId: "T_OTHER",
    }),
    baseDeps().deps,
  );
  assert.match(team.httpBody.text, /workspace/i);
  assert.equal(team.httpBody.response_type, "ephemeral");

  const channel = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.cancel,
      value: "import-aaa",
      triggerId: "trig-channel",
      channelId: "C_OTHER",
    }),
    baseDeps().deps,
  );
  assert.match(channel.httpBody.text, /channel/i);
  assert.equal(channel.httpBody.response_type, "ephemeral");
});

test("wrong-channel import ownership is rejected even with a valid import id", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.cancel,
      value: "import-aaa",
      triggerId: "trig-wrong-convo",
      channelId: "C_ALLOWED",
    }),
    {
      ...baseDeps().deps,
      getImportById: async () => sampleImportRow({ conversationId: "C_OTHER_IMPORT_CHANNEL" }),
    },
  );
  assert.match(result.httpBody.text, /does not belong to this channel/i);
});

test("choose action opens a paginated product picker", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const ctx = baseDeps();

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.choose,
      value: "import-aaa",
      triggerId: "trig-choose-1",
    }),
    ctx.deps,
  );
  assert.match(result.httpBody.text, /Loading actionable products/);
  assert.ok(result.background);
  await result.background!();

  const delivered = ctx.responsePosts.find((post) => post.replace_original === true);
  assert.ok(delivered);
  assert.match(delivered.text ?? "", /Choose a product to generate/);
  assert.match(JSON.stringify(delivered.blocks), /SS-001 · high/);
  assert.match(JSON.stringify(delivered.blocks), /SS-002 · normal/);
});

test("interactions route verifies signatures and parses form-encoded payloads", async () => {
  const { POST } = await import("@/app/api/slack/interactions/route");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  // Route uses real deps; unauthorized cancel with missing import should still verify signature path.
  // Use an ephemeral unauthorized team through signed body to avoid DB.
  const unauthorized = interactionRequest(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.cancel,
      value: "import-aaa",
      triggerId: `trig-route-${Date.now()}`,
      teamId: "T_OTHER",
    }),
  );
  const response = await POST(unauthorized);
  assert.equal(response.status, 200);
  const json = (await response.json()) as { text?: string; response_type?: string };
  assert.match(json.text ?? "", /workspace/i);
  assert.equal(json.response_type, "ephemeral");

  const bad = await POST(
    new Request("https://studio-shots.example/api/slack/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-slack-signature": "v0=invalid",
      },
      body: "payload=%7B%7D",
    }),
  );
  assert.equal(bad.status, 401);
});
