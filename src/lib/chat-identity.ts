export type ChatPlatform = "telegram" | "slack";

export const CHAT_PLATFORM = {
  telegram: "telegram",
  slack: "slack",
} as const satisfies Record<ChatPlatform, ChatPlatform>;

/** Platform-neutral conversation identity shared by imports and candidates. */
export type ChatConversation = {
  platform: ChatPlatform;
  conversationId: string;
};

export const telegramConversation = (chatId: number | string): ChatConversation => ({
  platform: CHAT_PLATFORM.telegram,
  conversationId: String(chatId),
});

export const slackConversation = (channelId: string): ChatConversation => ({
  platform: CHAT_PLATFORM.slack,
  conversationId: channelId,
});

export const toExternalEventId = (value: number | string): string => String(value);

export const toExternalMessageId = (value: number | string): string => String(value);

export const parseTelegramChatId = (conversationId: string): number => {
  if (!/^-?\d+$/.test(conversationId)) {
    throw new Error(`Invalid Telegram conversation id: ${conversationId}`);
  }
  return Number(conversationId);
};

export const parseTelegramMessageId = (externalMessageId: string): number => {
  if (!/^\d+$/.test(externalMessageId)) {
    throw new Error(`Invalid Telegram message id: ${externalMessageId}`);
  }
  return Number(externalMessageId);
};

/** Require Telegram delivery until a Slack adapter exists. */
export const requireTelegramConversation = (conversation: ChatConversation): number => {
  if (conversation.platform !== CHAT_PLATFORM.telegram) {
    throw new Error(`Chat platform "${conversation.platform}" is not implemented yet`);
  }
  return parseTelegramChatId(conversation.conversationId);
};
