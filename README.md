# WhatsApp AI Chatbot Platform

Production WhatsApp Business chatbot with a secure admin dashboard. Customers message the business
number (for example from an Instagram bio link); the bot answers from company-approved data (FAQs,
products, business details), optionally with an LLM, and staff can take over any conversation.

**Stack:** Next.js 16 (App Router, Route Handlers, `proxy.ts`) · TypeScript 6 strict · MongoDB Atlas +
Mongoose 9 · Zod 4 · Tailwind CSS 4 · Meta WhatsApp Cloud API · Upstash QStash + Vercel Cron ·
Anthropic Claude behind a provider interface · Vitest + in-memory MongoDB.

Deployment, Meta setup and the production acceptance test: **[docs/deployment.md](docs/deployment.md)**.

---

## Status: what is done and what has been verified

| Area | Implemented | Automated tests | Needs external setup | Verified for real |
|---|---|---|---|---|
| Webhook GET verification, `X-Hub-Signature-256` over raw bytes | ✅ | ✅ unit + route | Meta app secret, verify token | Built app with dummy credentials (handshake, forged signature → 401). **Not yet called by Meta** |
| Payload parsing (messages, statuses, unsupported, username/BSUID) | ✅ | ✅ incl. a real Meta status payload (anonymised) | — | Real "failed" status payload parsed |
| Durable ingest → job → reply, idempotency, concurrency | ✅ | ✅ integration (real MongoDB) | — | Built app with in-memory DB |
| Retries with backoff + jitter, dead-letter, requeue, unknown-outcome safety | ✅ | ✅ integration | QStash for production | Inline mode only |
| Delivery-status tracking (never moves backwards) | ✅ | ✅ integration | — | Not with real Meta statuses yet |
| Outbound text and template sending, error classification | ✅ | ✅ unit (mocked Graph API) | WhatsApp token + phone number ID | **No real message delivered yet**: the Meta test send failed with error 131031 (business verification required) |
| Chatbot engine (rules, FAQ, products, hours, handoff, injection guard, price guard) | ✅ | ✅ unit | — | Built app via simulator |
| AI provider (Anthropic or Gemini) with timeout and fallback | ✅ | ✅ unit (fake provider, mocked Gemini API) | `AI_PROVIDER_API_KEY`, `AI_MODEL` | Gemini `gemini-3.5-flash-lite` answered a direct test call (2026-10-27); not yet through the bot |
| WhatsApp policy (24h window, templates, opt-out/in) | ✅ | ✅ unit + integration | Approved template in WhatsApp Manager | Not against Meta |
| Admin auth (scrypt, DB sessions, roles, CSRF, rate limits) | ✅ | ✅ integration | — | Built app (login, cookie flags, CSRF 403, roles) |
| Admin dashboard (overview, conversations, FAQs, products, settings, health, simulator) | ✅ | Type-checked; API covered by tests | — | Built and served; API flows exercised. UI not yet reviewed in a browser by a person |
| Coexistence: app messages (`smb_message_echoes`), history import, staff-first wait and pause | ✅ | ✅ unit + integration | Tech Provider app, Embedded Signup config, webhook fields | **Not yet received from Meta** |
| Coexistence onboarding page (Embedded Signup, token exchange, sync requests) | ✅ | ✅ unit (mocked Graph API) | `META_APP_ID`, `META_EMBEDDED_SIGNUP_CONFIG_ID` | **Not run against Meta yet** |
| Saved replies in the dashboard | ✅ | Type-checked | — | Not yet reviewed in a browser |
| Webhook from Meta through a tunnel | ✅ | — | Published Meta app | ✅ Meta's test webhook received and signature-verified (2026-10-27); real phone messages not yet (Meta's test number was not receiving) |
| MongoDB Atlas connection | ✅ | — | `MONGODB_URI` | ✅ Connected to the development cluster |
| Production deployment (Hostinger Node.js web app or VPS, QStash, cron) | Config and guide written (docs/deployment.md 3b, 3c) | — | Hostinger, Upstash accounts | **Not deployed** |

**Real end-to-end WhatsApp testing has not happened yet.** It needs a Meta business portfolio that
is verified (see [docs/deployment.md](docs/deployment.md)).

---

## How it works

```
Customer (WhatsApp) ──▶ Meta Cloud API ──▶ POST /api/webhooks/whatsapp
                                              │ 1. verify signature (raw bytes)
                                              │ 2. validate + parse
                                              │ 3. store message + job in MongoDB (idempotent)
                                              │ 4. answer 200 only after storage succeeded
                                              ▼
                               QStash (prod) / after() (dev) ──▶ /api/jobs/process
                                              │ claim job atomically
                                              │ chatbot engine → reply (FAQ / product / rules / AI)
                                              │ policy check (24h window, opt-out)
                                              │ store reply as pending → send → store wamid
                                              ▼
Customer ◀── Meta ◀── Graph API  ·  later: status webhooks (sent/delivered/read/failed)
Vercel Cron every 5 min ──▶ /api/cron/recover: stuck jobs, early statuses, data retention
```

