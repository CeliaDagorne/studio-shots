import assert from "node:assert/strict";
import test from "node:test";

import type { PersistCandidateReviewResult } from "@/lib/generation";
import type { GenerationCandidateRow } from "@/lib/schema";
import type { SlackActionDeps, SlackInteractionResponse } from "@/lib/slack-actions";
import type { SlackBlock } from "@/lib/slack-blocks";

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

const sampleCandidate = (
  overrides?: Partial<GenerationCandidateRow>,
): GenerationCandidateRow =>
  ({
    id: "cand-1",
    shotRequestId: "req-1",
    productSku: "SS-001",
    candidateIndex: 1,
    lumaGenerationId: "luma-1",
    lumaState: "completed",
    status: "ready",
    reviewDecision: null,
    reviewedAt: null,
    blobPath: "candidates/SS-001/cand-1.jpg",
    blobUrl: "https://blob.example/cand-1.jpg",
    prompt: "lifestyle shot",
    errorMessage: null,
    platform: "slack",
    conversationId: "C_ALLOWED",
    externalMessageId: "111.222",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as GenerationCandidateRow;

const sampleMessageBlocks = (): SlackBlock[] => [
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*SS-001* · candidate 1/3\nReview this candidate independently.",
    },
  },
  {
    type: "image",
    image_url: "https://blob.example/cand-1.jpg",
    alt_text: "SS-001 candidate 1",
  },
  {
    type: "actions",
    block_id: "ss_cand_actions:cand-1",
    elements: [
      { type: "button", action_id: "ss_approve", text: { type: "plain_text", text: "Approve" }, value: "cand-1" },
      { type: "button", action_id: "ss_reject", text: { type: "plain_text", text: "Reject" }, value: "cand-1" },
    ],
  },
];

const blockActionPayload = (params: {
  actionId: string;
  value: string;
  triggerId: string;
  teamId?: string;
  channelId?: string;
  messageTs?: string;
  blocks?: SlackBlock[];
  responseUrl?: string;
}) => ({
  type: "block_actions",
  trigger_id: params.triggerId,
  team: { id: params.teamId ?? "T_ALLOWED" },
  channel: { id: params.channelId ?? "C_ALLOWED" },
  user: { id: "U_USER" },
  message: {
    ts: params.messageTs ?? "111.222",
    blocks: params.blocks ?? sampleMessageBlocks(),
  },
  response_url: params.responseUrl ?? "https://hooks.slack.com/actions/test",
  actions: [
    {
      action_id: params.actionId,
      value: params.value,
      action_ts: "111.222",
    },
  ],
});

const baseDeps = (candidate: GenerationCandidateRow = sampleCandidate()) => {
  const seen = new Set<string>();
  let stored = candidate;
  const responsePosts: SlackInteractionResponse[] = [];
  const deps: SlackActionDeps = {
    getCandidateById: async (id: string) => (id === stored.id ? stored : null),
    persistCandidateReview: async ({
      candidateId,
      decision,
    }: {
      candidateId: string;
      decision: "approved" | "rejected";
    }): Promise<PersistCandidateReviewResult> => {
      if (candidateId !== stored.id) {
        return {
          alreadyReviewed: true,
          candidate: null,
          existingDecision: null,
          requestStatus: null,
          approvedCount: null,
          importId: null,
          newlyResolved: false,
        };
      }
      if (stored.reviewDecision) {
        return {
          alreadyReviewed: true,
          candidate: stored,
          existingDecision: stored.reviewDecision,
          requestStatus: "awaiting_review",
          approvedCount: null,
          importId: null,
          newlyResolved: false,
        };
      }
      stored = {
        ...stored,
        reviewDecision: decision,
        reviewedAt: new Date(),
      };
      return {
        alreadyReviewed: false,
        candidate: stored,
        existingDecision: decision,
        requestStatus: "awaiting_review",
        approvedCount: null,
        importId: null,
        newlyResolved: false,
      };
    },
    claimAction: (key: string) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    releaseAction: (key: string) => {
      seen.delete(key);
    },
    postResponseUrl: async (_url, body) => {
      responsePosts.push(body);
    },
    appUrl: "https://studio-shots.example",
    isAllowedTeam: (teamId: string) => teamId === "T_ALLOWED",
    isAllowedChannel: (channelId: string) => channelId === "C_ALLOWED",
    notifyConversation: async () => undefined,
  };
  return {
    candidateRef: () => stored,
    setCandidate: (next: GenerationCandidateRow) => {
      stored = next;
    },
    responsePosts,
    deps,
  };
};

