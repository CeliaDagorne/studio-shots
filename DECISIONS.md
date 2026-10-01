# Decisions

Product and engineering choices behind Studio Shots.

## Chat surface: Slack-primary, Telegram secondary

**Decision:** Ship import, generation, and review through chat adapters, primarily Slack, with Telegram as a supported secondary channel. Do not build a web dashboard for generation or review.

**Why:** Reviewers already work in team chat. Slack is where most catalog and e-commerce teams collaborate; Telegram remains useful for lightweight or phone-first deployments. A new admin UI would fight adoption without improving the review loop.

**Impact:** Slack Events + Interactivity routes (`/api/slack/events`, `/api/slack/interactions`), Block Kit preview/picker/review, allowlisted `SLACK_TEAM_ID` / `SLACK_CHANNEL_ID`. Telegram webhook + `/import` caption + inline keyboards remain available on the same shared services. The website stays read-only.

## Shared services behind platform adapters

**Decision:** Keep import planning, generation claim/pipeline, and candidate review persistence platform-neutral. Slack and Telegram are thin adapters over `platform` + `conversationId` identity.

**Why:** One product loop should not fork into two business logics. Adapter-specific code should stop at auth, message formatting, and delivery.

**Impact:** `chat-identity.ts`, shared `imports.ts` / `generation.ts` / `persistCandidateReview`, and `generation-delivery.ts` branching only at send/edit time. Idempotency is keyed by `(platform, external_event_id)`.

## Done means multiple approved images

**Decision:** A request is complete only after every ready candidate is reviewed and at least two are approved.

**Why:** “One favorite” is not enough for product pages and campaigns. Independent per-candidate review matches how people pick from a contact sheet.

**Impact:** No album “pick one” UX; resolution logic in `review.ts`; product pages show approved images only.

## Spend control: one product at a time

**Decision:** Generate for a single selected product per confirm. Do not offer bulk generate-all in v1.

**Why:** Every image has a dollar cost. Teams need a clear gate before spend, and a way to stop after proving quality on one SKU.

**Impact:** Cost preview before confirm; **Generate priority** shortcut plus paginated **Choose a product** picker; atomic DB claim before Luma; no Generate-all action.

## Priority is an explicit catalog field

**Decision:** Urgency comes from a required CSV `Priority` value: `high`, `normal`, or `low` (case-insensitive).

**Why:** Keyword scoring on Notes is brittle and opaque. Operators should set priority in the sheet they already edit.

**Impact:** Missing or invalid Priority fails the import with a clear error. Among actionable requests, selection is `high` > `normal` > `low`, with CSV order breaking ties. Import preview shows the chosen SKU and its priority level. The product picker lists each actionable SKU with its priority and estimated cost. Notes never influence ranking.

## Durable storage before chat

**Decision:** Download completed Luma outputs to Vercel Blob, then send Blob URLs to chat and the product page.

**Why:** Provider URLs expire. Chat history is a poor archive for the e-commerce team’s weekly upload.

**Impact:** Blob paths `candidates/{sku}/{candidateId}.jpg`; downloads on `/products/[sku]`.

## Status in chat, plus a read-only web overview

**Decision:** Operators get progress from chat (Slack completion / campaign links; Telegram `/status`) and a public `/campaigns/[importId]` page that mirrors the same aggregates, without web generation or review actions.

**Why:** Visibility without interrupting reviewers or inventing another login. Chat remains the control surface; the website stays read-only.

**Impact:** `status.ts` aggregates products, pipeline stages, candidates, spend, and approved product page links. `campaigns.ts` reuses that aggregation for the campaign page. Import and completion messages include the campaign URL when available.

## Generation method: `image_edit` from the catalog product photo

**Decision:** Primary path is Luma `type: "image_edit"` with the catalog product photo as `source` (not `image_ref`).

**Why:** Product fidelity is the hard requirement — the full product must stay visible and recognizable. `image_edit` edits the packshot in place so shape, proportions, color, and material are preserved while the Shot Idea builds a lifestyle environment around it. `image_ref` generated new scenes inspired by the photo and too often cropped or redesigned the product. Luma ignores `aspect_ratio` on `image_edit` (output dimensions follow the source), so we omit it rather than silently falling back to `image_ref` just to request `4:5`.

**Impact:** Defaults in `luma.ts`; prompts keep the catalog Shot Idea as creative direction and append fixed framing constraints (full product visible, centered at ~60–75%, safe margins, no crop/obscure). Cost estimate constant and candidate count are unchanged.

## What we are not building (yet)

| Deferred | Reason |
|---|---|
| Generate-all / parallel multi-SKU runs | Spend and review load |
| Multi-tenant / multi-workspace / multi-channel | One Slack team+channel and one Telegram chat per deploy |
| Slack Marketplace distribution | Manifest install for a single workspace |
| CMS auto-publish | Weekly human upload remains the handoff |
| Auto-regeneration on `needs_regeneration` | Explicit confirm keeps cost predictable |
| `/export` zip | Product page downloads are enough for v1 |
| Configurable candidate count / model / live pricing | Fixed pipeline keeps cost predictable |

## Open questions

- Brand identity for customer-facing pages beyond the working “Studio Shots” label
- How long rejected candidates should remain visible in chat history
- Whether the e-commerce team later wants a bundled `/export` in addition to per-image downloads
