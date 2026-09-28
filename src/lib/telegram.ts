import {
  estimatedCostMicrosForOneProduct,
  formatProductPickerButtonText,
  formatUsdMicros,
} from "@/lib/request-planning";
import { env } from "@/lib/env";

import type { ActionableProductOption, RequestPlanSummary } from "@/types";

type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

export const PRODUCT_PICKER_PAGE_SIZE = 6;

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

  const priorityLabel = summary.priorityRequestSku
    ? `Generate priority: ${summary.priorityRequestSku}`
    : "Generate priority";

  return {
    inline_keyboard: [
      [{ text: priorityLabel, callback_data: `imp:priority:${importId}` }],
      [{ text: "Choose a product", callback_data: `imp:choose:${importId}` }],
      [{ text: "Cancel", callback_data: `imp:cancel:${importId}` }],
    ],
  };
};

export const buildProductPickerText = (
  summary: RequestPlanSummary,
  page: number,
  pageSize: number = PRODUCT_PICKER_PAGE_SIZE,
): string => {
  const total = summary.actionableProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const cost = formatUsdMicros(estimatedCostMicrosForOneProduct());

  return [
    "Choose a product to generate",
    "",
    `Actionable products: ${total}`,
    `Estimated cost per product: ${cost} (3 candidates)`,
    `Page ${safePage + 1} of ${totalPages}`,
    "",
    "Only imported, not-yet-generating products are listed.",
  ].join("\n");
};

export const productPickerKeyboard = (
  importId: string,
  products: ActionableProductOption[],
  page: number,
  pageSize: number = PRODUCT_PICKER_PAGE_SIZE,
): InlineKeyboardMarkup => {
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = products.slice(start, start + pageSize);

  const rows: InlineKeyboardButton[][] = pageItems.map((option) => [
    {
      text: formatProductPickerButtonText(option),
      callback_data: `imp:gen:${option.requestId}`,
    },
  ]);

  const navRow: InlineKeyboardButton[] = [];
  if (safePage > 0) {
    navRow.push({
      text: "Previous",
      callback_data: `imp:page:${importId}:${safePage - 1}`,
    });
  }
  if (safePage < totalPages - 1) {
    navRow.push({
      text: "Next",
      callback_data: `imp:page:${importId}:${safePage + 1}`,
    });
  }
  if (navRow.length > 0) {
    rows.push(navRow);
  }

  rows.push([
    { text: "Back", callback_data: `imp:back:${importId}` },
    { text: "Cancel", callback_data: `imp:cancel:${importId}` },
  ]);

  return { inline_keyboard: rows };
};

export const reviewCandidateKeyboard = (candidateId: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "Approve", callback_data: `cand:approve:${candidateId}` },
      { text: "Reject", callback_data: `cand:reject:${candidateId}` },
    ],
  ],
});

export type ImportCallbackAction =
  | { action: "priority"; importId: string }
  | { action: "choose"; importId: string }
  | { action: "back"; importId: string }
  | { action: "cancel"; importId: string }
  | { action: "page"; importId: string; page: number }
  | { action: "gen"; requestId: string };

export const parseImportCallbackData = (data: string): ImportCallbackAction | null => {
  if (!data.startsWith("imp:")) {
    return null;
  }

  const rest = data.slice(4);

  if (rest.startsWith("priority:")) {
    return { action: "priority", importId: rest.slice("priority:".length) };
  }
  if (rest.startsWith("choose:")) {
    return { action: "choose", importId: rest.slice("choose:".length) };
  }
  if (rest.startsWith("back:")) {
    return { action: "back", importId: rest.slice("back:".length) };
  }
  if (rest.startsWith("cancel:")) {
    return { action: "cancel", importId: rest.slice("cancel:".length) };
  }
  if (rest.startsWith("gen:")) {
    return { action: "gen", requestId: rest.slice("gen:".length) };
  }
  if (rest.startsWith("page:")) {
    const body = rest.slice("page:".length);
    const lastColon = body.lastIndexOf(":");
    if (lastColon <= 0) {
      return null;
    }
    const importId = body.slice(0, lastColon);
    const page = Number.parseInt(body.slice(lastColon + 1), 10);
    if (!Number.isFinite(page) || page < 0) {
      return null;
    }
    return { action: "page", importId, page };
  }

  return null;
};

export const helpMessage = (appUrl?: string) => {
  const base = (appUrl ?? "").replace(/\/+$/, "");
  const lines = [
    "Studio Shots — styled product photography, reviewed in Telegram.",
    "",
    "Import:",
    "- Upload a catalog CSV with caption /import",
    "- Review the cost preview, then generate the highest-priority product or choose any other actionable SKU",
    "- Generation stays limited to one product at a time",
    "",
    "Review:",
    "- Approve or reject each candidate independently",
    "- Approved images appear on the public product page for the e-commerce team",
    "",
    "Team visibility:",
    "- /status — campaign progress and estimated generation spend",
    "- /help — this message",
  ];

  if (base) {
    lines.push(`- Campaign overview pages: ${base}/campaigns/<importId>`);
  }

  lines.push(
    "",
    "Why the /import caption is required:",
    "- Telegram bots in groups usually run with privacy mode enabled",
    "- With privacy mode on, plain file attachments may never reach the bot",
    "- A /import caption makes the upload an explicit bot command",
  );

  return lines.join("\n");
};
