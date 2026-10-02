# Generation history

Product pages show approved assets only. Full generation/review timelines live at
`/products/[sku]/history?campaign=<importId>`.

## Why production history looked empty

1. **Feature not deployed yet** — the history route and `generation_attempts` table
   were developed locally and were not on production `main` while diagnosis ran.
2. **Different Neon branches** — local `.env.local` and production `.env.production`
   point at different database hosts. A campaign created locally does **not** exist
   in production.
3. **Campaign scoping** — product/history pages require a production import id in
   `?campaign=`. When that id is missing from the production database, the page
   stays empty rather than mixing another campaign’s candidates.

Production candidate rows used contiguous `candidate_index` batches (`1–3` / `4–6`),
so attempt reconstruction from the historical shared key
`(shot_request_id, ceil(candidate_index / 3))` is unambiguous.
`luma_generation_id` is per-candidate and is **not** used as an attempt grouping key.

## Schema

Migration `drizzle/0005_generation_attempts.sql` adds:

- `generation_attempts` (explicit attempt / legacy bucket per shot request)
- `generation_candidates.generation_attempt_id` nullable FK

The migration is additive: existing rows keep working with `generation_attempt_id = NULL`
until backfill or new generations link them. Currently deployed app code that does not
read or write these columns remains compatible after migrate.

New generations always insert an attempt row before candidates and link them.

## Production migration + backfill (manual)

Do **not** run write steps against production from an agent session unless
explicitly requested. Commands below are the exact operator flow.

### 1. Deploy code that includes the history page and migration

Ship the commit that contains `/products/[sku]/history` and
`drizzle/0005_generation_attempts.sql`.

### 2. Apply migrations on the production Neon branch

```bash
# Uses DATABASE_URL from the environment / .env.local by default.
# For production, point DATABASE_URL at the production Neon branch first:
DATABASE_URL='postgresql://…production…' npm run db:migrate
```

Optional verify:

```bash
DATABASE_URL='postgresql://…production…' npm run db:verify
npx tsx scripts/inspect-generation-history.ts --env=.env.production
```

### 3. Dry-run backfill (default — no writes)

```bash
npx tsx scripts/backfill-generation-attempts.ts --env=.env.production
```

Report lines show planned `ATTEMPT` / `LEGACY` groups, candidate counts, and stable ids.
Ambiguous relationships (if any) become a single **Legacy generation** without
invented attempt numbers.

### 4. Write backfill only after reviewing the dry-run

```bash
npx tsx scripts/backfill-generation-attempts.ts --env=.env.production --write
```

The script is idempotent: already-linked candidates are skipped; attempt ids are
stable hashes of `shotRequestId` + attempt number (or `:legacy`).

### 5. Confirm a real production campaign URL

Use an import id that exists on the production branch, for example:

```text
/products/SS-004/history?campaign=<production-import-id>
```

Inspect first if needed:

```bash
npx tsx scripts/inspect-generation-history.ts --env=.env.production \
  <production-import-id> SS-004
```
