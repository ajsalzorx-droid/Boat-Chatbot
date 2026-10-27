# Deployment, Meta setup and production acceptance

The steps below cover what source code cannot do for you. Meta, Vercel, Upstash and MongoDB change
their dashboards and prices regularly, so **confirm each step against the official documentation
before release**. Prices here are approximate and should be checked on each provider's pricing page.

---

## 1. Meta (WhatsApp Cloud API)

### 1.1 Business portfolio and verification
1. Use the **company's own** Meta Business portfolio (business.facebook.com). If it already manages
   the company's Instagram/Facebook, use that one: it is trusted more and owned by the company.
2. Add at least two company admins with two-factor authentication on, and add the developer as admin.
3. **Settings → Security Centre → Business verification**: verify with the company's official
   documents. For a UAE company: trade licence (DET or free-zone authority), address proof (DEWA
   bill, bank statement or Ejari), website and domain email. The legal name must match exactly.
   *Without verification, messaging can be blocked entirely (error 131031 "Business Account locked",
   as seen on this project's test portfolio).*

### 1.2 Developer app
1. developers.facebook.com → **Create app** → use case **"Connect with customers through WhatsApp"**
   → select the company's business portfolio.
2. **Use cases → WhatsApp → Customize → Step 1. Try it out**: note the **Phone number ID** and the
   **WhatsApp Business Account ID**.
3. **App settings → Basic**: copy the **App secret** (`META_APP_SECRET`). Add a **Privacy Policy URL**
   (needed to switch the app to Live).

### 1.3 Production access token (do not use the 24-hour token)
1. Business Settings → **Users → System users → Add**: an *Admin* system user.
2. **Assign assets**: the app (full control) and the WhatsApp account (full control).
3. **Generate token** for the app with permissions `whatsapp_business_messaging` and
   `whatsapp_business_management`, expiry **Never**. Store it only in the hosting provider's
   environment variables (`WHATSAPP_ACCESS_TOKEN`).
4. If the token is ever exposed, revoke it in the same screen and generate a new one.

### 1.4 Real business number
1. WhatsApp Manager → **Phone numbers → Add phone number**: the company's +971 number, verified by
   SMS or call. Choose the **display name** (must relate to the business; Meta reviews it).
2. If the number is on the **WhatsApp Business app** and staff should keep using the app, follow
   **1.7 Coexistence** instead and **do not register the number** (registering logs the app out).
   If it is on **regular WhatsApp**, back up chats, then delete that WhatsApp account before
   registering it on the API.
3. Make sure the number is **registered** for Cloud API (two-step verification PIN). If the
   dashboard does not do it, call `POST /<PHONE_NUMBER_ID>/register` with
   `{"messaging_product":"whatsapp","pin":"<6 digits>"}`.
4. Put the new phone number ID in `WHATSAPP_PHONE_NUMBER_ID`.
5. **WhatsApp Manager → Payment methods**: add a card for business-initiated (template) messages.

### 1.5 Webhook
1. Deploy first (section 3) so the URL responds.
2. App Dashboard → **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
   - Verify token: the exact value of `WHATSAPP_VERIFY_TOKEN`
   - **Verify and save**. Our server answers the challenge only if the token matches.
3. **Webhook fields → `messages` → Subscribe**.
4. If events do not arrive, make sure the app is subscribed to the WhatsApp account:
   `POST /<WABA_ID>/subscribed_apps` with the system-user token.
5. Switch the app to **Live** mode.

### 1.6 Templates (for messages outside the 24-hour window)
Create a **Utility** template in WhatsApp Manager → Message templates (for example
`reengagement_update`) and wait for approval. Then enter its name and language under
**Admin → Settings → WhatsApp messaging rules**. The app checks the approval status with Meta
before sending.

### 1.7 Coexistence: WhatsApp Business app and the bot on the same number
Staff keep the WhatsApp Business app on the phone; the bot answers through the Cloud API on the same
number. Messages staff send from the app arrive as `smb_message_echoes` webhooks and appear in the
dashboard as **Staff (WhatsApp app)**. **Not yet tested end to end with Meta**: confirm each step
against Meta's guide *Onboarding WhatsApp Business app users* before relying on it.

Requirements and limits (from Meta's documentation, check for changes):
- WhatsApp Business app **2.24.17 or newer**; eligibility is decided per number during onboarding.
- Throughput is fixed at 20 messages per second. Broadcast lists become read-only; linked devices are
  signed out during onboarding; WhatsApp for Windows is unsupported. Groups, disappearing and
  view-once messages, catalogs/orders and other app-only features are not available to the API.
- Contacts and up to 180 days of history can be synced **once**, within 24 hours of onboarding.

Steps:
1. Complete **business verification** (1.1).
2. App Dashboard → **Become a Tech Provider** and complete what Meta asks (App Review / advanced
   access for `whatsapp_business_management` and `whatsapp_business_messaging` if required).
3. **Facebook Login for Business → Configurations → Create**: choose the *WhatsApp Embedded Signup*
   variation and the two WhatsApp permissions. Copy the **configuration ID** into
   `META_EMBEDDED_SIGNUP_CONFIG_ID` and the **App ID** into `META_APP_ID`.
4. **Facebook Login for Business → Settings**: add `https://<your-domain>` to *Allowed domains for
   the JavaScript SDK* and turn on *Login with the JavaScript SDK*. App settings → Basic → App domains:
   add your domain.
5. Webhook fields (1.5): subscribe **`messages`, `smb_message_echoes`, `history`,
   `smb_app_state_sync`** and `account_update`.
6. In the WhatsApp Business app, turn **off** greeting and away messages if the bot should send the
   greeting (otherwise customers get two). Move quick replies into **Settings → Saved replies** and
   FAQs.
7. Dashboard (owner) → **WhatsApp connection → Connect WhatsApp Business app**, with the business
   phone in hand. On success the server subscribes the app to the account and requests the contacts
   and history sync. Keep the app open on the phone until the history has synced.
8. Copy the shown `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_BUSINESS_ACCOUNT_ID` into the environment.
   Assign the new WhatsApp account to the system user (1.3) so `WHATSAPP_ACCESS_TOKEN` can send for
   it. Restart the app.
9. **Settings → Staff first**: turn on *Let staff answer first*. The bot then waits (default 15 s)
   before answering, stays quiet when staff answered in the meantime, and pauses for that customer
   for a while (default 30 min) after each staff reply.

---

## 2. MongoDB Atlas

1. Production: a dedicated cluster (M10 or larger) in a region close to your users and hosting
   (Middle East if data should stay near the UAE). M0/Flex tiers are for development only.
2. **Database Access**: a user per environment with **readWrite on this database only**.
3. **Network Access**: Vercel functions have no fixed IP on standard plans. Either use Vercel Secure
   Compute or Atlas private networking for fixed egress, or allow `0.0.0.0/0` with a strong
   generated password, TLS (default) and the least-privilege user. Record the decision.
4. **Backups**: enable Cloud Backup with point-in-time restore. Rehearse a restore into a scratch
   cluster and run `npm run check:setup` against it.
5. Run `npm run db:sync-indexes` against production on first deploy and whenever models change.
   **Unique indexes enforce idempotency, so do not skip this step.**

---

## 3. Hosting (Vercel)

1. Import the repository in Vercel (Framework: Next.js). Node.js 22 or newer.
2. **Environment variables** (Production): every variable from `.env.example`. Use new secrets
   generated with `npm run secret`, different from development.
3. **QStash** (Upstash console → QStash): set `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`,
   `QSTASH_NEXT_SIGNING_KEY` and `APP_BASE_URL=https://<your-domain>`. The worker endpoint is
   `/api/jobs/process`; only QStash-signed requests are accepted. `QSTASH_PARALLELISM` (default 20)
   caps how many jobs run at once; raise it together with your Anthropic rate limit and Atlas tier.
4. **Cron**: `vercel.json` runs `/api/cron/recover` every 5 minutes. Vercel calls it with
   `Authorization: Bearer $CRON_SECRET`. Sub-daily schedules need a paid Vercel plan; on Hobby,
   change the schedule to daily and rely on QStash for retries.
5. Set `SIMULATOR_ENABLED=false` in production unless you want the demo simulator there.
6. After deploy, create the first owner from a trusted machine with production env loaded:
   `npm run admin:create -- --email owner@company.ae --name "Owner" --role owner`.
7. **Monitoring**: logs are structured JSON (Vercel → Logs, or a log drain). Alert on
   `webhook.ingest_failed`, `job.failed`, `outbound.failed`, `api.unhandled_error` and on
   `/api/health` returning 503 (external uptime monitor every 1–5 minutes).

### 3b. Hosting on Hostinger (VPS)

Use a **Hostinger VPS** (KVM 2 or larger, Ubuntu 24.04). Shared web hosting is not suitable: the
app is a long-running Node.js server that needs Node ≥ 22.12, a process manager and cron.

1. **Server setup** (as a non-root sudo user):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs nginx certbot python3-certbot-nginx
   sudo npm install -g pm2
   sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable   # port 3000 stays closed
   ```
2. **App**: copy the project to `/var/www/whatsapp-chatbot`, create `.env.local` there with the
   production values (`chmod 600 .env.local`), then:
   ```bash
   npm ci && npm run build && npm run db:sync-indexes
   pm2 start npm --name whatsapp-chatbot -- start -- -H 127.0.0.1 -p 3000
   pm2 save && pm2 startup
   ```
3. **Nginx** (`/etc/nginx/sites-available/whatsapp-chatbot`, then symlink to `sites-enabled`):
   ```nginx
   server {
     server_name bot.example.ae;
     client_max_body_size 2m;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $remote_addr;   # overwrite: clients cannot forge it
     }
   }
   ```
   Then `sudo certbot --nginx -d bot.example.ae` for HTTPS. HTTPS is required: production session
   cookies are `Secure`/`__Host-` and Meta only calls HTTPS webhooks.
4. **Cron** (`vercel.json` is ignored here). `crontab -e`:
   ```
   */5 * * * * curl -fsS -m 60 -H "Authorization: Bearer <CRON_SECRET>" https://bot.example.ae/api/cron/recover > /dev/null
   ```
5. **MongoDB Atlas → Network Access**: allow **only the VPS IP** (not `0.0.0.0/0`).
6. **QStash**: same as Vercel step 3, with `APP_BASE_URL=https://bot.example.ae`.
7. **Updates**: `git pull && npm ci && npm run build && pm2 reload whatsapp-chatbot`.
8. **Logs**: `pm2 logs whatsapp-chatbot`; install `pm2 install pm2-logrotate` so disks do not fill.

### 3c. Hosting on Hostinger Business / Cloud web hosting (Node.js web app)

Hostinger's **Business** and **Cloud** web hosting plans can run Node.js web apps (Single and
Premium plans cannot). hPanel menu names change, so follow Hostinger's current Node.js guide.

