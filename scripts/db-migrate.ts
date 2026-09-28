import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { resolve } from "node:path";

import "./load-env-local";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = neon(databaseUrl);
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

  console.log("Migration applied successfully.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]") : "Migration failed");
  process.exit(1);
});