test("Slack candidate blocks include image, SKU, candidate number, Approve and Reject", async () => {
  const { buildSlackCandidateBlocks, SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const built = buildSlackCandidateBlocks({
    caption: "SS-001 candidate 2/3\nReview this candidate independently.",
    blobUrl: "https://blob.example/cand.jpg",
    candidateId: "cand-2",
    sku: "SS-001",
    candidateIndex: 2,
    total: 3,
  });
  const serialized = JSON.stringify(built.blocks);
  assert.match(serialized, /SS-001/);
  assert.match(serialized, /candidate 2\/3/);
  assert.match(serialized, /blob\.example\/cand\.jpg/);
  assert.match(serialized, /Approve/);
  assert.match(serialized, /Reject/);
  assert.match(serialized, new RegExp(SLACK_ACTION_IDS.approve));
  assert.match(serialized, new RegExp(SLACK_ACTION_IDS.reject));
});

test("finalizeSlackCandidateMessageBlocks strips actions and stamps status", async () => {
  const { finalizeSlackCandidateMessageBlocks } = await import("@/lib/slack-blocks");
  const finalized = finalizeSlackCandidateMessageBlocks(sampleMessageBlocks(), "approved");
  const serialized = JSON.stringify(finalized);
  assert.doesNotMatch(serialized, /"type":"actions"/);
  assert.doesNotMatch(serialized, /"text":"Approve"/);
  assert.match(serialized, /Status: Approved/);
  assert.match(serialized, /blob\.example\/cand-1\.jpg/);
});

test("approval updates Slack message without buttons before any DB work", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const ctx = baseDeps();
  let getStarted = false;
  let releaseGet!: () => void;
  const getGate = new Promise<void>((resolve) => {
    releaseGet = resolve;
  });
  const originalGet = ctx.deps.getCandidateById!;
  ctx.deps.getCandidateById = async (id) => {
    getStarted = true;
    await getGate;
    return originalGet(id);
  };

  let persistStarted = false;
  let releasePersist!: () => void;
  const persistGate = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  const originalPersist = ctx.deps.persistCandidateReview!;
  ctx.deps.persistCandidateReview = async (params) => {
    persistStarted = true;
    await persistGate;
    return originalPersist(params);
  };

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-approve-1",
    }),
    ctx.deps,
  );

  assert.equal(result.httpBody.replace_original, true);
  assert.match(result.httpBody.text ?? "", /Status: Approved/);
  assert.doesNotMatch(JSON.stringify(result.httpBody.blocks), /"text":"Approve"/);
  assert.doesNotMatch(JSON.stringify(result.httpBody.blocks), /"text":"Reject"/);
  assert.doesNotMatch(JSON.stringify(result.httpBody.blocks), /"type":"actions"/);
  assert.equal(getStarted, false);
  assert.equal(persistStarted, false);
  assert.equal(ctx.candidateRef().reviewDecision, null);
  assert.ok(result.background);

  const background = result.background!();
  await Promise.resolve();
  assert.equal(getStarted, true);
  releaseGet();
  await Promise.resolve();
  releasePersist();
  await background;
  assert.equal(persistStarted, true);
  assert.equal(ctx.candidateRef().reviewDecision, "approved");
  assert.ok(ctx.responsePosts.some((post) => post.replace_original === true));
});

