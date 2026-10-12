import { createHash } from "node:crypto";

import { put } from "@vercel/blob";

import { assertBlobAuthConfigured, getBlobCommandOptions } from "@/lib/blob-auth";
import { buildCampaignPageUrl } from "@/lib/campaigns";
import {
  CHAT_PLATFORM,
  slackConversation,
  type ChatConversation,
  type ChatPlatform,
} from "@/lib/chat-identity";
import { env } from "@/lib/env";
import {
  findImportByExternalEvent,
  upsertCatalogAndPlanImport,
} from "@/lib/imports";
import { isFakeImageGenerationProvider } from "@/lib/image-generation";
import {
  DEFAULT_OUTPUT_ASPECT_RATIO,
  isOutputAspectRatio,
  parseOutputAspectRatio,
  type OutputAspectRatio,
} from "@/lib/output-format";
import type { CatalogRow } from "@/types";
import type { SlackFileAttachment } from "@/lib/slack-import";
import {
  buildSlackQuickShotPreviewBlocks,
  buildSlackQuickShotPreviewFallbackText,
  buildSlackQuickShotSetupBlocks,
  type SlackBlock,
} from "@/lib/slack-blocks";

/** Soft cap for Quick Shot product images downloaded from Slack (8 MiB). */
export const MAX_SLACK_QUICK_SHOT_BYTES = 8 * 1024 * 1024;

export const SLACK_QUICK_SHOT_CALLBACK_ID = "ss_quick_shot_modal";

export const SLACK_QUICK_SHOT_MESSAGES = {
  missingFile:
    "To start a Quick Shot, attach exactly one product image and mention @Studio Shots with `create`.",
  multipleFiles: "Please attach exactly one product image for Quick Shot.",
  wrongType:
    "That attachment is not a supported image. Upload a JPEG, PNG, WebP, or GIF and try again.",
  tooLarge: "That image is too large. Please upload a file under 8 MB.",
  downloadFailed:
    "I could not download that image from Slack. Re-upload the photo and mention @Studio Shots with `create` again.",
  corruptFile:
    "That file does not look like a valid image. Re-export as JPEG or PNG and try again.",
  blobFailed:
    "I could not store that product photo. No campaign was created — please try again in a moment.",
  unauthorizedChannel: "Studio Shots is not enabled in this channel.",
  alreadyProcessed: "That Quick Shot was already set up.",
  staleSetup:
    "That Quick Shot setup control is out of date. Attach the image again and mention @Studio Shots with `create`.",
  genericFailure: "Something went wrong setting up Quick Shot. Please try again.",
  skuRequired: "Enter a SKU for this product.",
  skuInvalid:
    "SKU must be 1–64 characters and use letters, numbers, hyphens, or underscores.",
  shotIdeaRequired: "Enter a shot idea / creative direction.",
  formatInvalid: "Choose 4:5 Portrait, 1:1 Square, or 3:2 Landscape.",
} as const;

const SUPPORTED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type QuickShotSetupPayload = {
  eventId: string;
  channelId: string;
  fileId: string;
};

