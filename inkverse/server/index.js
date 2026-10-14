const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const { db, RULES } = require('./db');
const { screenText, fileReport, addStrike } = require('./moderation');
const payments = require('./payments');
const copyright = require('./copyright');

const PORT = process.env.PORT || 3000;
const DAY = 24 * 3600 * 1000;
const now = () => Date.now();

// ---------- secrets ----------
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  const f = path.join(dataDir, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'));
  SECRET = fs.readFileSync(f, 'utf8');
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc: ["'none'"], frameAncestors: ["'none'"],
    },
  },
}));
payments.mountWebhook(app); // raw body required for signature check, so it must precede express.json
app.use(express.json({ limit: '2mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 400, standardHeaders: true, legacyHeaders: false }));
const uploadLimiter = rateLimit({ windowMs: 3600_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Upload limit reached for this hour. Please try again later.' } });   // chapter uploads run image/copyright analysis
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, message: { error: 'Too many attempts, try later.' } });

// ---------- helpers ----------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, error) => res.status(code).json({ error });
const publicUser = u => u && ({ id: u.id, username: u.username, role: u.role, bio: u.bio, adult: !!u.adult, coins: u.coins,
  payout_email: u.payout_email, tax_ok: !!u.tax_ok, streak: u.streak, can_checkin: u.last_checkin !== Math.floor(Date.now() / DAY), strikes: u.strikes, muted_until: u.muted_until, created_at: u.created_at,
  premium: u.plan_until > Date.now(), plan_until: u.plan_until || null, sub_cancel: !!u.sub_cancel, email_verified: !!u.email_verified });
const userFromToken = token => {
  try {
    const { id, v } = jwt.verify(token, SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    return u && !u.banned && (v ?? 0) === u.token_version ? u : null;   // token_version bump = "log out everywhere"
  } catch { return null; }
};
app.use((req, res, next) => {
  const h = req.headers.authorization || '';
  req.user = h.startsWith('Bearer ') ? userFromToken(h.slice(7)) : null;
  next();
});
const needAuth = (req, res, next) => req.user ? next() : fail(res, 401, 'Please log in.');
const needRole = (...roles) => (req, res, next) =>
  !req.user ? fail(res, 401, 'Please log in.') : roles.includes(req.user.role) ? next() : fail(res, 403, 'Not allowed for your account type.');
const sign = u => jwt.sign({ id: u.id, v: u.token_version }, SECRET, { expiresIn: '14d' });
const needVerified = (req, res, next) => process.env.REQUIRE_VERIFIED === 'true' && !req.user.email_verified ? fail(res, 403, 'Please confirm your email address first (check your inbox, or resend from your profile menu).') : next();
const notify = (userId, text, link) => db.prepare('INSERT INTO notifications(user_id,text,link,created_at) VALUES(?,?,?,?)').run(userId, text, link || null, now());
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

// ---------- generated artwork (so the demo has covers & pages without binary assets) ----------
const PALETTES = [['#ff6b6b', '#feca57'], ['#5f27cd', '#54a0ff'], ['#10ac84', '#1dd1a1'], ['#ee5253', '#ff9ff3'], ['#222f3e', '#576574'], ['#ff9f43', '#ee5253'], ['#0abde3', '#10ac84'], ['#341f97', '#c56cf0']];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get('/gen/cover/:id.svg', (req, res) => {
  const s = db.prepare('SELECT title,type FROM series WHERE id=?').get(Number(req.params.id));
  const i = Number(req.params.id) % PALETTES.length, [a, b] = PALETTES[i];
  const words = (s?.title || 'Untitled').split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 12) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  lines.push(cur);
  const text = lines.slice(0, 4).map((l, k) => `<text x="150" y="${210 + k * 42}" text-anchor="middle" font-family="Impact,Arial Black,sans-serif" font-size="38" fill="#fff" stroke="#000" stroke-width="1.5">${esc(l.toUpperCase())}</text>`).join('');
  res.type('image/svg+xml').set('Cache-Control', 'public,max-age=3600').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><pattern id="d" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.6" fill="#000" opacity=".12"/></pattern></defs><rect width="300" height="400" fill="url(#g)"/><rect width="300" height="400" fill="url(#d)"/><circle cx="${60 + i * 25}" cy="80" r="46" fill="#fff" opacity=".18"/><path d="M0 330 L90 260 L170 320 L250 240 L300 290 V400 H0Z" fill="#000" opacity=".25"/>${text}<text x="150" y="380" text-anchor="middle" font-family="Arial" font-size="14" fill="#fff" opacity=".9">${s?.type === 'novel' ? 'WEB NOVEL' : 'COMIC'}</text></svg>`);
});
app.get('/gen/page/:seed/:n.svg', (req, res) => {
  const seed = Number(req.params.seed) || 1, n = Number(req.params.n) || 1; const [a, b] = PALETTES[(seed + n) % PALETTES.length];
  const bub = (x, y, w, t) => `<g><rect x="${x}" y="${y}" rx="22" width="${w}" height="70" fill="#fff" stroke="#111" stroke-width="3"/><text x="${x + w / 2}" y="${y + 42}" text-anchor="middle" font-family="Comic Sans MS,Arial" font-size="22" fill="#111">${esc(t)}</text></g>`;
  const lines = ['"We have to go now!"', '"Not without the key."', '"…you came back."', '"This is only the beginning."', '"Run!!"'];
  res.type('image/svg+xml').set('Cache-Control', 'public,max-age=3600').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="1200" fill="url(#g)"/><rect x="30" y="30" width="740" height="540" fill="#fff" opacity=".18" stroke="#111" stroke-width="6"/><rect x="30" y="610" width="360" height="560" fill="#fff" opacity=".18" stroke="#111" stroke-width="6"/><rect x="420" y="610" width="350" height="560" fill="#fff" opacity=".18" stroke="#111" stroke-width="6"/><circle cx="${200 + (n * 97) % 400}" cy="300" r="120" fill="#000" opacity=".2"/>${bub(70, 70, 420, lines[n % 5])}${bub(450, 660, 300, lines[(n + 2) % 5].slice(0, 16))}<text x="400" y="1190" text-anchor="middle" font-family="Arial" font-size="20" fill="#fff">Demo page ${n} — upload your own art in Creator Studio</text></svg>`);
});

// ---------- uploads ----------
const upDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(upDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: upDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 80 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});
app.use('/uploads', express.static(upDir, { maxAge: '7d', setHeaders: r => r.setHeader('X-Content-Type-Options', 'nosniff') }));

// ---------- config & auth ----------
app.get('/healthz', (req, res) => { try { db.prepare('SELECT 1').get(); res.json({ ok: true, uptime: Math.round(process.uptime()) }); } catch { res.status(503).json({ ok: false }); } });
app.get('/api/config', (req, res) => res.json({ ...RULES, creatorShareUnlockPct: RULES.creatorShareUnlock * 100, payments: payments.paymentsMode() }));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const username = clean(req.body.username, 24), email = clean(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
  const role = req.body.role === 'creator' ? 'creator' : 'reader';
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return fail(res, 400, 'Username: 3-24 letters, numbers or underscores.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter a valid email.');
  if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters.');
  if (req.body.acceptTerms !== true) return fail(res, 400, 'You must accept the Terms & Community Guidelines.');
  if (db.prepare('SELECT 1 FROM users WHERE username=? OR email=?').get(username, email)) return fail(res, 409, 'Username or email already in use.');
  const info = db.prepare('INSERT INTO users(username,email,pass_hash,role,adult,created_at) VALUES(?,?,?,?,?,?)')
    .run(username, email, await bcrypt.hash(password, 10), role, req.body.adult === true ? 1 : 0, now());
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  notify(u.id, 'Welcome to InkVerse! Be kind, tag your spoilers, and enjoy.');
  app.sendVerification?.(u, req)?.catch?.(e => console.error('verification mail error', e.message));
  res.json({ token: sign(u), user: publicUser(u) });
}));
app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const id = clean(req.body.login, 120);
  const u = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(id, id);
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.pass_hash))) return fail(res, 401, 'Wrong username/email or password.');
  if (u.banned) return fail(res, 403, 'This account has been banned.');
  res.json({ token: sign(u), user: publicUser(u) });
}));
app.get('/api/me', needAuth, (req, res) => res.json(publicUser(req.user)));
app.patch('/api/me', needAuth, (req, res) => {
  const b = req.body, u = req.user;
  db.prepare('UPDATE users SET bio=?, adult=?, payout_email=?, tax_ok=? WHERE id=?').run(
    b.bio !== undefined ? clean(b.bio, 300) : u.bio,
    b.adult !== undefined ? (b.adult ? 1 : 0) : u.adult,
    b.payout_email !== undefined ? clean(b.payout_email, 120) || null : u.payout_email,
    b.tax_ok !== undefined && u.role !== 'reader' ? (b.tax_ok ? 1 : 0) : u.tax_ok, u.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)));
});
app.post('/api/me/become-creator', needAuth, (req, res) => {
  if (req.user.role === 'reader') db.prepare("UPDATE users SET role='creator' WHERE id=?").run(req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
});

// ---------- series ----------
const seriesSelect = `SELECT s.*, u.username AS creator,
  (SELECT COUNT(*) FROM chapters c WHERE c.series_id=s.id AND c.publish_at<=@now AND c.draft=0 AND c.review='ok') AS chapter_count,
  (SELECT COUNT(*) FROM follows f WHERE f.series_id=s.id) AS followers,
  (SELECT COUNT(*) FROM likes l WHERE l.series_id=s.id) AS likes,
  (SELECT ROUND(AVG(stars),2) FROM ratings r WHERE r.series_id=s.id) AS rating,
  (SELECT MAX(publish_at) FROM chapters c WHERE c.series_id=s.id AND c.publish_at<=@now AND c.draft=0 AND c.review='ok') AS updated_at
  FROM series s JOIN users u ON u.id=s.creator_id`;
const coverOf = s => s.cover || `/gen/cover/${s.id}.svg`;
const list = v => v ? v.split(',') : [];
const shapeSeries = s => ({ ...s, cover: coverOf(s), genres: list(s.genres), tags: list(s.tags), warnings: list(s.warnings), mature: !!s.mature });

app.get('/api/series', (req, res) => {
  const { q, type, genre, sort = 'trending', creator, status, monetization, language, tag, safe } = req.query;
  let where = "s.status!='removed'"; const params = { now: now(), boost: now() - 30 * DAY };
  if (q) { where += ' AND (s.title LIKE @q OR s.synopsis LIKE @q OR u.username LIKE @q)'; params.q = `%${clean(q, 60)}%`; }
  if (type === 'comic' || type === 'novel') { where += ' AND s.type=@type'; params.type = type; }
  if (genre) { where += " AND (',' || s.genres || ',') LIKE @genre"; params.genre = `%,${clean(genre, 30)},%`; }
  if (creator) { where += ' AND s.creator_id=@creator'; params.creator = Number(creator); }
  if (['ongoing', 'completed', 'hiatus'].includes(status)) { where += ' AND s.status=@status'; params.status = status; }
  if (['free', 'paid', 'hybrid'].includes(monetization)) { where += ' AND s.monetization=@mon'; params.mon = monetization; }
  if (RULES.languages[language]) { where += ' AND s.language=@lang'; params.lang = language; }
  if (tag) { where += " AND (',' || s.tags || ',') LIKE @tag"; params.tag = `%,${clean(tag, 40)},%`; }
  if (safe) for (const [i, w] of String(safe).split(',').filter(w => RULES.warnings.includes(w)).entries()) { where += ` AND (',' || s.warnings || ',') NOT LIKE @sw${i}`; params['sw' + i] = `%,${w},%`; }   // hide content warnings
  const order = { new: 'updated_at DESC', top: 'rating DESC, likes DESC', trending: '(s.views + likes*20 + followers*30) * (CASE WHEN s.created_at > @boost THEN 1.5 ELSE 1 END) DESC'   /* new-creator boost, 30 days, published in the Creator Program rules */ }[sort] || 'updated_at DESC';
  const rows = db.prepare(`${seriesSelect} WHERE ${where} AND chapter_count>0 ORDER BY ${order} LIMIT 60`).all(params);
  res.json(rows.map(shapeSeries));
});

app.get('/api/series/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare(`${seriesSelect} WHERE s.id=@id`).get({ id, now: now() });
  if (!s || (s.status === 'removed' && req.user?.id !== s.creator_id && req.user?.role !== 'admin')) return fail(res, 404, 'Series not found.');
  db.prepare('UPDATE series SET views=views+1 WHERE id=?').run(id);
  db.prepare('INSERT INTO view_log(series_id,day,views) VALUES(?,?,1) ON CONFLICT(series_id,day) DO UPDATE SET views=views+1').run(id, new Date().toISOString().slice(0, 10));
  const own = req.user && (req.user.id === s.creator_id || req.user.role === 'admin');
  const rows = db.prepare(`SELECT id,number,title,price_coins,publish_at,free_at,views,draft,review,words FROM chapters WHERE series_id=? ${own ? '' : "AND publish_at<=? AND draft=0 AND review='ok'"} ORDER BY number`).all(...(own ? [id] : [id, now()]));
  const unlocked = req.user ? new Set(db.prepare('SELECT chapter_id FROM unlocks WHERE user_id=?').all(req.user.id).map(r => r.chapter_id)) : new Set();
  const chapters = rows.map(c => ({ ...c, draft: !!c.draft, held: c.review !== 'ok', scheduled: c.publish_at > now() && !c.draft,
    locked: !own && c.price_coins > 0 && !(c.free_at && c.free_at <= now()) && !unlocked.has(c.id) }));
  const me = req.user ? {
    following: !!db.prepare('SELECT 1 FROM follows WHERE user_id=? AND series_id=?').get(req.user.id, id),
    liked: !!db.prepare('SELECT 1 FROM likes WHERE user_id=? AND series_id=?').get(req.user.id, id),
    rating: db.prepare('SELECT stars FROM ratings WHERE user_id=? AND series_id=?').get(req.user.id, id)?.stars || 0,
    progress: db.prepare('SELECT chapter_id FROM progress WHERE user_id=? AND series_id=?').get(req.user.id, id)?.chapter_id || null,
  } : null;
  const channels = db.prepare('SELECT id,name,tag,description FROM channels WHERE series_id=? ORDER BY id DESC LIMIT 20').all(id);
  res.json({ ...shapeSeries(s), chapters, me, channels, own: !!own });
});

const pick = (v, allowed, dflt) => allowed.includes(v) ? v : dflt;
const csvOf = (v, allowed, max) => String(v || '').split(',').map(g => g.trim()).filter(g => allowed.includes(g)).slice(0, max).join(',');
app.post('/api/series', needRole('creator', 'admin'), needVerified, upload.single('cover'), wrap(async (req, res) => {
  const b = req.body, title = clean(b.title, 80);
  const drop = () => req.file && fs.unlink(req.file.path, () => {});
  if (title.length < 2) { drop(); return fail(res, 400, 'Title is required.'); }
  if (!['comic', 'novel'].includes(b.type)) { drop(); return fail(res, 400, 'Type must be comic or novel.'); }
  if (req.file) {   // cover must not be a copyrighted image
    const chk = await copyright.checkUpload({ ownerId: req.user.id, files: [req.file] });
    if (chk.verdict !== 'pass') { drop(); return fail(res, 422, 'This cover image matches existing copyrighted artwork. Please upload your own cover.'); }
  }
  const mon = pick(b.monetization, ['free', 'paid', 'hybrid'], 'hybrid');
  const info = db.prepare('INSERT INTO series(creator_id,title,type,synopsis,genres,cover,schedule,mature,created_at,monetization,free_chapters,default_price,reading_dir,language,tags,warnings) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    req.user.id, title, b.type, clean(b.synopsis, 1500), csvOf(b.genres, RULES.genres, 4), req.file ? '/uploads/' + req.file.filename : null,
    b.schedule === 'bulk' ? 'bulk' : 'weekly', b.mature === 'true' || b.mature === '1' || b.mature === true ? 1 : 0, now(),
    mon, mon === 'hybrid' ? Math.max(0, Math.min(200, parseInt(b.free_chapters, 10) || 0)) : 0,
    mon === 'free' ? 0 : Math.max(0, Math.min(RULES.maxCoinsPerChapter, parseInt(b.default_price, 10) || 0)),
    pick(b.reading_dir, ['vertical', 'ltr', 'rtl'], b.type === 'comic' ? 'vertical' : 'ltr'), RULES.languages[b.language] ? b.language : 'en', csvOf(b.tags, RULES.tags, 6), csvOf(b.warnings, RULES.warnings, 6));
  res.json({ id: info.lastInsertRowid });
}));
app.patch('/api/series/:id', needAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id=?').get(Number(req.params.id));
  if (!s || (s.creator_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not your series.');
  const status = ['ongoing', 'completed', 'hiatus'].includes(req.body.status) && s.status !== 'removed' ? req.body.status : s.status;
  const schedule = ['weekly', 'bulk'].includes(req.body.schedule) ? req.body.schedule : s.schedule;
  const mon = pick(req.body.monetization, ['free', 'paid', 'hybrid'], s.monetization), b = req.body;
  db.prepare('UPDATE series SET status=?, schedule=?, synopsis=?, monetization=?, free_chapters=?, default_price=?, reading_dir=?, language=?, tags=?, warnings=? WHERE id=?').run(status, schedule, req.body.synopsis !== undefined ? clean(req.body.synopsis, 1500) : s.synopsis,
    mon, b.free_chapters !== undefined ? Math.max(0, Math.min(200, parseInt(b.free_chapters, 10) || 0)) : s.free_chapters,
    b.default_price !== undefined ? Math.max(0, Math.min(RULES.maxCoinsPerChapter, parseInt(b.default_price, 10) || 0)) : s.default_price,
    pick(b.reading_dir, ['vertical', 'ltr', 'rtl'], s.reading_dir), RULES.languages[b.language] ? b.language : s.language,
    b.tags !== undefined ? csvOf(b.tags, RULES.tags, 6) : s.tags, b.warnings !== undefined ? csvOf(b.warnings, RULES.warnings, 6) : s.warnings, s.id);
  res.json({ ok: true });
});

// ---------- chapters ----------
function nextWeeklySlot(seriesId) {
  const last = db.prepare('SELECT MAX(publish_at) m FROM chapters WHERE series_id=?').get(seriesId).m;
  return last && last > now() ? last + 7 * DAY : (last ? Math.max(last + 7 * DAY, now() + 60_000) : now());
}
function resolvePublishAt(b, series, indexInBatch = 0) {
  if (b.publish_mode === 'date' && b.publish_at) { const t = Date.parse(b.publish_at); if (!isNaN(t)) return Math.max(t, now()); }
  if (b.publish_mode === 'weekly') return nextWeeklySlot(series.id);
  return now() - 1000 + indexInBatch; // 'now' (bulk release)
}
function priceFields(b, publishAt, series, number) {
  let price = parseInt(b.price_coins || 0, 10) || 0;
  if (series?.monetization === 'free') price = 0;
  else if (series?.monetization === 'paid' && !price) price = series.default_price;
  else if (series?.monetization === 'hybrid') price = number <= series.free_chapters ? 0 : (price || series.default_price);   // first N chapters always free
  if (price && (price < RULES.minCoinsPerChapter || price > RULES.maxCoinsPerChapter)) throw new Error(`Premium price must be ${RULES.minCoinsPerChapter}-${RULES.maxCoinsPerChapter} coins (or 0 for free).`);
  const days = Math.min(parseInt(b.free_after_days || 0, 10) || 0, RULES.maxFreeAfterDays);
  return { price, free_at: price && days > 0 ? publishAt + days * DAY : null };
}
const wordCount = t => (String(t || '').trim().match(/\S+/g) || []).length;
const ownSeries = (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id=?').get(Number(req.params.id));
  if (!s || (s.creator_id !== req.user.id && req.user.role !== 'admin')) { fail(res, 403, 'Not your series.'); return null; }
  if (s.status === 'removed') { fail(res, 403, 'This series was removed (DMCA/policy).'); return null; }
  return s;
};
const nextNumber = sid => (db.prepare('SELECT MAX(number) m FROM chapters WHERE series_id=?').get(sid).m || 0) + 1;

app.post('/api/series/:id/chapters', needRole('creator', 'admin'), needVerified, uploadLimiter, upload.array('pages', 80), wrap(async (req, res) => {
  const files = req.files || [], drop = () => files.forEach(f => fs.unlink(f.path, () => {}));
  const s = ownSeries(req, res); if (!s) return drop();
  const b = req.body, title = clean(b.title, 100);
  if (!title) { drop(); return fail(res, 400, 'Chapter title is required.'); }
  let content = null, pages = null, sorted = files;
  if (s.type === 'novel') { content = clean(b.content, 200000); if (content.length < 50) return fail(res, 400, 'Novel chapter needs at least 50 characters.'); }
  else {
    sorted = [...files].sort((a, z) => a.originalname.localeCompare(z.originalname, undefined, { numeric: true }));
    if (!sorted.length) return fail(res, 400, 'Upload at least one page image.');
    pages = JSON.stringify(sorted.map(f => '/uploads/' + f.filename));
  }
  // ---- copyright check on the new upload
  const chk = await copyright.checkUpload({ ownerId: req.user.id, files: sorted, text: content });
  if (chk.verdict === 'block') {
    copyright.logCheck({ seriesId: s.id, userId: req.user.id, res: chk }); drop();
    return res.status(422).json({ error: 'Upload blocked by copyright check. ' + copyright.explain(chk), copyright: { verdict: 'block', score: chk.score, matches: chk.matches } });
  }
  try {
    const draft = b.draft === 'true' || b.draft === true || b.draft === '1' ? 1 : 0;
    const num = nextNumber(s.id), at = draft ? now() + 3650 * DAY : resolvePublishAt(b, s), { price, free_at } = priceFields(b, draft ? now() : at, s, num);
    const held = chk.verdict === 'review';
    const id = db.transaction(() => {
      const info = db.prepare("INSERT INTO chapters(series_id,number,title,content,pages,price_coins,publish_at,free_at,created_at,author_note,draft,review,words) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(s.id, num, title, content, pages, price, at, free_at, now(), clean(b.author_note, 500) || null, draft, held ? 'pending' : 'ok', wordCount(content));
      copyright.store({ ownerId: req.user.id, seriesId: s.id, chapterId: info.lastInsertRowid, prints: chk.prints });
      if (held) copyright.logCheck({ chapterId: info.lastInsertRowid, seriesId: s.id, userId: req.user.id, res: chk });
      return info.lastInsertRowid;
    })();
    if (held) notify(req.user.id, 'Your chapter was held for a quick copyright review and will go live once approved.');
    res.json({ id, publish_at: draft ? null : at, draft: !!draft, status: held ? 'pending_review' : draft ? 'draft' : 'ok', copyright: held ? { verdict: 'review', matches: chk.matches } : undefined });
  } catch (e) { drop(); fail(res, 400, e.message); }
}));
// Bulk release for novels: chapters separated by lines starting with "# "
app.post('/api/series/:id/chapters/bulk', needRole('creator', 'admin'), needVerified, uploadLimiter, wrap(async (req, res) => {
  const s = ownSeries(req, res); if (!s) return;
  if (s.type !== 'novel') return fail(res, 400, 'Bulk text import is for novels. For comics, upload each chapter.');
  const parts = String(req.body.text || '').split(/^# /m).map(p => p.trim()).filter(Boolean).slice(0, 100);
  if (!parts.length) return fail(res, 400, 'Start each chapter with a line like "# Chapter title".');
  const checks = [];
  for (const p of parts) {
    const [t, ...rest] = p.split('\n'), body = rest.join('\n').trim(); if (body.length < 50) return fail(res, 400, `Chapter "${t}" is too short.`);
    const chk = await copyright.checkUpload({ ownerId: req.user.id, text: clean(body, 200000) });
    if (chk.verdict === 'block') { copyright.logCheck({ seriesId: s.id, userId: req.user.id, res: chk }); return res.status(422).json({ error: `Chapter "${clean(t, 60)}" was blocked by the copyright check. ` + copyright.explain(chk), copyright: { verdict: 'block', matches: chk.matches } }); }
    checks.push(chk);
  }
  try {
    let n = nextNumber(s.id), last = null, held = 0; const draft = req.body.draft === true || req.body.draft === 'true' ? 1 : 0;
    db.transaction(() => {
      parts.forEach((p, i) => {
        const [t, ...rest] = p.split('\n'); const body = clean(rest.join('\n').trim(), 200000), chk = checks[i];
        const at = draft ? now() + 3650 * DAY : req.body.publish_mode === 'weekly' ? (last = last ? last + 7 * DAY : nextWeeklySlot(s.id)) : resolvePublishAt(req.body, s, i);
        const { price, free_at } = priceFields(req.body, draft ? now() : at, s, n);
        const review = chk.verdict === 'review' ? 'pending' : 'ok'; if (review === 'pending') held++;
        const id = db.prepare('INSERT INTO chapters(series_id,number,title,content,price_coins,publish_at,free_at,created_at,draft,review,words) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(s.id, n++, clean(t, 100), body, price, at, free_at, now(), draft, review, wordCount(body)).lastInsertRowid;
        copyright.store({ ownerId: req.user.id, seriesId: s.id, chapterId: id, prints: chk.prints });
        if (review === 'pending') copyright.logCheck({ chapterId: id, seriesId: s.id, userId: req.user.id, res: chk });
      });
    })();
    if (held) notify(req.user.id, `${held} imported chapter(s) were held for a quick copyright review.`);
    res.json({ created: parts.length, held });
  } catch (e) { fail(res, 400, e.message); }
}));

// Single source of truth for "can this person read this chapter?" (also used by highlights, polls, premium unlocks, progress)
function chapterAccess(user, chapterId) {
  const c = db.prepare('SELECT * FROM chapters WHERE id=?').get(chapterId); if (!c) return null;
  const s = db.prepare('SELECT s.*, u.username creator FROM series s JOIN users u ON u.id=s.creator_id WHERE s.id=?').get(c.series_id);
  const own = !!user && (user.id === s.creator_id || user.role === 'admin');
  if (!own) {
    if (s.status === 'removed') return { status: 410, error: 'This series was removed.' };
    if (c.publish_at > now() || c.draft || c.review !== 'ok') return { status: 404, error: 'Chapter not released yet.' };
    if (s.mature && !user?.adult) return { status: 403, error: 'Mature content: log in and confirm you are 18+ in your profile.' };
  }
  const unlocked = user && db.prepare('SELECT 1 FROM unlocks WHERE user_id=? AND chapter_id=?').get(user.id, c.id);
  return { c, s, own, locked: !own && c.price_coins > 0 && !(c.free_at && c.free_at <= now()) && !unlocked };
}

app.get('/api/chapters/:id', (req, res) => {
  const a = chapterAccess(req.user, Number(req.params.id));
  if (!a) return fail(res, 404, 'Chapter not found.'); if (a.status) return fail(res, a.status, a.error);
  const { c, s, own, locked } = a;
  const sib = db.prepare("SELECT id,number FROM chapters WHERE series_id=? AND publish_at<=? AND draft=0 AND review='ok' ORDER BY number").all(s.id, own ? Infinity : now());
  const idx = sib.findIndex(x => x.id === c.id);
  const base = { id: c.id, number: c.number, title: c.title, series_id: s.id, series_title: s.title, type: s.type, creator: s.creator, creator_id: s.creator_id,
    price_coins: c.price_coins, free_at: c.free_at, locked, prev: sib[idx - 1]?.id || null, next: sib[idx + 1]?.id || null, publish_at: c.publish_at,
    reading_dir: s.reading_dir, language: s.language, words: c.words, premium_unlock: !!req.user && req.user.plan_until > now(), draft: !!c.draft, held: c.review !== 'ok' };
  if (locked) return res.json(base);
  db.prepare('UPDATE chapters SET views=views+1 WHERE id=?').run(c.id);
  if (req.user) {
    db.prepare('INSERT INTO progress(user_id,series_id,chapter_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,series_id) DO UPDATE SET chapter_id=excluded.chapter_id, updated_at=excluded.updated_at, page=CASE WHEN progress.chapter_id=excluded.chapter_id THEN progress.page ELSE 0 END, pct=CASE WHEN progress.chapter_id=excluded.chapter_id THEN progress.pct ELSE 0 END').run(req.user.id, s.id, c.id, now());
    db.prepare('INSERT OR IGNORE INTO chapter_reads(user_id,chapter_id,series_id,first_at) VALUES(?,?,?,?)').run(req.user.id, c.id, s.id, now());
  }
  const reactions = Object.fromEntries(db.prepare('SELECT emoji, COUNT(*) n FROM reactions WHERE chapter_id=? GROUP BY emoji').all(c.id).map(r => [r.emoji, r.n]));
  const mine = req.user ? db.prepare('SELECT emoji FROM reactions WHERE chapter_id=? AND user_id=?').all(c.id, req.user.id).map(r => r.emoji) : [];
  const resume = req.user ? db.prepare('SELECT page, pct FROM progress WHERE user_id=? AND chapter_id=?').get(req.user.id, c.id) : null;
  res.json({ ...base, content: c.content, pages: c.pages ? JSON.parse(c.pages) : null, author_note: c.author_note, reactions, mine, resume,
    protect: c.price_coins > 0 });   // paid chapters get copy protection + reader watermark on the client
});

app.post('/api/chapters/:id/unlock', needAuth, (req, res) => {
  const c = db.prepare('SELECT c.*, s.creator_id, s.title st FROM chapters c JOIN series s ON s.id=c.series_id WHERE c.id=?').get(Number(req.params.id));
  if (!c || c.publish_at > now() || c.draft || c.review !== 'ok') return fail(res, 404, 'Chapter not found.');
  if (!c.price_coins) return res.json({ ok: true });
  if (db.prepare('SELECT 1 FROM unlocks WHERE user_id=? AND chapter_id=?').get(req.user.id, c.id)) return res.json({ ok: true });
  const tx = db.transaction(() => {
    const u = db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id);
    if (u.coins < c.price_coins) throw new Error('NOT_ENOUGH_COINS');
    db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(c.price_coins, req.user.id);
    db.prepare('INSERT INTO unlocks VALUES(?,?,?)').run(req.user.id, c.id, now());
    const net = c.price_coins * RULES.coinValueCents, creatorCut = +(net * RULES.creatorShareUnlock).toFixed(4);
    db.prepare('INSERT INTO earnings(creator_id,cents,source,series_id,available_at,created_at,payer_id,coins) VALUES(?,?,?,?,?,?,?,?)').run(c.creator_id, creatorCut, 'unlock', c.series_id, now() + RULES.holdDays * DAY, now(), req.user.id, c.price_coins);
    db.prepare('INSERT INTO transactions(user_id,type,coins,note,created_at) VALUES(?,?,?,?,?)').run(req.user.id, 'unlock', -c.price_coins, `${c.st} ch.${c.number}`, now());
  });
  try { tx(); res.json({ ok: true, coins: db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id).coins }); }
  catch (e) { e.message === 'NOT_ENOUGH_COINS' ? fail(res, 402, 'Not enough coins. Top up in your Wallet.') : fail(res, 500, e.message); }
});

// ---------- social ----------
const toggle = (table) => (req, res) => {
  const sid = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM series WHERE id=?').get(sid)) return fail(res, 404, 'Series not found.');
  const had = db.prepare(`DELETE FROM ${table} WHERE user_id=? AND series_id=?`).run(req.user.id, sid).changes;
  if (!had) db.prepare(`INSERT INTO ${table}(user_id,series_id) VALUES(?,?)`).run(req.user.id, sid);
  res.json({ on: !had });
};
app.post('/api/series/:id/follow', needAuth, toggle('follows'));
app.post('/api/series/:id/like', needAuth, toggle('likes'));
app.post('/api/series/:id/rate', needAuth, (req, res) => {
  const stars = Math.round(Number(req.body.stars));
  if (!(stars >= 1 && stars <= 5)) return fail(res, 400, 'Rating must be 1-5.');
  db.prepare('INSERT INTO ratings VALUES(?,?,?) ON CONFLICT(user_id,series_id) DO UPDATE SET stars=excluded.stars').run(req.user.id, Number(req.params.id), stars);
  res.json({ ok: true });
});
app.get('/api/library', needAuth, (req, res) => {
  const f = db.prepare(`${seriesSelect} JOIN follows fo ON fo.series_id=s.id AND fo.user_id=@u WHERE s.status!='removed'`).all({ now: now(), u: req.user.id });
  const cont = db.prepare(`${seriesSelect} JOIN progress p ON p.series_id=s.id AND p.user_id=@u WHERE s.status!='removed' ORDER BY p.updated_at DESC LIMIT 12`).all({ now: now(), u: req.user.id });
  const prog = Object.fromEntries(db.prepare('SELECT p.series_id, p.chapter_id, c.number FROM progress p JOIN chapters c ON c.id=p.chapter_id WHERE p.user_id=?').all(req.user.id).map(r => [r.series_id, r]));
  res.json({ following: f.map(shapeSeries), continue: cont.map(s => ({ ...shapeSeries(s), progress: prog[s.id] })) });
});

const commentShape = r => ({ id: r.id, body: r.body, created_at: r.created_at, user_id: r.user_id, username: r.username, role: r.role, pinned: !!r.pinned });
app.get('/api/chapters/:id/comments', (req, res) => {
  res.json(db.prepare("SELECT c.*, u.username, u.role FROM comments c JOIN users u ON u.id=c.user_id WHERE chapter_id=? AND c.status='visible' ORDER BY c.pinned DESC, c.id DESC LIMIT 100").all(Number(req.params.id)).map(commentShape));
});
app.post('/api/chapters/:id/comments', needAuth, (req, res) => {
  const ch = db.prepare("SELECT id FROM chapters WHERE id=? AND publish_at<=? AND draft=0 AND review='ok'").get(Number(req.params.id), now());
  if (!ch) return fail(res, 404, 'Chapter not found.');
  const r = screenText(req.user, req.body.body, { kind: 'comment' });
  if (!r.ok) return fail(res, 400, r.reason);
  const info = db.prepare('INSERT INTO comments(chapter_id,user_id,body,created_at) VALUES(?,?,?,?)').run(ch.id, req.user.id, r.body, now());
  res.json(commentShape({ id: info.lastInsertRowid, body: r.body, created_at: now(), user_id: req.user.id, username: req.user.username, role: req.user.role }));
});

// ---------- channels (chat rooms) ----------
app.get('/api/channels', (req, res) => {
  const where = req.query.series_id ? 'WHERE ch.series_id=@sid' : '';
  res.json(db.prepare(`SELECT ch.*, u.username owner, s.title series_title,
    (SELECT COUNT(*) FROM messages m WHERE m.channel_id=ch.id) AS msg_count FROM channels ch JOIN users u ON u.id=ch.owner_id LEFT JOIN series s ON s.id=ch.series_id ${where} ORDER BY msg_count DESC, ch.id DESC LIMIT 60`).all({ sid: Number(req.query.series_id) }));
});
app.post('/api/channels', needAuth, (req, res) => {
  const name = clean(req.body.name, 40), tag = RULES.channelTags.includes(req.body.tag) ? req.body.tag : 'general';
  if (name.length < 3) return fail(res, 400, 'Channel name must be at least 3 characters.');
  if (req.user.muted_until > now()) return fail(res, 403, 'You are muted and cannot create channels.');
  if (db.prepare('SELECT COUNT(*) c FROM channels WHERE owner_id=?').get(req.user.id).c >= 5) return fail(res, 400, 'Limit: 5 channels per user.');
  const nm = screenText(req.user, name + ' ' + (req.body.description || ''), { kind: 'comment' });
  if (!nm.ok || nm.flagged) return fail(res, 400, nm.reason || 'Channel name/description violates community guidelines.');
  const sid = req.body.series_id ? Number(req.body.series_id) : null;
  if (sid && !db.prepare('SELECT 1 FROM series WHERE id=?').get(sid)) return fail(res, 400, 'Unknown series.');
  const info = db.prepare('INSERT INTO channels(owner_id,series_id,name,description,tag,created_at) VALUES(?,?,?,?,?,?)').run(req.user.id, sid, name, clean(req.body.description, 200), tag, now());
  res.json({ id: info.lastInsertRowid });
});
app.get('/api/channels/:id', (req, res) => {
  const ch = db.prepare('SELECT ch.*, u.username owner, s.title series_title FROM channels ch JOIN users u ON u.id=ch.owner_id LEFT JOIN series s ON s.id=ch.series_id WHERE ch.id=?').get(Number(req.params.id));
  if (!ch) return fail(res, 404, 'Channel not found.');
  const messages = db.prepare("SELECT m.id,m.body,m.created_at,m.user_id,u.username,u.role FROM messages m JOIN users u ON u.id=m.user_id WHERE channel_id=? AND m.status='visible' ORDER BY m.id DESC LIMIT 60").all(ch.id).reverse();
  res.json({ ...ch, messages });
});
app.post('/api/channels/:id/mute', needAuth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id=?').get(Number(req.params.id));
  if (!ch || (ch.owner_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Only the channel host or an admin can mute.');
  const uid = Number(req.body.user_id); if (uid === ch.owner_id) return fail(res, 400, 'Cannot mute the host.');
  db.prepare('INSERT OR IGNORE INTO channel_mutes VALUES(?,?)').run(ch.id, uid);
  res.json({ ok: true });
});
app.delete('/api/channels/:id', needAuth, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id=?').get(Number(req.params.id));
  if (!ch || (ch.owner_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not allowed.');
  db.prepare('DELETE FROM channels WHERE id=?').run(ch.id); res.json({ ok: true });
});

// ---------- reports & DMCA ----------
app.post('/api/report', needAuth, (req, res) => {
  const type = req.body.target_type; if (!['message', 'comment', 'series', 'user'].includes(type)) return fail(res, 400, 'Bad target.');
  const r = fileReport({ reporterId: req.user.id, targetType: type, targetId: Number(req.body.target_id), reason: clean(req.body.reason || 'Unspecified', 300) });
  if (r.autoHidden && type === 'message') broadcastHide(Number(req.body.target_id));
  res.json({ ok: true, duplicate: !!r.duplicate });
});
app.post('/api/dmca', authLimiter, (req, res) => {
  const b = req.body, sid = Number(b.series_id);
  if (!db.prepare('SELECT 1 FROM series WHERE id=?').get(sid) || !b.claimant || !/^\S+@\S+$/.test(b.email || '') || String(b.details || '').length < 30) return fail(res, 400, 'Provide series, your name, email and detailed claim (30+ chars).');
  db.prepare('INSERT INTO dmca(series_id,claimant,email,details,created_at) VALUES(?,?,?,?,?)').run(sid, clean(b.claimant, 100), clean(b.email, 120), clean(b.details, 2000), now());
  res.json({ ok: true });
});

// ---------- wallet, tips, payouts ----------
app.get('/api/wallet', needAuth, (req, res) => {
  const u = db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id);
  res.json({ coins: u.coins, packs: RULES.coinPacks, history: db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id) });
});
// NOTE: demo checkout. Replace with Stripe Checkout + webhook (see README "Going to production").
app.post('/api/wallet/buy', needAuth, (req, res) => {
  if (payments.paymentsMode() !== 'demo') return fail(res, 403, 'Demo checkout is disabled. Use card checkout.');
  const p = RULES.coinPacks.find(x => x.id === req.body.pack); if (!p) return fail(res, 400, 'Unknown pack.');
  db.transaction(() => {
    db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(p.coins, req.user.id);
    db.prepare('INSERT INTO transactions(user_id,type,coins,cents,note,created_at) VALUES(?,?,?,?,?,?)').run(req.user.id, 'purchase', p.coins, p.cents, 'Demo checkout (no real charge)', now());
  })();
  res.json({ coins: db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id).coins });
});
app.post('/api/tip', needAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id=?').get(Number(req.body.series_id)); const coins = parseInt(req.body.coins, 10);
  if (!s) return fail(res, 404, 'Series not found.'); if (!(coins >= 10 && coins <= 5000)) return fail(res, 400, 'Tip 10-5000 coins.');
  if (s.creator_id === req.user.id) return fail(res, 400, "You can't tip yourself.");
  try {
    db.transaction(() => {
      if (db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id).coins < coins) throw new Error('coins');
      db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(coins, req.user.id);
      db.prepare('INSERT INTO earnings(creator_id,cents,source,series_id,available_at,created_at,payer_id,coins) VALUES(?,?,?,?,?,?,?,?)').run(s.creator_id, +(coins * RULES.coinValueCents * RULES.creatorShareTip).toFixed(4), 'tip', s.id, now() + RULES.holdDays * DAY, now(), req.user.id, coins);
      db.prepare('INSERT INTO transactions(user_id,type,coins,note,created_at) VALUES(?,?,?,?,?)').run(req.user.id, 'tip_sent', -coins, `Tip to ${s.title}`, now());
    })();
    notify(s.creator_id, `${req.user.username} tipped ${coins} coins on "${s.title}"! 🎉`, `#/series/${s.id}`);
    res.json({ ok: true, coins: db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id).coins });
  } catch (e) { e.message === 'coins' ? fail(res, 402, 'Not enough coins.') : fail(res, 500, e.message); }
});

function earningsSummary(uid) {
  const q = (cond) => db.prepare(`SELECT COALESCE(SUM(cents),0) v FROM earnings WHERE creator_id=? AND ${cond}`).get(uid, now()).v;
  return { pending: q('payout_id IS NULL AND available_at>?'), available: q('payout_id IS NULL AND available_at<=?'), lifetime: q('1=1 AND ?>0') };
}
app.get('/api/creator/dashboard', needRole('creator', 'admin'), (req, res) => {
  const uid = req.user.id;
  const series = db.prepare(`${seriesSelect} WHERE s.creator_id=@u ORDER BY s.id DESC`).all({ now: now(), u: uid }).map(shapeSeries);
  const bySeries = Object.fromEntries(db.prepare('SELECT series_id, ROUND(SUM(cents),2) c FROM earnings WHERE creator_id=? GROUP BY series_id').all(uid).map(r => [r.series_id, r.c]));
  const e = earningsSummary(uid);
  res.json({ series: series.map(s => ({ ...s, earned_cents: bySeries[s.id] || 0 })), earnings: e, minPayoutCents: RULES.minPayoutCents, holdDays: RULES.holdDays,
    payouts: db.prepare('SELECT * FROM payouts WHERE creator_id=? ORDER BY id DESC LIMIT 20').all(uid),
    totalViews: series.reduce((a, s) => a + s.views, 0), totalFollowers: series.reduce((a, s) => a + s.followers, 0) });
});
app.post('/api/creator/payout', needRole('creator', 'admin'), (req, res) => {
  const u = req.user; if (!u.payout_email || !u.tax_ok) return fail(res, 400, 'Add a payout email and accept the payout/tax terms in Studio → Payout settings first.');
  try {
    const id = db.transaction(() => {
      const e = earningsSummary(u.id);
      if (e.available < RULES.minPayoutCents) throw new Error(`Minimum payout is $${(RULES.minPayoutCents / 100).toFixed(2)}. Available: $${(e.available / 100).toFixed(2)}.`);
      if (db.prepare("SELECT 1 FROM payouts WHERE creator_id=? AND status='requested'").get(u.id)) throw new Error('You already have a payout pending review.');
      const p = db.prepare('INSERT INTO payouts(creator_id,cents,created_at) VALUES(?,?,?)').run(u.id, +e.available.toFixed(2), now());
      db.prepare('UPDATE earnings SET payout_id=? WHERE creator_id=? AND payout_id IS NULL AND available_at<=?').run(p.lastInsertRowid, u.id, now());
      return p.lastInsertRowid;
    })();
    res.json({ ok: true, id });
  } catch (e) { fail(res, 400, e.message); }
});

// ---------- notifications ----------
app.get('/api/notifications', needAuth, (req, res) => res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id)));
app.post('/api/notifications/read', needAuth, (req, res) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });

// ---------- admin / moderators ----------
const admin = needRole('admin');
app.get('/api/admin/overview', admin, (req, res) => {
  const c = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  const gross = db.prepare("SELECT COALESCE(SUM(cents),0) v FROM transactions WHERE type='purchase'").get().v;
  const owed = db.prepare('SELECT COALESCE(SUM(cents),0) v FROM earnings').get().v;
  res.json({ users: c('users'), series: c('series'), chapters: c('chapters'), openReports: db.prepare("SELECT COUNT(*) c FROM reports WHERE status='open'").get().c,
    openCopyright: db.prepare("SELECT COUNT(*) c FROM copyright_checks WHERE status='open' AND verdict='review'").get().c,
    pendingPayouts: db.prepare("SELECT COUNT(*) c FROM payouts WHERE status='requested'").get().c, openDmca: db.prepare("SELECT COUNT(*) c FROM dmca WHERE status='open'").get().c,
    grossCents: gross, creatorEarnedCents: +owed.toFixed(2) });
});
app.get('/api/admin/reports', admin, (req, res) => {
  const rows = db.prepare("SELECT r.*, u.username reporter FROM reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE r.status='open' ORDER BY r.id DESC LIMIT 100").all();
  const ctx = r => {
    if (r.target_type === 'message') return db.prepare('SELECT m.body, m.status, u.username author, m.user_id, m.channel_id FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?').get(r.target_id);
    if (r.target_type === 'comment') return db.prepare('SELECT c.body, c.status, u.username author, c.user_id FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(r.target_id);
    if (r.target_type === 'series') return db.prepare('SELECT title AS body, status, creator_id AS user_id FROM series WHERE id=?').get(r.target_id);
    return db.prepare('SELECT username author, id user_id FROM users WHERE id=?').get(r.target_id);
  };
  res.json(rows.map(r => ({ ...r, target: ctx(r) })));
});
app.post('/api/admin/reports/:id', admin, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(Number(req.params.id)); if (!r) return fail(res, 404, 'Not found.');
  const action = req.body.action; let authorId = null;
  if (r.target_type === 'message') { authorId = db.prepare('SELECT user_id FROM messages WHERE id=?').get(r.target_id)?.user_id; }
  if (r.target_type === 'comment') { authorId = db.prepare('SELECT user_id FROM comments WHERE id=?').get(r.target_id)?.user_id; }
  if (r.target_type === 'user') authorId = r.target_id;
  if (['hide', 'warn', 'ban'].includes(action)) {
    if (r.target_type === 'message') { db.prepare("UPDATE messages SET status='hidden' WHERE id=?").run(r.target_id); broadcastHide(r.target_id); }
    if (r.target_type === 'comment') db.prepare("UPDATE comments SET status='hidden' WHERE id=?").run(r.target_id);
    if (r.target_type === 'series' && action === 'hide') db.prepare("UPDATE series SET status='removed' WHERE id=?").run(r.target_id);
    const target = authorId && db.prepare('SELECT * FROM users WHERE id=?').get(authorId);
    if (target && target.role !== 'admin') {
      if (action === 'warn') addStrike(target, 'A moderator removed your content for violating the guidelines');
      if (action === 'ban') db.prepare('UPDATE users SET banned=1 WHERE id=?').run(target.id);
    }
  }
  db.prepare('UPDATE reports SET status=?, action=?, resolved_by=? WHERE id=?').run(action === 'dismiss' ? 'dismissed' : 'actioned', action, req.user.id, r.id);
  audit(req, 'report_' + action, `${r.target_type}#${r.target_id}`);
  res.json({ ok: true });
});
app.get('/api/admin/payouts', admin, (req, res) => res.json(db.prepare('SELECT p.*, u.username, u.payout_email FROM payouts p JOIN users u ON u.id=p.creator_id ORDER BY (p.status=\'requested\') DESC, p.id DESC LIMIT 50').all()));
app.post('/api/admin/payouts/:id', admin, (req, res) => {
  const p = db.prepare("SELECT * FROM payouts WHERE id=? AND status='requested'").get(Number(req.params.id)); if (!p) return fail(res, 404, 'No pending payout.');
  const ok = req.body.action === 'approve';
  db.transaction(() => {
    db.prepare('UPDATE payouts SET status=? WHERE id=?').run(ok ? 'paid' : 'rejected', p.id);
    if (!ok) db.prepare('UPDATE earnings SET payout_id=NULL WHERE payout_id=?').run(p.id);
    else db.prepare('INSERT INTO transactions(user_id,type,cents,note,created_at) VALUES(?,?,?,?,?)').run(p.creator_id, 'payout', p.cents, 'Payout sent (mark paid after real transfer)', now());
    audit(req, 'payout_' + (ok ? 'paid' : 'reject'), `#${p.id} ${p.cents}c`);
    notify(p.creator_id, ok ? `Your payout of $${(p.cents / 100).toFixed(2)} was approved.` : 'Your payout request was rejected — contact support.');
  })();
  res.json({ ok: true });
});
app.get('/api/admin/dmca', admin, (req, res) => res.json(db.prepare('SELECT d.*, s.title FROM dmca d JOIN series s ON s.id=d.series_id ORDER BY (d.status=\'open\') DESC, d.id DESC LIMIT 50').all()));
app.post('/api/admin/dmca/:id', admin, (req, res) => {
  const d = db.prepare('SELECT d.*, s.creator_id, s.title FROM dmca d JOIN series s ON s.id=d.series_id WHERE d.id=?').get(Number(req.params.id)); if (!d) return fail(res, 404, 'Not found.');
  const action = req.body.action;
  if (action === 'takedown') {
    db.prepare("UPDATE series SET status='removed' WHERE id=?").run(d.series_id);
    notify(d.creator_id, `"${d.title}" was removed after a copyright claim. You may file a counter-notice via support within 10 business days.`);
  } else if (action === 'counter') {
    db.prepare("UPDATE series SET status='ongoing' WHERE id=?").run(d.series_id);
  }
  audit(req, 'dmca_' + action, `#${d.id} series ${d.series_id}`);
  db.prepare('UPDATE dmca SET status=? WHERE id=?').run(action === 'takedown' ? 'takedown' : action === 'counter' ? 'counter' : 'dismissed', d.id);
  res.json({ ok: true });
});
app.get('/api/admin/users', admin, (req, res) => res.json(db.prepare('SELECT id,username,email,role,strikes,muted_until,banned,created_at FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 50').all(`%${clean(req.query.q, 40)}%`)));
app.post('/api/admin/users/:id', admin, (req, res) => {
  const id = Number(req.params.id), a = req.body.action;
  const target = db.prepare('SELECT role, banned FROM users WHERE id=?').get(id); if (!target) return fail(res, 404, 'User not found.');
  if (a === 'promote' && target.role !== 'admin' && !target.banned) { db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id); audit(req, 'user_promote', `user#${id}`); return res.json({ ok: true }); }
  if (a === 'demote' && target.role === 'admin' && id !== req.user.id) { db.prepare("UPDATE users SET role='reader' WHERE id=?").run(id); audit(req, 'user_demote', `user#${id}`); return res.json({ ok: true }); }
  if (target.role === 'admin') return fail(res, 400, 'Cannot act on admins (use demote, and not on yourself).');
  audit(req, 'user_' + a, `user#${id}`);
  if (a === 'ban') db.prepare('UPDATE users SET banned=1 WHERE id=?').run(id);
  if (a === 'unban') db.prepare('UPDATE users SET banned=0, strikes=0, muted_until=0 WHERE id=?').run(id);
  if (a === 'unmute') db.prepare('UPDATE users SET muted_until=0 WHERE id=?').run(id);
  res.json({ ok: true });
});