1. Push the project to a **private** GitHub repository (`.env.local` is git-ignored and must stay so).
2. hPanel → **Websites → Create site → Node.js web app** → import the GitHub repository. Use a
   subdomain such as `bot.example.ae`.
3. Build settings: Node **22.x** (or 24.x), install `npm ci`, build `npm run build`, start
   `npm run start`.
4. **Environment variables**: the production values from `.env.example` (new secrets from
   `npm run secret`), `APP_BASE_URL=https://bot.example.ae`, `SIMULATOR_ENABLED=false`.
5. Make sure **SSL** is active for the subdomain (Meta only calls HTTPS).
6. hPanel → **Advanced → Cron Jobs**, every 5 minutes:
   `curl -fsS -m 60 -H "Authorization: Bearer <CRON_SECRET>" https://bot.example.ae/api/cron/recover`
7. **MongoDB Atlas → Network Access**: allow the hosting plan's outgoing IP (shown in hPanel).
8. Use **QStash** in production. Without it, delayed jobs (staff-first wait, retries) run inside
   the app process and fall back to the 5-minute recovery sweep if the process restarts.
9. From your machine with production values loaded: `npm run db:sync-indexes` and
   `npm run admin:create -- --email … --role owner`.
10. Check `https://bot.example.ae/api/health`, then set the webhook (1.5) and privacy policy URL
    (`https://bot.example.ae/privacy`) in the Meta app.