Reliability guarantees, each covered by tests:
- A customer message is stored before Meta gets `200`; if storage fails, Meta retries.
- Unique indexes (`whatsappMessageId`, `botReplyTo`, job `idempotencyKey`) mean duplicates and races can never create a second message, job or reply.
- Outbound messages are stored as `pending` before sending and claimed atomically. A timeout becomes `unknown` and is **never auto-resent** (to avoid duplicates); admins decide.
- Status events can only move a message forward (`read` is never replaced by a late `delivered`).
- Jobs retry with exponential backoff and jitter, then go to a dead-letter state that admins can requeue from System Health.

## Project structure

```
src/
  app/
    api/webhooks/whatsapp/   Meta webhook (GET verify, POST events)
    api/jobs/process/        QStash worker (signed)
    api/cron/recover/        scheduled recovery + retention (CRON_SECRET)
    api/auth/                login / logout
    api/admin/               dashboard APIs (all role-checked)
    admin/                   dashboard pages
    login/                   sign-in page
  proxy.ts                   optimistic redirect for /admin (real checks are server-side)
  components/ui.tsx          UI primitives
  lib/
    auth/                    scrypt passwords, DB sessions, guards
    config/env.ts            per-feature env validation
    db/                      Mongoose connection
    http/api.ts              JSON helpers, CSRF/origin check, safe errors
    security/rate-limit.ts   MongoDB-backed rate limiting
    validation/admin.ts      Zod schemas for every admin input
    whatsapp/                client, signature, parser, policy, types
    logging/                 JSON logger with redaction
  models/                    Mongoose models (+ registry for index sync)
  providers/ai/              AI provider interface + Anthropic
  services/
    chatbot/                 channel-independent engine (rules, prompt, guards)
    conversations/ messages/ knowledge/ settings/ webhooks/ jobs/ health/ simulator/
scripts/                     admin bootstrap, index sync, setup check, webhook simulation, test send
tests/unit, tests/integration
```

---

## Local development

Requirements: Node.js ≥ 22.12 (developed on 24), a MongoDB Atlas cluster.

```bash
npm install
cp .env.example .env.local        # fill in values (see below)
npm run secret                    # generate each secret separately
npm run db:sync-indexes           # create indexes (required: they enforce idempotency)
npm run admin:create -- --email you@company.ae --name "Your Name" --role owner
npm run check:setup               # read-only check of config, MongoDB and WhatsApp credentials
npm run dev                       # http://localhost:3000 → /login
```

Then open **Admin → Simulator** to chat with the bot using your FAQs and products without WhatsApp.
Simulated replies are labelled and never sent.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run check` | typecheck + lint + all tests |
| `npm run test` | unit + integration tests (in-memory MongoDB, mocked WhatsApp/AI) |
| `npm run check:setup` | read-only config + connection check (sends nothing) |
| `npm run db:sync-indexes` | builds all MongoDB indexes; run on every deploy that changes models |
| `npm run admin:create -- --email … --role owner\|admin\|agent` | creates an account and prints a one-time password |
| `npm run admin:create -- --email … --reset-password` / `--deactivate` | account maintenance |
| `npm run webhook:simulate -- --text "Hi"` | posts a correctly signed **simulated** webhook to a running server |
| `npm run whatsapp:send-test -- --to 9715XXXXXXXX` | sends one real `hello_world` template |
| `npm run secret` | prints a cryptographically secure secret |

### Environment variables

All variables are documented in [.env.example](.env.example). They are validated when the feature
using them runs, and errors name the variable, never its value.

| Group | Variables | Without them |
|---|---|---|
| Database | `MONGODB_URI`, `MONGODB_DB_NAME` | Nothing works; `/api/health` returns 503 |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_API_VERSION` | Webhook answers 503; nothing is sent |
| Admin | `ADMIN_SESSION_SECRET`, `ADMIN_SESSION_TTL_HOURS` | Login unavailable |
| AI (optional) | `AI_PROVIDER=anthropic\|gemini`, `AI_PROVIDER_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS` | Bot answers from FAQs, products and rules only |
| Queue | `APP_BASE_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_URL` | Inline mode (development) |
| Cron | `CRON_SECRET` | No scheduled recovery or retention |
| Other | `LOG_LEVEL`, `SIMULATOR_ENABLED` | Sensible defaults |

## Security summary

- Admin accounts exist only via the CLI (`admin:create`); there is no public sign-up.
- Passwords are hashed with scrypt; sessions are random tokens stored as HMACs in MongoDB, expire, and are revoked on logout, deactivation and password change.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` + `__Host-` prefix in production.
- Every admin page and API checks the session and role on the server: owner/admin (content, settings, health, simulator) vs agent (conversations).
- Mutations require same origin plus an `X-Requested-With` header (CSRF). No CORS headers are sent.
- Rate limits apply to login (per IP and per account), password changes and all admin writes.
- Zod validates every input; filter fields accept only primitives (no `$` operator injection); unknown query paths throw (`strictQuery: "throw"`).
- Security headers include CSP, HSTS, `frame-ancestors 'none'`, `nosniff` and a referrer policy.
- Logs are JSON with tokens, secrets and connection strings redacted, phone numbers masked, and no message text.
- The chatbot treats customer text as untrusted: injection attempts get a fixed refusal, trusted data stays in the system prompt, and AI output is rejected if it leaks instructions or quotes a price not in Products.
- Retention: messages older than the configured period are deleted by the cron; admins can erase a customer's data on request.
