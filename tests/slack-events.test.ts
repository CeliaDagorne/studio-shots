import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.LUMA_AGENTS_API_KEY = process.env.LUMA_AGENTS_API_KEY ?? "luma-key";
process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET = "slack-signing-secret-for-tests";
process.env.SLACK_TEAM_ID = "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = "C_ALLOWED";

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

const signBody = (rawBody: string, timestamp: string, secret: string = SIGNING_SECRET): string => {
  const base = `v0:${timestamp}:${rawBody}`;
  const digest = createHmac("sha256", secret).update(base, "utf8").digest("hex");
  return `v0=${digest}`;
};

const signedRequest = (rawBody: string, timestamp: string, signature?: string) =>
  new Request("https://studio-shots.example/api/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature ?? signBody(rawBody, timestamp),
    },
    body: rawBody,
  });

const withMockedSlackPost = async (
  run: (posts: Array<{ channel: string; text: string }>) => Promise<void>,
) => {
  const posts: Array<{ channel: string; text: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("chat.postMessage")) {
      posts.push(JSON.parse(String(init?.body ?? "{}")) as { channel: string; text: string });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    await run(posts);
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("verifySlackRequestSignature accepts a valid signature", async () => {
  const { verifySlackRequestSignature } = await import("@/lib/slack-verify");
  const rawBody = '{"type":"url_verification","challenge":"abc"}';
  const timestamp = "1700000000";
  const result = verifySlackRequestSignature({
    signingSecret: SIGNING_SECRET,
    rawBody,
    timestampHeader: timestamp,
    signatureHeader: signBody(rawBody, timestamp),
    nowSec: 1700000000,
  });
  assert.equal(result.ok, true);
});

test("verifySlackRequestSignature rejects an invalid signature", async () => {
  const { verifySlackRequestSignature } = await import("@/lib/slack-verify");
  const rawBody = '{"ok":true}';
  const timestamp = "1700000000";
  const result = verifySlackRequestSignature({
    signingSecret: SIGNING_SECRET,
    rawBody,
    timestampHeader: timestamp,
    signatureHeader: "v0=deadbeef",
    nowSec: 1700000000,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "invalid_signature");
  }
});

test("verifySlackRequestSignature rejects a stale timestamp", async () => {
  const { verifySlackRequestSignature, SLACK_MAX_TIMESTAMP_AGE_SEC } = await import(
    "@/lib/slack-verify"
  );
  const rawBody = '{"ok":true}';
  const timestamp = "1700000000";
  const result = verifySlackRequestSignature({
    signingSecret: SIGNING_SECRET,
    rawBody,
    timestampHeader: timestamp,
    signatureHeader: signBody(rawBody, timestamp),
    nowSec: 1700000000 + SLACK_MAX_TIMESTAMP_AGE_SEC + 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "stale_timestamp");
  }
});

test("invalid signature returns 401 from the Slack events route", async () => {
  const { POST } = await import("@/app/api/slack/events/route");
  const rawBody = JSON.stringify({ type: "url_verification", challenge: "nope" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await POST(signedRequest(rawBody, timestamp, "v0=invalid"));
  assert.equal(response.status, 401);
});

test("Slack URL verification returns the challenge", async () => {
  const { POST } = await import("@/app/api/slack/events/route");
  const rawBody = JSON.stringify({
    type: "url_verification",
    challenge: "challenge-token-123",
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await POST(signedRequest(rawBody, timestamp));
  assert.equal(response.status, 200);
  const json = (await response.json()) as { challenge: string };
  assert.equal(json.challenge, "challenge-token-123");
});

test("duplicate Slack event_id is claimed once and later deliveries are skipped", async () => {
  const { resetSlackEventDedupeForTests, claimSlackEventId } = await import("@/lib/slack-dedupe");
  const { POST } = await import("@/app/api/slack/events/route");

  resetSlackEventDedupeForTests();

  await withMockedSlackPost(async () => {
    const payload = {
      type: "event_callback",
      team_id: "T_ALLOWED",
      event_id: "Ev_DUPLICATE_1",
      event: {
        type: "app_mention",
        channel: "C_ALLOWED",
        text: "<@U_BOT> help",
      },
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));

    const first = await POST(signedRequest(rawBody, timestamp));
    assert.equal(first.status, 200);
    assert.equal(claimSlackEventId("Ev_DUPLICATE_1"), false);

    const second = await POST(signedRequest(rawBody, timestamp));
    assert.equal(second.status, 200);
    assert.equal(claimSlackEventId("Ev_DUPLICATE_1"), false);
  });

  resetSlackEventDedupeForTests();
});

test("unauthorized workspace is acknowledged without posting", async () => {
  const { resetSlackEventDedupeForTests } = await import("@/lib/slack-dedupe");
  const { processSlackEventCallback } = await import("@/lib/slack");
  const { POST } = await import("@/app/api/slack/events/route");

  resetSlackEventDedupeForTests();

  await withMockedSlackPost(async (posts) => {
    const payload = {
      type: "event_callback",
      team_id: "T_OTHER",
      event_id: "Ev_TEAM_1",
      event: {
        type: "app_mention",
        channel: "C_ALLOWED",
        text: "<@U_BOT> help",
      },
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await POST(signedRequest(rawBody, timestamp));
    assert.equal(response.status, 200);

    const result = await processSlackEventCallback(payload as never);
    assert.equal(result.handled, false);
    assert.equal(result.reason, "unauthorized_team");
    assert.equal(posts.length, 0);
  });

  resetSlackEventDedupeForTests();
});

test("unauthorized channel is acknowledged with a clear refusal message", async () => {
  const { processSlackEventCallback } = await import("@/lib/slack");
  const { SLACK_IMPORT_MESSAGES } = await import("@/lib/slack-import");

  await withMockedSlackPost(async (posts) => {
    const result = await processSlackEventCallback({
      type: "event_callback",
      team_id: "T_ALLOWED",
      event_id: "Ev_CHANNEL_1",
      event: {
        type: "app_mention",
        channel: "C_OTHER",
        text: "<@U_BOT> help",
      },
    });
    assert.equal(result.handled, false);
    assert.equal(result.reason, "unauthorized_channel");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.text, SLACK_IMPORT_MESSAGES.unauthorizedChannel);
  });
});

test("app_mention in the allowlisted channel posts the Studio Shots help message", async () => {
  const { processSlackEventCallback, slackHelpMessage } = await import("@/lib/slack");

  await withMockedSlackPost(async (posts) => {
    const result = await processSlackEventCallback({
      type: "event_callback",
      team_id: "T_ALLOWED",
      event_id: "Ev_HELP_1",
      event: {
        type: "app_mention",
        channel: "C_ALLOWED",
        text: "<@U_BOT> hello",
      },
    });
    assert.equal(result.handled, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.channel, "C_ALLOWED");
    assert.equal(posts[0]?.text, slackHelpMessage(process.env.APP_URL));
  });
});
