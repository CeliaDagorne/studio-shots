# Studio Shots

**Live site:** [https://studio-shots.vercel.app](https://studio-shots.vercel.app)

Chat-first styled product photography for catalog teams, primarily used through **Slack**. Telegram is also supported as a secondary chat adapter.

Import a product CSV in Slack, preview costs, generate lifestyle candidates with [Luma](https://lumalabs.ai) (one product at a time), approve or reject each shot in your team’s channel, and publish approved images on public product pages. A read-only web campaign overview tracks progress after each import.

## What it does (Slack)

1. **Import**: Attach a catalog CSV in the authorized Slack channel and mention `@Studio Shots` with `import`. Studio Shots replies with a Block Kit cost preview before any paid generation.
2. **Select**: Use **Generate priority** for the top SKU, or **Choose a product** for any other actionable SKU.
3. **Generate**: Confirm generation for one product at a time (spend stays controlled).
4. **Review**: Approve or Reject each candidate independently in the channel.
5. **Campaign**: After import, Studio Shots shares a link to `/campaigns/[importId]`. Approved images also appear on `/products/[sku]` with download links.

Telegram exposes the same shared services with `/import`, inline keyboards, and `/status`; see [Telegram setup](#telegram-setup-secondary) below.

## Intentional v1 limits

- One authorized Slack workspace + channel per deployment (`SLACK_TEAM_ID`, `SLACK_CHANNEL_ID`)
- One authorized Telegram chat per deployment (`ALLOWED_CHAT_ID`) when Telegram is used
- Luma as the image-generation provider (`image_edit` from the catalog product photo, `uni-1`)
- Fixed candidate count (three per request); at least two approvals to mark a product done
- Fixed per-image cost estimate constant (see [ARCHITECTURE.md](ARCHITECTURE.md))
- One product generating at a time; no batch / generate-all
- No Slack Marketplace distribution and no multi-tenant / multi-workspace support
- No CMS auto-upload and no automatic regeneration

## Demo catalog

Sample data lives in [`data/catalog.csv`](data/catalog.csv) with packshots under [`public/demo/`](public/demo/):

| SKU | Product | Priority |
|---|---|---|
| SS-001 | Lilac Ceramic Vase | high |
| SS-002 | Amber Glass Candle | normal |
| SS-003 | Olive Canvas Weekend Bag | normal |
| SS-004 | Cobalt Glass Table Lamp | low |

Photo paths are root-relative (`/demo/...`) and resolved against `APP_URL` when calling Luma.

### CSV columns

`SKU`, `Product Name`, `Category`, `Color / Finish`, `Material`, `Price`, `Photo`, `Shot Idea`, `Notes`, `Priority`

- Rows without a Shot Idea are catalog-only (no generation request).
- **`Priority` is required** on every row. Accepted values: `high`, `normal`, `low` (case-insensitive; whitespace trimmed).
- Among actionable shot requests, Studio Shots selects the highest priority (`high` > `normal` > `low`). Equal priorities keep CSV order.
- Notes never affect priority ranking.
- After import, Slack offers **Generate priority**, **Choose a product** (paginated list with SKU, priority, and estimated cost), and **Cancel**.

## Stack

- Next.js 16 (App Router) on Vercel
- Neon (Postgres) + Drizzle
- Slack Events API + Interactivity (primary chat adapter)
- Telegram Bot API webhook (secondary adapter)
- Luma Agents API
- Vercel Blob (durable candidate storage)

## Setup (fresh deployment)

Use **new** Vercel, Neon, Slack app, and Blob credentials; do not reuse another project’s secrets. Telegram is optional for a Slack-only deploy, but the current runtime still expects Telegram env vars to be set (see `.env.example`).

1. Copy [`.env.example`](.env.example) → `.env.local` and fill in values.
2. `npm install`
3. `npm run db:migrate`
4. `npm run dev` (or deploy to Vercel)
5. Create the Slack app from [`slack-app-manifest.json`](slack-app-manifest.json) and point Events / Interactivity URLs at your deployment (see below).

### Slack environment variables

| Variable | Purpose |
|---|---|
| `SLACK_BOT_TOKEN` | Bot user OAuth token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Request signature verification |
| `SLACK_TEAM_ID` | Allowlisted workspace |
| `SLACK_CHANNEL_ID` | Allowlisted channel |

Also required for any deployment: `APP_URL`, `DATABASE_URL`, plus the Telegram vars in `.env.example`.

### Image generation provider

| Environment | Setting |
|---|---|
| Local / Vercel Preview | `IMAGE_GENERATION_PROVIDER=fake` |
| Production | `IMAGE_GENERATION_PROVIDER=luma` |

- **fake** returns deterministic demo candidates from `public/demo/`, never instantiates the Luma client, and does not require `LUMA_AGENTS_API_KEY`. Slack shows a visible test-mode context line. Fake mode is refused when `VERCEL_ENV=production`.
- **luma** uses Luma Agents `image_edit` (requires `LUMA_AGENTS_API_KEY`).

Unset defaults: `luma` only when `VERCEL_ENV=production`; otherwise `fake`.

Blob uploads use Vercel OIDC on the linked project (no long-lived blob token required in env). Production Luma runs still persist candidates to Blob; fake mode serves public demo URLs.

### Slack app setup

1. In [api.slack.com/apps](https://api.slack.com/apps), **Create New App** → **From a manifest**.
2. Paste or upload [`slack-app-manifest.json`](slack-app-manifest.json). Update `request_url` values to your `APP_URL`:
   - Events: `https://<your-host>/api/slack/events`
   - Interactivity: `https://<your-host>/api/slack/interactions`
3. Install the app to the workspace and copy the **Bot User OAuth Token** and **Signing Secret** into `.env.local`.
4. Set `SLACK_TEAM_ID` / `SLACK_CHANNEL_ID` to the workspace and channel you authorize.
5. Invite `@Studio Shots` to that channel.

Scopes used: `app_mentions:read`, `chat:write`, `files:read`. Bot event: `app_mention`.

### Telegram setup (secondary)

Telegram remains a supported adapter on the same shared import, planning, generation, and review services.

1. Create a bot with BotFather and set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `ALLOWED_CHAT_ID`.
2. Point the webhook at `APP_URL/api/telegram/webhook` with your secret:

```bash
npm run set:webhook
npm run webhook:info
```

3. In the allowlisted chat, upload a CSV with caption `/import`, then use the inline keyboards and `/status` as needed.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local Next.js |
| `npm test` | Unit + optional DB integration tests |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply Drizzle SQL migrations |
| `npm run set:webhook` | Register Telegram webhook |
| `npm run webhook:info` | Inspect Telegram webhook |

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): system flow, adapters, and key mechanics
- [DECISIONS.md](DECISIONS.md): product and engineering choices

## License

ISC
