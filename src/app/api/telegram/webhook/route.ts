import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";

import { parseCatalogCsv } from "@/lib/csv";
import { env } from "@/lib/env";
import {
  applyCandidateReview,
  getShotRequestById,
  runPriorityGeneration,
  runSelectedRequestGeneration,
} from "@/lib/generation";
import {
  cancelImport,
  getImportByPreviewMessage,
  importRecordToSummary,
  listActionableProductsForImport,
  loadStillActionableProductsForImport,
  setPreviewMessageId,
  upsertCatalogAndPlanImport,
} from "@/lib/imports";
import {
  evaluateProductSelection,
  selectionErrorMessage,
} from "@/lib/product-selection";
import { buildImportPreviewText } from "@/lib/request-planning";
import { formatStudioStatusMessage, getStudioStatusSummary } from "@/lib/status";
import {
  answerCallbackQuery,
  buildProductPickerText,
  editMessageText,
  getFileContents,
  helpMessage,
  importPreviewKeyboard,
  isAllowedChat,
  parseImportCallbackData,
  productPickerKeyboard,
  removeInlineKeyboard,
  sendMessage,
} from "@/lib/telegram";
import type { TelegramMessage, TelegramUpdate } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ok = () => NextResponse.json({ ok: true });

const hasImportCaption = (message: TelegramMessage): boolean =>
  (message.caption ?? "").trim().startsWith("/import");

const extractCommand = (message: TelegramMessage): string | null => {
  const text = (message.text ?? "").trim();
  if (text.startsWith("/start")) return "/start";
  if (text.startsWith("/help")) return "/help";
  if (text.startsWith("/status")) return "/status";
  return null;
};

const handleImportMessage = async (message: TelegramMessage, telegramUpdateId: number) => {
  if (!message.document) {
    await sendMessage(
      message.chat.id,
      "Upload the CSV as a document with the caption /import so Telegram reliably delivers it in groups.",
    );
    return;
  }

  const filename = message.document.file_name ?? "catalog.csv";
  const fileContents = await getFileContents(message.document.file_id);
  const rows = parseCatalogCsv(fileContents);
  const summary = await upsertCatalogAndPlanImport(
    rows,
    filename,
    Number(message.chat.id),
    telegramUpdateId,
  );

  if (summary.alreadyProcessed && summary.previewMessageId) {
    return;
  }

  const preview = await sendMessage(
    message.chat.id,
    buildImportPreviewText(summary),
    importPreviewKeyboard(summary.importId, summary),
  );
  await setPreviewMessageId(summary.importId, preview.message_id);
};

const handleCommand = async (message: TelegramMessage, command: string) => {
  switch (command) {
    case "/start":
    case "/help":
      await sendMessage(message.chat.id, helpMessage());
      return;
    case "/status": {
      const summary = await getStudioStatusSummary();
      await sendMessage(message.chat.id, formatStudioStatusMessage(summary));
      return;
    }
    default:
      return;
  }
};

const handleCandidateCallback = async (
  callbackId: string,
  data: string,
  chatId: number,
  messageId: number,
) => {
  const [, action, candidateId] = data.split(":");
  if (!candidateId || (action !== "approve" && action !== "reject")) {
    await answerCallbackQuery(callbackId, "Unknown candidate action.");
    return;
  }

  const result = await applyCandidateReview({
    candidateId,
    decision: action === "approve" ? "approved" : "rejected",
    chatId,
    messageId,
  });

  if (result.alreadyReviewed) {
    await answerCallbackQuery(callbackId, "Already recorded.");
    return;
  }

  await answerCallbackQuery(
    callbackId,
    action === "approve" ? "Approved." : "Rejected.",
  );
};

const assertCallbackImportId = (
  expectedImportId: string | undefined,
  importRecordId: string,
): boolean => {
  if (!expectedImportId) {
    return true;
  }
  return expectedImportId === importRecordId;
};

