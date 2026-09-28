const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const parseChatId = (value: string): string => {
  if (!/^-?\d+$/.test(value)) {
    throw new Error("ALLOWED_CHAT_ID must be a numeric Telegram chat id");
  }
  return value;
};

export const env = {
  get appUrl() {
    return required("APP_URL");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get telegramBotToken() {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get telegramWebhookSecret() {
    return required("TELEGRAM_WEBHOOK_SECRET");
  },
  get allowedChatId() {
    return parseChatId(required("ALLOWED_CHAT_ID"));
  },
  get lumaAgentsApiKey() {
    return required("LUMA_AGENTS_API_KEY");
  },
};
