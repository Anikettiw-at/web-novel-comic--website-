# InkVerse — Design Document

> Read. Create. Get paid. A comics + web-novel platform with two account types (Reader, Creator), live moderated discussion channels, and a creator payout system designed so that **readers, creators and the platform all profit**.

**Note on visual reference:** the brief said the look should match "above", but no image arrived with the request. The design below is a Webtoon-style direction (clean, mobile-first, bold display type, one signature green). Swap the tokens in §6 once the reference is available.

---

## 1. Research summary

Findings from a web search of Webtoon, Tapas, Royal Road and general moderation practice. Several sources were secondary blogs; **verify platform numbers against each platform's official creator pages before relying on them.**

| Topic | What platforms do | What InkVerse adopts |
|---|---|---|
| Early access / paid episodes | Webtoon "Fast Pass" (2019): readers pay to read ahead, works best for creators on a regular schedule. Tapas: paid episodes, creator gets ~50%. | **Wait-or-pay model**: a chapter is premium for N days, then becomes free. Creator picks price (5–100 coins) and the free-after window. |
| Ad / revenue share | Tapas reported ~70% of ad revenue to creators; Webtoon ad-share needs audience thresholds and a $100 payout minimum. | Creator gets **70%** of net coin value on unlocks, **90%** of tips; payout minimum **$50**. |
| Tips | Webtoon moved to audience-led tipping after ending Creator Rewards (2023). Tapas "Ink" tips. | Tip button on every series; supporter leaderboard. |
| Discovery | Royal Road: strong tags/filters; Tapas: strong discoverability; Webtoon: community. | Genre/type/sort filters, search autocomplete, personalised "Picked for you", trending score. |
| Community | AO3 uses detailed tagging so readers can filter; GoComics uses automated moderation to cut moderator workload. | Channel **topic tags** (general / spoilers / theories / fan-art / recs), `\|\|spoiler\|\|` markup, blurred spoiler channels, automod + human queue. |
| Moderation / legal | Hybrid automated + human review; easy reporting; DMCA notice-and-takedown with counter-notice; EFF notes appeals/notice of removal lag behind. | Report button everywhere, auto-hide at 3 reports, strike ladder, **appeals**, removal **notifications**, DMCA workflow, admin **audit log**. |
| Resilience | SmackJeeves' 2020 shutdown shows creators diversify. | Creators own their IP (stated in Terms); clean content model for future export. |

Sources: Publishers Weekly (Webtoon Fast Pass interview), Taddy blog on Webtoon creator income, Wikipedia "Tapas (website)", EFF "Who Has Your Back", Videntifier & PatentPC moderation/DMCA guides, K Comics Beat webcomic-platform opinion piece.

---

## 2. Users & roles

| Role | Can do |
|---|---|
| **Reader** | Register/login, browse, read free and unlocked chapters, comment, react, rate, like, follow, track progress, **host & join chat channels**, buy coins, tip, report content, appeal strikes, earn badges/streak coins. One click to upgrade to Creator. |
| **Creator** | Everything a reader can **plus**: create series (comic or novel), upload chapters (single or bulk), schedule releases (now / weekly / date), set early-access price, write author notes, view analytics, set payout details, request payouts. |
| **Admin / Moderator** | Review report queue, hide/remove content, issue strikes, ban/unban, handle DMCA claims, approve payouts, review appeals, manage blocked words, read audit log. |

---

## 3. Business rules (single source of truth: `server/db.js → RULES`)

| Rule | Value | Why it keeps everyone in profit |
|---|---|---|
| Coin packs | 200/$1.99 · 500/$4.49 · 1200/$9.99 · 2600/$19.99 | Bulk discount nudges larger purchases. |
| Net coin value | **0.8¢** per coin | After payment-processor fees and taxes (price ≈ 1¢/coin). Creator share is computed on *net*, so the platform never pays out money it didn't keep. |
| Creator share (unlocks) | **70%** of net value | Industry-competitive; platform keeps 30% for hosting, moderation, payments. |
| Creator share (tips) | **90%** | Tips are goodwill; low platform cut encourages support. |
| Earnings hold | **14 days** | Covers refunds/chargebacks before money becomes withdrawable. |
| Minimum payout | **$50** | Keeps payment-fee overhead small. |
| Payout prerequisites | Payout email + accepted payout/tax terms | Compliance (tax info) and a destination for funds. |
| One open payout at a time | yes | Prevents double-withdrawal. |
| Chapter price | 5–100 coins, free-after ≤ 60 days | Prevents price abuse; keeps content eventually accessible. |
| Free daily check-in | 5,5,10,10,15,15,30 coins on a 7-day streak | Retention loop funded from the platform's margin, **never** deducted from creators. |
| Mature content | Must be flagged 18+; readers need 18+ confirmation | Legal/safety. |
| New-account link block | 24 h | Anti-spam/scam. |
| Strike ladder | 1 warn · 2 → 10-min mute · 3 → 24-h mute · 5 → ban | Proportional, escalating, appealable. |
| Auto-hide | 3 distinct reporters hide a message/comment until review | Fast response without a mod online. |
| DMCA | Claim → admin takedown → creator notified → counter-notice restores | Safe-harbor style process; repeat infringers banned. |
| IP ownership | Creators keep ownership; InkVerse gets a hosting/display licence | Trust and legal clarity. |