const audit = (req, action, target) => db.prepare('INSERT INTO audit(admin_id,action,target,created_at) VALUES(?,?,?,?)').run(req.user.id, action, String(target), now());
payments.mountRoutes(app, { needAuth, fail, needVerified });
require('./account').mount(app, { authLimiter, fail, needAuth, publicUser, sign });
copyright.mount(app, { needRole, fail, clean, notify, audit, secret: SECRET, upDir: upDir });
require('./features')(app, { needAuth, needRole, fail, clean, notify, audit, seriesSelect, shapeSeries, chapterAccess, paymentsMode: payments.paymentsMode, stripeCall: payments.stripeCall });
require('./advanced')(app, { needAuth, needRole, fail, clean, notify, audit, seriesSelect, shapeSeries });

// ---------- downloads page: lists whatever `npm run build:downloads` produced ----------
const dlDir = path.join(__dirname, '..', 'public', 'downloads');
const DL_INFO = {
  'InkVerse-Go-Live-Steps.pdf': ['PDF', 'Go-live steps: deploy & make it real', 'START HERE. Exact steps you must do: Render, Stripe, email, domain, payouts, legal, backups, launch tests, env variables.'],
  'InkVerse-Guide.pdf': ['PDF', 'Working guide & details', 'How InkVerse works for readers, creators and admins; business rules, moderation, architecture and design.'],
  'README.md': ['README', 'Setup & deployment guide', 'Install, environment variables, Docker / Render / VPS deployment, pre-launch checklist, troubleshooting.'],
  'design.md': ['DESIGN', 'design.md', 'Research summary, features, business rules, architecture, design system and motion spec.'],
  'tasks.md': ['TASKS', 'tasks.md', 'Complete task list: what is built and what to do next.'],
  'env.example.txt': ['ENV', '.env example', 'Every environment variable with safe defaults. Rename to .env.'],
  'inkverse.zip': ['ZIP', 'Full source code (zip)', 'The entire project: server, front end, docs, Dockerfile. Run npm install, then npm start.'],
};
app.get('/api/downloads', (req, res) => {
  const files = fs.existsSync(dlDir) ? fs.readdirSync(dlDir).filter(f => DL_INFO[f]) : [];
  res.json(Object.keys(DL_INFO).filter(f => files.includes(f)).map(f => ({ file: f, url: '/downloads/' + f, kind: DL_INFO[f][0], title: DL_INFO[f][1], desc: DL_INFO[f][2], bytes: fs.statSync(path.join(dlDir, f)).size })));
});