test("rejection updates Slack message without buttons before persistence finishes", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const ctx = baseDeps();

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.reject,
      value: "cand-1",
      triggerId: "trig-reject-1",
    }),
    ctx.deps,
  );

  assert.equal(result.httpBody.replace_original, true);
  assert.match(result.httpBody.text ?? "", /Status: Rejected/);
  assert.doesNotMatch(JSON.stringify(result.httpBody.blocks), /"text":"Approve"/);
  assert.doesNotMatch(JSON.stringify(result.httpBody.blocks), /"text":"Reject"/);
  assert.ok(result.background);
  await result.background!();
  assert.equal(ctx.candidateRef().reviewDecision, "rejected");
});

test("duplicate review clicks are idempotent and do not re-persist", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const ctx = baseDeps();
  let persistCalls = 0;
  const persist = ctx.deps.persistCandidateReview!;
  ctx.deps.persistCandidateReview = async (params) => {
    persistCalls += 1;
    return persist(params);
  };

  const first = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-dup-a",
    }),
    ctx.deps,
  );
  assert.match(first.httpBody.text ?? "", /Approved/);
  assert.doesNotMatch(JSON.stringify(first.httpBody.blocks), /"text":"Approve"/);
  assert.ok(first.background);
  await first.background!();

  const second = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-dup-b",
    }),
    ctx.deps,
  );
  assert.match(second.httpBody.text ?? "", /Approved/);
  assert.doesNotMatch(JSON.stringify(second.httpBody.blocks), /"text":"Approve"/);
  assert.ok(second.background);
  await second.background!();
  assert.equal(persistCalls, 1);
});

test("a second click while review is in flight is refused without leaving buttons", async () => {
  const { handleSlackBlockAction, SLACK_INTERACTION_MESSAGES } = await import(
    "@/lib/slack-actions"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const ctx = baseDeps();
  let releasePersist!: () => void;
  const persistGate = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  const originalPersist = ctx.deps.persistCandidateReview!;
  ctx.deps.persistCandidateReview = async (params) => {
    await persistGate;
    return originalPersist(params);
  };

  const first = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-race-a",
    }),
    ctx.deps,
  );
  assert.match(first.httpBody.text ?? "", /Approved/);
  assert.doesNotMatch(JSON.stringify(first.httpBody.blocks), /"text":"Reject"/);

  const second = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.reject,
      value: "cand-1",
      triggerId: "trig-race-b",
    }),
    ctx.deps,
  );
  assert.equal(second.httpBody.response_type, "ephemeral");
  assert.equal(second.httpBody.text, SLACK_INTERACTION_MESSAGES.reviewInProgress);

  releasePersist();
  await first.background!();
  assert.equal(ctx.candidateRef().reviewDecision, "approved");
});

test("conflicting decisions are rejected without changing the stored decision", async () => {
  const { handleSlackBlockAction, SLACK_INTERACTION_MESSAGES } = await import(
    "@/lib/slack-actions"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const ctx = baseDeps(
    sampleCandidate({
      reviewDecision: "approved",
      reviewedAt: new Date(),
    }),
  );

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.reject,
      value: "cand-1",
      triggerId: "trig-conflict-1",
    }),
    ctx.deps,
  );

  // Immediate ack still removes buttons; conflict is reported via response_url.
  assert.equal(result.httpBody.replace_original, true);
  assert.doesNotMatch(JSON.stringify(result.httpBody.blocks), /"text":"Approve"/);
  assert.ok(result.background);
  await result.background!();
  assert.equal(ctx.candidateRef().reviewDecision, "approved");
  assert.ok(
    ctx.responsePosts.some(
      (post) =>
        post.response_type === "ephemeral" &&
        post.text === SLACK_INTERACTION_MESSAGES.alreadyApproved,
    ),
  );
  assert.ok(
    ctx.responsePosts.some(
      (post) =>
        post.replace_original === true &&
        /Approved/.test(post.text) &&
        !JSON.stringify(post.blocks).includes('"text":"Approve"'),
    ),
  );
});