export const isSlackCreateIntent = (text: string | undefined): boolean => {
  if (!text) return false;
  const stripped = text
    .replace(/<@[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return /\bcreate\b/.test(stripped);
};

export const isSlackImageAttachment = (file: SlackFileAttachment): boolean => {
  const name = (file.name ?? file.title ?? "").toLowerCase();
  const mime = (file.mimetype ?? "").toLowerCase();
  const filetype = (file.filetype ?? "").toLowerCase();
  if (SUPPORTED_IMAGE_MIME.has(mime)) return true;
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(filetype)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(name);
};

export type SlackImageSelection =
  | { ok: true; file: SlackFileAttachment }
  | { ok: false; message: string };

export const selectSlackImageAttachment = (
  files: SlackFileAttachment[] | undefined,
): SlackImageSelection => {
  if (!files || files.length === 0) {
    return { ok: false, message: SLACK_QUICK_SHOT_MESSAGES.missingFile };
  }
  if (files.length > 1) {
    return { ok: false, message: SLACK_QUICK_SHOT_MESSAGES.multipleFiles };
  }
  const file = files[0]!;
  if (!isSlackImageAttachment(file)) {
    return { ok: false, message: SLACK_QUICK_SHOT_MESSAGES.wrongType };
  }
  if (typeof file.size === "number" && file.size > MAX_SLACK_QUICK_SHOT_BYTES) {
    return { ok: false, message: SLACK_QUICK_SHOT_MESSAGES.tooLarge };
  }
  return { ok: true, file };
};

export const encodeQuickShotSetupValue = (payload: QuickShotSetupPayload): string =>
  JSON.stringify(payload);

export const parseQuickShotSetupValue = (
  value: string | undefined,
): QuickShotSetupPayload | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<QuickShotSetupPayload>;
    if (
      typeof parsed.eventId !== "string" ||
      !parsed.eventId ||
      typeof parsed.channelId !== "string" ||
      !parsed.channelId ||
      typeof parsed.fileId !== "string" ||
      !parsed.fileId
    ) {
      return null;
    }
    return {
      eventId: parsed.eventId,
      channelId: parsed.channelId,
      fileId: parsed.fileId,
    };
  } catch {
    return null;
  }
};

export const detectImageContentType = (
  bytes: Buffer,
): { contentType: string; extension: string } | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (bytes.length >= 6) {
    const header = bytes.toString("ascii", 0, 6);
    if (header === "GIF87a" || header === "GIF89a") {
      return { contentType: "image/gif", extension: "gif" };
    }
  }
  return null;
};

export const validateQuickShotSku = (
  raw: string | null | undefined,
): { ok: true; sku: string } | { ok: false; message: string } => {
  const sku = (raw ?? "").trim();
  if (!sku) {
    return { ok: false, message: SLACK_QUICK_SHOT_MESSAGES.skuRequired };
  }
  if (sku.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sku)) {
    return { ok: false, message: SLACK_QUICK_SHOT_MESSAGES.skuInvalid };
  }
  return { ok: true, sku };
};

export const validateQuickShotIdea = (
  raw: string | null | undefined,
): { ok: true; shotIdea: string } | { ok: false; message: string } => {
  const shotIdea = (raw ?? "").trim();
  if (!shotIdea) {
    return { ok: false, message: SLACK_QUICK_SHOT_MESSAGES.shotIdeaRequired };
  }
  return { ok: true, shotIdea };
};

export const buildQuickShotCatalogRow = (params: {
  sku: string;
  shotIdea: string;
  photoUrl: string;
}): CatalogRow => ({
  sku: params.sku,
  productName: params.sku,
  category: "Quick Shot",
  colorOrFinish: "",
  material: "",
  priceCents: 0,
  photoUrl: params.photoUrl,
  shotIdea: params.shotIdea,
  notes: "Created via Slack Quick Shot",
  priority: "normal",
});

export const quickShotSourceBlobPath = (params: {
  sku: string;
  contentDigest: string;
  extension: string;
}): string => {
  const safeSku = params.sku.replace(/[^A-Za-z0-9_-]/g, "_");
  const ext = params.extension.replace(/^\./, "").toLowerCase() || "jpg";
  return `quick-shot-sources/${safeSku}/${params.contentDigest.slice(0, 24)}.${ext}`;
};

type SlackFilesInfoResult = {
  ok: boolean;
  error?: string;
  file?: {
    id?: string;
    mimetype?: string;
    size?: number;
    url_private?: string;
    url_private_download?: string;
    name?: string;
    title?: string;
  };
};

export const fetchSlackFileMetadata = async (
  fileId: string,
  options?: { botToken?: string; fetchImpl?: typeof fetch },
): Promise<SlackFileAttachment> => {
  const token = options?.botToken ?? env.slackBotToken;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl("https://slack.com/api/files.info", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams({ file: fileId }).toString(),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(SLACK_QUICK_SHOT_MESSAGES.downloadFailed);
  }
  const json = (await response.json()) as SlackFilesInfoResult;
  if (!json.ok || !json.file?.id) {
    throw new Error(SLACK_QUICK_SHOT_MESSAGES.downloadFailed);
  }
  return {
    id: json.file.id,
    name: json.file.name,
    title: json.file.title,
    mimetype: json.file.mimetype,
    size: json.file.size,
    url_private: json.file.url_private,
    url_private_download: json.file.url_private_download,
  };
};

