import { createHmac, timingSafeEqual } from "node:crypto";

/** Slack rejects requests older than this (seconds). */
export const SLACK_MAX_TIMESTAMP_AGE_SEC = 60 * 5;

export type SlackSignatureVerifyInput = {
  signingSecret: string;
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  /** Injectable clock for tests (unix seconds). */
  nowSec?: number;
  maxAgeSec?: number;
};

export type SlackSignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "invalid_timestamp" | "stale_timestamp" | "invalid_signature" };

const hmacHex = (secret: string, base: string): string =>
  createHmac("sha256", secret).update(base, "utf8").digest("hex");

const safeEqualHex = (a: string, b: string): boolean => {
  try {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
};

export const isSlackTimestampFresh = (
  timestampSec: number,
  nowSec: number,
  maxAgeSec: number = SLACK_MAX_TIMESTAMP_AGE_SEC,
): boolean => Math.abs(nowSec - timestampSec) <= maxAgeSec;

/**
 * Verify Slack request signing using the raw body, signing secret, and timestamp.
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export const verifySlackRequestSignature = (
  input: SlackSignatureVerifyInput,
): SlackSignatureVerifyResult => {
  const timestampHeader = input.timestampHeader?.trim() ?? "";
  const signatureHeader = input.signatureHeader?.trim() ?? "";

  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "missing_headers" };
  }

  if (!/^\d+$/.test(timestampHeader)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const timestampSec = Number(timestampHeader);
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const maxAgeSec = input.maxAgeSec ?? SLACK_MAX_TIMESTAMP_AGE_SEC;

  if (!isSlackTimestampFresh(timestampSec, nowSec, maxAgeSec)) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const base = `v0:${timestampHeader}:${input.rawBody}`;
  const expected = `v0=${hmacHex(input.signingSecret, base)}`;

  if (!safeEqualHex(expected, signatureHeader)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true };
};
