# Bharat Gas WhatsApp Message Sender

An internal, full-stack application for the Bharat Gas agency network to run **personalized WhatsApp broadcast campaigns** to LPG consumers. It imports consumer records from CSV/Excel files, manages reusable message templates with dynamic variables, and orchestrates throttled, personalized campaign sends through the Meta WhatsApp Cloud API.

> **Status:** Production-focused foundations in place; real WhatsApp sending is currently in **dry-run mode**. See [Current limitations and roadmap](#16-current-limitations--roadmap).

---

## 1. Project overview

The system is a monorepo with two independent applications:

| Application | Purpose | Default port |
| --- | --- | --- |
| `frontend/` | Next.js (App Router) admin UI — Bharat Gas‑branded dashboard | `3000` |
| `backend/` | NestJS REST API — customers, templates, campaigns, messages, WhatsApp gateway | `3001` |

Both apps are TypeScript. The backend persists to PostgreSQL through Prisma 8 (ORM) and talks to Meta WhatsApp Cloud API when `WHATSAPP_MODE=live` and the Meta credentials are configured; in `WHATSAPP_MODE=dry` it simulates sends in a safe, configurable **dry‑run mode**.

---

## 2. Main features currently implemented

- **Operational dashboard** — live backend/database health, WhatsApp status, campaign stats, recent campaigns, quick actions, system status panel.
- **Customer registry (LPG consumers)** — CSV / XLSX / XLS import with a two‑phase **preview → confirm** flow:
  - duplicate‑in‑file, already‑in‑database, and invalid‑row detection;
  - only brand‑new valid rows are inserted (never overwrites existing records);
  - optional per‑customer **dynamic variables** (e.g. Consumer No., Refill Date, Booking ID, Agency Name) are parsed from extra columns and stored as JSON;
  - server‑driven search, status filtering, and pagination.
- **Message templates** — CRUD with archive, variable helpers and Bharat Gas presets, plus a **live preview** that renders a template against a real customer and reports any missing variables.
- **Campaigns** — 4‑step creation wizard, start / pause / resume / stop / retry, per‑message **throttle**, personalized rendering per customer, "never send unresolved variables" guard, live progress polling, max 3 send attempts per message.
- **Message history** — list with search + status filter, inspector modal with the full payload and WhatsApp message ID; single direct send from a customer's detail view.
- **WhatsApp gateway** — dry‑run simulator by default; capable of real `text` sends via Meta Cloud API when configured (see section 11).
- **Delivery webhooks** — Meta subscription verification plus signed `delivered` / `read` / `failed` callbacks, tracked as monotonic, replay-safe delivery states with a per-message timeline in the UI (see section 13).
- **AI Assistant (OpenAI + DeepSeek)** — server‑side draft **generation, improvement and personalization** with template‑variable preservation; a full `/ai` UI; AI output is **always** review‑gated and never sends WhatsApp messages (see section 12).
- **Settings page** — UI shell for agency/WhatsApp settings (frontend‑only at present; nothing is persisted yet).

---

## 3. Tech stack

### Backend (`backend/`)
- **NestJS 12** (REST, Express platform), Node.js, TypeScript
- **Prisma 8 (release candidate)** with the **`@prisma/orm-postgres`** driver adapter — contract‑first schema (`prisma/contract.prisma`), generated client in `src/prisma/`
- **class-validator / class-transformer** — request DTO validation
- **helmet** — security headers
- **express-rate-limit** — per‑IP rate limiting
- **csv-parse / exceljs** — consumer file ingestion
- **multer** — file upload handling
- **oxlint** — linting; **vitest** + **supertest** — unit and e2e tests

### Frontend (`frontend/`)
- **Next.js 16** (App Router, static/SSR output), React 19
- **Tailwind CSS v4**, **lucide-react** icons
- **eslint** (eslint-config-next) — linting

### Database
- **PostgreSQL** (developed against 18.x)

---

## 4. Project structure

```
whatsapp-message-sender/
├── backend/                      # NestJS REST API
│   ├── prisma/
│   │   └── contract.prisma       # Prisma 8 data contract (PSL)
│   ├── prisma.config.ts          # Prisma 8 project config (connection, contract, output)
│   ├── migrations/               # Prisma migrations (contract graph)
│   │   ├── app/…                 #   migration packages + refs
│   │   └── snapshots/…           #   immutable contract snapshots
│   ├── src/
│   │   ├── main.ts               # bootstrap: helmet, CORS, rate limit, validation, logging
│   │   ├── app.module.ts
│   │   ├── common/dto.ts         # request DTOs with class-validator rules
│   │   ├── prisma/               # PrismaService + generated client (contract.json/contract.d.ts/db.ts)
│   │   ├── health/               # /health
│   │   ├── customers/            # /customers (import, preview, list)
│   │   ├── templates/            # /templates (CRUD, archive, preview)
│   │   ├── campaigns/            # /campaigns (wizard, engine, control, progress)
│   │   ├── messages/             # /messages (history, single send)
│   │   └── whatsapp/             # /whatsapp (status, test send, Meta gateway)
│   ├── test/                     # vitest e2e specs
│   ├── .env.example              # environment templates (placeholders only)
│   └── package.json
├── frontend/                     # Next.js admin UI
│   ├── src/app/                  # pages: dashboard(/), campaigns, customers, messages,
│   │                             #         settings, templates, whatsapp
│   ├── src/components/           # layout + dashboard + UI primitives
│   ├── src/lib/api.ts            # typed API client for the backend
│   ├── .env.example
│   └── package.json
└── .gitignore
```

---

## 5. Frontend setup

Requirements: **Node.js 20+** and npm.

```bash
cd frontend
npm install
```

The app has no build step beyond what Next.js performs; create the environment file (see section 9) and start `npm run dev`.

---

## 6. Backend setup

Requirements: **Node.js 20+** and npm.

```bash
cd backend
npm install
```

Create the environment file (section 9). The backend connects to PostgreSQL on startup; it must be reachable before the API boots (section 7).

---

## 7. PostgreSQL setup

The backend expects a PostgreSQL database reachable at the URL in `DATABASE_URL`. A typical local setup:

```sql
-- Run as a superuser (e.g. `psql -U postgres`)
CREATE ROLE whatsapp_app LOGIN PASSWORD 'change-me-strong-password';
CREATE DATABASE whatsapp_sender OWNER whatsapp_app;
```

Then set `DATABASE_URL` in `backend/.env`:

```bash
DATABASE_URL=postgresql://whatsapp_app:change-me-strong-password@127.0.0.1:5432/whatsapp_sender
```

> The database schema is created and kept in sync through **Prisma migrations** (section 8). There is no SQL dump to restore.

---

## 8. Prisma 8 setup as currently configured

Prisma 8 uses a **contract‑first** workflow instead of the classic `schema.prisma` + client generation:

- **Contract:** `backend/prisma/contract.prisma` (PSL) — the single source of truth for the models: `Customer`, `Campaign`, `Message`, `MessageTemplate`.
- **Config:** `backend/prisma.config.ts` — loads `DATABASE_URL` from the environment, points the contract at `prisma/contract.prisma`, and emits the client to `src/prisma`.
- **Generated client:** `src/prisma/{contract.json, contract.d.ts, db.ts}` — instantiated by `PrismaService` (connects via `db.connect()` on module init).
- **Migrations:** stored under `backend/migrations/` as self‑contained **migration packages** (`migration.ts` + `ops.json`) plus immutable **contract snapshots**, forming a linearly applied graph:
  - `20260917T1933_initial_schema`
  - `20260917T2047_add_message_template`
  - `20260922T1826_add_campaign_fields_and_variables`

Useful Prisma commands (run from `backend/`):

```bash
npx prisma migration check                      # validate on-disk migration graph integrity
npx prisma migration list                       # list on-disk migrations
npx prisma migration status                     # DB marker vs target contract (needs DATABASE_URL)
npx prisma db verify                            # confirm DB schema matches the contract
npx prisma db migrate                           # apply pending on-disk migrations
npx prisma contract emit                        # regenerate client artifacts
npx prisma migration plan --name <slug>         # plan a new migration package from contract changes
npx prisma migration ref set <name> <hash>      # point a ref (e.g. db) at a contract
```

To bring a fresh database up to the current schema, run `npx prisma db migrate` (replays the full on‑disk migration graph) and confirm with `npx prisma db verify`.

---

## 9. Environment variables

Two files — one per app — define every required variable with **placeholders only**. Copy them and fill in real values locally; never commit real credentials (`.env*` is gitignored, with `!.env.example` kept trackable).

### `backend/.env` (from `backend/.env.example`)

| Variable | Purpose | Example / notes |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://USER:PASSWORD@127.0.0.1:5432/whatsapp_sender` |
| `WHATSAPP_MODE` | `dry` simulates sends; `live` sends real messages | `dry` (default) |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp Cloud API phone number ID | required only for `live` |
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API access token | required only for `live` |
| `WHATSAPP_API_VERSION` | Meta Graph API version | `v21.0` (default) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Token you choose; Meta sends it once during the subscription handshake | long random string; required to register a callback URL |
| `WHATSAPP_APP_SECRET` | App Secret used to verify the `X-Hub-Signature-256` HMAC on every delivery POST | required in `live` mode / `NODE_ENV=production` |
| `ALLOWED_ORIGINS` | Comma‑separated CORS allowlist | `http://localhost:3000` (default); `*` allowed but not recommended |
| `RATE_LIMIT_MAX` | Rate‑limit requests per window per IP | `300` (default) |
| `RATE_LIMIT_WINDOW_MS` | Rate‑limit window in milliseconds | `60000` (default) |
| `PORT` | HTTP port the API listens on | `3001` (default); set to whatever your host injects |
| `BODY_LIMIT` | Max request body size | `1mb` (default); must exceed a batched Meta delivery notification |
| `AI_PROVIDER` | Default AI assistant provider | `openai` or `deepseek` |
| `OPENAI_API_KEY` | OpenAI API key (kept server‑side) | required only when using OpenAI |
| `OPENAI_MODEL` | OpenAI model name (configurable) | default `gpt-4o-mini` |
| `DEEPSEEK_API_KEY` | DeepSeek API key (kept server‑side) | required only when using DeepSeek |
| `DEEPSEEK_MODEL` | DeepSeek model name (configurable) | default `deepseek-chat` |
| `AI_TIMEOUT_MS` | Per‑request AI call timeout in ms | `30000` (default) |

### `frontend/.env.local` (from `frontend/.env.example`)

| Variable | Purpose | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Backend base URL used by the UI | `http://localhost:3001` |

---

## 10. How to run frontend and backend locally

**Terminal 1 — backend (API on `:3001`):**

```bash
cd backend
npm run start:dev        # watch mode
# or: npm run start      # compiled mode
```

**Terminal 2 — frontend (UI on `:3000`):**

```bash
cd frontend
npm run dev              # http://localhost:3000
```

Open `http://localhost:3000`. The frontend talks to the backend at `http://localhost:3001` (from `NEXT_PUBLIC_API_URL`), which must also be present in `ALLOWED_ORIGINS` on the backend.

---

## 11. WhatsApp dry-run mode and real Meta integration

**Current behavior (safe by default):**

- `WHATSAPP_MODE=dry` (default) — the gateway never contacts Meta. Every send is simulated: it logs a truncated preview of the message and returns a fake WhatsApp ID (`dry-…`). Perfect for building and demoing campaigns with real data.
- `WHATSAPP_MODE=live` — **fails closed.** If `WHATSAPP_PHONE_NUMBER_ID` or `WHATSAPP_ACCESS_TOKEN` is missing, the send is rejected with a configuration error (HTTP 503, `WHATSAPP_NOT_CONFIGURED`) and **no** request is made to Meta. It never falls back to simulating, because a fabricated `dry-…` success is indistinguishable from a real delivery in campaign results. A misconfiguration is logged once at startup and surfaces in the UI as `NOT CONFIGURED`.
- `POST /whatsapp/test` lets you exercise the dry‑run pipeline from the UI with a number and message.

**What is required to send real messages:**

1. Set `WHATSAPP_MODE=live` in `backend/.env`.
2. Provide `WHATSAPP_PHONE_NUMBER_ID` = your WhatsApp Business phone number ID.
3. Provide `WHATSAPP_ACCESS_TOKEN` = a valid Meta Graph API access token.
4. Optionally set `WHATSAPP_API_VERSION` (default `v21.0`).

**Current integration limits** (important — see roadmap):
- Only **`type: text`** and **`type: template`** messages are sent. Meta requires approved **message templates** for outbound traffic outside the 24‑hour customer service window.
- Delivery and read **webhooks are implemented** (`/webhooks/whatsapp`), so `SENT → DELIVERED → READ` is tracked from Meta's callbacks; inbound replies are acknowledged but not yet processed.
- The send endpoint has **no per‑request timeout tuning, backoff, or Meta rate‑limit awareness** yet — a campaign relies on its own throttle and retry budget.
- Authentication protects the API via a global guard; the only unauthenticated routes are root, health, auth, and the two webhook routes.

---

## 12. AI Assistant (OpenAI + DeepSeek) — drafting only, review‑gated

An AI assistant that helps staff **generate, improve and personalize message drafts**. It is a writing‑aid surface only, and it is the only AI surface in the product.

**Supported providers**

- `openai` — `https://api.openai.com/v1/chat/completions`
- `deepseek` — `https://api.deepseek.com/chat/completions`

Both use server‑side HTTP calls via native `fetch` (no SDK, no extra dependencies). Provider, model and timeout are configured through environment variables (`AI_PROVIDER`, `OPENAI_API_KEY`/`OPENAI_MODEL`, `DEEPSEEK_API_KEY`/`DEEPSEEK_MODEL`, `AI_TIMEOUT_MS`). A request may override the default provider with a `"provider": "openai" | "deepseek"` field.

Both providers share one `OpenAICompatProvider` base (the two APIs use the same request/response shape); `OpenAIProvider` and `DeepSeekProvider` only supply identity, endpoint, credentials and model. `AiService` depends solely on the `ProviderAdapter` interface, resolved through `ProviderRegistry`, so it never imports a provider SDK or endpoint directly.

**Endpoints**

All three accept the shared optional fields `provider`, `instructions`, `tone`, `language` (a BCP‑47‑style tag such as `en` or `hi-IN`), and `businessContext`.

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /ai/generate` | `template`, `customer` (variable map), + shared fields | `AiDraftResult` |
| `POST /ai/improve` | `message`, + shared fields | `AiDraftResult` |
| `POST /ai/personalize` | `message`, `customer` (variable map), + shared fields | `AiDraftResult` |

`AiDraftResult`:

| Field | Meaning |
| --- | --- |
| `provider` | `openai` or `deepseek` |
| `model` | Model reported by the provider (falls back to the configured name) |
| `content` | The draft text. Always a draft, never auto‑sent |
| `variables` | `{{placeholder}}` names found in `content` |
| `usage` | Real provider‑reported `{ inputTokens, outputTokens }`, or `null` when the provider omitted usage. Numbers are never estimated |
| `reviewRequired` | Always `true` |

**What each action does**

- `generate` — drafts a new message from a template for one customer. Placeholders are **kept** in the output, not substituted.
- `improve` — rewrites an existing message to be clearer/more effective, keeping its placeholders.
- `personalize` — merges one customer's real saved values into an existing message, resolving the placeholders it has values for and leaving the rest for the operator. It is the only action allowed to substitute, and it still refuses unknown placeholder names.

**Configuration errors**

The whole AI section is optional. With no API keys the app still boots; an AI request then fails with a clean `503` ("AI provider is not configured") and the UI shows a configuration message. No outbound provider call is attempted.

**Review gate (hard requirement)**

- `reviewRequired` is **always `true`** in every AI response.
- AI output is an **untrusted draft**; the user must review/edit/approve it before the existing sending workflow is used.
- The AI module **never imports or calls the WhatsApp service** and has no path to start campaigns, dispatch messages, or call the Meta API.
- The frontend enforces the gate in the UI: the draft renders in an **editable** textarea behind a persistent "Review required" banner, and an "Edited draft — re‑review before use" marker appears once the operator changes it. The only onward actions are *Copy* and *Copy to Campaign* (clipboard), which hand text to the operator — nothing is sent.
- A system prompt is sent with every request forbidding invented facts, deceptive or unsubstantiated claims, claims of having been sent, and any attempt to skip review.

**Security & safety**

- API keys stay **server‑side only**; they are never returned to the frontend and never written to logs. Logs contain only provider, model, draft length, and duration — never full prompts or full customer data.
- Keys are read from the environment only. They are never persisted to `AppSetting` (the settings allowlist rejects AI key fields), so the browser can never read or set them.
- Placeholder variables (e.g. `{{customer_name}}`, `{{agency_name}}`, `{{agency_address}}`, `{{agency_contact}}`, `{{emergency_contact}}`) must be preserved verbatim. The backend re‑extracts variables from the AI result and **rejects the draft with a controlled `400`** if any original variable is missing. `personalize` instead rejects any placeholder name that was not in the source message or the customer map.
- Inputs are validated with `class-validator` DTOs plus server‑side limits on template/message, instructions, tone, customer variables, and total request size.
- Error mapping is clean and secret‑free: unsupported provider → `400`; missing API key → `503`; provider HTTP error / network failure / malformed or empty response → `502`; request timeout → `504`; dropped or invented variable → `400`.

**Frontend AI Assistant UI** (`frontend/src/app/ai/page.tsx`, reachable as `/ai` from the sidebar)

- Provider selector (`Auto` = server default, or explicit `openai` / `deepseek`), action switch (`Generate` / `Improve` / `Personalize`), tone, language, and a free‑form instructions box.
- For `generate` it loads real customers and templates, derives the customer's variable map (name, mobile, plus any saved custom variables), and shows which template placeholders and customer variables are available.
- The draft panel shows provider, model and real token usage (or "Usage not reported"), an editable draft with a live character count, the preserved `{{variables}}` as badges, *Regenerate*, *Improve Draft*, *Copy*, *Reset*, and *Copy to Campaign*.
- Errors are mapped to operator‑readable messages (including the 503 "not configured" case) rather than raw responses.

**Testing**

No test in this repository contacts OpenAI, DeepSeek, or Meta:

- `backend/src/ai/ai.service.spec.ts` (unit) drives the service through a **fake global `fetch`**; it asserts both providers, the provider override, key/model/endpoint selection, `400`/`502`/`503`/`504` mapping, timeout abort, variable preservation and invention guards, real‑vs‑missing usage, system‑prompt guardrails, and that no code path can send a WhatsApp message.
- `backend/test/ai.e2e-spec.ts` (e2e) boots the app with a **stubbed `fetch`** that throws if anything other than `api.openai.com` / `api.deepseek.com` is called. It covers auth (`401` on all three endpoints), missing key → `503` with no outbound call, unknown provider → `400`, DTO validation, the documented response contract, server‑side‑only `Authorization` header, the system prompt on the wire, the review gate, and that the API key never appears in a response.

---

## 13. WhatsApp delivery webhooks (delivered / read / failed)

Sending a message only proves Meta accepted it. Whether it actually reached the
recipient is reported asynchronously, via the webhook below. The system now
records that outcome per message.

### Endpoints

| Route | Purpose | Authentication |
| --- | --- | --- |
| `GET /webhooks/whatsapp` | One-time subscription handshake Meta performs when you register the callback URL | `hub.verify_token` compared in constant time against `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| `POST /webhooks/whatsapp` | Delivery status events | `X-Hub-Signature-256`, an HMAC-SHA256 of the **raw** request body keyed with `WHATSAPP_APP_SECRET` |

Both routes are the only `@Public()` routes in the app; the global auth guard
stays enabled everywhere else. They authenticate themselves rather than
relying on the guard.

### Registering the callback

1. Set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` to a long random string of your own.
2. Set `WHATSAPP_APP_SECRET` to the App Secret from Meta's App dashboard
   (Settings → Basic).
3. In the WhatsApp product settings, set the callback URL to your public
   `https://…/webhooks/whatsapp` and subscribe to the `messages` field.
4. Confirm the handshake succeeded — the WhatsApp page then shows
   *Verified by Meta*.

### Delivery states

```
PENDING ──▶ SENT ──▶ DELIVERED ──▶ READ
   │         │          │            │
   └─────────┴──────────┴────────────┴──▶ FAILED  (terminal)
```

* Transitions are **monotonic**. A message may only move forward; a repeat is a
  no-op, and an out-of-order event (`read` then `delivered`) is refused. This is
  what makes Meta's aggressive event redelivery harmless.
* `FAILED` is **terminal** for that delivery attempt. A late `delivered` cannot
  revive it. Retrying is an explicit operator action via the campaign retry
  endpoint, which re-queues the message for a fresh attempt budget.
* Stages may be skipped: Meta can report `read` with no preceding `delivered`.
* An unrecognised status is ignored, never guessed at, so a new Meta status
  cannot corrupt a message.

### Timestamps and errors

* `deliveredAt`, `readAt` and `failedAt` are each written **at most once**. The
  first observation wins, so replayed or late events cannot rewrite history or
  null out a value already held.
* Meta's own event timestamp is used when plausible; otherwise local receipt
  time is. Implausible values (before 2015, more than 5 minutes in the future,
  non-numeric) are discarded rather than persisted.
* A failure stores Meta's numeric `code` in `errorCode` and a bounded,
  redacted summary in `error`. Raw error bodies, tokens and message content are
  never stored.

### Response semantics

Once a request is authentic, the endpoint always answers `200` — including for
events it cannot use (unknown message id, unmodelled status, inbound messages,
duplicate delivery). Meta retries every non-2xx aggressively, so failing a
harmless payload would create a retry storm and bury real failures in noise.
Only transport-level problems (bad signature, unparseable body) produce a `4xx`.

### Security posture

* Signature verification **fails closed** in `live` mode and when
  `NODE_ENV=production`: without `WHATSAPP_APP_SECRET`, every delivery event is
  rejected. In `dry` development mode it is permissive and logs a prominent
  warning, so the pipeline can be exercised locally without a real Meta app.
* Signatures are computed over the raw body captured at the HTTP layer
  (`NestFactory.create(AppModule, { rawBody: true })`). Re-serialised JSON
  would change key order and break every signature.
* Token and signature comparisons are constant-time.
* Audit entries record the outcome, never the payload, the signature, or any
  secret. Unknown message ids are audited once per payload so a misconfigured
  endpoint cannot flood the audit trail.
* A per-request event budget bounds how much work one HTTP call can trigger.

---

## 14. API areas currently available

All routes are relative to the backend base URL (`http://localhost:3001`).

| Area | Method & path | Description |
| --- | --- | --- |
| App | `GET /` | Hello world (health sanity) |
| Health | `GET /health` | API + database status with row counts |
| Customers | `POST /customers/upload/preview` | Parse & validate a CSV/XLSX file (no writes) |
| | `POST /customers/upload` | Import validated consumer rows |
| | `GET /customers` | Paginated list: `search`, `status`, `page`, `pageSize` |
| Templates | `POST /templates` | Create template |
| | `GET /templates` | List templates |
| | `GET /templates/:id` | Get template |
| | `PATCH /templates/:id` | Update template |
| | `DELETE /templates/:id` | Archive template (sets inactive) |
| | `POST /templates/:id/preview` | Render against a customer; returns missing variables |
| Campaigns | `POST /campaigns` | Create campaign (`name`, `templateId`, `customerIds`, optional `throttleMs`) |
| | `GET /campaigns` | List campaigns |
| | `GET /campaigns/:id` | Get campaign |
| | `GET /campaigns/:id/progress` | Sent/failed/pending progress |
| | `POST /campaigns/:id/{start,pause,resume,stop,retry}` | Campaign lifecycle control |
| Messages | `POST /messages/send` | Single personalized send (`customerId`, `templateId`) |
| | `GET /messages` | Paginated history: `search`, `status`, `campaignId`, `customerId`, `page`, `pageSize` → `{ data, meta }` |
| WhatsApp | `GET /whatsapp/status` | Mode/configured state (credentials shown as masked) plus webhook readiness booleans |
| | `POST /whatsapp/test` | Send a test message (`to`, optional `message`) |
| Webhooks | `GET /webhooks/whatsapp` | Meta subscription handshake (public; verify-token authenticated) |
| | `POST /webhooks/whatsapp` | Delivery status events (public; HMAC-signature authenticated) |
| AI Assistant | `POST /ai/generate` | Generate a draft from a template, customer variables and style options (review‑gated) |
| | `POST /ai/improve` | Improve an existing message draft (review‑gated) |
| | `POST /ai/personalize` | Merge one customer's real values into an existing message (review‑gated) |
| Analytics | `GET /analytics/dashboard` | Aggregated dashboard figures, computed in the database |
| Audit | `GET /audit-logs` | Paginated audit trail: `search`, `action`, `entityType`, `entityId`, `status`, `page`, `pageSize` |
| Settings | `GET /settings` | Resolved settings (stored values over environment defaults) |
| | `PUT /settings` | Partial update; only allow‑listed, non‑secret keys are accepted |

Request bodies for create/update/send/preview endpoints are validated through typed DTOs (`backend/src/common/dto.ts`); invalid payloads return `400` with a field‑level message list.

---

## 15. Testing / build commands

### Backend

```bash
cd backend
npm run build          # compile to dist/ (also copies the Prisma contract)
npm run lint           # oxlint (type-aware)
npm test               # vitest unit tests
npm run test:e2e       # vitest e2e (boots the app; requires a reachable database)
```

### Frontend

```bash
cd frontend
npm run build          # next build (production)
npm run lint           # eslint
npm run start          # serve the production build after `build`
```

### Production startup

```bash
cd backend
npm ci
npm run build          # dist/ includes prisma/contract.json, required at runtime
NODE_ENV=production npm run start:prod    # `node dist/main`
```

Set `PORT` (defaults to `3001`) and `BODY_LIMIT` (defaults to `1mb`) to match
your host. `npm run start:prod` serves the compiled output and needs no
development-only tooling; the Prisma contract is copied into `dist/prisma/` by
the build step. The frontend is a static export built with `NEXT_PUBLIC_API_URL`
baked in, so it must be built with the production API URL, not at runtime.

---

## 16. Security hardening currently implemented

- **Helmet** security headers on all responses.
- **CORS allowlist** via `ALLOWED_ORIGINS` (default `http://localhost:3000`); disallowed origins receive no CORS headers.
- **Per‑IP rate limiting** (`express-rate-limit`, default 300 requests/min) with tunable window via environment variables.
- **Global request validation** (`ValidationPipe` + typed DTOs, `whitelist` on) — unknown fields are stripped, invalid bodies rejected with `400`.
- **Request logging** — every request is logged with method, URL, status, and duration; 5xx logged as errors.
- **Secrets discipline** — `.env*` files and real credentials are gitignored; only placeholder `.env.example` files are committed; test consumer CSVs (which contain mobile numbers) are gitignored; WhatsApp credentials are reported only as masked status in `/whatsapp/status`.
- **Webhook authentication** — the two `/webhooks/whatsapp` routes are the only `@Public()` routes in the app; they verify a constant-time token (GET) and an `X-Hub-Signature-256` HMAC over the raw request body (POST). Signature verification **fails closed** in `live` mode and when `NODE_ENV=production`. Raw payloads, signatures and secrets are never logged or persisted; webhook readiness is exposed as booleans only, never the verify token or app secret.
- **Request logging is credential‑safe** — Meta's subscription handshake puts `hub.verify_token` directly in the query string, so the HTTP logger redacts every credential‑bearing query parameter (`hub.verify_token`, `access_token`, `token`, `secret`, `password`, `api_key`, `apikey`, `authorization`) before writing a line. Non‑sensitive URLs keep full fidelity, so filters and search terms are still logged. Covered by `backend/src/common/redact-url.spec.ts`.

---

## 17. Current limitations / roadmap

**Known limitations**

- **Single shared admin account** — authentication is enabled and every endpoint is guarded, but there is one shared credential pair, so actions cannot be attributed to an individual person and there is no role separation.
- **Campaign runner is in‑process** — campaigns left `RUNNING` by a crash are re‑adopted on the next boot, but a runner does not survive a restart mid‑send, so a message can be re‑attempted after recovery.
- **Scaling** — customer lists still load rows into memory before filtering/paginating; message history, audit history and dashboard aggregates are now paginated/aggregated in the database.
- **WhatsApp** — `text`‑only sends, no Meta message templates (see section 11).
- **Inbound messages are not handled** — the webhook accepts and acknowledges them, but replies are not automated. See section 13.
- **Settings UI** — values are persisted and served by the API, but the settings page does not yet edit them.
- **Test coverage** — backend unit and API e2e suites exist and pass; there is no frontend test runner yet.

**Planned roadmap (priority order)**

1. ✔ Migration drift fix + backend security baseline *(done — see commit history)*
2. Complete customer management (DB‑level search/filter/pagination, edit/delete)
3. Complete template personalization (persisted agency settings → `agency_*` variables; richer preview)
4. ✔ Durable, restart‑recoverable campaign engine *(done — see `backend/src/campaigns/campaigns.service.ts`)*
5. ✔ Message history — server‑side pagination/filter/sort *(done — see section 13)*
6. Real Meta WhatsApp integration (message templates; delivery webhooks ✔ done — see section 13)
7. ✔ Authentication / authorization *(done — global `AuthGuard`, session cookie)*
8. ✔ Audit logging *(done — see section 13)*
9. ✔ AI assistant (OpenAI + DeepSeek), review‑gated, with `/ai` UI *(done — see section 12)*; upcoming: approve‑to‑template flow
10. ✔ Persistent settings *(done — see section 13)*
11. ✔ Automated tests — backend service + API e2e *(done)*; remaining: frontend
12. Production deployment prep (Docker/CI/env)
13. Final end‑to‑end verification

---

## 18. Git development workflow

- Single long‑lived branch: **`main`** (remote: `origin`).
- Commits use concise, conventional messages (e.g. `security: harden backend configuration and validation`).
- **Never commit secrets**: `.env`, `.env.local`, lock‑file credentials, or the sample consumer CSVs. The `.gitignore` enforces this; `.env.example` files are the only environment‑related files intended for version control.
- **Keep the migration graph consistent**: after any Prisma contract change, plan a migration (`npx prisma migration plan`), commit the package **and** its snapshot, and confirm with `npx prisma migration check`.
- Push to GitHub only on explicit approval; the project rule is **no pushing without instruction**.
- Verify before committing: `npm run lint`, `npm run build`, `npm test`, and — for backend changes touching the API or database — `npm run test:e2e`.
