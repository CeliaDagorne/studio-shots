import { buildCampaignPageUrl } from "@/lib/campaigns";
import { slackConversation, type ChatConversation } from "@/lib/chat-identity";
import { env } from "@/lib/env";
import {
  getLatestImportForConversation,
  loadStillActionableProductsForImport,
} from "@/lib/imports";
import {
  isFakeImageGenerationProvider,
} from "@/lib/image-generation";
import { selectNextActionableProduct } from "@/lib/product-selection";
import type { ImportRow } from "@/lib/schema";
import type { ActionableProductOption } from "@/types";
import {
  buildSlackCampaignStatusBlocks,
  type SlackBlock,
} from "@/lib/slack-blocks";
import {
  isSlackImportIntent,
  runSlackCatalogImport,
  SLACK_IMPORT_MESSAGES,
  type SlackFileAttachment,
} from "@/lib/slack-import";

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
  files?: SlackFileAttachment[];
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

/**
 * Slack help copy. Uses mrkdwn-friendly bullets and explicit newlines so each
 * instruction renders on its own line in a section block.
 */
export const slackHelpMessage = (_appUrl?: string): string =>
  [
    "*Studio Shots* · styled product photography for catalog teams.",
    "",
    "*Import a catalog in this channel:*",
    "• Attach one CSV and mention @Studio Shots with `import`",
    "• Review the preview, then generate the priority product or choose another SKU",
    "",
    "*Candidate review:*",
    "• Approve or Reject each generated shot in this channel",
    "",
    "*Team visibility:*",
    "• Public product pages for approved shots",
    "• After import, Studio Shots shares a link to the campaign overview.",
  ].join("\n");

export const slackHelpBlocks = (appUrl?: string): SlackBlock[] => [
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: slackHelpMessage(appUrl),
    },
  },
];

export const SLACK_UNKNOWN_COMMAND_MESSAGE =
  "I don't recognize that command. Try `help`, `import`, `next`, `next up`, `continue`, or `status`.";

export const SLACK_NO_CAMPAIGN_MESSAGE =
  "No campaign found in this channel yet. Attach a catalog CSV and mention @Studio Shots with `import`.";

const CAMPAIGN_STATUS_COMMANDS = new Set(["next", "next up", "continue", "status"]);

/** Strip bot mentions and normalize whitespace for command matching. */
export const normalizeSlackMentionText = (text: string | undefined): string => {
  if (!text) {
    return "";
  }
  return text.replace(/<@[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
};

export type SlackMentionCommand =
  | { kind: "help" }
  | { kind: "campaign_status" }
  | { kind: "unknown"; text: string };

export const parseSlackMentionCommand = (text: string | undefined): SlackMentionCommand => {
  const normalized = normalizeSlackMentionText(text);
  if (!normalized || normalized === "help") {
    return { kind: "help" };
  }
  if (CAMPAIGN_STATUS_COMMANDS.has(normalized)) {
    return { kind: "campaign_status" };
  }
  return { kind: "unknown", text: normalized };
};

type SlackApiResult = {
  ok: boolean;
  error?: string;
  ts?: string;
};

export const postSlackMessage = async (params: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<{ ts?: string }> => {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.slackBotToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: params.channel,
      text: params.text,
      ...(params.blocks ? { blocks: params.blocks } : {}),
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

  return { ts: json.ts };
};

export type SlackEventDeps = {
  postMessage?: typeof postSlackMessage;
  getLatestImportForConversation?: (
    conversation: ChatConversation,
  ) => Promise<ImportRow | null>;
  loadStillActionableProductsForImport?: (
    record: ImportRow,
  ) => Promise<ActionableProductOption[]>;
  appUrl?: string;
};

/**
 * Handle a verified Slack event_callback after the HTTP ack has been (or will be) returned.
 * Unauthorized teams are ignored. Unauthorized channels get a clear refusal message.
 */
export const processSlackEventCallback = async (
  payload: SlackEventCallback,
  deps: SlackEventDeps = {},
): Promise<{ handled: boolean; reason?: string }> => {
  const postMessage = deps.postMessage ?? postSlackMessage;
  const getLatestImport =
    deps.getLatestImportForConversation ?? getLatestImportForConversation;
  const loadStillActionable =
    deps.loadStillActionableProductsForImport ?? loadStillActionableProductsForImport;
  const appUrl = deps.appUrl ?? env.appUrl;

  if (!isAllowedSlackTeam(payload.team_id)) {
    return { handled: false, reason: "unauthorized_team" };
  }

  const event = payload.event;
  if (event.type !== "app_mention") {
    return { handled: false, reason: "ignored_event_type" };
  }

  const mention = event as SlackAppMentionEvent;
  const channel = mention.channel;
  if (!channel) {
    return { handled: false, reason: "missing_channel" };
  }

  if (!isAllowedSlackChannel(channel)) {
    await postMessage({
      channel,
      text: SLACK_IMPORT_MESSAGES.unauthorizedChannel,
    });
    return { handled: false, reason: "unauthorized_channel" };
  }

  if (isSlackImportIntent(mention.text)) {
    const result = await runSlackCatalogImport({
      channel,
      externalEventId: payload.event_id,
      files: mention.files,
      deps: {
        postMessage,
      },
    });
    return {
      handled: result.ok,
      reason: result.reason ?? "import",
    };
  }

  const command = parseSlackMentionCommand(mention.text);

  if (command.kind === "help") {
    await postMessage({
      channel,
      text: slackHelpMessage(appUrl),
      blocks: slackHelpBlocks(appUrl),
    });
    return { handled: true, reason: "help" };
  }

  if (command.kind === "unknown") {
    await postMessage({
      channel,
      text: SLACK_UNKNOWN_COMMAND_MESSAGE,
    });
    return { handled: true, reason: "unknown_command" };
  }

  const conversation = slackConversation(channel);
  const latestImport = await getLatestImport(conversation);
  if (!latestImport) {
    await postMessage({
      channel,
      text: SLACK_NO_CAMPAIGN_MESSAGE,
    });
    return { handled: true, reason: "no_campaign" };
  }

  const remaining = await loadStillActionable(latestImport);
  const nextProduct = selectNextActionableProduct(remaining);
  const campaignPageUrl = buildCampaignPageUrl(appUrl, latestImport.id);
  const status = buildSlackCampaignStatusBlocks({
    importId: latestImport.id,
    campaignPageUrl,
    nextProduct,
    testMode: isFakeImageGenerationProvider(),
  });

  await postMessage({
    channel,
    text: status.text,
    blocks: status.blocks,
  });

  return {
    handled: true,
    reason: nextProduct ? "campaign_next" : "campaign_complete",
  };
};