### Approximate monthly costs (check current pricing)
| Service | Plan | Approximate cost |
|---|---|---|
| Vercel | Pro (needed for 5-minute cron and team use) | ~USD 20 per member |
| MongoDB Atlas | M10 dedicated with backups | ~USD 60+ (region dependent) |
| Upstash QStash | Free tier, then pay as you go | Free at low volume; about USD 1 per 100k messages |
| WhatsApp Cloud API | Per message, by category and the customer's country | Replies within 24h of a customer message are generally free; templates are charged |
| Anthropic (optional) | Pay per token | Depends on volume; a small fast model keeps it low |

---

## 4. Local webhook testing with a tunnel

```bash
npm run dev
# in another terminal (either tool):
cloudflared tunnel --url http://localhost:3000
ngrok http 3000
```
Use `https://<tunnel-host>/api/webhooks/whatsapp` as the callback URL in the Meta app (section 1.5).
Tunnel URLs change on restart; switch the callback back to production afterwards.

Without Meta, `npm run webhook:simulate -- --text "Hi"` posts a correctly signed **simulated**
event. This tests your server only; it does not prove that Meta can reach it.

---

## 5. Production acceptance test

Record the result, date and evidence (screenshot or log line) for each step. Do not mark the
system live until every step passes with **real** WhatsApp.

