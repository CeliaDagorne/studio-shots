# Architecture

Studio Shots turns catalog shot ideas into reviewer-approved lifestyle images through a **chat-first** workflow. Slack is the primary adapter; Telegram is a supported secondary adapter. Both call the same shared import, planning, generation, and review services. The companion website is read-only.

## High-level flow

```text
Slack: attach CSV + @Studio Shots import
  (or Telegram: CSV caption /import)
  → shared plan + cost preview (Neon)
  → Generate priority OR Choose a product (paginated)
  → claim request (imported_unconfirmed → generating)
  → Luma image_edit × 3 (concurrent; catalog photo as source)
  → download → Vercel Blob
  → Slack Block Kit candidates + Approve/Reject
    (or Telegram photos + inline keyboards)
  → ≥2 approvals → approved + product page URL
  → /products/[sku] shows approved Blob images only
  → /campaigns/[importId] read-only web overview
  → Slack completion message / Telegram /status rollup
```

## Shared identity model

Chat work is keyed by platform-neutral conversation identity (`src/lib/chat-identity.ts`):

| Field | Meaning |
|---|---|
| `platform` | `"slack"` or `"telegram"` |
| `conversationId` | Slack channel id, or Telegram chat id as a string |

Imports, shot requests, and generation candidates store that identity so delivery and authorization stay scoped to the originating conversation. External event ids are also platform-scoped (`stableImportId(platform, externalEventId)`, unique on `(platform, external_event_id)`).

## Components

| Piece | Role |
|---|---|
| `POST /api/slack/events` | Slack Events API; signature verify; `event_id` dedupe; app_mention → help or import |
| `POST /api/slack/interactions` | Slack Block Kit actions; signature verify; preview / picker / generate / review |
| `POST /api/telegram/webhook` | Telegram updates; `x-telegram-bot-api-secret-token`; chat allowlist |
| `src/lib/chat-identity.ts` | Shared `platform` + `conversationId` helpers |
| `src/lib/imports.ts` | Idempotent CSV plan persistence (stable IDs, Neon transaction) |
| `src/lib/generation.ts` | Atomic claim, Luma pipeline via `waitUntil`, shared `persistCandidateReview` |
| `src/lib/generation-delivery.ts` | Platform delivery (Slack post vs Telegram send/edit) |
| `src/lib/luma.ts` | Luma Agents `image_edit` helpers (`uni-1`, catalog photo as `source`) |
| `src/lib/image-generation*.ts` | Shared provider interface; `luma` + `fake` implementations; env selection |
| `src/lib/blob.ts` | Durable public Blob URLs before chat delivery |
| `src/lib/products.ts` | Product page query; approved-only filter |
| `src/lib/status.ts` | Shared campaign aggregates (Telegram `/status` + web overview) |
| `src/lib/campaigns.ts` | Campaign page assembly, demo catalog, public URLs |
| `src/lib/assets.ts` | Join root-relative `/demo/...` paths to `APP_URL` for external APIs |

Both adapters invoke the same planning (`imports.ts` / request planning), generation claim + pipeline, and review persistence. UI-only code lives in Slack Block Kit builders / Telegram keyboards.

## Auth and idempotency

### Slack

- Every Events and Interactivity request is verified with the Slack signing secret (`src/lib/slack-verify.ts`): HMAC over `v0:{timestamp}:{rawBody}`, with a max timestamp age.
- Unauthorized `team_id` / channel id are ignored or refused without running shared services.
- Slack `event_id` values are claimed once in-process (`claimSlackEventId`) so duplicate deliveries do not re-run import or help.
- Interaction `trigger_id`s are similarly claimed so repeated button clicks stay idempotent at the edge; review persistence also uses an atomic `review_decision IS NULL` update.

### Telegram

- Webhook requests must present `TELEGRAM_WEBHOOK_SECRET` via `x-telegram-bot-api-secret-token`.
- Only `ALLOWED_CHAT_ID` may import, generate, or review.
- Import idempotency keys off Telegram `update_id` as `external_event_id` for platform `telegram`.

