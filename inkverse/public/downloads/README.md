# InkVerse

Comics + web-novel platform with **Reader** and **Creator** accounts, live **moderated chat channels**, early-access **coin payments**, creator **payouts**, analytics, and an admin moderation console.

Full-stack: Node.js · Express · SQLite (better-sqlite3) · WebSocket (`ws`) · vanilla-JS SPA (PWA). No build step.

> **Status:** fully working locally. Payments are a **demo checkout** (no real money moves). Follow "Going to production" before charging real users.

## What's inside (v3)
- **Free tier & Premium** — free is ad-supported with a highlight cap; Premium removes ads, lifts the cap and includes monthly early-access unlocks. Creators choose **Free / Paid / Hybrid** per series.
- **Reading modes** — vertical scroll, paged, **manga (right-to-left, double-page)** and a novel **Book view**, all with an animated **page-turn**. Themes, fonts, text-to-speech, offline saving and synced progress.
- **Highlights that persist** — select text in novels (4 colours + notes) or drag a box over a comic panel; stored on your account.
- **Copyright check on new uploads** — image hashing + text fingerprinting against other creators and a protected-works registry; auto-block, admin review queue, signed ownership proof.
- **Creator studio** — drafts, scheduling, bulk import, chapter manager, retention/conversion analytics, comment pin/delete, polls, tags & content warnings.
- **Discovery & fairness** — charts (rising, paid, free, completed, spotlight), related series, filters, 30-day new-creator boost.
- **Accounts** — signup/login, email verification, password reset/change, sign out everywhere, data export, account deletion.

Docs: [`design.md`](design.md) (features, business rules, architecture) · [`tasks.md`](tasks.md) (what is done / next).

---

## 1. Quick start (local)

Requirements: **Node.js 18+** (tested on 22) and npm.

```bash
npm install
npm start            # http://localhost:3000
```

The first start creates `data/inkverse.db` and seeds demo content.

| Account | Login | Password | Role |
|---|---|---|---|
| Admin / moderator | `admin` | `Admin123!` | admin |
| Creator | `NovaInk` | `Creator123!` | creator (has earnings) |
| Creator | `KaiWrites` | `Creator123!` | creator |
| Reader | `ReaderRay` | `Reader123!` | reader (500 coins) |

> These demo credentials are public. **Never deploy with them** — see §3.

```bash
npm test             # 140+ end-to-end API checks on throwaway databases
```

---

## 2. Environment variables

