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

Both apps are TypeScript. The backend persists to PostgreSQL through Prisma 8 (ORM) and talks to Meta WhatsApp Cloud API when configured; otherwise it simulates sends in a safe, configurable **dry‑run mode**.

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
- **AI Assistant (OpenAI + DeepSeek)** — server‑side draft generation and message improvement with template‑variable preservation; AI output is **always** review‑gated and never sends WhatsApp messages (see section 12).
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
| `ALLOWED_ORIGINS` | Comma‑separated CORS allowlist | `http://localhost:3000` (default); `*` allowed but not recommended |
| `RATE_LIMIT_MAX` | Rate‑limit requests per window per IP | `300` (default) |
| `RATE_LIMIT_WINDOW_MS` | Rate‑limit window in milliseconds | `60000` (default) |
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
- `POST /whatsapp/test` lets you exercise the dry‑run pipeline from the UI with a number and message.

**What is required to send real messages:**

1. Set `WHATSAPP_MODE=live` in `backend/.env`.
2. Provide `WHATSAPP_PHONE_NUMBER_ID` = your WhatsApp Business phone number ID.
3. Provide `WHATSAPP_ACCESS_TOKEN` = a valid Meta Graph API access token.
4. Optionally set `WHATSAPP_API_VERSION` (default `v21.0`).

**Current integration limits** (important — see roadmap):
- Only **`type: text`** messages are sent. Meta requires **message templates** for outbound traffic outside the 24‑hour customer service window; template messages are not yet implemented.
- There is **no webhook** — delivery/read receipts are not tracked; a message is marked `SENT` once the Meta API accepts it.
- No send timeout tuning, backoff, or rate‑limit awareness yet.
- There are **no authentication protections** on send endpoints — see limitations.

---

## 12. AI Assistant (OpenAI + DeepSeek) — drafting only, review‑gated

A backend AI assistant that helps staff **write and improve message drafts**. It is a writing‑aid surface only.

**Supported providers**

- `openai` — `https://api.openai.com/v1/chat/completions`
- `deepseek` — `https://api.deepseek.com/chat/completions`

Both use server‑side HTTP calls via native `fetch` (no SDK, no extra dependencies). Provider, model and timeout are configured through environment variables (`AI_PROVIDER`, `OPENAI_API_KEY`/`OPENAI_MODEL`, `DEEPSEEK_API_KEY`/`DEEPSEEK_MODEL`, `AI_TIMEOUT_MS`). A request may override the default provider with a `"provider": "openai" | "deepseek"` field.

**Endpoints**

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /ai/generate` | `template`, `customer` (variables), optional `provider`, `instructions`, `tone` | `{ provider, model, draft, reviewRequired }` |
| `POST /ai/improve` | `message`, optional `provider`, `instructions`, `tone` | `{ provider, model, draft, reviewRequired }` |

**Review gate (hard requirement)**

- `reviewRequired` is **always `true`** in every AI response.
- AI output is an **untrusted draft**; the user must review/edit/approve it before the existing sending workflow is used.
- The AI module **never imports or calls the WhatsApp service** and has no path to start campaigns, dispatch messages, or call the Meta API.

**Security & safety**

- API keys stay **server‑side only**; they are never returned to the frontend and never written to logs. Logs contain only provider, model, draft length, and duration — never full prompts or full customer data.
- Placeholder variables (e.g. `{{customer_name}}`, `{{agency_name}}`, `{{agency_address}}`, `{{agency_contact}}`, `{{emergency_contact}}`) must be preserved verbatim. The backend re‑extracts variables from the AI result and **rejects the draft with a controlled `400`** if any original variable is missing.
- Inputs are validated with `class-validator` DTOs plus server‑side limits on template/message, instructions, tone, customer variables, and total request size.
- Error mapping is clean and secret‑free: unsupported provider → `400`; missing API key → `503`; provider HTTP error / network failure / malformed or empty response → `502`; request timeout → `504`; dropped variable → `400`.

---

## 13. API areas currently available

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
| | `GET /messages` | Message history (capped at 100) |
| WhatsApp | `GET /whatsapp/status` | Mode/configured state (credentials shown as masked) |
| | `POST /whatsapp/test` | Send a test message (`to`, optional `message`) |
| AI Assistant | `POST /ai/generate` | Generate a personalized draft from a template, customer variables and style options (review‑gated) |
| | `POST /ai/improve` | Improve an existing message draft (review‑gated) |

Request bodies for create/update/send/preview endpoints are validated through typed DTOs (`backend/src/common/dto.ts`); invalid payloads return `400` with a field‑level message list.

---

## 14. Testing / build commands

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

---

## 15. Security hardening currently implemented

- **Helmet** security headers on all responses.
- **CORS allowlist** via `ALLOWED_ORIGINS` (default `http://localhost:3000`); disallowed origins receive no CORS headers.
- **Per‑IP rate limiting** (`express-rate-limit`, default 300 requests/min) with tunable window via environment variables.
- **Global request validation** (`ValidationPipe` + typed DTOs, `whitelist` on) — unknown fields are stripped, invalid bodies rejected with `400`.
- **Request logging** — every request is logged with method, URL, status, and duration; 5xx logged as errors.
- **Secrets discipline** — `.env*` files and real credentials are gitignored; only placeholder `.env.example` files are committed; test consumer CSVs (which contain mobile numbers) are gitignored; WhatsApp credentials are reported only as masked status in `/whatsapp/status`.

---

## 16. Current limitations / roadmap

**Known limitations**

- **No authentication (single‑user admin app)** — every API endpoint and page is public; sending endpoints are unprotected.
- **Campaign engine is in‑memory** — campaigns running when the backend restarts are left stranded; delivery state is not re‑durable.
- **Scaling** — customer lists and message queries load rows into memory before filtering/paginating; message history is capped at 100 with no guaranteed order.
- **WhatsApp** — `text`‑only sends, no Meta message templates, no webhook/receipts (see section 11).
- **Settings page** — UI shell only; nothing is persisted.
- **No audit logging, minimal automated tests.**

**Planned roadmap (priority order)**

1. ✔ Migration drift fix + backend security baseline *(done — see commit history)*
2. Complete customer management (DB‑level search/filter/pagination, edit/delete)
3. Complete template personalization (persisted agency settings → `agency_*` variables; richer preview)
4. Durable, restart‑recoverable campaign engine
5. Message history (server‑side pagination/filter/sort)
6. Real Meta WhatsApp integration (message templates + webhook receipts)
7. Authentication / authorization
8. Audit logging
9. ✔ AI assistant foundations (OpenAI + DeepSeek), review‑gated *(done — see section 12)*; upcoming: AI assistant UI + approve‑to‑template flow
10. Persistent settings
11. Automated tests (service + API e2e + frontend)
12. Production deployment prep (Docker/CI/env)
13. Final end‑to‑end verification

---

## 17. Git development workflow

- Single long‑lived branch: **`main`** (remote: `origin`).
- Commits use concise, conventional messages (e.g. `security: harden backend configuration and validation`).
- **Never commit secrets**: `.env`, `.env.local`, lock‑file credentials, or the sample consumer CSVs. The `.gitignore` enforces this; `.env.example` files are the only environment‑related files intended for version control.
- **Keep the migration graph consistent**: after any Prisma contract change, plan a migration (`npx prisma migration plan`), commit the package **and** its snapshot, and confirm with `npx prisma migration check`.
- Push to GitHub only on explicit approval; the project rule is **no pushing without instruction**.
- Verify before committing: `npm run lint`, `npm run build`, `npm test`, and — for backend changes touching the API or database — `npm run test:e2e`.