const handleImportCallback = async (
  callbackId: string,
  data: string,
  chatId: number,
  messageId: number,
) => {
  const parsed = parseImportCallbackData(data);
  if (!parsed) {
    await answerCallbackQuery(callbackId, "Unknown action.");
    return;
  }

  const importRecord = await getImportByPreviewMessage(chatId, messageId);

  if (!importRecord) {
    await answerCallbackQuery(callbackId, "That import preview could not be found.");
    return;
  }

  if (importRecord.confirmationAction === "cancelled") {
    await answerCallbackQuery(callbackId, "This import was cancelled.");
    return;
  }

  if (importRecord.confirmationAction) {
    await answerCallbackQuery(callbackId, "This import has already been handled.");
    return;
  }

  const summary = importRecordToSummary(importRecord);
  const previewText = buildImportPreviewText(summary);

  if (parsed.action !== "gen" && !assertCallbackImportId(parsed.importId, importRecord.id)) {
    await answerCallbackQuery(callbackId, "That button does not match this import.");
    return;
  }

  if (parsed.action === "choose") {
    const actionable = await loadStillActionableProductsForImport(importRecord);
    if (actionable.length === 0) {
      await answerCallbackQuery(callbackId, "No actionable products left.");
      return;
    }
    await editMessageText(
      chatId,
      messageId,
      buildProductPickerText({ ...summary, actionableProducts: actionable }, 0),
      productPickerKeyboard(importRecord.id, actionable, 0),
    );
    await answerCallbackQuery(callbackId, "Choose a product.");
    return;
  }

  if (parsed.action === "page") {
    const actionable = await loadStillActionableProductsForImport(importRecord);
    await editMessageText(
      chatId,
      messageId,
      buildProductPickerText({ ...summary, actionableProducts: actionable }, parsed.page),
      productPickerKeyboard(importRecord.id, actionable, parsed.page),
    );
    await answerCallbackQuery(callbackId, `Page ${parsed.page + 1}`);
    return;
  }

  if (parsed.action === "back") {
    await editMessageText(
      chatId,
      messageId,
      previewText,
      importPreviewKeyboard(importRecord.id, summary),
    );
    await answerCallbackQuery(callbackId, "Back to import preview.");
    return;
  }

  if (parsed.action === "cancel") {
    const cancelled = await cancelImport(importRecord.id);
    if (!cancelled) {
      await answerCallbackQuery(callbackId, "This import has already been handled.");
      return;
    }
    await editMessageText(
      chatId,
      messageId,
      `${previewText}\n\nCancelled.`,
      removeInlineKeyboard(),
    );
    await answerCallbackQuery(callbackId, "Import cancelled.");
    return;
  }

  if (parsed.action === "priority") {
    const prioritySku = importRecord.priorityRequestSku;
    if (!prioritySku) {
      await answerCallbackQuery(callbackId, "No priority product is available.");
      return;
    }

    await editMessageText(
      chatId,
      messageId,
      `${previewText}\n\nConfirmed: generating priority product ${prioritySku} in the background.`,
      removeInlineKeyboard(),
    );
    await answerCallbackQuery(callbackId, "Priority generation started.");

    waitUntil(
      runPriorityGeneration({
        importId: importRecord.id,
        chatId,
      }).catch(async (error) => {
        const message = error instanceof Error ? error.message : "Unknown background failure";
        await sendMessage(chatId, `Background priority generation failed: ${message}`);
      }),
    );
    return;
  }

  if (parsed.action === "gen") {
    const actionable = listActionableProductsForImport(importRecord);
    const request = await getShotRequestById(parsed.requestId);
    const evaluation = evaluateProductSelection({
      actionable,
      requestId: parsed.requestId,
      request: request
        ? {
            id: request.id,
            productSku: request.productSku,
            workflowStatus: request.workflowStatus,
          }
        : null,
    });

    if (!evaluation.ok) {
      await answerCallbackQuery(callbackId, selectionErrorMessage(evaluation.reason));
      return;
    }

    const option = evaluation.option;

    await editMessageText(
      chatId,
      messageId,
      `${previewText}\n\nConfirmed: generating ${option.sku} (${option.priority}) in the background.`,
      removeInlineKeyboard(),
    );
    await answerCallbackQuery(callbackId, `Generating ${option.sku}.`);

    waitUntil(
      runSelectedRequestGeneration({
        shotRequestId: option.requestId,
        chatId,
      }).catch(async (error) => {
        const message = error instanceof Error ? error.message : "Unknown background failure";
        await sendMessage(chatId, `Background generation failed: ${message}`);
      }),
    );
    return;
  }

  await answerCallbackQuery(callbackId, "Unknown action.");
};

const handleCallback = async (update: TelegramUpdate) => {
  const callback = update.callback_query;
  if (!callback?.data || !callback.message) {
    return;
  }

  const chatId = Number(callback.message.chat.id);
  const messageId = callback.message.message_id;
  const data = callback.data;

  if (data.startsWith("cand:")) {
    await handleCandidateCallback(callback.id, data, chatId, messageId);
    return;
  }

  if (data.startsWith("imp:")) {
    await handleImportCallback(callback.id, data, chatId, messageId);
  }
};

export async function POST(request: Request) {
  if (request.headers.get("x-telegram-bot-api-secret-token") !== env.telegramWebhookSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.message) {
    if (!isAllowedChat(update.message.chat.id)) {
      return ok();
    }

    if (hasImportCaption(update.message)) {
      await handleImportMessage(update.message, update.update_id);
      return ok();
    }

    const command = extractCommand(update.message);
    if (command) {
      await handleCommand(update.message, command);
    }

    return ok();
  }

  if (update.callback_query?.message) {
    if (!isAllowedChat(update.callback_query.message.chat.id)) {
      return ok();
    }

    await handleCallback(update);
  }

  return ok();
}
