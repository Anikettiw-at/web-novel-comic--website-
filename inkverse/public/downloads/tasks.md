# InkVerse — Tasks

`[x]` = implemented and covered by the smoke test or verified in the browser · `[ ]` = recommended next step for production.
Run the automated checks with `npm test`.

## Phase 0 — Research & planning
- [x] Research Webtoon / Tapas / Royal Road monetisation, community and moderation models
- [x] Write `design.md` (features, business rules, architecture, design system)
- [x] Write `tasks.md`
- [x] Define business rules in one config object (`RULES`)

## Phase 1 — Foundation
- [x] Node/Express project, SQLite schema (23 tables), WAL mode, foreign keys
- [x] Auth: register / login, bcrypt, JWT, role model (reader · creator · admin)
- [x] Terms acceptance at signup, 18+ confirmation
- [x] Security headers + CSP, rate limiting, input cleaning
- [x] Demo seed data (users, 6 series, chapters, channels, 30 days of traffic)

## Phase 2 — Content
- [x] Series CRUD (comic / novel, genres, status, schedule plan, mature flag)
- [x] Cover upload or generated SVG cover
- [x] Comic chapter upload (multi-image, natural sort)
- [x] Novel chapter editor
- [x] Bulk novel import (`# Title` separators)
- [x] Release modes: now · weekly auto-slot · date picker
- [x] Scheduler: notify followers when a scheduled chapter goes live
- [x] Hidden-until-released chapters for the public, visible to owner
- [x] Author notes per chapter

## Phase 3 — Reading experience
- [x] Home: hero carousel, shelves, genre chips, continue reading
- [x] Browse: type / genre / sort / search
- [x] Live search suggestions
- [x] Series page: stats, follow, like, rate, tip, report
- [x] Comic reader (vertical scroll, lazy panels, paged mode, swipe, keyboard)
- [x] Novel reader (font size, sepia, auto-scroll)
- [x] Reading progress + library
- [x] Chapter comments with spoiler markup
- [x] Chapter reactions
- [x] Dark / light theme, PWA manifest + service worker
- [ ] Offline download of chapters for subscribers
- [ ] Localisation (i18n) and RTL support
- [ ] Reading-time estimates, bookmarks inside chapters

## Phase 4 — Community & chat
- [x] Create / list channels with topic tags (general, spoilers, theories, fan-art, recs)
- [x] Real-time chat over WebSocket with presence count
- [x] Spoiler tools: `||inline||` and blurred spoiler channels
- [x] Host mute, admin mute
- [x] Per-user limit of 5 channels
- [ ] Message edit / delete by author, replies and threads
- [ ] Image/GIF sharing in chat (with image moderation)
- [ ] Redis pub/sub so chat scales across several servers

## Phase 5 — Moderation & safety
- [x] Profanity / slur filter tolerant of spacing tricks
- [x] Rate limit, duplicate blocker, all-caps tamer, 24 h new-account link block
- [x] Strike ladder (warn → mute → long mute → ban)
- [x] Report button on messages, comments, series
- [x] Auto-hide at 3 distinct reporters
- [x] Admin queue (dismiss / remove / strike / ban)
- [x] Appeals workflow
- [x] Audit log of admin actions
- [x] Admin-editable blocked words (live reload)
- [x] DMCA claim → takedown → counter-notice restore
- [x] Mature-content gate
- [ ] ML toxicity classifier and multilingual word lists
- [ ] Image moderation for uploads (NSFW / CSAM hash matching)
- [ ] Shadow-ban and per-channel moderators
- [ ] Email notification of removals

## Phase 6 — Monetisation & payouts
- [x] Coin packs, wallet ledger (demo checkout)
- [x] Early-access chapters with price and free-after window
- [x] Unlock transaction (atomic) with 70 % creator share on net coin value
- [x] Tips with 90 % creator share
- [x] Earnings ledger with 14-day hold
- [x] Payout request (minimum $50, payout email + tax confirmation, one open request)
- [x] Admin payout approve / reject (reject releases earnings)
- [x] Top-supporters leaderboard
- [x] **Stripe Checkout + signed webhook** for real coin purchases (idempotent, amount-checked; needs your Stripe keys)
- [ ] **Stripe Connect / PayPal Payouts** for automatic transfers (today: admin pays manually, then clicks "Mark paid")
- [ ] Tax forms (W-9 / W-8BEN), VAT handling
- [ ] Refund and chargeback handling (reverse earnings during hold)
- [ ] Ad revenue sharing and creator subscriptions / memberships

## Phase 7 — Engagement
- [x] Daily check-in streak (7-day ladder)
- [x] Achievement badges
- [x] Personalised recommendations (genre affinity)
- [x] New-chapter notifications + bell
- [x] Password-reset emails (SMTP)
- [ ] Email / web-push notifications for new chapters
- [ ] Creator following feed and activity timeline
- [ ] Seasonal events, creator contests

## Phase 8 — Creator analytics
- [x] 30-day views and earnings charts
- [x] Top chapters, top supporters, revenue mix
- [x] Per-series earnings
- [ ] Retention funnel per chapter (drop-off point)
- [ ] Export CSV of earnings

## Phase 9 — Quality & operations
- [x] End-to-end API smoke test (`npm test`, 48 checks)
- [x] Browser verification of every page
- [x] README, `design.md`, `tasks.md`, PDF guide
- [ ] Unit tests, CI pipeline, load test of chat
- [x] Automatic daily database backups (kept 7 days on the data disk)
- [x] Render Blueprint (`render.yaml`), Dockerfile, go-live PDF
- [x] Privacy Policy template page
- [ ] Off-server backup copies (S3 / Backblaze)
- [ ] Migrate SQLite → Postgres, uploads → S3/R2 + CDN, image resizing
- [ ] Monitoring (error tracking, uptime), backups
- [ ] Accessibility audit against WCAG 2.1 AA
- [ ] Legal review of Terms, Privacy Policy, DMCA agent registration
