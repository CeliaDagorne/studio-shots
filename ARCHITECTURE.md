# Architecture

Studio Shots turns catalog shot ideas into reviewer-approved lifestyle images without a separate dashboard.

## High-level flow

```text
CSV (/import in Telegram)
  → plan + cost preview (Neon)
  → Generate priority OR Choose a product (paginated)
  → claim request (imported_unconfirmed → generating)
  → Luma image_ref × 3 (concurrent) @ 3:2
  → download → Vercel Blob
  → Telegram photos + Approve/Reject
  → ≥2 approvals → approved + product page URL
  → /products/[sku] shows approved Blob images only
  → /campaigns/[importId] read-only web overview
  → /status for campaign rollup + estimated spend
```

## Components

| Piece | Role |
|---|---|
| `POST /api/telegram/webhook` | Authenticated Telegram updates (`x-telegram-bot-api-secret-token`); chat allowlist |
| `src/lib/imports.ts` | Idempotent CSV plan persistence (Telegram `update_id`, stable IDs, Neon transaction) |
| `src/lib/generation.ts` | Atomic claim, Luma pipeline via `waitUntil`, review resolution |
| `src/lib/luma.ts` | `image_ref` + `uni-1` + aspect `3:2` |
| `src/lib/blob.ts` | Durable public Blob URLs before chat delivery |
| `src/lib/products.ts` | Product page query; approved-only filter |
| `src/lib/status.ts` | Shared campaign aggregates for `/status` and web overview |
| `src/lib/campaigns.ts` | Campaign page assembly, demo catalog, public URLs |
| `src/lib/assets.ts` | Join root-relative `/demo/...` paths to `APP_URL` for external APIs |

## Import safety

- Parent `imports` row is written with dependent products/shot requests in one Neon HTTP transaction batch.
- Duplicate Telegram deliveries of the same `update_id` do not create duplicate imports.
- Shot requests are keyed by `(sku, request_hash)` so identical re-imports stay idempotent.
- “Unchanged” catalog rows can still be **actionable** if their workflow status is `imported_unconfirmed`.

## Generation safety

- A request is claimed atomically before any paid Luma call.
- Work continues after the webhook returns `200` (`waitUntil`, `maxDuration` on the route).
- Candidate images are stored on Blob; Telegram receives Blob URLs (not short-lived Luma URLs).
- One product is generated per confirm action in v1.
- Import preview offers a priority shortcut plus a paginated product picker (6 SKUs per page). Callbacks carry stable import/request IDs only.
- Stale picker taps (already generating / complete / not in this import) get a clear callback error and do not call Luma.

## Review rules

- Each ready candidate is reviewed independently (Approve / Reject).
- After every ready candidate has a decision: **approved** if ≥2 approvals, else **needs_regeneration**.
- Failed candidates are excluded from the approval count but reported in chat.
- Completing as approved sends the public product page URL (and campaign overview URL when known) built from `APP_URL`.

## Public site

- `/` — Telegram-first product story, four-step workflow, demo catalog, GitHub/docs links, and a link to the latest campaign when one exists (works with no imports yet).
- `/campaigns/[importId]` — read-only campaign totals and product grid (priority, status, approved counts, product links).
- `/products/[sku]` — metadata, original catalog photo, approved styled shots + downloads.
- Unknown campaigns/SKUs → not-found; products with no approvals → empty gallery state.
- Generation and review actions stay in Telegram; the website never exposes secrets or provider IDs.

## Cost model (estimate)

Configured as integer micros USD per `image_ref` image (`IMAGE_REF_COST_USD_MICROS`, currently $0.0434). Preview and `/status` use that constant × candidates generated. Treat it as an estimate and update when provider pricing changes.

## Near-term product work

None currently queued beyond polish and a fresh production deploy when credentials are ready.

## Out of scope (v1)

Bulk generate-all, multi-tenant / multi-chat, CMS publishing, `/export` zip, automatic regeneration queues.
