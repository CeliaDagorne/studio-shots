import { env } from "@/lib/env";

export type SlackUrlVerification = {
  type: "url_verification";
  challenge: string;
  token?: string;
};

export type SlackAppMentionEvent = {
  type: "app_mention";
  user?: string;
  text?: string;
  channel: string;
  ts?: string;
  event_ts?: string;
};

export type SlackEventCallback = {
  type: "event_callback";
  token?: string;
  team_id: string;
  api_app_id?: string;
  event_id: string;
  event_time?: number;
  event: SlackAppMentionEvent | { type: string; channel?: string };
};

export type SlackEventsPayload = SlackUrlVerification | SlackEventCallback | { type?: string };

export const isSlackUrlVerification = (payload: unknown): payload is SlackUrlVerification =>
  typeof payload === "object" &&
  payload !== null &&
  (payload as SlackUrlVerification).type === "url_verification" &&
  typeof (payload as SlackUrlVerification).challenge === "string";

export const isSlackEventCallback = (payload: unknown): payload is SlackEventCallback =>
  typeof payload === "object" &&
  payload !== null &&
  (payload as SlackEventCallback).type === "event_callback" &&
  typeof (payload as SlackEventCallback).team_id === "string" &&
  typeof (payload as SlackEventCallback).event_id === "string" &&
  typeof (payload as SlackEventCallback).event === "object" &&
  (payload as SlackEventCallback).event !== null;

export const isAllowedSlackTeam = (teamId: string): boolean => teamId === env.slackTeamId;

export const isAllowedSlackChannel = (channelId: string): boolean =>
  channelId === env.slackChannelId;

export const slackHelpMessage = (appUrl?: string): string => {
  const base = (appUrl ?? "").replace(/\/+$/, "");
  const lines = [
    "Studio Shots — styled product photography for catalog teams.",
    "",
    "Mention @Studio Shots in this channel for help.",
    "Catalog import, generation, and review currently run in Telegram; Slack workflows are being added.",
    "",
    "Team visibility:",
    "- Public product pages for approved shots",
  ];

  if (base) {
    lines.push(`- Campaign overview pages: ${base}/campaigns/<importId>`);
  }

  return lines.join("\n");
};

type SlackApiResult = {
  ok: boolean;
  error?: string;
};

export const postSlackMessage = async (params: {
  channel: string;
  text: string;
}): Promise<void> => {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.slackBotToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: params.channel,
      text: params.text,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Slack chat.postMessage HTTP ${response.status}`);
  }

  const json = (await response.json()) as SlackApiResult;
  if (!json.ok) {
    throw new Error(`Slack chat.postMessage failed: ${json.error ?? "unknown_error"}`);
  }
};

/**
 * Handle a verified Slack event_callback after the HTTP ack has been (or will be) returned.
 * Unauthorized team/channel and unknown event types are no-ops.
 */
export const processSlackEventCallback = async (
  payload: SlackEventCallback,
): Promise<{ handled: boolean; reason?: string }> => {
  if (!isAllowedSlackTeam(payload.team_id)) {
    return { handled: false, reason: "unauthorized_team" };
  }

  const event = payload.event;
  if (event.type !== "app_mention") {
    return { handled: false, reason: "ignored_event_type" };
  }

  const channel = event.channel;
  if (!channel || !isAllowedSlackChannel(channel)) {
    return { handled: false, reason: "unauthorized_channel" };
  }

  await postSlackMessage({
    channel,
    text: slackHelpMessage(env.appUrl),
  });

  return { handled: true };
};