| # | Step | How to check | Pass |
|---|---|---|---|
| 1 | A real test customer sends a WhatsApp message to the business number | Phone | ☐ |
| 2 | Meta delivers the webhook | Admin → System health: "Last event received" updates; log `webhook.accepted` | ☐ |
| 3 | Signature verified | No `webhook.signature_invalid` log for that request | ☐ |
| 4 | Inbound message persisted | Message visible in Admin → Conversations | ☐ |
| 5 | Duplicate delivery creates no duplicate reply | Meta App → WhatsApp → Webhooks test, or resend the same payload; still one reply | ☐ |
| 6 | Chatbot generates an appropriate reply | Reply text matches FAQ/product/settings | ☐ |
| 7 | WhatsApp accepts the outbound message | Message shows "Sent to WhatsApp" with no error | ☐ |
| 8 | Delivery status updates via webhooks | Status moves to Delivered ✓✓ then Read ✓✓ | ☐ |
| 9 | Dashboard shows the conversation; manual reply works | Staff reply arrives on the phone | ☐ |
| 10 | Failures are logged safely and recoverable | Temporarily use an invalid token: reply shows Failed (190), job appears in System health; restore the token, Resend works; logs contain no token or message text | ☐ |
| 11 | Opt-out | Customer sends STOP: confirmation once, no further bot replies | ☐ |
| 12 | Handoff | Customer asks for a person: bot pauses, status "Needs a person" | ☐ |
| 13 | Backup restore rehearsed | Restore to a scratch cluster succeeds | ☐ |
| 14 | Coexistence: staff reply from the app appears in the dashboard | Conversation shows "Staff (WhatsApp app)" | ☐ |
| 15 | Coexistence: staff first | Staff answers within the wait time: no bot reply. Nobody answers: bot replies after the wait | ☐ |
| 16 | Coexistence: history imported | Past chats appear in Conversations in the right order | ☐ |
