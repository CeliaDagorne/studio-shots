import "./load-env-local";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const redactSecrets = (message: string): string =>
  message
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "[redacted-bot-token]")
    .replace(/secret_token[=:]\s*\S+/gi, "secret_token=[redacted]");

async function main() {
  const botToken = required("TELEGRAM_BOT_TOKEN");
  const appUrl = required("APP_URL");
  const secretToken = required("TELEGRAM_WEBHOOK_SECRET");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: `${appUrl}/api/telegram/webhook`,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
    }),
  });

  const json = await response.json();
  console.log(JSON.stringify(json, null, 2));

  if (!response.ok || !json.ok) {
    throw new Error("Telegram setWebhook returned a non-success response");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "setWebhook failed";
  console.error(redactSecrets(message));
  process.exit(1);
});

export {};