export const downloadSlackImageBytes = async (
  file: SlackFileAttachment,
  options?: { botToken?: string; fetchImpl?: typeof fetch },
): Promise<Buffer> => {
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    throw new Error(SLACK_QUICK_SHOT_MESSAGES.downloadFailed);
  }
  const token = options?.botToken ?? env.slackBotToken;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(SLACK_QUICK_SHOT_MESSAGES.downloadFailed);
  }
  const headerType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (headerType.includes("text/html") || headerType.includes("application/json")) {
    throw new Error(SLACK_QUICK_SHOT_MESSAGES.downloadFailed);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error(SLACK_QUICK_SHOT_MESSAGES.corruptFile);
  }
  if (buffer.byteLength > MAX_SLACK_QUICK_SHOT_BYTES) {
    throw new Error(SLACK_QUICK_SHOT_MESSAGES.tooLarge);
  }
  return buffer;
};

export const materializeQuickShotSourceToBlob = async (params: {
  sku: string;
  bytes: Buffer;
  contentType: string;
  extension: string;
  putBlob?: (
    pathname: string,
    bytes: Buffer,
    contentType: string,
  ) => Promise<{ url: string }>;
}): Promise<{ blobUrl: string; blobPath: string }> => {
  const digest = createHash("sha256").update(params.bytes).digest("hex");
  const blobPath = quickShotSourceBlobPath({
    sku: params.sku,
    contentDigest: digest,
    extension: params.extension,
  });

  if (!params.putBlob) {
    assertBlobAuthConfigured();
  }

  const putBlob =
    params.putBlob ??
    (async (pathname, bytes, contentType) => {
      const uploaded = await put(pathname, bytes, {
        access: "public",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        ...getBlobCommandOptions(),
      });
      return { url: uploaded.url };
    });

  const uploaded = await putBlob(blobPath, params.bytes, params.contentType);
  return { blobUrl: uploaded.url, blobPath };
};

export type SlackQuickShotPostMessage = (params: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
}) => Promise<unknown>;

export type SlackQuickShotOpenModal = (params: {
  triggerId: string;
  view: Record<string, unknown>;
}) => Promise<void>;

/** Reply with the setup button — does not download the image or create a campaign. */
export const runSlackQuickShotMention = async (params: {
  channel: string;
  externalEventId: string;
  files: SlackFileAttachment[] | undefined;
  deps: {
    postMessage: SlackQuickShotPostMessage;
  };
}): Promise<{ ok: boolean; reason?: string }> => {
  const selection = selectSlackImageAttachment(params.files);
  if (!selection.ok) {
    await params.deps.postMessage({
      channel: params.channel,
      text: selection.message,
    });
    return { ok: false, reason: "invalid_attachment" };
  }

  const setupValue = encodeQuickShotSetupValue({
    eventId: params.externalEventId,
    channelId: params.channel,
    fileId: selection.file.id,
  });

  const built = buildSlackQuickShotSetupBlocks({ setupValue });
  await params.deps.postMessage({
    channel: params.channel,
    text: built.text,
    blocks: built.blocks,
  });
  return { ok: true, reason: "setup_prompted" };
};

