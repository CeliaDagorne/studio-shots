# Studio Shots

Telegram-first styled product photography for catalog teams.

Import a product CSV, generate lifestyle candidates with [Luma](https://lumalabs.ai) (one product at a time), approve or reject each shot in chat, and publish approved images on public product pages. Campaign managers track progress and estimated spend with `/status`.

## What it does

1. **Import** — Upload a catalog CSV in Telegram with caption `/import`. The bot replies with a cost preview before any paid generation.
2. **Generate** — Confirm generation for one product at a time (spend stays controlled). Use **Generate priority** for the top SKU, or **Choose a product** for any other actionable SKU.
3. **Review** — A reviewer approves or rejects each candidate independently in Telegram.
4. **Publish** — Approved images appear on `/products/[sku]` with download links for the e-commerce team. Rejected candidates never show.
5. **Track** — `/status` reports campaign counts, pipeline stages, and estimated generation spend.

## Intentional v1 limits

- Telegram-first review (one allowlisted chat per deployment)
- Luma as the image-generation provider (`image_ref`, `uni-1`, `3:2`)
- Three candidates per request; at least two approvals to mark a product done
- One product generating at a time
- No bulk “generate everything,” no CMS auto-upload, no automatic regeneration

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
- After import, Telegram offers **Generate priority**, **Choose a product** (paginated list with SKU, priority, and estimated cost), and **Cancel**.

## Stack

- Next.js 14 (App Router) on Vercel
- Neon (Postgres) + Drizzle
- Telegram Bot API (webhook)
- Luma Agents API
- Vercel Blob (durable candidate storage)

## Setup (fresh deployment)

Use **new** Vercel, Neon, Telegram bot, and Blob credentials—do not reuse another project’s secrets.

1. Copy `.env.example` → `.env.local` and fill in values.
2. `npm install`
3. `npm run db:migrate`
4. `npm run dev` (or deploy to Vercel)
5. Point the Telegram webhook at `APP_URL/api/telegram/webhook` with your secret:

```bash
npm run set:webhook
npm run webhook:info
```

Required env vars: `APP_URL`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_CHAT_ID`, `LUMA_AGENTS_API_KEY`.

Blob uploads use Vercel OIDC on the linked project (no long-lived blob token required in env).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local Next.js |
| `npm test` | Unit + optional DB integration tests |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply Drizzle SQL migrations |
| `npm run set:webhook` | Register Telegram webhook |

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — system flow and key mechanics
- [DECISIONS.md](DECISIONS.md) — product and engineering choices

## License

ISC