// ---------- static SPA ----------
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, file) => { if (/\.(js|css|html|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); }, // always revalidate app code after deploys
}));
app.use('/api', (req, res) => fail(res, 404, 'Unknown endpoint.'));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return fail(res, 400, 'Upload error: ' + err.message);
  console.error(err); fail(res, 500, 'Server error.');
});

// ---------- realtime chat ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const rooms = new Map(); // channelId -> Set<ws>
function broadcast(channelId, payload) { const s = JSON.stringify(payload); rooms.get(channelId)?.forEach(c => c.readyState === 1 && c.send(s)); }
function broadcastHide(messageId) {
  const m = db.prepare('SELECT channel_id FROM messages WHERE id=?').get(messageId); if (m) broadcast(m.channel_id, { type: 'hide', id: messageId });
}
const presence = id => rooms.get(id)?.size || 0;
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', ws => {
  let user = null, channel = null;
  const send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'join') {
      user = m.token ? userFromToken(m.token) : null;
      channel = db.prepare('SELECT * FROM channels WHERE id=?').get(Number(m.channel));
      if (!channel) return send({ type: 'error', error: 'Channel not found.' });
      if (!rooms.has(channel.id)) rooms.set(channel.id, new Set());
      rooms.get(channel.id).add(ws);
      broadcast(channel.id, { type: 'presence', count: presence(channel.id) });
      return send({ type: 'joined', canPost: !!user });
    }
    if (m.type === 'msg') {
      if (!user || !channel) return send({ type: 'error', error: 'Log in to chat.' });
      user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id); // refresh strikes/mutes
      if (user.banned) return send({ type: 'error', error: 'Your account is banned.' });
      if (db.prepare('SELECT 1 FROM channel_mutes WHERE channel_id=? AND user_id=?').get(channel.id, user.id)) return send({ type: 'error', error: 'The host muted you in this channel.' });
      const r = screenText(user, m.body);
      if (!r.ok) return send({ type: 'error', error: r.reason });
      const info = db.prepare('INSERT INTO messages(channel_id,user_id,body,created_at) VALUES(?,?,?,?)').run(channel.id, user.id, r.body, now());
      broadcast(channel.id, { type: 'msg', message: { id: info.lastInsertRowid, body: r.body, created_at: now(), user_id: user.id, username: user.username, role: user.role } });
      if (r.flagged) send({ type: 'notice', text: 'Some words were filtered and you received a strike.' });
    }
  });
  ws.on('close', () => { if (channel) { rooms.get(channel.id)?.delete(ws); broadcast(channel.id, { type: 'presence', count: presence(channel.id) }); } });
});

