// Builds everything offered on the site's /#/downloads page:
//   public/downloads/InkVerse-Guide.pdf   (how it works + details)
//   public/downloads/{README,design,tasks}.md
//   public/downloads/inkverse.zip         (whole project, without node_modules/data/uploads/.git)
// Run:  npm run build:downloads
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'downloads');
fs.mkdirSync(out, { recursive: true });
const { RULES } = require('../server/db'); // keeps the PDF numbers in sync with the code
const money = c => '$' + (c / 100).toFixed(2);

// ---------- copy docs ----------
for (const f of ['README.md', 'design.md', 'tasks.md', '.env.example']) fs.copyFileSync(path.join(root, f), path.join(out, f === '.env.example' ? 'env.example.txt' : f));

// ---------- PDF ----------
const GREEN = '#00a84f', INK = '#15181d', MUTED = '#5b6472';
const clean = s => String(s).replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[^\x20-\x7E -ÿ–—‘’“”•]/g, '');
const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: 'InkVerse - Working Guide & Details', Author: 'InkVerse' }, bufferPages: true });
doc.pipe(fs.createWriteStream(path.join(out, 'InkVerse-Guide.pdf')));
const W = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const ensure = h => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
const h1 = t => { ensure(60); doc.moveDown(0.8).font('Helvetica-Bold').fontSize(18).fillColor(INK).text(clean(t)); const y = doc.y + 2; doc.rect(doc.page.margins.left, y, 44, 3).fill(GREEN); doc.moveDown(0.6); };
const h2 = t => { ensure(40); doc.moveDown(0.4).font('Helvetica-Bold').fontSize(12).fillColor(GREEN).text(clean(t)); doc.moveDown(0.15); };
const p = t => { ensure(30); doc.font('Helvetica').fontSize(10).fillColor(INK).text(clean(t), { lineGap: 2.5 }); doc.moveDown(0.4); };
const bullets = items => items.forEach(t => {
  doc.font('Helvetica').fontSize(10); const w = W() - 16, h = doc.heightOfString(clean(t), { width: w, lineGap: 2 }); ensure(h + 4);
  const y = doc.y, x = doc.page.margins.left; doc.circle(x + 4, y + 5.5, 1.8).fill(GREEN);
  doc.fillColor(INK).text(clean(t), x + 16, y, { width: w, lineGap: 2 }); doc.x = x; doc.moveDown(0.25);
});
function table(head, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0), x0 = doc.page.margins.left, scale = W() / total, ws = widths.map(w => w * scale);
  const drawRow = (cells, bold, fill) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    const hs = cells.map((c, i) => doc.heightOfString(clean(c), { width: ws[i] - 10 })), h = Math.max(...hs) + 10;
    ensure(h); const y = doc.y; if (fill) doc.rect(x0, y, W(), h).fill(fill);
    let x = x0; cells.forEach((c, i) => { doc.fillColor(bold ? '#ffffff' : INK).text(clean(c), x + 5, y + 5, { width: ws[i] - 10 }); x += ws[i]; });
    doc.moveTo(x0, y + h).lineTo(x0 + W(), y + h).strokeColor('#dfe3e8').lineWidth(0.5).stroke(); doc.y = y + h; doc.x = x0;
  };
  drawRow(head, true, '#15181d'); rows.forEach((r, i) => drawRow(r, false, i % 2 ? '#f6f7f9' : null)); doc.moveDown(0.6);
}

// cover
doc.rect(0, 0, doc.page.width, 300).fill('#0e1013');
doc.fillColor('#00d564').font('Helvetica-Bold').fontSize(54).text('INK', 56, 100, { continued: true }).fillColor('#ffffff').text('VERSE');
doc.fillColor('#c9ced6').font('Helvetica').fontSize(16).text('Read. Create. Get paid.', 56, 170);
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('Working Guide & Platform Details', 56, 215);
doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Comics and web novels with moderated chat channels and creator payouts', 56, 330);
doc.text('Version 1.0 - ' + new Date().toISOString().slice(0, 10), 56, 346);
doc.y = 400; doc.x = 56;

