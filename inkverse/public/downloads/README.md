# InkVerse

Comics + web-novel platform with **Reader** and **Creator** accounts, live **moderated chat channels**, early-access **coin payments**, creator **payouts**, analytics, and an admin moderation console.

Full-stack: Node.js · Express · SQLite (better-sqlite3) · WebSocket (`ws`) · vanilla-JS SPA (PWA). No build step.

> **Status:** fully working locally. Payments are a **demo checkout** (no real money moves). Follow "Going to production" before charging real users.

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
npm test             # 34 end-to-end API checks on a throwaway database
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

### Option B — Render / Railway (managed)
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
- [ ] Add image moderation before opening uploads to the public
- [ ] Add transactional email (password reset, removal notices)

## 5. Going to production with real payments
The demo endpoints are `POST /api/wallet/buy` (coin purchase) and the admin "Mark paid" payout button.

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
  db.js           schema + business RULES
  seed.js         demo / production seeding
  smoke-test.js   end-to-end tests (npm test)
public/           SPA (index.html, css/styles.css, js/app.js), PWA manifest + service worker
uploads/          user uploads (git-ignored)
data/             SQLite DB + secret (git-ignored)
design.md  tasks.md  README.md  Dockerfile  .env.example
```

## 8. API overview
Auth `POST /api/auth/register|login` · `GET/PATCH /api/me` · Catalogue `GET /api/series`, `/api/series/:id`, `/api/chapters/:id` · Creator `POST /api/series`, `/api/series/:id/chapters`, `/chapters/bulk`, `GET /api/creator/dashboard|analytics`, `POST /api/creator/payout` · Money `GET /api/wallet`, `POST /api/wallet/buy`, `/api/chapters/:id/unlock`, `/api/tip` · Community `GET/POST /api/channels`, WebSocket `/ws`, `POST /api/report`, `/api/appeals` · Admin `GET/POST /api/admin/*` · Engagement `POST /api/checkin`, `GET /api/recommendations`, `/api/me/badges`.

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
