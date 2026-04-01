# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (original); MongoDB (email bot system)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server (with MongoDB email API)
│   └── web-mail/           # React+Vite web email client (Tailwind, React Router, shadcn/ui)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── master_bot.py           # Dual Telegram email bot with SMTP + web password management
├── cloudflare_email_worker.js  # Cloudflare Email Worker for edge email reception
├── cloudflare_wrangler.toml    # Wrangler config for CF worker deployment
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server with MongoDB-backed email inbox API. Routes live in `src/routes/` and use JWT auth with httpOnly cookies.

- Entry: `src/index.ts` — reads `PORT`, connects MongoDB, starts Express, graceful shutdown (SIGTERM/SIGINT)
- App setup: `src/app.ts` — helmet (security headers), compression, rate limiting (120/min general, 20/15min auth), CORS, cookie-parser, JSON/urlencoded parsing, CSRF protection middleware, trust proxy enabled, global error handler
- MongoDB: `src/lib/mongo.ts` — connects to both Bot1 and Bot2 MongoDB databases
- Auth: `src/middleware/auth.ts` — JWT middleware with httpOnly cookies, request fingerprinting (user-agent + accept-language hash embedded in JWT), CSRF token generation/validation, live alias validation on every authenticated request (checks existence, ownership, active status, expiry)
- Admin: `src/middleware/admin.ts` — admin role verification (admin, moderator, super_admin)
- Utilities: `src/lib/sanitize.ts` — regex escaping, search query sanitization, dbKey validation
- Routes:
  - `src/routes/health.ts` — `GET /api/healthz`
  - `src/routes/auth.ts` — `POST /api/auth/login` (with fingerprint + CSRF token issuance), `POST /api/auth/logout`, `GET /api/auth/me` (refreshes CSRF token), `POST /api/auth/switch`
  - `src/routes/inbox.ts` — `GET /api/inbox` (paginated), `GET /api/inbox/stats`
  - `src/routes/mail.ts` — `GET /api/mail/:id`, `PATCH /api/mail/:id`, `POST /api/mail/batch`
  - `src/routes/aliases.ts` — `GET /api/aliases`, `PATCH /api/aliases/:email/password`
  - `src/routes/incoming.ts` — `POST /api/incoming-mail` (Cloudflare worker endpoint, API key auth)
  - `src/routes/admin.ts` — Full admin panel API (dashboard stats, user/alias management, role/status changes, bulk set passwords, admin action logging with Telegram notifications)
- Security: helmet headers, CSRF double-submit cookie pattern, request fingerprinting, live alias validation, rate limiting, regex injection prevention, input length limits, bcrypt(12) password hashing, trust proxy for correct IP detection
- Dependencies: `mongodb`, `jsonwebtoken`, `bcryptjs`, `cookie-parser`, `helmet`, `compression`, `express-rate-limit`
- Depends on: `@workspace/db`, `@workspace/api-zod`

