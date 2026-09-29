import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { claimSlackEventId } from "@/lib/slack-dedupe";
import {
  isAllowedSlackTeam,
  isSlackEventCallback,
  isSlackUrlVerification,
  processSlackEventCallback,
} from "@/lib/slack";
import { verifySlackRequestSignature } from "@/lib/slack-verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const unauthorizedAck = () => NextResponse.json({ ok: true });

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

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (isSlackUrlVerification(payload)) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (!isSlackEventCallback(payload)) {
    return NextResponse.json({ ok: true });
  }

  if (!isAllowedSlackTeam(payload.team_id)) {
    return unauthorizedAck();
  }

  if (!claimSlackEventId(payload.event_id)) {
    return unauthorizedAck();
  }

  // Acknowledge immediately; process asynchronously so Slack does not retry.
  waitUntil(
    processSlackEventCallback(payload).catch((error) => {
      console.error(
        "[slack/events]",
        error instanceof Error ? error.message : "background processing failed",
      );
    }),
  );

  return NextResponse.json({ ok: true });
}
