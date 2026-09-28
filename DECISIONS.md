# Decisions

Product and engineering choices behind Studio Shots.

## Chat surface: Telegram

**Decision:** Ship review and import in Telegram, not a web dashboard or Slack-first bot.

**Why:** Reviewers already work from their phone in chat. Privacy mode, document captions, and inline keyboards are well understood; a new admin UI would fight adoption.

**Impact:** Webhook bot, `/import` caption requirement, allowlisted `ALLOWED_CHAT_ID`, Approve/Reject keyboards.

## Done means multiple approved images

**Decision:** A request is complete only after every ready candidate is reviewed and at least two are approved.

**Why:** “One favorite” is not enough for product pages and campaigns. Independent per-candidate review matches how people pick from a contact sheet.

**Impact:** No album “pick one” UX; resolution logic in `review.ts`; product pages show approved images only.

## Spend control: one product at a time

**Decision:** Generate for a single selected product per confirm. Do not offer bulk generate-all in v1.

**Why:** Every image has a dollar cost. Teams need a clear gate before spend, and a way to stop after proving quality on one SKU.

**Impact:** Cost preview before confirm; priority-first shortcut today; SKU picker next; atomic DB claim before Luma.

## Priority is an explicit catalog field

**Decision:** Urgency comes from a required CSV `Priority` value: `high`, `normal`, or `low` (case-insensitive).

**Why:** Keyword scoring on Notes is brittle and opaque. Operators should set priority in the sheet they already edit.

**Impact:** Missing or invalid Priority fails the import with a clear error. Among actionable requests, selection is `high` > `normal` > `low`, with CSV order breaking ties. Import preview shows the chosen SKU and its priority level. Notes never influence ranking.

## Durable storage before chat

**Decision:** Download completed Luma outputs to Vercel Blob, then send Blob URLs to Telegram and the product page.

**Why:** Provider URLs expire. Chat history is a poor archive for the e-commerce team’s weekly upload.

**Impact:** Blob paths `candidates/{sku}/{candidateId}.jpg`; downloads on `/products/[sku]`.

## Status lives in chat

**Decision:** Campaign progress and estimated spend are a Telegram `/status` message, not a separate analytics UI.

**Why:** Visibility without interrupting reviewers or inventing another login.

**Impact:** `status.ts` aggregates products, pipeline stages, candidates, spend, and approved product page links.

## Generation method: `image_ref` at 3:2

**Decision:** Primary path is Luma `image_ref` with aspect ratio `3:2` (not `image_edit`).

**Why:** Side-by-side validation favored more natural, editorial lifestyle scenes from `image_ref`, with controllable framing. `image_edit` preserved the source more literally and remains a possible fidelity fallback later.

**Impact:** Defaults in `luma.ts` / `request-planning.ts`; prompts stress product shape, color, and material fidelity.

## What we are not building (yet)

| Deferred | Reason |
|---|---|
| Generate-all / parallel multi-SKU runs | Spend and review load |
| Multi-tenant / multi-chat | One deployment = one team chat |
| CMS auto-publish | Weekly human upload remains the handoff |
| Auto-regeneration on `needs_regeneration` | Explicit confirm keeps cost predictable |
| `/export` zip | Product page downloads are enough for v1 |

## Open questions

- Brand identity for customer-facing pages beyond the working “Studio Shots” label
- How long rejected candidates should remain visible in chat history
- Whether the e-commerce team later wants a bundled `/export` in addition to per-image downloads