**Environment Variables (API server):**
- `BOT1_MONGO_URI` — MongoDB connection string for Bot1
- `BOT2_MONGO_URI` — MongoDB connection string for Bot2
- `BOT1_DB_NAME` / `BOT2_DB_NAME` — Database names (default: `mailbot_pro`)
- `JWT_SECRET` or `SESSION_SECRET` — Secret for JWT signing
- `INCOMING_MAIL_API_KEY` — API key for Cloudflare worker incoming mail endpoint

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages.

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`).

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package. Run scripts via `pnpm --filter @workspace/scripts run <script>`.

### `artifacts/web-mail` (`@workspace/web-mail`)

React+Vite web email client branded as **ZayMail** with Tailwind CSS, shadcn/ui components, and React Router. Domain: `zayvex.cloud`.

- Pages: Login (modern gradient UI with success animation, shake-on-error, no "create account"), Inbox (paginated, search, filter, pull-to-refresh, swipe-to-delete, unread blue dot indicator, staggered entry animations, hover quick-actions), Mail Detail (full HTML rendering with inline images toggle, full-view mode, download/open-in-tab, keyboard shortcuts: Escape/Backspace=back, S=star, D=delete, U=toggle read, F=full view), Settings (password change with 4-bar strength meter and match feedback, theme toggle), Admin Panel (Dashboard, Users, Aliases, Logs)
- Auth: Cookie-based sessions via `/api/auth/*` endpoints (httpOnly JWT cookies)
- Account switching: mail.tm-style dropdown with colored avatar initials per alias, active indicator, switch with loading state
- Theme: Indigo/violet color palette with light/dark/system modes, glass effects, gradient branding, custom scrollbar styling
- Admin panel: Dashboard with staggered animated stat cards, per-bot breakdown, user management (role/status changes), alias management (activate/deactivate, extend expiry, reset password, delete), activity logs with filtering — all pages have staggered entry animations
- Toast notifications: sonner for all admin actions and user feedback
- Error handling: All optimistic updates have rollback on API failure (star, read, delete, swipe actions)
- API proxy: Vite dev server proxies `/api` to api-server on port 8080
- Responsive: Collapsible desktop sidebar (localStorage-persisted) + mobile bottom nav layout
- Credit footer: "Built by NiHAL @N2X4E" in sidebar and login page
- Dependencies: react-router-dom, dompurify, lucide-react, sonner, shadcn/ui components (button, badge, card, dropdown-menu, input, label, separator, skeleton, tooltip)

## MasterMailBot (`master_bot.py`)

Unified Python script running two Telegram email-forwarding bots simultaneously (Bot 1 for Nihal, Bot 2 for Maruf) with a built-in SMTP server (aiosmtpd on port 25).

### Key Features
- **Dual bot**: Both bots share identical functionality but use separate MongoDB databases, alias caches, and Telegram sessions
- **SMTP server**: aiosmtpd replaces Gmail/IMAP polling; incoming emails route to the correct bot/user automatically
- **Web password management**: Auto-generates bcrypt-hashed passwords on alias creation; users can view/reset passwords via "Web Password" button in user panel
- **uvloop**: High-performance event loop (falls back to default asyncio if not installed)
- **TTLCache**: In-memory LRU+TTL cache (OrderedDict-based) for users, counts, and aliases — minimizes MongoDB hits
- **Cross-bot email uniqueness**: Same email address cannot be assigned in both bots simultaneously
- **Admin fallback**: Unassigned emails route to Bot1 only, first admin only

### Dependencies
`telethon`, `motor`, `aiosmtpd`, `python-dotenv`, `uvloop`, `bcrypt` (optional, falls back to sha256)

### Config
- Bot credentials, MongoDB URIs, and super admin IDs are set via environment variables or hardcoded defaults
- SMTP binds to `SMTP_HOST`/`SMTP_PORT` (default `0.0.0.0:25`)
- Session files: `bot1_session`, `bot2_session`
- Timezone: `Asia/Dhaka`

### MongoDB Schema (per bot database)
- **`users`**: `_id` (U{tg_id}), `tg_user_id`, `username`, `name`, `role`, `status`, `notifications`, `stats`, timestamps
- **`aliases`**: `alias_email` (unique), `tg_user_id`, `user_id`, `active`, `expires_at`, `password` (bcrypt hash), timestamps
- **`mail_logs`**: `_id` (SHA256 dedupe_key), `alias_email`, `tg_user_id`, `from`, `subject`, `body`, `snippet`, `read`, `starred`, `deleted`, `bot`, timestamps
- **`settings`** and **`statistics`**: System configuration and aggregated data
- **`admin_logs`**: Admin action audit trail with `action`, `adminTgId`, `adminName`, `targetType`, `targetId`, `details`, `dbKey`, `timestamp`

## Cloudflare Email Worker (`cloudflare_email_worker.js`)

Cloudflare Workers script that receives emails via Cloudflare Email Routing and POSTs them to the API server's `/api/incoming-mail` endpoint.

### Setup
1. Deploy with Wrangler: `wrangler deploy` (uses `cloudflare_wrangler.toml`)
2. Set secrets: `wrangler secret put INCOMING_MAIL_API_KEY`
3. Configure Cloudflare Email Routing to route emails to this worker
4. Set `API_ENDPOINT` to your API server URL

### Config (`cloudflare_wrangler.toml`)
- `API_ENDPOINT` — URL of the API server
- `INCOMING_MAIL_API_KEY` — Secret for authenticating with the API
