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
  response_metadata?: {
    messages?: string[];
  };
};

export class SlackPostMessageError extends Error {
  readonly slackError: string;
  readonly validationMessages: string[];

  constructor(slackError: string, validationMessages: string[] = []) {
    const detail =
      validationMessages.length > 0
        ? `${slackError}: ${validationMessages.join(" | ")}`
        : slackError;
    super(`Slack chat.postMessage failed: ${detail}`);
    this.name = "SlackPostMessageError";
    this.slackError = slackError;
    this.validationMessages = validationMessages;
  }
}

const postSlackChatMessage = async (body: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<SlackApiResult> => {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.slackBotToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: body.channel,
      text: body.text,
      ...(body.blocks ? { blocks: body.blocks } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Slack chat.postMessage HTTP ${response.status}`);
  }

  return (await response.json()) as SlackApiResult;
};

const postSlackChatUpdate = async (body: {
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<SlackApiResult> => {
  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.slackBotToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: body.channel,
      ts: body.ts,
      text: body.text,
      ...(body.blocks ? { blocks: body.blocks } : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Slack chat.update HTTP ${response.status}`);
  }

  return (await response.json()) as SlackApiResult;
};

/**
 * Update an existing Slack message (e.g. strip Approve/Reject after review).
 * Prefer this over response_url — response_url often 404s after the HTTP ack.
 */
export const updateSlackMessage = async (params: {
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<void> => {
  const json = await postSlackChatUpdate({
    channel: params.channel,
    ts: params.ts,
    text: params.text,
    blocks: params.blocks,
  });

  if (json.ok) {
    return;
  }

  const validationMessages = json.response_metadata?.messages ?? [];
  console.error(
    "[slack/chat.update]",
    json.error ?? "unknown_error",
    validationMessages.length > 0 ? validationMessages : undefined,
  );
  throw new SlackPostMessageError(json.error ?? "unknown_error", validationMessages);
};

/**
 * Post a Slack message. On `invalid_blocks`, logs Slack validation details
 * (never tokens/credentials). By default retries once as plain text without blocks.
 * Pass `invalidBlocksFallback: "none"` for interactive messages that must not
 * silently lose action buttons.
 */
export const postSlackMessage = async (params: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  invalidBlocksFallback?: "plain_text" | "none";
}): Promise<{ ts?: string; usedFallback?: boolean }> => {
  const json = await postSlackChatMessage({
    channel: params.channel,
    text: params.text,
    blocks: params.blocks,
  });

  if (json.ok) {
    return { ts: json.ts };
  }

  const validationMessages = json.response_metadata?.messages ?? [];
  // Log error code + Block Kit validation messages only — never auth material.
  console.error(
    "[slack/chat.postMessage]",
    json.error ?? "unknown_error",
    validationMessages.length > 0 ? validationMessages : undefined,
  );

  const allowPlainTextFallback = params.invalidBlocksFallback !== "none";

  if (
    allowPlainTextFallback &&
    json.error === "invalid_blocks" &&
    params.blocks &&
    params.blocks.length > 0
  ) {
    const fallback = await postSlackChatMessage({
      channel: params.channel,
      text: params.text,
    });
    if (fallback.ok) {
      console.error(
        "[slack/chat.postMessage] recovered with plain-text fallback after invalid_blocks",
      );
      return { ts: fallback.ts, usedFallback: true };
    }
    const fallbackMessages = fallback.response_metadata?.messages ?? [];
    console.error(
      "[slack/chat.postMessage]",
      fallback.error ?? "unknown_error",
      fallbackMessages.length > 0 ? fallbackMessages : undefined,
    );
    throw new SlackPostMessageError(
      fallback.error ?? json.error ?? "unknown_error",
      fallbackMessages.length > 0 ? fallbackMessages : validationMessages,
    );
  }

  throw new SlackPostMessageError(json.error ?? "unknown_error", validationMessages);
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