export const buildQuickShotModalView = (
  privateMetadata: string,
): Record<string, unknown> => ({
  type: "modal",
  callback_id: SLACK_QUICK_SHOT_CALLBACK_ID,
  private_metadata: privateMetadata,
  title: { type: "plain_text", text: "Quick Shot", emoji: true },
  submit: { type: "plain_text", text: "Create preview", emoji: true },
  close: { type: "plain_text", text: "Cancel", emoji: true },
  blocks: [
    {
      type: "input",
      block_id: "qs_sku",
      label: { type: "plain_text", text: "SKU", emoji: true },
      element: {
        type: "plain_text_input",
        action_id: "sku",
        placeholder: { type: "plain_text", text: "e.g. QS-001" },
        max_length: 64,
      },
    },
    {
      type: "input",
      block_id: "qs_shot_idea",
      label: { type: "plain_text", text: "Shot idea / creative direction", emoji: true },
      element: {
        type: "plain_text_input",
        action_id: "shot_idea",
        multiline: true,
        placeholder: {
          type: "plain_text",
          text: "e.g. sunlit console table, soft morning light",
        },
        max_length: 2000,
      },
    },
    {
      type: "input",
      block_id: "qs_format",
      label: { type: "plain_text", text: "Output format", emoji: true },
      element: {
        type: "static_select",
        action_id: "format",
        initial_option: {
          text: { type: "plain_text", text: "4:5 Portrait" },
          value: DEFAULT_OUTPUT_ASPECT_RATIO,
        },
        options: [
          {
            text: { type: "plain_text", text: "4:5 Portrait" },
            value: "4:5",
          },
          {
            text: { type: "plain_text", text: "1:1 Square" },
            value: "1:1",
          },
          {
            text: { type: "plain_text", text: "3:2 Landscape" },
            value: "3:2",
          },
        ],
      },
    },
  ],
});

export type QuickShotModalFields = {
  sku: string;
  shotIdea: string;
  outputAspectRatio: OutputAspectRatio;
};

export const parseQuickShotModalSubmission = (
  values: Record<string, Record<string, { value?: string; selected_option?: { value?: string } }>>,
):
  | { ok: true; fields: QuickShotModalFields }
  | { ok: false; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const skuResult = validateQuickShotSku(values.qs_sku?.sku?.value);
  if (!skuResult.ok) {
    errors.qs_sku = skuResult.message;
  }
  const ideaResult = validateQuickShotIdea(values.qs_shot_idea?.shot_idea?.value);
  if (!ideaResult.ok) {
    errors.qs_shot_idea = ideaResult.message;
  }
  const formatRaw = values.qs_format?.format?.selected_option?.value;
  if (formatRaw && !isOutputAspectRatio(formatRaw)) {
    errors.qs_format = SLACK_QUICK_SHOT_MESSAGES.formatInvalid;
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    fields: {
      sku: (skuResult as { ok: true; sku: string }).sku,
      shotIdea: (ideaResult as { ok: true; shotIdea: string }).shotIdea,
      outputAspectRatio: parseOutputAspectRatio(formatRaw),
    },
  };
};

/**
 * Download Slack image → Blob → one-product import → Quick Shot preview.
 * Never starts generation.
 */