test("stale or missing candidates return clear errors via response_url", async () => {
  const { handleSlackBlockAction, SLACK_INTERACTION_MESSAGES } = await import(
    "@/lib/slack-actions"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");

  const missingCtx = baseDeps();
  missingCtx.deps.getCandidateById = async () => null;
  const missing = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-missing",
      triggerId: "trig-missing",
    }),
    missingCtx.deps,
  );
  assert.equal(missing.httpBody.replace_original, true);
  assert.ok(missing.background);
  await missing.background!();
  assert.ok(
    missingCtx.responsePosts.some(
      (post) => post.text === SLACK_INTERACTION_MESSAGES.missingCandidate,
    ),
  );

  const staleCtx = baseDeps(sampleCandidate({ status: "failed", blobUrl: null }));
  const stale = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-stale",
    }),
    staleCtx.deps,
  );
  assert.ok(stale.background);
  await stale.background!();
  assert.ok(
    staleCtx.responsePosts.some(
      (post) => post.text === SLACK_INTERACTION_MESSAGES.staleCandidate,
    ),
  );

  const wrongCtx = baseDeps();
  const wrongMessage = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-wrong-ts",
      messageTs: "999.999",
    }),
    wrongCtx.deps,
  );
  assert.ok(wrongMessage.background);
  await wrongMessage.background!();
  assert.ok(
    wrongCtx.responsePosts.some(
      (post) => post.text === SLACK_INTERACTION_MESSAGES.staleCandidate,
    ),
  );
});

test("unauthorized workspace and channel review actions are refused", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const deps = baseDeps().deps;

  const team = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-team",
      teamId: "T_OTHER",
    }),
    deps,
  );
  assert.match(team.httpBody.text, /workspace/i);
  assert.equal(team.httpBody.response_type, "ephemeral");

  const channel = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-channel",
      channelId: "C_OTHER",
    }),
    deps,
  );
  assert.match(channel.httpBody.text, /channel/i);
  assert.equal(channel.httpBody.response_type, "ephemeral");
});

test("candidate from another Slack conversation is rejected", async () => {
  const { handleSlackBlockAction, SLACK_INTERACTION_MESSAGES } = await import(
    "@/lib/slack-actions"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const ctx = baseDeps(sampleCandidate({ conversationId: "C_OTHER" }));

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-wrong-convo",
    }),
    ctx.deps,
  );
  assert.equal(result.httpBody.replace_original, true);
  assert.ok(result.background);
  await result.background!();
  assert.ok(
    ctx.responsePosts.some(
      (post) => post.text === SLACK_INTERACTION_MESSAGES.wrongCandidateConversation,
    ),
  );
});

test("request completion notification runs only when newly resolved", async () => {
  const { handleSlackBlockAction } = await import("@/lib/slack-actions");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const notifications: string[] = [];
  const ctx = baseDeps();
  ctx.deps.persistCandidateReview = async () => ({
    alreadyReviewed: false,
    candidate: {
      ...ctx.candidateRef(),
      reviewDecision: "approved",
    },
    existingDecision: "approved",
    requestStatus: "approved",
    approvedCount: 2,
    importId: "import-1",
    newlyResolved: true,
  });
  ctx.deps.notifyConversation = async (_conversation, text) => {
    notifications.push(text);
  };

  const result = await handleSlackBlockAction(
    blockActionPayload({
      actionId: SLACK_ACTION_IDS.approve,
      value: "cand-1",
      triggerId: "trig-complete",
    }),
    ctx.deps,
  );
  assert.ok(result.background);
  await result.background!();
  assert.equal(notifications.length, 1);
  assert.match(notifications[0]!, /marked approved/);
  assert.match(notifications[0]!, /Product page:/);
});
