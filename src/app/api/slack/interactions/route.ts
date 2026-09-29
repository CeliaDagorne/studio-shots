import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  handleSlackBlockAction,
  parseSlackInteractionFormBody,
} from "@/lib/slack-actions";
import { verifySlackRequestSignature } from "@/lib/slack-verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

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

  try {
    const result = await handleSlackBlockAction(payload);

    if (result.background) {
      waitUntil(
        result.background().catch((error) => {
          console.error(
            "[slack/interactions]",
            error instanceof Error ? error.message : "background generation failed",
          );
        }),
      );
    }

    // Immediate Block Kit response keeps Slack under the 3s acknowledgement limit.
    return NextResponse.json(result.httpBody);
  } catch (error) {
    console.error(
      "[slack/interactions]",
      error instanceof Error ? error.message : "interaction failed",
    );
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Something went wrong handling that action. Please try again.",
    });
  }
}