// ---------- scheduler: notify followers when chapters go live ----------
function releaseTick() {
  const due = db.prepare("SELECT c.id,c.number,c.title,c.series_id,s.title st FROM chapters c JOIN series s ON s.id=c.series_id WHERE c.notified=0 AND c.draft=0 AND c.review='ok' AND c.publish_at<=?").all(now());
  for (const c of due) {
    db.prepare('UPDATE chapters SET notified=1 WHERE id=?').run(c.id);
    for (const f of db.prepare('SELECT user_id FROM follows WHERE series_id=?').all(c.series_id)) notify(f.user_id, `New chapter: ${c.st} — #${c.number} ${c.title}`, `#/read/${c.id}`);
  }
}
setInterval(releaseTick, 30_000); releaseTick();

require('./seed').run();
copyright.backfill().catch(e => console.error('fingerprint backfill failed', e.message));
// ---------- automatic daily backups (kept in DATA_DIR/backups; also copy them off-server!) ----------
async function backupTick() {
  try {
    const dir = path.join(dataDir, 'backups'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `inkverse-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(f)) { await db.backup(f); console.log('Backup written:', f); }
    const keep = Number(process.env.BACKUP_KEEP || 7);
    fs.readdirSync(dir).filter(x => x.endsWith('.db')).sort().reverse().slice(keep).forEach(x => fs.unlinkSync(path.join(dir, x)));
  } catch (e) { console.error('Backup failed:', e.message); }
}
if (require.main === module) { backupTick(); setInterval(backupTick, 6 * 3600_000); }

if (require.main === module) server.listen(PORT, () => console.log(`InkVerse running → http://localhost:${PORT}`));
module.exports = { app, server };