h1('1. What is InkVerse?');
p('InkVerse is a full-stack web platform where creators publish comics (image pages) and web novels (text chapters) and get paid by their readers, while readers browse, read, discuss and support the work they love. It has two public account types - Reader and Creator - plus an Admin/Moderator role used by the platform team.');
p('The design goal is a marketplace where everybody profits: readers get a free-to-read catalogue with optional early access, creators keep the majority of revenue and own their work, and the platform earns a sustainable share that funds hosting, moderation and payments.');

h1('2. Who can do what');
table(['Role', 'Capabilities'], [
  ['Reader', 'Register and log in, browse and search, read free and unlocked chapters, comment, react, rate, like, follow series, track reading progress, host and join chat channels, buy coins, tip creators, report content, appeal strikes, collect badges and daily check-in coins. A reader can upgrade to Creator in one click.'],
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
p('Readers buy coins in packs. Coins are spent on early-access chapters and tips. The creator share is calculated on the net value of the coins (after payment fees and taxes), so the platform never pays out money it did not keep.');
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
p('Flow: purchase -> reader coins increase -> unlock or tip -> reader coins decrease and a creator earning is recorded with an availability date -> after the hold the earning is "available" -> creator requests a payout -> admin approves (paid) or rejects (earnings are released back). All money movements run inside database transactions. Purchases in this version are a demo checkout; connect Stripe before charging real users.');

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
p('Limits of this version: the built-in word list is only a demo set. A production launch needs a maintained multilingual list, ideally a machine-learning toxicity classifier, and image moderation for uploaded art.');

h1('7. Advanced features');
bullets(['Personalised recommendations ("Because you like Fantasy") from likes, follows, reading history and ratings.', 'Live search suggestions with cover thumbnails.', 'Creator analytics: 30-day views and earnings charts, top chapters, top supporters and revenue mix.', 'Top-supporters leaderboard on every series page.', 'Chapter reactions and author notes.', 'Daily check-in streak and achievement badges.', 'Comic paged mode with keyboard and swipe navigation; novel auto-scroll.', 'Scheduled releases with automatic follower notifications.', 'Installable Progressive Web App with offline shell and image caching; dark and light themes.', 'Appeals workflow, audit log and admin-editable word filter.']);

h1('8. Design and animation');
p('Visual style is a clean Webtoon-inspired layout: bold display headings (Bangers), friendly UI text (Poppins), serif novel text (Merriweather), one signature green with pink and yellow accents, rounded cards and pill buttons. (No reference image was received with the brief, so these tokens can be swapped easily once it is available.)');
bullets(['Page transitions: fade and rise. Hero banner: slide and fade with staggered text and animated dots.', 'Cards, chapters and comic panels reveal as they scroll into view; novel paragraphs appear one by one.', 'Hover zoom on covers, logo tilt, chat messages pop in, spoilers un-blur, coin-burst particles on purchases, tips and unlocks, charts draw themselves.', 'All motion is disabled automatically for users who prefer reduced motion. The layout is responsive down to phone width.']);

h1('9. Technology and architecture');
table(['Part', 'Technology'], [
  ['Server', 'Node.js 18+, Express, REST API under /api'],
  ['Realtime chat', 'WebSocket (ws) at /ws'],
  ['Database', 'SQLite via better-sqlite3 (WAL mode, transactions); 23 tables'],
  ['Auth', 'bcrypt password hashes, JWT tokens (14 days), role checks on every protected route'],
  ['Front end', 'Vanilla JavaScript single-page app with hash routing - no build step; PWA manifest + service worker'],
  ['Files', 'Uploads on disk (multer, image-only, 8 MB each); generated SVG covers and demo pages'],
  ['Security', 'Helmet with strict Content-Security-Policy, rate limits, parameterised SQL, escaped output, upload allow-list'],
  ['Tests', 'npm test runs end-to-end API checks on a temporary database'],
], [1.2, 5]);
p('Data tables: users, series, chapters, unlocks, follows, likes, ratings, progress, comments, reactions, channels, channel_mutes, messages, reports, appeals, audit, blocked_words, transactions, earnings, payouts, dmca, notifications, view_log.');

h1('10. Running and deploying');
h2('Run locally');
p('Install Node.js 18+, then run "npm install" and "npm start" and open http://localhost:3000. Demo accounts (local use only): admin / Admin123!, NovaInk / Creator123!, KaiWrites / Creator123!, ReaderRay / Reader123!.');
h2('Environment variables');
table(['Variable', 'Default', 'Purpose'], [
  ['PORT', '3000', 'HTTP and WebSocket port'],
  ['JWT_SECRET', 'auto-generated', 'REQUIRED in production. Signs login tokens (48+ random characters).'],
  ['DATA_DIR', './data', 'REQUIRED in production. Persistent folder for the database.'],
  ['UPLOAD_DIR', './uploads', 'REQUIRED in production. Persistent folder for uploaded images.'],
  ['DB_FILE', 'DATA_DIR/inkverse.db', 'Override database file path'],
  ['SEED_DEMO', 'true', 'Set to false in production (no demo users or content)'],
  ['ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_USERNAME', '-', 'Create your real admin account when SEED_DEMO=false'],
  ['HOLD_DAYS', '14', 'Days earnings are held before withdrawal'],
], [2.2, 1.4, 3.6]);
h2('Deployment essentials');
bullets(['Needs a persistent disk (SQLite database and uploads live on disk). Free ephemeral hosts will lose data.', 'Run a single instance (chat rooms are in memory; SQLite is single-writer).', 'Use HTTPS and make sure the proxy forwards WebSocket upgrades on /ws.', 'Options: Docker (Dockerfile included), Render or Railway with a mounted disk, or a VPS with pm2 and Nginx. Full commands are in README.md.', 'Back up DATA_DIR and UPLOAD_DIR regularly.']);

h1('11. Before real launch');
bullets(['Set SEED_DEMO=false and a real admin; use a strong JWT_SECRET.', 'Integrate Stripe Checkout + webhook for coin purchases and Stripe Connect or PayPal Payouts for creator payouts; collect tax forms.', 'Have the Terms, Privacy Policy and DMCA agent registration reviewed by a lawyer.', 'Upgrade moderation (multilingual list, ML classifier, image scanning) and add email notifications.', 'Plan scaling: PostgreSQL, Redis for chat, object storage + CDN for images.']);
p('See tasks.md for the full checklist of finished work and next steps, and design.md for the research summary and detailed business rules.');

// footer with page numbers
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i); if (i === 0) continue;
  doc.page.margins.bottom = 0; // writing in the margin must not trigger an automatic new page
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`InkVerse - Working Guide  |  Page ${i + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 36, { width: W(), align: 'center', lineBreak: false });
}
doc.end();

// ---------- ZIP (after the PDF so it is included) ----------
doc.on('end', () => setTimeout(() => {
  const zipPath = path.join(out, 'inkverse.zip'); const output = fs.createWriteStream(zipPath); const zip = archiver('zip', { zlib: { level: 9 } });
  output.on('close', () => console.log(`Built downloads in public/downloads (zip ${(zip.pointer() / 1024).toFixed(0)} KB)`));
  zip.pipe(output);
  zip.glob('**/*', { cwd: root, dot: true, ignore: ['node_modules/**', 'data/**', 'uploads/**', '.git/**', '.env', 'public/downloads/*.zip', 'inkverse.zip', 'tmp/**'] }, { prefix: 'inkverse' });
  zip.finalize();
}, 400));