### Shared import safety

- Parent `imports` row is written with dependent products/shot requests in one Neon HTTP transaction batch.
- Duplicate deliveries of the same `(platform, external_event_id)` do not create duplicate imports.
- Shot requests are keyed by `(sku, request_hash)` so identical re-imports stay idempotent.
- “Unchanged” catalog rows can still be **actionable** if their workflow status is `imported_unconfirmed`.

## Generation safety

- A request is claimed atomically before any paid Luma call.
- Work continues after the HTTP ack returns (`waitUntil`, `maxDuration` on routes).
- Candidate images are stored on Blob; chat receives Blob URLs (not short-lived Luma URLs).
- One product is generated per confirm action in v1.
- Import preview offers a priority shortcut plus a paginated product picker. Callbacks / action values carry stable import/request IDs only.
- Stale picker taps (already generating / complete / not in this import) get a clear error and do not call Luma.

## Review rules

- Each ready candidate is reviewed independently (Approve / Reject).
- After every ready candidate has a decision: **approved** if ≥2 approvals, else **needs_regeneration**.
- Failed candidates are excluded from the approval count but reported in chat.
- Completing as approved sends the public product page URL (and campaign overview URL when known) built from `APP_URL`.
- Slack updates the original candidate message to Approved/Rejected and removes buttons; Telegram edits the caption and removes the inline keyboard. Neither path auto-regenerates after rejection.

## Public site

- `/`: Slack-primary product story, four-step workflow, demo catalog, GitHub/docs links, and a link to the latest campaign when one exists (works with no imports yet). Telegram is noted as also supported.
- `/campaigns/[importId]`: read-only campaign totals and product grid (priority, status, approved counts, product links).
- `/products/[sku]`: metadata, original catalog photo, approved styled shots + downloads.
- Unknown campaigns/SKUs → not-found; products with no approvals → empty gallery state.
- Generation and review actions stay in chat; the website never exposes secrets or provider IDs.

## Cost model (estimate)

Configured as integer micros USD per generated image (`IMAGE_REF_COST_USD_MICROS`, currently $0.0434; name retained for pricing constant continuity). Preview and status views use that constant × candidates generated. Treat it as an estimate and update when provider pricing changes.

## Why image editing (product fidelity)

Studio Shots uses Luma `type: "image_edit"` with the catalog packshot as `source` so lifestyle scenes are built **around** the real product instead of regenerating it. Prompts keep the catalog Shot Idea as creative direction and append fixed framing rules: keep the complete product visible, centered at roughly 60–75% of the frame, with safe margins and no crop/obscure/redesign. Luma derives edit output dimensions from the source image (`aspect_ratio` is ignored for `image_edit`), so the request omits aspect ratio and never silently falls back to `image_ref`.

### Fake provider (local / Preview)

Set `IMAGE_GENERATION_PROVIDER=fake` to exercise the full Slack import → generate → review → campaign-continuation path without calling or charging Luma. The fake provider returns three deterministic demo images from `public/demo/`, simulates a short delay for loading states, and persists candidates through the normal database and review flow. Production must use `IMAGE_GENERATION_PROVIDER=luma`; `fake` is refused when `VERCEL_ENV=production`.

## Out of scope (v1)

| Limit | Notes |
|---|---|
| Bulk generate-all / parallel multi-SKU | Spend and review load |
| Multi-tenant / multi-workspace / multi-channel | One Slack team+channel and one Telegram chat per deploy |
| Slack Marketplace distribution | Single-workspace install via manifest |
| CMS auto-publish | Weekly human upload remains the handoff |
| Auto-regeneration on `needs_regeneration` | Explicit confirm keeps cost predictable |
| `/export` zip | Product page downloads are enough for v1 |
| Variable candidate count / model / pricing UI | Fixed `uni-1`, three candidates, constant cost estimate |
