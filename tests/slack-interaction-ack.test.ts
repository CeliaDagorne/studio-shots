import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.LUMA_AGENTS_API_KEY = process.env.LUMA_AGENTS_API_KEY ?? "luma-key";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET =
  process.env.SLACK_SIGNING_SECRET ?? "slack-signing-secret-for-tests";
process.env.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID ?? "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C_ALLOWED";

const signBody = (rawBody: string, timestamp: string): string => {
  const base = `v0:${timestamp}:${rawBody}`;
  const digest = createHmac("sha256", process.env.SLACK_SIGNING_SECRET!)
    .update(base, "utf8")
    .digest("hex");
  return `v0=${digest}`;
};

const signedInteractionRequest = (payload: Record<string, unknown>) => {
  const rawBody = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
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

test("interactions route returns 200 before a delayed background handler resolves", async () => {
  const { POST, slackInteractionsRouteDeps } = await import(
    "@/app/api/slack/interactions/route"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let backgroundFinished = false;
  let scheduledWork: Promise<unknown> | null = null;

  const previousSchedule = slackInteractionsRouteDeps.scheduleBackground;
  const previousExecute = slackInteractionsRouteDeps.executeSlackBlockAction;

  slackInteractionsRouteDeps.scheduleBackground = (work) => {
    scheduledWork = work;
  };
  slackInteractionsRouteDeps.executeSlackBlockAction = async () => {
    await gate;
    backgroundFinished = true;
  };

  try {
    const response = await POST(
      signedInteractionRequest({
        type: "block_actions",
        trigger_id: `trig-ack-${Date.now()}`,
        team: { id: "T_ALLOWED" },
        channel: { id: "C_ALLOWED" },
        actions: [
          {
            action_id: SLACK_ACTION_IDS.approve,
            value: "cand-ack-1",
            action_ts: "1",
          },
        ],
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.equal(backgroundFinished, false);
    assert.ok(scheduledWork);

    release();
    await scheduledWork;
    assert.equal(backgroundFinished, true);
  } finally {
    slackInteractionsRouteDeps.scheduleBackground = previousSchedule;
    slackInteractionsRouteDeps.executeSlackBlockAction = previousExecute;
  }
});

test("executeSlackBlockAction persists approve and updates the candidate message", async () => {
  const {
    executeSlackBlockAction,
    SLACK_INTERACTION_MESSAGES,
  } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const updates: Array<{ text: string; blocks?: unknown }> = [];
  let persistedDecision: string | null = null;
  const claimed = new Set<string>();

  await executeSlackBlockAction(
    {
      type: "block_actions",
      trigger_id: "trig-exec-approve",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      response_url: "https://hooks.slack.com/actions/test",
      message: {
        ts: "111.222",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*SS-001* · candidate 1/3\nReview this candidate independently.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: SLACK_ACTION_IDS.approve,
                text: { type: "plain_text", text: "Approve" },
                value: "cand-1",
              },
            ],
          },
        ],
      },
      actions: [
        {
          action_id: SLACK_ACTION_IDS.approve,
          value: "cand-1",
          action_ts: "1",
        },
      ],
    },
    {
      claimAction: (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      releaseAction: (key) => {
        claimed.delete(key);
      },
      getCandidateById: async () =>
        ({
          id: "cand-1",
          shotRequestId: "req-1",
          productSku: "SS-001",
          candidateIndex: 1,
          status: "ready",
          reviewDecision: null,
          blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
          platform: "slack",
          conversationId: "C_ALLOWED",
          externalMessageId: "111.222",
        }) as never,
      persistCandidateReview: async ({ decision }) => {
        persistedDecision = decision;
        return {
          alreadyReviewed: false,
          candidate: {
            id: "cand-1",
            shotRequestId: "req-1",
            productSku: "SS-001",
            candidateIndex: 1,
            status: "ready",
            reviewDecision: decision,
            blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
            platform: "slack",
            conversationId: "C_ALLOWED",
            externalMessageId: "111.222",
          } as never,
          existingDecision: decision,
          requestStatus: "awaiting_review",
          approvedCount: null,
          importId: "import-1",
          newlyResolved: false,
        };
      },
      updateMessage: async ({ text, blocks }) => {
        updates.push({ text, blocks });
      },
      postResponseUrl: async () => undefined,
      isFakeGeneration: () => true,
    },
  );

  assert.equal(persistedDecision, "approved");
  assert.ok(updates.length >= 1);
  assert.match(updates[0]!.text, /✅ Approved/);
  assert.doesNotMatch(JSON.stringify(updates[0]!.blocks), /"type":"actions"/);
  assert.equal(SLACK_INTERACTION_MESSAGES.processingFailed.length > 0, true);
});

test("executeSlackBlockAction persists reject decisions", async () => {
  const { executeSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  let persistedDecision: string | null = null;
  const claimed = new Set<string>();

  await executeSlackBlockAction(
    {
      type: "block_actions",
      trigger_id: "trig-exec-reject",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      response_url: "https://hooks.slack.com/actions/test",
      message: { ts: "111.222", blocks: [] },
      actions: [
        {
          action_id: SLACK_ACTION_IDS.reject,
          value: "cand-2",
          action_ts: "1",
        },
      ],
    },
    {
      claimAction: (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      releaseAction: () => undefined,
      getCandidateById: async () =>
        ({
          id: "cand-2",
          shotRequestId: "req-1",
          productSku: "SS-001",
          candidateIndex: 2,
          status: "ready",
          reviewDecision: null,
          blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
          platform: "slack",
          conversationId: "C_ALLOWED",
          externalMessageId: "111.222",
        }) as never,
      persistCandidateReview: async ({ decision }) => {
        persistedDecision = decision;
        return {
          alreadyReviewed: false,
          candidate: {
            id: "cand-2",
            shotRequestId: "req-1",
            productSku: "SS-001",
            candidateIndex: 2,
            status: "ready",
            reviewDecision: decision,
            blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
            platform: "slack",
            conversationId: "C_ALLOWED",
            externalMessageId: "111.222",
          } as never,
          existingDecision: decision,
          requestStatus: "awaiting_review",
          approvedCount: null,
          importId: "import-1",
          newlyResolved: false,
        };
      },
      updateMessage: async () => undefined,
      postResponseUrl: async () => undefined,
    },
  );

  assert.equal(persistedDecision, "rejected");
});

test("duplicate Slack interaction delivery does not re-persist a review", async () => {
  const { executeSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  let persistCalls = 0;
  const claimed = new Set<string>();
  const payload = {
    type: "block_actions",
    trigger_id: "trig-dup-delivery",
    team: { id: "T_ALLOWED" },
    channel: { id: "C_ALLOWED" },
    response_url: "https://hooks.slack.com/actions/test",
    message: { ts: "111.222", blocks: [] },
    actions: [
      {
        action_id: SLACK_ACTION_IDS.approve,
        value: "cand-dup",
        action_ts: "1",
      },
    ],
  };

  const deps = {
    claimAction: (key: string) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    releaseAction: (key: string) => {
      claimed.delete(key);
    },
    getCandidateById: async () =>
      ({
        id: "cand-dup",
        shotRequestId: "req-1",
        productSku: "SS-001",
        candidateIndex: 1,
        status: "ready",
        reviewDecision: persistCalls > 0 ? "approved" : null,
        blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
        platform: "slack",
        conversationId: "C_ALLOWED",
        externalMessageId: "111.222",
      }) as never,
    persistCandidateReview: async ({ decision }: { decision: "approved" | "rejected" }) => {
      persistCalls += 1;
      return {
        alreadyReviewed: persistCalls > 1,
        candidate: {
          id: "cand-dup",
          shotRequestId: "req-1",
          productSku: "SS-001",
          candidateIndex: 1,
          status: "ready",
          reviewDecision: decision,
          blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
          platform: "slack",
          conversationId: "C_ALLOWED",
          externalMessageId: "111.222",
        } as never,
        existingDecision: decision,
        requestStatus: "awaiting_review",
        approvedCount: null,
        importId: "import-1",
        newlyResolved: false,
      };
    },
    updateMessage: async () => undefined,
    postResponseUrl: async () => undefined,
  };

  await executeSlackBlockAction(payload, deps);
  await executeSlackBlockAction(payload, deps);
  assert.equal(persistCalls, 1);
});

test("conflicting second decision does not overwrite the stored review", async () => {
  const { executeSlackBlockAction, SLACK_INTERACTION_MESSAGES } = await import(
    "@/lib/slack-actions"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const ephemerals: string[] = [];
  const claimed = new Set<string>();

  await executeSlackBlockAction(
    {
      type: "block_actions",
      trigger_id: "trig-conflict-exec",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      response_url: "https://hooks.slack.com/actions/test",
      message: { ts: "111.222", blocks: [] },
      actions: [
        {
          action_id: SLACK_ACTION_IDS.reject,
          value: "cand-conflict",
          action_ts: "1",
        },
      ],
    },
    {
      claimAction: (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      releaseAction: () => undefined,
      getCandidateById: async () =>
        ({
          id: "cand-conflict",
          shotRequestId: "req-1",
          productSku: "SS-001",
          candidateIndex: 1,
          status: "ready",
          reviewDecision: "approved",
          blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
          platform: "slack",
          conversationId: "C_ALLOWED",
          externalMessageId: "111.222",
        }) as never,
      persistCandidateReview: async () => {
        throw new Error("persist must not run for an already-reviewed candidate");
      },
      updateMessage: async () => undefined,
      postResponseUrl: async (_url, body) => {
        if (body.response_type === "ephemeral" && body.text) {
          ephemerals.push(body.text);
        }
      },
    },
  );

  assert.ok(ephemerals.includes(SLACK_INTERACTION_MESSAGES.alreadyApproved));
});

test("background failure after acknowledgement posts a retryable error", async () => {
  const { executeSlackBlockAction, SLACK_INTERACTION_MESSAGES } = await import(
    "@/lib/slack-actions"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const ephemerals: string[] = [];
  const claimed = new Set<string>();

  await executeSlackBlockAction(
    {
      type: "block_actions",
      trigger_id: "trig-bg-fail",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      response_url: "https://hooks.slack.com/actions/test",
      message: { ts: "111.222", blocks: [] },
      actions: [
        {
          action_id: SLACK_ACTION_IDS.approve,
          value: "cand-fail",
          action_ts: "1",
        },
      ],
    },
    {
      claimAction: (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      releaseAction: () => undefined,
      getCandidateById: async () => {
        throw new Error("simulated db outage");
      },
      updateMessage: async () => undefined,
      postResponseUrl: async (_url, body) => {
        if (body.text) {
          ephemerals.push(body.text);
        }
      },
    },
  );

  assert.ok(
    ephemerals.some(
      (text) =>
        text === SLACK_INTERACTION_MESSAGES.processingFailed ||
        text.includes("try again"),
    ),
  );
});

test("invalid signature still returns 401 without scheduling background work", async () => {
  const { POST, slackInteractionsRouteDeps } = await import(
    "@/app/api/slack/interactions/route"
  );
  let scheduled = false;
  const previous = slackInteractionsRouteDeps.scheduleBackground;
  slackInteractionsRouteDeps.scheduleBackground = () => {
    scheduled = true;
  };
  try {
    const response = await POST(
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
    assert.equal(response.status, 401);
    assert.equal(scheduled, false);
  } finally {
    slackInteractionsRouteDeps.scheduleBackground = previous;
  }
});
