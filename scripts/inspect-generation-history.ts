/**
 * Read-only production/local DB diagnostic for generation history.
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/inspect-generation-history.ts [campaignImportId] [sku]
 * Or:
 *   npx tsx scripts/inspect-generation-history.ts --env=.env.production [campaignImportId] [sku]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { neon } from "@neondatabase/serverless";

const loadEnvFile = (path: string) => {
  const contents = readFileSync(path, "utf-8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

const args = process.argv.slice(2);
const envArg = args.find((arg) => arg.startsWith("--env="));
if (envArg) {
  loadEnvFile(resolve(process.cwd(), envArg.slice("--env=".length)));
} else {
  try {
    loadEnvFile(resolve(process.cwd(), ".env.local"));
  } catch {
    // optional
  }
}

const positional = args.filter((arg) => !arg.startsWith("--"));
const campaignImportId = positional[0] ?? null;
const skuFilter = positional[1] ?? null;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const host = (() => {
    try {
      return new URL(databaseUrl).host;
    } catch {
      return "[unparseable]";
    }
  })();

  const sql = neon(databaseUrl);
  console.log(`Connected host: ${host}`);

  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `;
  const tableNames = tables.map((row) => String(row.table_name));
  console.log("Tables:", tableNames.join(", "));
  console.log(
    "generation_attempts present:",
    tableNames.includes("generation_attempts"),
  );

  const migrations = await sql`
    select id, hash, created_at
    from __drizzle_migrations
    order by created_at
  `.catch(() => [] as Array<{ id: string; hash: string; created_at: string }>);
  console.log(`Drizzle migrations applied: ${migrations.length}`);

  const importCount = await sql`select count(*)::int as count from imports`;
  const requestCount = await sql`select count(*)::int as count from shot_requests`;
  const candidateCount =
    await sql`select count(*)::int as count from generation_candidates`;
  console.log(
    `Counts: imports=${importCount[0]?.count} requests=${requestCount[0]?.count} candidates=${candidateCount[0]?.count}`,
  );

  if (campaignImportId) {
    const campaign = await sql`
      select id, filename, platform, created_at
      from imports
      where id = ${campaignImportId}
      limit 1
    `;
    console.log(
      `Campaign ${campaignImportId}:`,
      campaign[0]
        ? `FOUND filename=${campaign[0].filename} platform=${campaign[0].platform} created_at=${campaign[0].created_at}`
        : "NOT FOUND in this database",
    );
  }

  const recentImports = await sql`
    select id, filename, platform, created_at
    from imports
    order by created_at desc
    limit 5
  `;
  console.log("Recent imports:");
  for (const row of recentImports) {
    console.log(`  - ${row.id} | ${row.filename} | ${row.platform} | ${row.created_at}`);
  }

  const candidateStats = skuFilter
    ? await sql`
        select
          product_sku,
          shot_request_id,
          count(*)::int as candidate_count,
          min(candidate_index)::int as min_index,
          max(candidate_index)::int as max_index,
          count(distinct candidate_index)::int as distinct_indexes,
          count(luma_generation_id)::int as with_luma_id,
          count(blob_url)::int as with_blob,
          count(review_decision)::int as with_decision,
          min(created_at) as first_created,
          max(created_at) as last_created
        from generation_candidates
        where product_sku = ${skuFilter}
        group by product_sku, shot_request_id
        order by max(created_at) desc
        limit 20
      `
    : await sql`
        select
          product_sku,
          shot_request_id,
          count(*)::int as candidate_count,
          min(candidate_index)::int as min_index,
          max(candidate_index)::int as max_index,
          count(distinct candidate_index)::int as distinct_indexes,
          count(luma_generation_id)::int as with_luma_id,
          count(blob_url)::int as with_blob,
          count(review_decision)::int as with_decision,
          min(created_at) as first_created,
          max(created_at) as last_created
        from generation_candidates
        group by product_sku, shot_request_id
        order by max(created_at) desc
        limit 20
      `;

  console.log("Candidate groups by request:");
  for (const row of candidateStats) {
    console.log(
      `  - ${row.product_sku} request=${row.shot_request_id} n=${row.candidate_count} idx=${row.min_index}-${row.max_index} luma=${row.with_luma_id} blob=${row.with_blob} decisions=${row.with_decision} created=${row.first_created}..${row.last_created}`,
    );
  }

  const sample = skuFilter
    ? await sql`
        select
          id,
          product_sku,
          shot_request_id,
          candidate_index,
          status,
          review_decision,
          luma_generation_id,
          blob_url is not null as has_blob,
          error_message,
          created_at
        from generation_candidates
        where product_sku = ${skuFilter}
        order by created_at desc, candidate_index asc
        limit 30
      `
    : await sql`
        select
          id,
          product_sku,
          shot_request_id,
          candidate_index,
          status,
          review_decision,
          luma_generation_id,
          blob_url is not null as has_blob,
          error_message,
          created_at
        from generation_candidates
        order by created_at desc, candidate_index asc
        limit 30
      `;

  console.log("Sample candidates (newest first):");
  for (const row of sample) {
    console.log(
      `  - ${row.product_sku} #${row.candidate_index} status=${row.status} decision=${row.review_decision ?? "-"} luma=${row.luma_generation_id ? "yes" : "no"} blob=${row.has_blob} err=${row.error_message ? "yes" : "no"} created=${row.created_at} request=${row.shot_request_id}`,
    );
  }

  // Reconstructability analysis: within each request, do indices form clean attempt batches of 3?
  const allByRequest = await sql`
    select shot_request_id, product_sku, array_agg(candidate_index order by candidate_index) as indexes
    from generation_candidates
    group by shot_request_id, product_sku
  `;

  let unambiguous = 0;
  let ambiguous = 0;
  for (const row of allByRequest) {
    const indexes = (row.indexes as number[]) ?? [];
    const byAttempt = new Map<number, number[]>();
    for (const index of indexes) {
      const attempt = Math.ceil(index / 3);
      const list = byAttempt.get(attempt) ?? [];
      list.push(index);
      byAttempt.set(attempt, list);
    }
    let requestOk = true;
    for (const [attempt, list] of byAttempt) {
      const expectedStart = (attempt - 1) * 3 + 1;
      const expected = [expectedStart, expectedStart + 1, expectedStart + 2];
      const unexpected = list.filter((i) => !expected.includes(i));
      if (unexpected.length > 0 || list.length === 0) {
        requestOk = false;
      }
      // Partial attempts (1-2 of 3) are still unambiguous if indices belong to that batch.
      if (list.some((i) => i < expectedStart || i > expectedStart + 2)) {
        requestOk = false;
      }
    }
    if (requestOk) {
      unambiguous += 1;
    } else {
      ambiguous += 1;
      console.log(
        `  AMBIGUOUS request=${row.shot_request_id} sku=${row.product_sku} indexes=${indexes.join(",")}`,
      );
    }
  }
  console.log(
    `Reconstructability: unambiguous_requests=${unambiguous} ambiguous_requests=${ambiguous}`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]")
      : "Inspection failed",
  );
  process.exit(1);
});