---

## 4. Feature list

### 4.1 Reading experience
- Home with auto-sliding hero carousel (fade + slide), horizontal shelves, genre chips.
- Browse with type / genre / sort filters and search; **live search suggestions** (debounced, with cover thumbs).
- Series page: cover, stats, synopsis, follow/like/rate/tip/report, chapter list with lock/schedule badges, **top supporters**, related channels.
- **Comic reader**: vertical-scroll with lazy-loaded panels that fade up; **paged mode** with arrow keys and swipe; auto-hiding header; reading progress bar.
- **Novel reader**: serif typography, A−/A+, sepia theme, **auto-scroll** (S key, +/- speed), paragraph reveal animation.
- Resume-reading progress, library (following + continue).
- **Chapter reactions** (🔥 😂 😭 😮 ❤️) and **author notes**.
- Dark/light theme (respects OS), PWA (installable, offline shell, image cache).

### 4.2 Community & chat
- Anyone can **host a channel** (limit 5 each), attached to a series, with a topic tag.
- Real-time WebSocket chat with presence counter.
- **Spoiler tools**: `||inline spoiler||`, and "Spoilers ahead" channels blur every message until clicked.
- Host can mute a user; admins can mute/remove anywhere.
- Comments under every chapter, moderated the same way.

### 4.3 Creator tools
- Create series (comic/novel, genres, schedule plan, 18+ flag, cover upload or generated cover).
- Upload comic chapters (multi-image, natural-sort) or write/paste novel chapters; **bulk novel import** (`# Title` separators).
- Release modes: **publish now**, **weekly auto-slot**, **pick a date**; scheduler notifies followers when a chapter goes live.
- Early-access price + free-after window.
- **Analytics**: 30-day views and earnings charts, top chapters, top supporters, revenue mix.
- Earnings dashboard: available / pending (hold) / lifetime, payout request & history.

### 4.4 Monetization
- Coin wallet (demo checkout; Stripe-ready), chapter unlocks, tips, supporter leaderboard.
- Ledger of every coin movement.
- Creator earnings ledger with hold period and payout batches.

### 4.5 Engagement
- Daily check-in streak, achievement badges, personalised recommendations ("Because you like Fantasy"), new-chapter notifications, trending score (views + likes + follows).

### 4.6 Trust & safety
- Layered moderation (see §7), appeals, audit log, admin-editable word filter, DMCA workflow, mature-content gate, rate limiting.


### 4.7 v3 additions

**Plans.** *Free*: every free chapter, ad-supported (house ads between chapters), 25 saved highlights, early access via coins or by waiting. *Premium* ($7.99/month): no ads, unlimited highlights, 30 early-access unlocks a month. A Premium unlock still pays the creator (half the coin rate, funded by the subscription). Per series the creator picks **Free**, **Paid** or **Hybrid** (first N chapters free).

**Reading.** Scroll, *Paged* and *Manga* modes for comics; *Scroll* and *Book* view for novels. Pages turn with a CSS-3D leaf hinged at the spine (right edge for right-to-left). Manga mode reads right-to-left with double-page spreads on wide screens. Novels paginate with CSS columns and are measured after fonts load. Themes, font, size, spacing, animation and spread preferences are saved locally and synced to the account. Text-to-speech uses the browser's voices. Progress is saved per chapter (page for comics, percent for novels) with minutes-left estimates. Chapters can be saved for offline reading (Cache API, cleared on logout).

**Highlights.** A highlight is `(chapter, paragraph, start, end, text, colour, note)` for novels or `(chapter, page, x%, y%, w%, h%)` for comic panels. The server verifies the text against the chapter before saving and refuses overlaps, so highlights survive reloads and devices; if text ever shifts the client re-anchors by searching for the stored passage.

**Copyright check.** Every new cover, comic page and novel chapter is fingerprinted before it is published and compared with other creators' uploads and with an admin-managed protected-works registry. Images: SHA-256 and a 64-bit difference hash (Hamming distance ≤ 6; blank pages ignored). Text: sampled 5-word shingles, containment ratio. Outcomes: **block** (≥ 80 % of pages / text, or ≥ 50 % of a protected work), **hold for review** (any matching page, or ≥ 30 % text overlap) — hidden from readers until an admin approves — or **pass**. A signed ownership statement (hash + timestamp) can be downloaded per chapter. Limitation: it recognises material InkVerse has already seen; it cannot search the open web, so the DMCA workflow stays in place.

