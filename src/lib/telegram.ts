import { env } from "@/lib/env";

import type { RequestPlanSummary } from "@/types";

type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

const telegramFetch = async <T>(method: string, body?: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed: ${response.status}`);
  }

  const json = (await response.json()) as { ok: boolean; result: T };
  if (!json.ok) {
    throw new Error(`Telegram API ${method} returned ok=false`);
  }

  return json.result;
};

export const sendMessage = async (
  chatId: number | string,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
) => {
  return telegramFetch<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
};

export const sendPhoto = async (
  chatId: number | string,
  photoUrl: string,
  caption: string,
  replyMarkup?: InlineKeyboardMarkup,
) => {
  return telegramFetch<{ message_id: number }>("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    reply_markup: replyMarkup,
  });
};

export const editMessageText = async (
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
) => {
  return telegramFetch("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup,
  });
};

export const editMessageCaption = async (
  chatId: number | string,
  messageId: number,
  caption: string,
  replyMarkup?: InlineKeyboardMarkup,
) => {
  return telegramFetch("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    reply_markup: replyMarkup,
  });
};

export const answerCallbackQuery = async (callbackQueryId: string, text?: string) => {
  return telegramFetch("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
};

export const getFileContents = async (fileId: string): Promise<string> => {
  const file = await telegramFetch<{ file_path: string }>("getFile", {
    file_id: fileId,
  });

  const response = await fetch(`https://api.telegram.org/file/bot${env.telegramBotToken}/${file.file_path}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }

  return response.text();
};

export const isAllowedChat = (chatId: number | string): boolean =>
  String(chatId) === env.allowedChatId;

export const removeInlineKeyboard = (): InlineKeyboardMarkup => ({
  inline_keyboard: [],
});

export const importPreviewKeyboard = (
  importId: string,
  summary: RequestPlanSummary,
): InlineKeyboardMarkup | undefined => {
  if (summary.requestsReadyToGenerate === 0) {
    return undefined;
  }

  return {
    inline_keyboard: [
      [{ text: "Generate priority product first", callback_data: `imp:priority:${importId}` }],
      [{ text: "Cancel", callback_data: `imp:cancel:${importId}` }],
    ],
  };
};

export const reviewCandidateKeyboard = (candidateId: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "Approve", callback_data: `cand:approve:${candidateId}` },
      { text: "Reject", callback_data: `cand:reject:${candidateId}` },
    ],
  ],
});

export const helpMessage = () =>
  [
    "Studio Shots — styled product photography, reviewed in Telegram.",
    "",
    "Import:",
    "- Upload a catalog CSV with caption /import",
    "- Review the cost preview, then generate one selected product at a time to keep spending controlled",
    "",
    "Review:",
    "- Approve or reject each candidate independently",
    "- Approved images appear on the public product page for the e-commerce team",
    "",
    "Team visibility:",
    "- /status — campaign progress and estimated generation spend",
    "- /help — this message",
    "",
    "Why the /import caption is required:",
    "- Telegram bots in groups usually run with privacy mode enabled",
    "- With privacy mode on, plain file attachments may never reach the bot",
    "- A /import caption makes the upload an explicit bot command",
  ].join("\n");
