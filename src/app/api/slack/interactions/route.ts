import { NextResponse } from "next/server";

import { scheduleBackground } from "@/lib/background";
import { env } from "@/lib/env";
import {
  executeSlackBlockAction,
  parseSlackInteractionFormBody,
} from "@/lib/slack-actions";
import { verifySlackRequestSignature } from "@/lib/slack-verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Injectable for tests — production uses the real scheduler and executor. */
export const slackInteractionsRouteDeps = {
  scheduleBackground,
  executeSlackBlockAction,
};

/**
 * Slack interactivity endpoint.
 *
 * Must acknowledge within 3 seconds. Signature verification and payload parse
 * happen inline; all DB / Slack API / generation work runs in the background.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  const verified = verifySlackRequestSignature({
    signingSecret: env.slackSigningSecret,
    rawBody,
    timestampHeader: request.headers.get("x-slack-request-timestamp"),
    signatureHeader: request.headers.get("x-slack-signature"),
  });

  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.reason }, { status: 401 });
  }

  let payload;
  try {
    payload = parseSlackInteractionFormBody(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  slackInteractionsRouteDeps.scheduleBackground(
    slackInteractionsRouteDeps.executeSlackBlockAction(payload),
    "[slack/interactions]",
  );

  // Empty 200 satisfies Slack's acknowledgement deadline. Message updates and
  // ephemerals are delivered from background work via chat.update / response_url.
  return new NextResponse(null, { status: 200 });
}