All optional locally. Copy `.env.example` to `.env` and run `npm run start:env` (uses Node's built-in `--env-file`), or set them in your host's dashboard.

| Variable | Default | Required in production? | Purpose |
|---|---|---|---|
| `PORT` | `3000` | host usually sets it | HTTP + WebSocket port |
| `JWT_SECRET` | auto-generated into `data/.secret` | **Yes** | Signs login tokens. Use 48+ random chars (`openssl rand -hex 48`). If it changes, everyone is logged out. |
| `DATA_DIR` | `./data` | **Yes** (point to a persistent disk) | Holds the SQLite DB and the auto secret |
| `DB_FILE` | `<DATA_DIR>/inkverse.db` | no | Override the database file path |
| `UPLOAD_DIR` | `./uploads` | **Yes** (persistent disk) | Uploaded covers and comic pages |
| `SEED_DEMO` | `true` | **Set to `false`** | `false` = no demo users/content |
| `ADMIN_EMAIL` | – | **Yes** (with `SEED_DEMO=false`) | Email of the real admin account created on boot |
| `ADMIN_PASSWORD` | – | **Yes** (with `SEED_DEMO=false`) | Its password (8+ chars; change it after first login) |
| `ADMIN_USERNAME` | `admin` | no | Its username |
| `HOLD_DAYS` | `14` | no | Days creator earnings are held before they can be withdrawn |
| `PUBLIC_URL` | request host | **Yes** | Your public https URL (used in Stripe redirects and reset emails) |
| `STRIPE_SECRET_KEY` | – | **Yes** for real sales | `sk_test_…` / `sk_live_…`. Enables card checkout and disables the demo checkout. |
| `STRIPE_WEBHOOK_SECRET` | – | **Yes** with Stripe | `whsec_…` from your webhook endpoint (`/api/stripe/webhook`); coins are credited only by this signed event |
| `DEMO_PAYMENTS` | `true` when no Stripe key | set `false` | `false` removes the free demo checkout |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `SMTP_SECURE` | – | **Yes** for password reset | Any SMTP provider (Brevo, Resend, Mailgun, SendGrid, Gmail app password) |
| `MAIL_FROM` | `SMTP_USER` | recommended | e.g. `InkVerse <no-reply@yourdomain.com>` |
| `BACKUP_KEEP` | `7` | no | Daily DB backups kept in `DATA_DIR/backups` |
| `REQUIRE_VERIFIED` | `false` | recommended with SMTP | `true` = creators must confirm their email before publishing and anyone must before buying coins |

Business rules (revenue split, payout minimum, coin packs, check-in rewards) live in `server/db.js → RULES` and are also shown in the UI automatically.

### Minimal production `.env`
```env
PORT=3000
JWT_SECRET=<output of: openssl rand -hex 48>
DATA_DIR=/var/data
UPLOAD_DIR=/var/data/uploads
SEED_DEMO=false
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=<a long unique password>
```

---

## 3. Deployment

### Important constraints (read first)
1. **SQLite + uploads live on disk → you need a persistent disk/volume.** Hosts with ephemeral filesystems (free tiers, most serverless platforms) will lose all data on restart.
2. **Run a single instance.** Chat rooms are held in memory and SQLite is single-writer. To scale horizontally, move to Postgres + Redis pub/sub (see `tasks.md`).
3. **Serve over HTTPS.** The client automatically uses `wss://` when the page is HTTPS. Your proxy must forward WebSocket upgrades on `/ws`.
4. **Not suitable for Vercel/Netlify functions** (long-lived WebSocket + disk).

### Option A — Docker (any VPS, Fly.io, Railway, Render, Coolify…)
```bash
docker build -t inkverse .
docker run -d --name inkverse -p 3000:3000 \
  -v inkverse_data:/var/data \
  -e JWT_SECRET=$(openssl rand -hex 48) \
  -e DATA_DIR=/var/data -e UPLOAD_DIR=/var/data/uploads \
  -e SEED_DEMO=false -e ADMIN_EMAIL=you@yourdomain.com -e ADMIN_PASSWORD='change-me-please' \
  inkverse
```

### Option B0 — One-click Render Blueprint (recommended)
This repo contains `render.yaml` at its root. In Render: **New → Blueprint** → select the repo → enter `ADMIN_EMAIL` and `ADMIN_PASSWORD` when prompted → **Apply**. It creates a Starter web service with a 1 GB persistent disk (paid; disks are not available on the free tier), generates `JWT_SECRET`, and disables demo accounts. Open the service URL and log in with the admin you entered.

### Option B — Render / Railway (manual)
1. Push this repo to GitHub, create a **Web Service** from it.
2. Build command: `npm install` · Start command: `npm start`.
3. Add a **persistent disk** mounted at `/var/data` (Render: Disks · Railway: Volumes).
4. Add the environment variables from the table above (`DATA_DIR=/var/data`, `UPLOAD_DIR=/var/data/uploads`, …).
5. Deploy, open the URL, log in with `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

### Option C — VPS with pm2 + Nginx
```bash
sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx   # Node 18+
git clone <your repo> /opt/inkverse && cd /opt/inkverse && npm ci --omit=dev
sudo mkdir -p /var/data && sudo chown $USER /var/data
cp .env.example .env && nano .env          # fill the production values
npm i -g pm2 && pm2 start "node --env-file=.env server/index.js" --name inkverse && pm2 save && pm2 startup
```
Nginx site (`/etc/nginx/sites-available/inkverse`), then `sudo certbot --nginx -d yourdomain.com`:
```nginx
server {
  server_name yourdomain.com;
  client_max_body_size 80m;                 # comic chapter uploads
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade; # WebSocket chat
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Backups
Back up `DATA_DIR` (database + secret) and `UPLOAD_DIR` nightly. For a consistent DB copy while running: `sqlite3 inkverse.db ".backup backup.db"`.

---

## 4. Pre-launch checklist
- [ ] `SEED_DEMO=false`, real `ADMIN_*` set, demo accounts absent
- [ ] Strong `JWT_SECRET`, HTTPS on, WebSocket proxy works (open a chat channel)
- [ ] Persistent disk mounted and backed up
- [ ] Real payments connected (below) — the demo checkout is for development only
- [ ] Terms, Privacy Policy and a registered DMCA agent reviewed by a lawyer
- [ ] Replace the demo word filter list with a maintained, multilingual one
- [ ] Add NSFW/CSAM image moderation before opening uploads to the public (the copyright check does not do this)
- [ ] Install a real web-wide image search (e.g. TinEye/Copyleaks) if you need to catch copies of work InkVerse has never seen
- [ ] Add transactional email (password reset, removal notices)

## 5. Going to production with real payments
The demo endpoints are `POST /api/wallet/buy` (coin purchase), the demo Premium grant in `POST /api/premium/subscribe`, and the admin "Mark paid" payout button. With `STRIPE_SECRET_KEY` set, coins **and Premium** use Stripe Checkout; add the webhook events `checkout.session.completed`, `invoice.paid` and `customer.subscription.deleted`.

1. **Coin purchase:** create a Stripe Checkout Session per coin pack; on the `checkout.session.completed` **webhook** (verify the signature) run the same logic as `/api/wallet/buy` (credit coins + `transactions` row). Remove the demo endpoint.
2. **Payouts:** use Stripe Connect or PayPal Payouts. In `POST /api/admin/payouts/:id` (approve) trigger the real transfer first, then mark paid.
3. **Refunds/chargebacks:** during the hold window, delete or reverse the matching `earnings` rows.
4. Collect tax forms (W-9 / W-8BEN) before the first payout.

## 6. How it works (short)
- **Readers** register, read, comment, react, follow, host chat channels, buy coins, tip.
- **Creators** also create series and upload chapters (single, bulk, or scheduled weekly), set early-access prices, see analytics and request payouts.
- **Money:** coins unlock early-access chapters → creator earns **70 %** of net coin value (tips **90 %**) → earnings are held 14 days → creator requests a payout (≥ $50) → admin approves.
- **Moderation:** automatic filter + rate limits → strikes (mute → ban) → report queue (auto-hide at 3 reports) → appeals → audit log; DMCA workflow for copyright.

## 7. Project structure
```
server/
  index.js        Express app, REST API, WebSocket chat, scheduler
  advanced.js     recommendations, analytics, reactions, streaks, badges, appeals, audit, word filter
  moderation.js   text screening, strikes, reports
  copyright.js    upload fingerprinting, protected registry, review queue, ownership proof
  features.js     premium, highlights, prefs/history, charts, polls, creator tools
  db.js           schema + business RULES
  seed.js         demo / production seeding
  smoke-test.js   end-to-end tests (npm test)
public/           SPA (index.html, css/styles.css, js/app.js + reader.js, studio.js, pages.js), PWA manifest + service worker
uploads/          user uploads (git-ignored)
data/             SQLite DB + secret (git-ignored)
design.md  tasks.md  README.md  Dockerfile  .env.example
```

## 8. API overview
Auth `POST /api/auth/register|login` · `GET/PATCH /api/me` · Catalogue `GET /api/series`, `/api/series/:id`, `/api/chapters/:id` · Creator `POST /api/series`, `/api/series/:id/chapters`, `/chapters/bulk`, `GET /api/creator/dashboard|analytics`, `POST /api/creator/payout` · Money `GET /api/wallet`, `POST /api/wallet/buy`, `/api/chapters/:id/unlock`, `/api/tip` · Community `GET/POST /api/channels`, WebSocket `/ws`, `POST /api/report`, `/api/appeals` · Admin `GET/POST /api/admin/*` · Engagement `POST /api/checkin`, `GET /api/recommendations`, `/api/me/badges` · **v3** Premium `GET /api/premium`, `POST /api/premium/subscribe|cancel`, `/api/chapters/:id/premium-unlock` · Highlights `GET/POST /api/chapters/:id/highlights`, `PATCH/DELETE /api/highlights/:id`, `GET /api/highlights` · Reader `GET/PUT /api/me/prefs`, `POST /api/chapters/:id/progress`, `GET /api/history` · Discovery `GET /api/charts`, `/api/series/:id/related` · Creator `PATCH/DELETE /api/chapters/:id`, `GET /api/creator/series/:id/retention`, `/api/creator/comments`, `POST /api/chapters/:id/poll`, `GET /api/chapters/:id/proof` · Copyright `POST /api/copyright/check-text`, admin `GET /api/admin/copyright`, `POST /api/admin/copyright/protect|:id` · Account `POST /api/auth/change-password|logout-all|verify-email`, `GET /api/me/export`, `DELETE /api/me` · Ops `GET /healthz`.

## 9. Troubleshooting
| Problem | Fix |
|---|---|
| `npm install` fails building `better-sqlite3` | Install build tools (Windows: Visual Studio Build Tools; Linux: `build-essential python3`) or use a Node LTS version with prebuilt binaries. |
| Node crashes instantly (exit code 139 / `-1073741819`) | Use the pinned `better-sqlite3@11.10.0` from `package.json` (newer releases crashed on Node 22.12/Windows during testing). |
| Chat shows "offline" behind a proxy | Forward `Upgrade`/`Connection` headers for `/ws` (Nginx snippet above). |
| Logged out after every deploy | Set a fixed `JWT_SECRET` and persistent `DATA_DIR`. |
| Uploaded images vanish after deploy | `UPLOAD_DIR` is not on a persistent disk. |
| Project inside OneDrive behaves oddly | Keep `data/` outside synced folders (`DATA_DIR=C:\inkverse-data`). |

## License
MIT — demo project; review legal/payment requirements before operating a real marketplace.
