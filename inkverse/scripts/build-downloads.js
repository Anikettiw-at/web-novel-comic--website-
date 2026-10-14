// Builds everything offered on the site's /#/downloads page:
//   public/downloads/InkVerse-Guide.pdf        how the platform works + details
//   public/downloads/InkVerse-Go-Live-Steps.pdf  what YOU must do to deploy and make it real
//   public/downloads/{README,design,tasks}.md, env.example.txt
//   public/downloads/inkverse.zip              whole project (no node_modules/data/uploads/.git)
// Run:  npm run build:downloads
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'downloads');
fs.mkdirSync(out, { recursive: true });
const { RULES } = require('../server/db'); // keeps PDF numbers in sync with the code
const money = c => '$' + (c / 100).toFixed(2);

for (const f of ['README.md', 'design.md', 'tasks.md', '.env.example']) fs.copyFileSync(path.join(root, f), path.join(out, f === '.env.example' ? 'env.example.txt' : f));

const GREEN = '#00a84f', INK = '#15181d', MUTED = '#5b6472';
const clean = s => String(s).replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/…/g, '...').replace(/[^\x20-\x7E -ÿ–—‘’“”]/g, '');

// ---------- tiny PDF toolkit ----------
function createPdf(file, { title, cover, sub, tagline, footer }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: title, Author: 'InkVerse' }, bufferPages: true });
  const stream = fs.createWriteStream(path.join(out, file)); doc.pipe(stream);
  const W = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ensure = h => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
  const api = {
    doc, W, ensure,
    h1(t) { ensure(70); doc.moveDown(0.8).font('Helvetica-Bold').fontSize(18).fillColor(INK).text(clean(t)); doc.rect(doc.page.margins.left, doc.y + 2, 44, 3).fill(GREEN); doc.moveDown(0.6); },
    h2(t) { ensure(40); doc.moveDown(0.4).font('Helvetica-Bold').fontSize(12).fillColor(GREEN).text(clean(t)); doc.moveDown(0.15); },
    p(t, o = {}) { ensure(30); doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(o.color || INK).text(clean(t), { lineGap: 2.5 }); doc.moveDown(0.4); },
    bullets(items) { items.forEach(t => { doc.font('Helvetica').fontSize(10); const w = W() - 16, h = doc.heightOfString(clean(t), { width: w, lineGap: 2 }); ensure(h + 4); const y = doc.y, x = doc.page.margins.left; doc.circle(x + 4, y + 5.5, 1.8).fill(GREEN); doc.fillColor(INK).text(clean(t), x + 16, y, { width: w, lineGap: 2 }); doc.x = x; doc.moveDown(0.25); }); },
    checks(items) { items.forEach(t => { doc.font('Helvetica').fontSize(10); const w = W() - 22, h = doc.heightOfString(clean(t), { width: w, lineGap: 2 }); ensure(h + 6); const y = doc.y, x = doc.page.margins.left; doc.roundedRect(x, y + 1, 10, 10, 2).lineWidth(1).strokeColor(GREEN).stroke(); doc.fillColor(INK).text(clean(t), x + 22, y, { width: w, lineGap: 2 }); doc.x = x; doc.moveDown(0.3); }); },
    code(t) { doc.font('Courier').fontSize(8.5); const w = W() - 16, h = doc.heightOfString(t, { width: w }) + 12; ensure(h + 4); const y = doc.y, x = doc.page.margins.left; doc.roundedRect(x, y, W(), h, 4).fill('#f1f3f5'); doc.fillColor('#1b2733').text(t, x + 8, y + 6, { width: w }); doc.x = x; doc.y = y + h + 6; },
    step(n, t, time) { ensure(90); doc.moveDown(0.7); const y = doc.y, x = doc.page.margins.left; doc.roundedRect(x, y, W(), 28, 6).fill('#0e1013'); doc.fillColor('#00d564').font('Helvetica-Bold').fontSize(11).text('STEP ' + n, x + 12, y + 9, { continued: true }).fillColor('#ffffff').text('   ' + clean(t)); if (time) doc.fillColor('#9aa3b2').font('Helvetica').fontSize(9).text(clean(time), x, y + 10, { width: W() - 12, align: 'right' }); doc.x = x; doc.y = y + 38; },
    table(head, rows, widths) {
      const total = widths.reduce((a, b) => a + b, 0), x0 = doc.page.margins.left, ws = widths.map(w => w * W() / total);
      const draw = (cells, bold, fill) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9); const h = Math.max(...cells.map((c, i) => doc.heightOfString(clean(c), { width: ws[i] - 10 }))) + 10; ensure(h); const y = doc.y; if (fill) doc.rect(x0, y, W(), h).fill(fill); let x = x0; cells.forEach((c, i) => { doc.fillColor(bold ? '#ffffff' : INK).text(clean(c), x + 5, y + 5, { width: ws[i] - 10 }); x += ws[i]; }); doc.moveTo(x0, y + h).lineTo(x0 + W(), y + h).strokeColor('#dfe3e8').lineWidth(0.5).stroke(); doc.y = y + h; doc.x = x0; };
      draw(head, true, '#15181d'); rows.forEach((r, i) => draw(r, false, i % 2 ? '#f6f7f9' : null)); doc.moveDown(0.6);
    },
    callout(t, color = '#fff6d6') { doc.font('Helvetica').fontSize(9.5); const w = W() - 20, h = doc.heightOfString(clean(t), { width: w, lineGap: 2 }) + 16; ensure(h + 6); const y = doc.y, x = doc.page.margins.left; doc.roundedRect(x, y, W(), h, 6).fill(color); doc.fillColor(INK).text(clean(t), x + 10, y + 8, { width: w, lineGap: 2 }); doc.x = x; doc.y = y + h + 8; },
    finish() {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) { doc.switchToPage(i); if (i === 0) continue; doc.page.margins.bottom = 0; doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`${footer}  |  Page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 36, { width: W(), align: 'center', lineBreak: false }); }
      doc.end(); return new Promise(r => stream.on('finish', r));
    },
  };
  doc.rect(0, 0, doc.page.width, 300).fill('#0e1013');
  doc.fillColor('#00d564').font('Helvetica-Bold').fontSize(54).text('INK', 56, 100, { continued: true }).fillColor('#ffffff').text('VERSE');
  doc.fillColor('#c9ced6').font('Helvetica').fontSize(16).text('Read. Create. Get paid.', 56, 170);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(cover, 56, 215);
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(tagline, 56, 330).text(sub + ' - ' + new Date().toISOString().slice(0, 10), 56, 346);
  doc.y = 400; doc.x = 56;
  return api;
}

// =====================================================================================
// PDF 1: Working guide & details
// =====================================================================================
function buildGuide() {
  const P = createPdf('InkVerse-Guide.pdf', { title: 'InkVerse - Working Guide & Details', cover: 'Working Guide & Platform Details', tagline: 'Comics and web novels with moderated chat channels and creator payouts', sub: 'Version 1.1', footer: 'InkVerse - Working Guide' });
  const { h1, h2, p, bullets, table } = P;
  h1('1. What is InkVerse?');
  p('InkVerse is a full-stack web platform where creators publish comics (image pages) and web novels (text chapters) and get paid by their readers, while readers browse, read, discuss and support the work they love. It has two public account types - Reader and Creator - plus an Admin/Moderator role used by the platform team.');
  p('The design goal is a marketplace where everybody profits: readers get a free-to-read catalogue with optional early access, creators keep the majority of revenue and own their work, and the platform earns a sustainable share that funds hosting, moderation and payments.');
  h1('2. Who can do what');
  table(['Role', 'Capabilities'], [
    ['Reader', 'Register and log in, browse and search, read free and unlocked chapters, comment, react, rate, like, follow series, track reading progress, host and join chat channels, buy coins, tip creators, report content, appeal strikes, collect badges and daily check-in coins, reset a forgotten password by email. A reader can upgrade to Creator in one click.'],
    ['Creator', 'Everything a reader can do, plus: create series (comic or novel), upload chapters, bulk-import novel chapters, schedule releases, set early-access prices, add author notes, see analytics, set payout details and request payouts.'],
    ['Admin / Moderator', 'Review the report queue, remove content, issue strikes, ban or unban users, handle copyright (DMCA) claims, approve or reject payouts, review appeals, manage the blocked-word list and read the audit log.'],
  ], [1.2, 5]);
  h1('3. How it works - step by step');
  h2('Reader journey');
  bullets(['Open the site, browse trending / new / top-rated shelves or search (suggestions appear while typing).', 'Open a series: see synopsis, rating, chapters (free, premium or scheduled), top supporters and discussion channels.', 'Read: comics scroll vertically (or switch to paged mode with arrow keys / swipe); novels have font size, sepia theme and auto-scroll.', 'Premium chapters show a lock with a coin price and a "becomes free on" date. Readers either wait for the free date or unlock instantly with coins.', 'React with an emoji, leave a comment (use ||text|| to hide spoilers), rate, like and follow. Followers are notified when new chapters go live.', 'Join or host a chat channel for a series. Pick a topic tag (general, spoilers, theories, fan-art, recs).']);
  h2('Creator journey');
  bullets(['Register as Creator (or upgrade from Reader) and open Studio.', 'Create a series: choose comic or novel, genres (up to 4), release plan (weekly or batch), 18+ flag, optional cover.', 'Add chapters: upload comic pages in reading order, or write / paste novel text. Optionally bulk-import many novel chapters using "# Title" separators.', 'Choose a release mode: publish now, weekly (auto-scheduled into the next free 7-day slot) or a specific date. Set an early-access price (5-100 coins) and the number of days after which the chapter becomes free.', 'Watch the analytics dashboard (views, earnings, top chapters, top supporters, revenue mix).', 'Set payout email and accept the payout/tax terms, then request a payout once the available balance reaches the minimum.']);
  h2('Admin journey');
  bullets(['Open Admin: the overview shows users, series, open reports, pending payouts, coin sales and creator earnings accrued.', 'Reports tab: dismiss, remove, remove + strike, or remove + ban. Payouts tab: mark paid or reject. Copyright tab: take down or restore. Appeals tab: accept or reject. Word filter tab: add or remove blocked words. Audit log: every admin action is recorded. Users tab: search, mute, ban, unban.']);
  h1('4. Money: how everyone profits');
  p('Readers buy coins in packs through Stripe Checkout. Coins are spent on early-access chapters and tips. The creator share is calculated on the net value of the coins (after payment fees and taxes), so the platform never pays out money it did not keep.');
  table(['Rule', 'Value'], [
    ['Coin packs', RULES.coinPacks.map(k => `${k.coins} coins for ${money(k.cents)}`).join('; ')],
    ['Net value of 1 coin', RULES.coinValueCents + ' cent (after processor fees and taxes)'],
    ['Creator share - chapter unlocks', Math.round(RULES.creatorShareUnlock * 100) + '% of net coin value (platform keeps ' + Math.round((1 - RULES.creatorShareUnlock) * 100) + '%)'],
    ['Creator share - tips', Math.round(RULES.creatorShareTip * 100) + '% (platform keeps ' + Math.round((1 - RULES.creatorShareTip) * 100) + '%)'],
    ['Earnings hold', RULES.holdDays + ' days (covers refunds and chargebacks)'],
    ['Minimum payout', money(RULES.minPayoutCents)],
    ['Payout prerequisites', 'Payout email + accepted payout/tax terms; one open payout request at a time'],
    ['Chapter price limits', RULES.minCoinsPerChapter + '-' + RULES.maxCoinsPerChapter + ' coins; free-after window up to ' + RULES.maxFreeAfterDays + ' days'],
    ['Daily check-in', RULES.checkinRewards.join(', ') + ' coins over a 7-day streak, funded from the platform margin'],
  ], [2, 4]);
  p('Flow: Stripe payment succeeds -> signed webhook credits the coins once -> reader unlocks or tips -> a creator earning is recorded with an availability date -> after the hold it is "available" -> creator requests a payout -> admin pays it (PayPal / bank / Wise) and clicks "Mark paid" (or rejects, releasing the earnings). All money movements run inside database transactions.');
  h1('5. Community and chat');
  bullets(['Any user can host up to 5 channels. A channel can be attached to a series and carries a topic tag.', 'Chat is real time over WebSocket with an online counter.', 'Spoiler tools: wrap text in ||double bars|| to hide it until clicked; "Spoilers ahead" channels blur every message until the reader clicks it.', 'The channel host can mute a disruptive member; admins can act anywhere.', 'Comments below each chapter follow the same moderation rules.']);
  h1('6. Moderation system');
  table(['Layer', 'What it does'], [
    ['Prevent', 'Rules shown in chat, terms accepted at sign-up, links blocked for accounts younger than 24 hours, rate limit (about 1 message per second), duplicate-message blocker, shouting (all caps) is lowercased.'],
    ['Detect', 'Profanity and slur filter that also catches spacing tricks; admins can add their own words. Matches are masked and the author receives a strike automatically.'],
    ['Escalate', 'Strike 1 warning; strike 2 a 10-minute mute; strike 3 a 24-hour mute; strike 5 account ban. Three different users reporting the same message or comment hides it automatically until a moderator reviews it.'],
    ['Review', 'Admin queue with dismiss / remove / remove + strike / remove + ban.'],
    ['Appeal', 'Users with strikes can appeal. Accepted appeals remove one strike and lift the mute; the user is notified either way.'],
    ['Accountability', 'Every admin action is stored in an audit log.'],
    ['Copyright', 'Public DMCA form -> admin takedown (creator is notified) -> optional restore after a counter-notice. Mature series must be flagged 18+ and are gated for readers.'],
  ], [1.2, 5]);
  p('Limits: the built-in word list is only a demo set. A serious launch needs a maintained multilingual list, ideally a machine-learning toxicity classifier, and image moderation for uploaded art.');
  h1('7. Advanced features');
  bullets(['Personalised recommendations ("Because you like Fantasy") from likes, follows, reading history and ratings.', 'Live search suggestions with cover thumbnails.', 'Creator analytics: 30-day views and earnings charts, top chapters, top supporters and revenue mix.', 'Top-supporters leaderboard on every series page; chapter reactions; author notes.', 'Daily check-in streak and achievement badges.', 'Comic paged mode with keyboard and swipe navigation; novel auto-scroll.', 'Scheduled releases with automatic follower notifications.', 'Installable Progressive Web App with offline shell and image caching; dark and light themes.', 'Appeals workflow, audit log and admin-editable word filter.', 'Real card payments (Stripe Checkout + signed webhook), password-reset emails, automatic daily database backups.']);
  h1('7b. Version 3: tiers, reading modes, highlights, copyright');
  bullets(['Free tier (ads, 25 highlights) and Premium (no ads, unlimited highlights, 30 early-access unlocks a month). Creators pick Free, Paid or Hybrid (first N chapters free) per series.',
    'Animated page turning (3D leaf) for comics and for the novel Book view; Manga mode reads right-to-left with double-page spreads. Reduced-motion users get instant turns.',
    'Highlights persist on the account: select text in novels (4 colours + notes) or drag a box over a comic panel. My highlights page lists them all.',
    'Copyright check on every new upload: image hash + perceptual hash + text fingerprint vs other creators and an admin registry of protected works. Blocks copies, holds partial matches for admin review, and issues signed ownership proofs. It cannot search the open web - keep the DMCA process.',
    'Creator studio: drafts, chapter manager, retention and free-to-paid conversion table, comment pin/delete, polls, tags and content warnings. Charts rank by reader activity only; new series get a 30-day boost.',
    'Accounts: email verification, password change, sign out everywhere, data export, account deletion.']);
  h1('8. Design and animation');
  p('Visual style is a clean Webtoon-inspired layout: bold display headings (Bangers), friendly UI text (Poppins), serif novel text (Merriweather), one signature green with pink and yellow accents, rounded cards and pill buttons. (No reference image was received with the brief, so these tokens can be swapped easily once it is available.)');
  bullets(['Page transitions: fade and rise. Hero banner: slide and fade with staggered text and animated dots.', 'Cards, chapters and comic panels reveal as they scroll into view; novel paragraphs appear one by one.', 'Hover zoom on covers, logo tilt, chat messages pop in, spoilers un-blur, coin-burst particles on purchases, tips and unlocks, charts draw themselves.', 'All motion is disabled automatically for users who prefer reduced motion. The layout is responsive down to phone width.']);
  h1('9. Technology and architecture');
  table(['Part', 'Technology'], [
    ['Server', 'Node.js 18+, Express, REST API under /api'],
    ['Realtime chat', 'WebSocket (ws) at /ws'],
    ['Database', 'SQLite via better-sqlite3 (WAL mode, transactions, daily backups)'],
    ['Auth', 'bcrypt password hashes, JWT tokens (14 days), role checks on every protected route, email password reset'],
    ['Payments', 'Stripe Checkout (REST) + HMAC-verified webhook, idempotent credit, amount and currency check'],
    ['Front end', 'Vanilla JavaScript single-page app with hash routing - no build step; PWA manifest + service worker'],
    ['Files', 'Uploads on disk (multer, image-only, 8 MB each); generated SVG covers and demo pages'],
    ['Security', 'Helmet with strict Content-Security-Policy, rate limits, parameterised SQL, escaped output, upload allow-list'],
    ['Tests', 'npm test runs 48 end-to-end checks on a temporary database'],
  ], [1.2, 5]);
  p('See the separate "InkVerse Go-Live Steps" PDF for deployment, Stripe, email, domain, legal and operations. README.md has the full environment-variable reference.');
  return P.finish();
}

// =====================================================================================
// PDF 2: Go-live steps (what the owner must do)
// =====================================================================================
function buildGoLive() {
  const P = createPdf('InkVerse-Go-Live-Steps.pdf', { title: 'InkVerse - Go-Live Steps', cover: 'Go-Live Steps: Deploy & Make It Real', tagline: 'Everything you personally need to do, in order, with exact values to copy', sub: 'Owner checklist', footer: 'InkVerse - Go-Live Steps' });
  const { h1, h2, p, bullets, checks, table, step, code, callout } = P;
  h1('Read this first');
  p('The code is finished, tested (48 automated checks) and already pushed to your GitHub repository. What remains can only be done by you, because it needs your personal accounts, passwords, bank details and legal identity. This guide lists those steps in order. Total time: about 2-3 hours, plus waiting for Stripe account approval.');
  table(['Already done in code', 'Only you can do'], [
    ['Full website, API, real-time chat, moderation, admin console', 'Create the Render, Stripe, email and domain accounts'],
    ['Stripe Checkout + signed webhook (coins credited once, amount-checked)', 'Paste your secret keys into Render (never into the code or GitHub)'],
    ['Password-reset emails (needs an SMTP login)', 'Verify your business/bank with Stripe'],
    ['Daily automatic database backups, health check, security headers', 'Pay creators (PayPal/bank) and click "Mark paid"'],
    ['Render Blueprint (render.yaml), Dockerfile, Terms + Privacy templates', 'Legal review, DMCA agent registration, taxes'],
  ], [1, 1]);
  callout('Costs (verify on each provider\'s pricing page): Render Starter web service about $7/month plus a small monthly charge for the 1 GB persistent disk. Stripe takes a fee per payment (commonly 2.9% + 30 cents in the US). Domain about $10-15/year. An SMTP email provider is usually free at low volume. The free Render plan will NOT work: it erases the database on every restart.');
  callout('Business note: because Stripe\'s fixed 30-cent fee is large on tiny payments, the smallest coin pack is $1.99 (200 coins), not $0.99. With the current prices every pack leaves the platform a positive margin after Stripe fees even when creators receive their full 70% share. Free daily check-in coins are paid for by YOU: when a reader spends them on a chapter, the creator still earns their share. Watch this cost.', '#e6f7ee');

  step(1, 'Create the accounts you need', '10 min');
  checks(['GitHub - you already have it. Repository: github.com/Anikettiw-at/web-novel-comic--website-', 'Render - sign up at render.com using "Continue with GitHub".', 'Stripe - sign up at stripe.com (you can stay in Test mode until Step 5).', 'An email provider with SMTP - for example Brevo, Resend, Mailgun or SendGrid (free tiers exist). A Gmail address with an App Password also works for very small volume.', 'Optional but recommended: a domain name from a registrar such as Namecheap, Cloudflare or GoDaddy.']);

  step(2, 'Deploy on Render using the Blueprint', '15 min');
  checks(['In Render click New + -> Blueprint.', 'Choose the repository web-novel-comic--website-. Render finds render.yaml automatically and shows one service named "inkverse".', 'When asked for ADMIN_EMAIL type YOUR real email. For ADMIN_PASSWORD type a long unique password (20+ characters) and store it in a password manager.', 'Click Apply / Deploy Blueprint. Wait 3-6 minutes until the service shows "Live".', 'Open the URL Render shows (looks like https://inkverse-xxxx.onrender.com). Click "Log in", use your ADMIN_EMAIL (or username "admin") and the password you chose.', 'You should see the home page (empty catalogue: demo content is intentionally off) and an Admin item in the menu.']);
  callout('If Render says the disk needs a paid plan, choose the Starter instance type. If the build fails, open the Logs tab and compare with the Troubleshooting table at the end.');

  step(3, 'Tell the app its public address', '3 min');
  checks(['In Render open your service -> Environment -> Add Environment Variable.', 'Key PUBLIC_URL, value = your live address WITHOUT a trailing slash, e.g. https://inkverse-xxxx.onrender.com (use your custom domain later in Step 7).', 'Save. Render restarts the service automatically (about 1 minute).']);

  step(4, 'Turn on real email (password reset)', '15 min');
  p('In your email provider find "SMTP settings" and copy the values. Then add these variables in Render -> Environment:');
  table(['Variable', 'Example value'], [['SMTP_HOST', 'smtp-relay.brevo.com  (use your provider\'s host)'], ['SMTP_PORT', '587'], ['SMTP_USER', 'the SMTP login your provider shows'], ['SMTP_PASS', 'the SMTP password / key your provider shows'], ['MAIL_FROM', 'InkVerse <no-reply@yourdomain.com>']], [1, 2.4]);
  checks(['Verify the sender address (or domain) inside the email provider - they will tell you exactly which DNS records (SPF/DKIM) to add.', 'Test: log out, click "Forgot your password?", enter an account email, and confirm the email arrives and the link works.']);

  step(5, 'Turn on real payments with Stripe', '30 min + approval time');
  h2('5a. API key');
  checks(['In the Stripe Dashboard stay in Test mode (toggle at top right). Go to Developers -> API keys.', 'Copy the Secret key (starts with sk_test_). In Render -> Environment add STRIPE_SECRET_KEY = that key. Never share it or put it in GitHub.']);
  h2('5b. Webhook (this is what actually credits the coins)');
  checks(['Stripe Dashboard -> Developers -> Webhooks -> Add endpoint.', 'Endpoint URL: https://YOUR-ADDRESS/api/stripe/webhook (same address as PUBLIC_URL).', 'Select events: checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid and customer.subscription.deleted (the last two keep Premium subscriptions in sync). Save.', 'Open the new endpoint and click "Reveal" on Signing secret (starts with whsec_). In Render add STRIPE_WEBHOOK_SECRET = that value.']);
  h2('5c. Test it');
  checks(['Log in as a normal reader (register a new account on the site). Open Wallet and click a coin pack - you are sent to Stripe Checkout.', 'Pay with the test card 4242 4242 4242 4242, any future expiry date, any 3-digit CVC, any ZIP.', 'You return to the Wallet and the coins appear within seconds. In Stripe -> Webhooks the delivery should show status 200.', 'If coins do not appear: the signing secret is wrong or PUBLIC_URL/endpoint URL does not match - check Render logs for "Bad signature".']);
  h2('5d. Go live with real money');
  checks(['Complete Stripe account activation: business details, identity, and the bank account where money will be paid out.', 'Switch the dashboard to Live mode. Repeat 5a and 5b in Live mode (new sk_live_ key, a NEW live webhook endpoint with its own whsec_ secret).', 'Replace STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Render with the live values. Do one real purchase of the cheapest pack yourself and refund it from Stripe if you like.']);

  step(6, 'First-day admin setup', '20 min');
  checks(['Log in as admin. Open Admin -> Word filter and add any extra words you want blocked.', 'Register a second account as a Creator (use a different email) and publish a first series and chapter to check the whole flow. Set a price on one chapter, then unlock it from a reader account.', 'Open the Terms and Privacy pages and read them. Replace the contact details and company name by editing public/js/app.js (search for "Terms & Community Guidelines" and "Privacy Policy") and push to GitHub - Render redeploys automatically.', 'Add moderators: have them register normally, then Admin -> Users -> search their username -> "Make moderator". Remove access the same way with "Remove moderator". Moderators have full admin powers (including payouts), so only promote people you trust.']);

  step(7, 'Custom domain and HTTPS', '20 min + DNS wait');
  checks(['Render -> your service -> Settings -> Custom Domains -> Add Custom Domain, enter yourdomain.com (and www.yourdomain.com).', 'At your domain registrar add the DNS records Render shows (usually a CNAME for www and an A/ALIAS record for the root). Delete conflicting old records.', 'Wait for Render to show "Verified" and issue the free HTTPS certificate (minutes to a few hours).', 'Update PUBLIC_URL in Render to https://yourdomain.com and update the Stripe webhook endpoint URL (both modes) to https://yourdomain.com/api/stripe/webhook.']);

  step(8, 'How to pay your creators (monthly routine)', '15 min per cycle');
  p('Creators earn money automatically, but the actual transfer is done by you (this keeps the system simple and safe; automatic payouts through Stripe Connect are listed as a future upgrade).');
  checks(['Creators add a payout email (PayPal address is simplest) and accept the terms in Studio. They request a payout once available earnings reach $50.', 'Admin -> Payouts shows each request with the amount and payout email.', 'Send the money yourself (PayPal, Wise, bank transfer) for exactly that amount. Keep the receipt.', 'Click "Mark paid" (or "Reject" with a note to the creator). Their balance and a notification update automatically.', 'Each month export or note your totals: coin sales (Stripe), creator payouts, Stripe fees, hosting costs. The Admin overview shows coin sales and creator earnings accrued.']);
  callout('Taxes: if you pay creators, many countries require collecting tax forms (in the US, W-9 for US creators and W-8BEN for foreign ones) and possibly issuing year-end reports. Digital goods can also trigger sales tax or VAT. Talk to an accountant before your first payout; Stripe Tax can help with sales tax/VAT.');

  step(9, 'Legal checklist', '1-2 hours + lawyer time');
  checks(['Have a lawyer review the Terms, Privacy Policy and creator payout terms for your country/state. The pages in the app are templates only.', 'Copyright (DMCA): if you serve US users, register a designated DMCA agent with the US Copyright Office (online form, small fee - check the current fee) and put the agent contact on the Copyright page.', 'Children: decide your minimum age. The app asks users to confirm 18+ for mature series; if children can register you may have extra duties (e.g. COPPA in the US, age-appropriate design rules elsewhere).', 'EU/UK users: GDPR applies - add a privacy contact email, a way to export/delete data on request, and list your processors (Render, Stripe, email provider).', 'Child-safety: report any child sexual abuse material immediately to the proper authority (in the US, NCMEC CyberTipline) and remove it. Add image moderation before opening uploads widely.']);

  step(10, 'Backups and monitoring', '15 min');
  checks(['The app writes a database backup to /var/data/backups every day and keeps 7 (change with BACKUP_KEEP). This is on the same disk, so it protects against mistakes, not disk loss.', 'In Render open the Disk settings and confirm snapshots are enabled; check Render\'s current documentation for snapshot retention.', 'Once a week download a copy off-server: Render -> service -> Shell, or ask the developer to add automatic upload to S3/Backblaze (listed in tasks.md).', 'Free uptime monitor: create an UptimeRobot (or similar) HTTP monitor on https://yourdomain.com/api/config with email alerts.', 'Turn on Stripe email alerts for failed webhooks (Developers -> Webhooks).']);

  step(11, 'Pre-launch test script', '30 min');
  table(['Test', 'Expected result'], [
    ['Register a reader on your phone', 'Account created, can browse and read'],
    ['Forgot password', 'Email arrives, new password works'],
    ['Buy the cheapest pack with a test card', 'Coins appear, Stripe webhook shows 200'],
    ['Unlock a premium chapter', 'Coins drop, chapter opens; creator Studio shows pending earnings'],
    ['Open a chat channel on two devices', 'Messages appear instantly on both; online counter is 2'],
    ['Type a blocked word', 'Message is masked, strike notification arrives'],
    ['Report a message 3 times from 3 accounts', 'Message hides and appears in Admin -> Reports'],
    ['Creator requests payout (needs $50 available; temporarily set HOLD_DAYS=0 to test)', 'Appears in Admin -> Payouts; "Mark paid" notifies the creator'],
    ['Restart the Render service', 'Data and uploaded images are still there (proves the disk works)'],
  ], [3, 3]);

  step(12, 'Launch and grow', 'ongoing');
  bullets(['Invite 5-10 creators before inviting readers: a catalogue needs content. Offer launch-month perks such as featured placement.', 'Appoint community moderators early and review the report queue daily; reply to appeals within a few days.', 'Watch these numbers weekly: new readers, chapters read per reader, % readers who buy coins, creators publishing weekly, report-to-resolution time, payout disputes.', 'When traffic grows: move SQLite to PostgreSQL, chat to Redis, images to object storage + CDN (see tasks.md).']);

  h1('Environment variables - complete list');
  table(['Variable', 'Required?', 'Value / where to get it'], [
    ['DATA_DIR', 'set by blueprint', '/var/data (the persistent disk)'],
    ['UPLOAD_DIR', 'set by blueprint', '/var/data/uploads'],
    ['SEED_DEMO', 'set by blueprint', 'false = no demo users or content'],
    ['DEMO_PAYMENTS', 'set by blueprint', 'false = no free demo coins'],
    ['JWT_SECRET', 'auto-generated', 'Render creates it; do not change after launch (logs everyone out)'],
    ['ADMIN_EMAIL, ADMIN_PASSWORD', 'you type at deploy', 'Your real admin login. ADMIN_USERNAME optional (default admin).'],
    ['PUBLIC_URL', 'you add (Step 3)', 'https://yourdomain.com, no trailing slash'],
    ['STRIPE_SECRET_KEY', 'you add (Step 5)', 'Stripe -> Developers -> API keys (sk_test_ then sk_live_)'],
    ['STRIPE_WEBHOOK_SECRET', 'you add (Step 5)', 'Stripe -> Developers -> Webhooks -> signing secret (whsec_)'],
    ['SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM', 'you add (Step 4)', 'From your email provider\'s SMTP page'],
    ['HOLD_DAYS', 'optional', 'Default 14 - days before creator earnings can be withdrawn'],
    ['BACKUP_KEEP', 'optional', 'Default 7 - daily backups kept'],
  ], [2.2, 1.4, 3.4]);

  h1('Troubleshooting');
  table(['Problem', 'Fix'], [
    ['Build fails on Render', 'Open Logs. Make sure NODE_VERSION=22.12.0 is present and the service root directory is "inkverse".'],
    ['Site works but chat says "offline"', 'WebSockets need a normal web service (not static). Check the service type is Web Service and the URL uses https.'],
    ['Everyone is logged out after each deploy', 'JWT_SECRET changed or the disk is not mounted. Confirm DATA_DIR=/var/data and the disk exists.'],
    ['Uploaded images disappear', 'UPLOAD_DIR must be /var/data/uploads (on the disk).'],
    ['Pay button says purchases are not enabled', 'STRIPE_SECRET_KEY is missing, or DEMO_PAYMENTS=false with no Stripe key.'],
    ['Paid but no coins', 'Stripe -> Webhooks -> check delivery errors. 400 = wrong signing secret; 503 = secret not set. Fix the variable, then use "Resend" on the event (safe: coins credit only once).'],
    ['No reset email', 'Check SMTP variables and the Render logs for "mail error". Verify the sender in your email provider; check spam.'],
    ['Cannot log in as admin', 'Admin is created at boot from ADMIN_EMAIL/ADMIN_PASSWORD only if no such user exists. Login with the email or username "admin".'],
    ['Service sleeps / slow first load', 'Only on free plans. Use Starter or higher.'],
  ], [2, 4.4]);
  p('Keep your passwords and secret keys in a password manager. Never paste them into chat, email, or GitHub. If a key is ever exposed, roll it immediately in the provider dashboard and update Render.', { bold: true });
  return P.finish();
}

// ---------- build both PDFs, then the zip ----------
Promise.all([buildGuide(), buildGoLive()]).then(() => {
  const zipPath = path.join(out, 'inkverse.zip'); const output = fs.createWriteStream(zipPath); const zip = archiver('zip', { zlib: { level: 9 } });
  output.on('close', () => console.log(`Built downloads in public/downloads (zip ${(zip.pointer() / 1024).toFixed(0)} KB)`));
  zip.pipe(output);
  zip.glob('**/*', { cwd: root, dot: true, ignore: ['node_modules/**', 'data/**', 'uploads/**', '.git/**', '.env', 'public/downloads/*.zip', 'inkverse.zip', 'tmp/**'] }, { prefix: 'inkverse' });
  zip.append(fs.readFileSync(path.join(root, '..', 'render.yaml')), { name: 'render.yaml' }); // blueprint lives at repo root
  zip.finalize();
});