export const submitSlackQuickShot = async (params: {
  setup: QuickShotSetupPayload;
  fields: QuickShotModalFields;
  deps: {
    postMessage: SlackQuickShotPostMessage;
    fetchFileMetadata?: typeof fetchSlackFileMetadata;
    downloadImage?: typeof downloadSlackImageBytes;
    materialize?: typeof materializeQuickShotSourceToBlob;
    upsertImport?: typeof upsertCatalogAndPlanImport;
    findExistingImport?: (
      platform: ChatPlatform,
      externalEventId: string,
    ) => Promise<{ id: string } | null>;
    appUrl?: string;
    isFakeGeneration?: () => boolean;
  };
}): Promise<{ ok: boolean; reason?: string; importId?: string }> => {
  const fetchMeta = params.deps.fetchFileMetadata ?? fetchSlackFileMetadata;
  const downloadImage = params.deps.downloadImage ?? downloadSlackImageBytes;
  const materialize = params.deps.materialize ?? materializeQuickShotSourceToBlob;
  const upsertImport = params.deps.upsertImport ?? upsertCatalogAndPlanImport;
  const findExisting =
    params.deps.findExistingImport ?? findImportByExternalEvent;
  const appUrl = params.deps.appUrl ?? env.appUrl;
  const isFake = params.deps.isFakeGeneration ?? isFakeImageGenerationProvider;

  // Idempotent before any Slack download / Blob write.
  const existing = await findExisting(CHAT_PLATFORM.slack, params.setup.eventId);
  if (existing) {
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: SLACK_QUICK_SHOT_MESSAGES.alreadyProcessed,
    });
    return { ok: true, reason: "already_processed", importId: existing.id };
  }

  let file: SlackFileAttachment;
  try {
    file = await fetchMeta(params.setup.fileId);
  } catch {
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: SLACK_QUICK_SHOT_MESSAGES.downloadFailed,
    });
    return { ok: false, reason: "download_failed" };
  }

  if (!isSlackImageAttachment(file)) {
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: SLACK_QUICK_SHOT_MESSAGES.wrongType,
    });
    return { ok: false, reason: "wrong_type" };
  }

  let bytes: Buffer;
  try {
    bytes = await downloadImage(file);
  } catch (error) {
    const message =
      error instanceof Error && error.message === SLACK_QUICK_SHOT_MESSAGES.tooLarge
        ? SLACK_QUICK_SHOT_MESSAGES.tooLarge
        : SLACK_QUICK_SHOT_MESSAGES.downloadFailed;
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: message,
    });
    return { ok: false, reason: "download_failed" };
  }

  const detected = detectImageContentType(bytes);
  if (!detected) {
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: SLACK_QUICK_SHOT_MESSAGES.corruptFile,
    });
    return { ok: false, reason: "corrupt_file" };
  }

  let blobUrl: string;
  try {
    const uploaded = await materialize({
      sku: params.fields.sku,
      bytes,
      contentType: detected.contentType,
      extension: detected.extension,
    });
    blobUrl = uploaded.blobUrl;
  } catch (error) {
    console.error(
      "[slack/quick-shot]",
      error instanceof Error ? error.message : "blob materialization failed",
    );
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: SLACK_QUICK_SHOT_MESSAGES.blobFailed,
    });
    return { ok: false, reason: "blob_failed" };
  }

  // Never persist private Slack download URLs as catalog photo sources.
  if (/slack\.com|slack-files|files\.slack/i.test(blobUrl)) {
    console.error("[slack/quick-shot] refused to persist a Slack-hosted source URL");
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: SLACK_QUICK_SHOT_MESSAGES.blobFailed,
    });
    return { ok: false, reason: "blob_failed" };
  }

  const row = buildQuickShotCatalogRow({
    sku: params.fields.sku,
    shotIdea: params.fields.shotIdea,
    photoUrl: blobUrl,
  });
  const conversation: ChatConversation = slackConversation(params.setup.channelId);

  try {
    const summary = await upsertImport(
      [row],
      `quick-shot-${params.fields.sku}.jpg`,
      conversation,
      params.setup.eventId,
      { outputAspectRatio: params.fields.outputAspectRatio },
    );

    if (summary.alreadyProcessed) {
      await params.deps.postMessage({
        channel: params.setup.channelId,
        text: SLACK_QUICK_SHOT_MESSAGES.alreadyProcessed,
      });
      return { ok: true, reason: "already_processed", importId: summary.importId };
    }

    const campaignPageUrl = buildCampaignPageUrl(appUrl, summary.importId);
    const previewSummary = {
      ...summary,
      outputAspectRatio: params.fields.outputAspectRatio,
      outputAspectRatioLocked: false as const,
    };
    const preview = buildSlackQuickShotPreviewBlocks({
      summary: previewSummary,
      sku: params.fields.sku,
      shotIdea: params.fields.shotIdea,
      sourceImageUrl: blobUrl,
      campaignPageUrl,
      testMode: isFake(),
    });
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: buildSlackQuickShotPreviewFallbackText({
        summary: previewSummary,
        sku: params.fields.sku,
        shotIdea: params.fields.shotIdea,
        campaignPageUrl,
        testMode: isFake(),
      }),
      blocks: preview.blocks,
    });
    return { ok: true, reason: "previewed", importId: summary.importId };
  } catch (error) {
    console.error(
      "[slack/quick-shot]",
      error instanceof Error ? error.message : "import failed",
    );
    await params.deps.postMessage({
      channel: params.setup.channelId,
      text: SLACK_QUICK_SHOT_MESSAGES.genericFailure,
    });
    return { ok: false, reason: "generic_failure" };
  }
};
