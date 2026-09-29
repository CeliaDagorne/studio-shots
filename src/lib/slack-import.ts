import { buildCampaignPageUrl } from "@/lib/campaigns";
import {
  CHAT_PLATFORM,
  slackConversation,
  type ChatConversation,
} from "@/lib/chat-identity";
import { parseCatalogCsv } from "@/lib/csv";
import { env } from "@/lib/env";
import { upsertCatalogAndPlanImport } from "@/lib/imports";
import {
  buildSlackImportPreviewBlocks,
  buildSlackImportPreviewFallbackText,
  type SlackBlock,
} from "@/lib/slack-blocks";

/** Soft cap for catalog CSVs downloaded from Slack (1 MiB). */
export const MAX_SLACK_CSV_BYTES = 1_048_576;

export const SLACK_IMPORT_MESSAGES = {
  missingFile:
    "To import a catalog, attach exactly one CSV and mention @Studio Shots with `import`.",
  multipleFiles: "Please attach exactly one CSV file for import.",
  wrongType: "That attachment is not a CSV. Upload a `.csv` catalog file and try again.",
  tooLarge: "That CSV is too large. Please upload a file under 1 MB.",
  downloadFailed:
    "I could not download that file from Slack. Please re-upload the CSV and try again.",
  invalidCatalog:
    "That CSV could not be read as a Studio Shots catalog. Check the required headers and row values, then try again.",
  unauthorizedChannel: "Studio Shots is not enabled in this channel.",
  alreadyProcessed: "This import event was already processed.",
  genericFailure: "Something went wrong while importing. Please try again.",
} as const;

export type SlackFileAttachment = {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
};

export const isSlackImportIntent = (text: string | undefined): boolean => {
  if (!text) {
    return false;
  }
  const stripped = text.replace(/<@[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return /\bimport\b/.test(stripped);
};

export const isSlackCsvAttachment = (file: SlackFileAttachment): boolean => {
  const name = (file.name ?? file.title ?? "").toLowerCase();
  const mime = (file.mimetype ?? "").toLowerCase();
  const filetype = (file.filetype ?? "").toLowerCase();
  return (
    filetype === "csv" ||
    mime === "text/csv" ||
    mime === "application/csv" ||
    (mime === "text/plain" && name.endsWith(".csv")) ||
    name.endsWith(".csv")
  );
};

export type SlackCsvSelection =
  | { ok: true; file: SlackFileAttachment }
  | { ok: false; message: string };

export const selectSlackCsvAttachment = (
  files: SlackFileAttachment[] | undefined,
): SlackCsvSelection => {
  if (!files || files.length === 0) {
    return { ok: false, message: SLACK_IMPORT_MESSAGES.missingFile };
  }
  if (files.length > 1) {
    return { ok: false, message: SLACK_IMPORT_MESSAGES.multipleFiles };
  }

  const file = files[0]!;
  if (!isSlackCsvAttachment(file)) {
    return { ok: false, message: SLACK_IMPORT_MESSAGES.wrongType };
  }

  if (typeof file.size === "number" && file.size > MAX_SLACK_CSV_BYTES) {
    return { ok: false, message: SLACK_IMPORT_MESSAGES.tooLarge };
  }

  return { ok: true, file };
};

export const downloadSlackFileContents = async (
  file: SlackFileAttachment,
  options?: { botToken?: string; fetchImpl?: typeof fetch },
): Promise<string> => {
  const url = file.url_private_download ?? file.url_private;
  if (!url) {
    throw new Error(SLACK_IMPORT_MESSAGES.downloadFailed);
  }

  const token = options?.botToken ?? env.slackBotToken;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(SLACK_IMPORT_MESSAGES.downloadFailed);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SLACK_CSV_BYTES) {
    throw new Error(SLACK_IMPORT_MESSAGES.tooLarge);
  }

  return buffer.toString("utf8");
};

const catalogErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return SLACK_IMPORT_MESSAGES.invalidCatalog;
  }
  const message = error.message.trim();
  // parseCatalogCsv / price / priority errors are safe to surface; never leak URLs/tokens.
  if (
    /csv|header|priority|price|sku|empty|column|row/i.test(message) &&
    !/token|secret|password|postgres|bearer|xoxb|http/i.test(message)
  ) {
    return `That CSV could not be imported: ${message}`;
  }
  return SLACK_IMPORT_MESSAGES.invalidCatalog;
};

export type SlackImportPostMessage = (params: {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
}) => Promise<unknown>;

export type SlackCatalogImportDeps = {
  downloadFile?: typeof downloadSlackFileContents;
  upsertImport?: typeof upsertCatalogAndPlanImport;
  postMessage: SlackImportPostMessage;
  appUrl?: string;
};

/**
 * Run catalog import for an authorized Slack mention that includes a CSV.
 * Uses shared parseCatalogCsv + upsertCatalogAndPlanImport — no duplicated planning.
 */
export const runSlackCatalogImport = async (params: {
  channel: string;
  externalEventId: string;
  files: SlackFileAttachment[] | undefined;
  deps: SlackCatalogImportDeps;
}): Promise<{ ok: boolean; reason?: string }> => {
  const selection = selectSlackCsvAttachment(params.files);
  if (!selection.ok) {
    await params.deps.postMessage({
      channel: params.channel,
      text: selection.message,
    });
    return { ok: false, reason: "invalid_attachment" };
  }

  const downloadFile = params.deps.downloadFile ?? downloadSlackFileContents;
  const upsertImport = params.deps.upsertImport ?? upsertCatalogAndPlanImport;
  const appUrl = params.deps.appUrl ?? env.appUrl;

  let csvText: string;
  try {
    csvText = await downloadFile(selection.file);
  } catch {
    await params.deps.postMessage({
      channel: params.channel,
      text: SLACK_IMPORT_MESSAGES.downloadFailed,
    });
    return { ok: false, reason: "download_failed" };
  }

  let rows;
  try {
    rows = parseCatalogCsv(csvText);
  } catch (error) {
    await params.deps.postMessage({
      channel: params.channel,
      text: catalogErrorMessage(error),
    });
    return { ok: false, reason: "invalid_catalog" };
  }

  const conversation: ChatConversation = slackConversation(params.channel);
  const filename = selection.file.name ?? selection.file.title ?? "catalog.csv";

  try {
    const summary = await upsertImport(
      rows,
      filename,
      conversation,
      params.externalEventId,
    );

    if (summary.alreadyProcessed) {
      await params.deps.postMessage({
        channel: params.channel,
        text: SLACK_IMPORT_MESSAGES.alreadyProcessed,
      });
      return { ok: true, reason: "already_processed" };
    }

    const campaignPageUrl = buildCampaignPageUrl(appUrl, summary.importId);
    const text = buildSlackImportPreviewFallbackText(summary, { campaignPageUrl });
    const blocks = buildSlackImportPreviewBlocks(summary, { campaignPageUrl });

    await params.deps.postMessage({
      channel: params.channel,
      text,
      blocks,
    });

    return { ok: true, reason: "imported" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/csv|header|priority|price|sku|empty|column|row/i.test(message)) {
      await params.deps.postMessage({
        channel: params.channel,
        text: catalogErrorMessage(error),
      });
      return { ok: false, reason: "invalid_catalog" };
    }

    console.error(
      "[slack/import]",
      error instanceof Error ? error.message : "import failed",
    );
    await params.deps.postMessage({
      channel: params.channel,
      text: SLACK_IMPORT_MESSAGES.genericFailure,
    });
    return { ok: false, reason: "generic_failure" };
  }
};

export const slackPlatform = CHAT_PLATFORM.slack;