**Fairness.** Charts rank by reader activity, never by spend. New series get a 1.5× trending multiplier for 30 days and a spotlight shelf.

**Anti-piracy deterrents (paid chapters).** Copy / cut / right-click / drag blocked, print hidden, faint per-reader watermark. These raise the effort; they cannot stop screenshots.

---

## 5. Architecture

```
Browser (vanilla JS SPA, hash router, PWA)
   │  REST /api/*            WebSocket /ws
   ▼                         ▼
Express app ── auth (JWT, bcrypt) ── helmet CSP ── rate limits
   │             │
   │             └── moderation.js (filters, strikes, reports)   advanced.js (recs, analytics, appeals…)
   ▼
SQLite (better-sqlite3, WAL)   +   /uploads (images)   +   generated SVG art (/gen/*)
```

**Why these choices:** zero-config local setup (no DB server), transactional money operations (SQLite transactions guard unlock/tip/payout), and a swap path to Postgres/S3/Stripe described in the README.

### Data model (tables)
`users, series, chapters, unlocks, follows, likes, ratings, progress, comments, reactions, channels, channel_mutes, messages, reports, appeals, audit, blocked_words, transactions, earnings, payouts, dmca, notifications, view_log`

Money flow: **purchase** (user coins ↑) → **unlock/tip** (user coins ↓, `earnings` row for creator with `available_at = now + hold`) → **payout request** (sums available earnings, locks them with `payout_id`) → **admin approves** (status `paid`) or **rejects** (earnings released back).

---

## 6. Visual design system

| Token | Value |
|---|---|
| Brand green | `#00d564` (hover `#00b553`) |
| Accent pink / yellow | `#ff4d8d` / `#ffd23f` |
| Light / dark surfaces | `#f6f7f9`, `#fff` / `#0e1013`, `#181b21` |
| Display font | **Bangers** (logo, headings, numbers) |
| UI font | **Poppins** 400–800 |
| Reading font | **Merriweather** (novels) |
| Radius | 14 px cards, 999 px pills |
| Spacing | 4/8/12/16/24 scale, max width 1240 px |

### Motion spec
| Where | Animation |
|---|---|
| Page change | fade + rise (`pageIn`, 550 ms, ease-out-expo) |
| Nav | slides down on load; logo tilts on hover |
| Hero | slides cross-fade/translate 60 px, staggered text, dots stretch to a pill, 6 s autoplay |
| Cards & chapters | scroll-reveal with stagger (IntersectionObserver) |
| Cover hover | zoom 1.09 + gradient overlay |
| Comic panels | fade-up as they enter the viewport |
| Novel paragraphs | reveal one by one |
| Chat | messages pop in; presence dot pulses; spoilers un-blur |
| Money | coin burst particles on unlock/tip/purchase/check-in |
| Charts | stroke draw-in |
| Toasts, modals | slide-in / scale-pop |
| Accessibility | all animation disabled under `prefers-reduced-motion` |

### Responsive
Fluid grid, hamburger menu below 860 px, hero stacks vertically, 16 px side gutters on phones.

---

## 7. Moderation model

1. **Prevent** – clear rules shown in chat, terms acceptance at signup, 24-h link block for new accounts, rate limit (1 msg / 1.2 s), duplicate blocker, all-caps tamer.
2. **Detect** – profanity/slur filter tolerant of spacing tricks (`s h i t`), admin-editable list; masked output + automatic strike.
3. **Escalate** – strikes → mutes → ban; 3 distinct reports auto-hide content.
4. **Review** – admin queue with actions: dismiss / remove / remove + strike / remove + ban.
5. **Appeal** – users with strikes can appeal; admins accept (strike removed, mute lifted) or reject; user is notified either way.
6. **Account** – every admin action is written to an **audit log**.
7. **Legal** – DMCA form → admin takedown → creator notified → counter-notice restore.

*Limits:* the word list is a demo set; production needs a maintained multilingual list and ideally an ML classifier plus image moderation for uploads.

---

## 8. Security
bcrypt password hashing · JWT (14 d) · Helmet with strict CSP · API + auth rate limiting · parameterised SQL everywhere · output escaping in the client (`esc()`) · upload MIME/size allow-list · role checks on every privileged route · locked chapter content is never sent to unauthorised clients · money operations in DB transactions.

---

## 9. Success metrics (suggested)
Reader D7 retention · chapters read per session · % readers who unlock ≥1 chapter · ARPPU · creator 30-day activation (first chapter published) · median time-to-moderate a report · appeal reversal rate · payout dispute rate.
