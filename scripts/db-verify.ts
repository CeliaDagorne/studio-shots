import { neon } from "@neondatabase/serverless";

import "./load-env-local";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const expectedTables = ["products", "imports", "shot_requests"];
  const sql = neon(databaseUrl);

  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name
  `;

  const found = rows.map((row) => row.table_name as string);
  const missing = expectedTables.filter((name) => !found.includes(name));
  const extra = found.filter(
    (name) => !expectedTables.includes(name) && name !== "__drizzle_migrations",
  );

  console.log("Tables in public schema:");
  for (const name of found) {
    console.log(`  - ${name}`);
  }

  if (missing.length > 0) {
    console.error(`Missing expected tables: ${missing.join(", ")}`);
    process.exit(1);
  }

  if (extra.length > 0) {
    console.log(`Other tables present: ${extra.join(", ")}`);
  }

  if (found.includes("generation_attempts")) {
    console.log("generation_attempts table is present.");
  } else {
    console.log(
      "generation_attempts table is not present yet (apply drizzle/0005_generation_attempts.sql).",
    );
  }

  console.log("Verification passed: products, imports, shot_requests exist.");
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]")
      : "Verification failed",
  );
  process.exit(1);
});
