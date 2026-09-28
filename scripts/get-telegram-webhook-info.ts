import "./load-env-local";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const redactSecrets = (message: string): string =>
  message.replace(/bot\d+:[A-Za-z0-9_-]+/g, "[redacted-bot-token]");

async function main() {
  const botToken = required("TELEGRAM_BOT_TOKEN");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, {
    cache: "no-store",
  });

  const json = await response.json();
  console.log(JSON.stringify(json, null, 2));

  if (!response.ok || !json.ok) {
    throw new Error("Telegram getWebhookInfo returned a non-success response");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "getWebhookInfo failed";
  console.error(redactSecrets(message));
  process.exit(1);
});

export {};
