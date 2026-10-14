// v3 features: Premium tier, highlights, synced reader prefs & history, fair-ranking charts, related series,
// polls, comment management, chapter editing/drafts and per-chapter retention analytics.
const { db, RULES } = require('./db');
const DAY = 24 * 3600 * 1000;
const now = () => Date.now();
const isPremium = u => !!u && u.plan_until > now();

module.exports = function mount(app, { needAuth, needRole, fail, clean, notify, audit, seriesSelect, shapeSeries, chapterAccess, paymentsMode, stripeCall }) {
  // ================= Premium (subscription) =================
  const month = () => new Date().toISOString().slice(0, 7);
  const quotaLeft = u => RULES.premium.monthlyUnlocks - (db.prepare('SELECT n FROM premium_unlocks WHERE user_id=? AND month=?').get(u.id, month())?.n || 0);
  const premiumInfo = u => ({ active: isPremium(u), until: u.plan_until || null, cancelling: !!u.sub_cancel, cents: RULES.premium.cents, unlocksLeft: isPremium(u) ? quotaLeft(u) : 0,
    monthlyUnlocks: RULES.premium.monthlyUnlocks, mode: paymentsMode() });
  app.get('/api/premium', needAuth, (req, res) => res.json(premiumInfo(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))));
  app.post('/api/premium/subscribe', needAuth, async (req, res) => {
    const mode = paymentsMode();
    if (isPremium(req.user) && !req.user.sub_cancel) return fail(res, 400, 'You are already a Premium member.');
    if (mode === 'off') return fail(res, 400, 'Subscriptions are not enabled on this site.');
    if (mode === 'demo') {   // development only: no money moves
      db.prepare('UPDATE users SET plan_until=?, sub_cancel=0 WHERE id=?').run(Math.max(now(), req.user.plan_until) + RULES.premium.days * DAY, req.user.id);
      db.prepare('INSERT INTO transactions(user_id,type,cents,note,created_at) VALUES(?,?,?,?,?)').run(req.user.id, 'subscription', RULES.premium.cents, 'Premium (demo, no real charge)', now());
      return res.json({ ok: true, demo: true });
    }
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    try {
      const data = await stripeCall('/checkout/sessions', {
        mode: 'subscription', client_reference_id: String(req.user.id), ...(req.user.stripe_customer ? { customer: req.user.stripe_customer } : { customer_email: req.user.email }),
        success_url: `${base}/#/premium?paid=1`, cancel_url: `${base}/#/premium`, 'metadata[kind]': 'premium',
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(RULES.premium.cents),
        'line_items[0][price_data][recurring][interval]': 'month', 'line_items[0][price_data][product_data][name]': RULES.premium.label,
      });
      res.json({ url: data.url });
    } catch (e) { console.error('Stripe subscribe error:', e.message); fail(res, 502, 'Could not start checkout. Please try again.'); }
  });
  app.post('/api/premium/cancel', needAuth, async (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!isPremium(u)) return fail(res, 400, 'No active subscription.');
    try { if (u.stripe_sub && paymentsMode() === 'stripe') await stripeCall('/subscriptions/' + u.stripe_sub, { cancel_at_period_end: 'true' }); }
    catch (e) { console.error('Stripe cancel error:', e.message); return fail(res, 502, 'Could not cancel right now. Please try again.'); }
    db.prepare('UPDATE users SET sub_cancel=1 WHERE id=?').run(u.id);
    res.json({ ok: true, until: u.plan_until });
  });
  // Premium members unlock early-access chapters from a monthly allowance. Creators are still paid (half the coin rate, funded by the subscription).
  app.post('/api/chapters/:id/premium-unlock', needAuth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id); if (!isPremium(u)) return fail(res, 402, 'Premium membership required.');
    const a = chapterAccess(u, Number(req.params.id)); if (!a || a.status) return fail(res, a?.status || 404, a?.error || 'Chapter not found.');
    if (!a.locked) return res.json({ ok: true });
    if (quotaLeft(u) <= 0) return fail(res, 402, `You've used all ${RULES.premium.monthlyUnlocks} Premium unlocks this month.`);
    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO unlocks VALUES(?,?,?)').run(u.id, a.c.id, now());
      db.prepare('INSERT INTO premium_unlocks(user_id,month,n) VALUES(?,?,1) ON CONFLICT(user_id,month) DO UPDATE SET n=n+1').run(u.id, month());
      db.prepare('INSERT INTO earnings(creator_id,cents,source,series_id,available_at,created_at,payer_id,coins) VALUES(?,?,?,?,?,?,?,?)')
        .run(a.s.creator_id, +(a.c.price_coins * RULES.coinValueCents * RULES.creatorShareUnlock * 0.5).toFixed(4), 'unlock', a.s.id, now() + RULES.holdDays * DAY, now(), u.id, 0);
    })();
    res.json({ ok: true, left: quotaLeft(u) });
  });

  // ================= Highlights (persisted per user) =================
  const COLORS = ['yellow', 'green', 'pink', 'blue'];
  const hlShape = h => ({ id: h.id, chapter_id: h.chapter_id, kind: h.kind, para: h.para, start: h.start, end: h.end, text: h.text, page: h.page, x: h.x, y: h.y, w: h.w, h: h.h, color: h.color, note: h.note, created_at: h.created_at });
  app.get('/api/chapters/:id/highlights', needAuth, (req, res) => res.json(db.prepare('SELECT * FROM highlights WHERE user_id=? AND chapter_id=? ORDER BY para, start, page, id').all(req.user.id, Number(req.params.id)).map(hlShape)));
  app.post('/api/chapters/:id/highlights', needAuth, (req, res) => {
    const a = chapterAccess(req.user, Number(req.params.id)); if (!a || a.status || a.locked) return fail(res, 403, 'You can only highlight chapters you can read.');
    const b = req.body, color = COLORS.includes(b.color) ? b.color : 'yellow', note = clean(b.note, 500);
    const total = db.prepare('SELECT COUNT(*) n FROM highlights WHERE user_id=?').get(req.user.id).n;
    if (!isPremium(req.user) && total >= RULES.freeHighlightLimit) return fail(res, 402, `Free accounts can keep ${RULES.freeHighlightLimit} highlights. Go Premium for unlimited highlights.`);
    let info;
    if (b.kind === 'region') {
      const [x, y, w, h] = [b.x, b.y, b.w, b.h].map(Number), page = parseInt(b.page, 10);
      if (![x, y, w, h].every(Number.isFinite) || !(page >= 0) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > 100.01 || y + h > 100.01) return fail(res, 400, 'Invalid highlight area.');
      if (!a.c.pages || page >= JSON.parse(a.c.pages).length) return fail(res, 400, 'Invalid page.');
      info = db.prepare("INSERT INTO highlights(user_id,chapter_id,kind,page,x,y,w,h,color,note,created_at) VALUES(?,?,'region',?,?,?,?,?,?,?,?)").run(req.user.id, a.c.id, page, x, y, w, h, color, note, now());
    } else {
      const para = parseInt(b.para, 10), start = parseInt(b.start, 10), end = parseInt(b.end, 10), text = String(b.text || '').slice(0, 1500);
      if (!a.c.content || !(para >= 0) || !(start >= 0) || !(end > start) || !text) return fail(res, 400, 'Invalid selection.');
      const paras = a.c.content.split(/\n{2,}/); if (para >= paras.length || paras[para].slice(start, end) !== text) return fail(res, 400, 'Selection does not match the chapter text.');
      if (db.prepare("SELECT 1 FROM highlights WHERE user_id=? AND chapter_id=? AND kind='text' AND para=? AND start<? AND end>?").get(req.user.id, a.c.id, para, end, start)) return fail(res, 409, 'That text is already highlighted — click it to change or remove.');
      info = db.prepare("INSERT INTO highlights(user_id,chapter_id,kind,para,start,end,text,color,note,created_at) VALUES(?,?,'text',?,?,?,?,?,?,?)").run(req.user.id, a.c.id, para, start, end, text, color, note, now());
    }
    res.json(hlShape(db.prepare('SELECT * FROM highlights WHERE id=?').get(info.lastInsertRowid)));
  });
  app.patch('/api/highlights/:id', needAuth, (req, res) => {
    const h = db.prepare('SELECT * FROM highlights WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id); if (!h) return fail(res, 404, 'Highlight not found.');
    db.prepare('UPDATE highlights SET color=?, note=? WHERE id=?').run(COLORS.includes(req.body.color) ? req.body.color : h.color, req.body.note !== undefined ? clean(req.body.note, 500) : h.note, h.id);
    res.json(hlShape(db.prepare('SELECT * FROM highlights WHERE id=?').get(h.id)));
  });
  app.delete('/api/highlights/:id', needAuth, (req, res) => { db.prepare('DELETE FROM highlights WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id); res.json({ ok: true }); });
  app.get('/api/highlights', needAuth, (req, res) => res.json({
    limit: isPremium(req.user) ? null : RULES.freeHighlightLimit,
    items: db.prepare(`SELECT h.*, c.number, c.title ct, s.id sid, s.title st, s.type FROM highlights h JOIN chapters c ON c.id=h.chapter_id JOIN series s ON s.id=c.series_id
      WHERE h.user_id=? ORDER BY h.created_at DESC LIMIT 300`).all(req.user.id).map(h => ({ ...hlShape(h), number: h.number, chapter_title: h.ct, series_id: h.sid, series_title: h.st, type: h.type })),
  }));

  // ================= Synced reader preferences, progress, history =================
  const PREF_KEYS = { theme: ['light', 'dark', 'sepia', 'black'], font: ['serif', 'sans', 'dyslexic'], mode: ['scroll', 'paged', 'manga'], flip: [true, false], dual: [true, false] };
  app.get('/api/me/prefs', needAuth, (req, res) => { try { res.json(JSON.parse(req.user.prefs || '{}')); } catch { res.json({}); } });
  app.put('/api/me/prefs', needAuth, (req, res) => {
    const out = {}, b = req.body || {};
    for (const [k, allowed] of Object.entries(PREF_KEYS)) if (allowed.includes(b[k])) out[k] = b[k];
    for (const [k, lo, hi] of [['fs', 13, 30], ['lh', 1.3, 2.4], ['rate', 0.5, 2]]) if (Number.isFinite(+b[k]) && +b[k] >= lo && +b[k] <= hi) out[k] = +b[k];
    db.prepare('UPDATE users SET prefs=? WHERE id=?').run(JSON.stringify(out), req.user.id); res.json(out);
  });
  app.post('/api/chapters/:id/progress', needAuth, (req, res) => {
    const a = chapterAccess(req.user, Number(req.params.id)); if (!a || a.status || a.locked) return res.json({ ok: false });
    const page = Math.max(0, Math.min(5000, parseInt(req.body.page, 10) || 0)), pct = Math.max(0, Math.min(100, Number(req.body.pct) || 0));
    db.prepare('INSERT INTO progress(user_id,series_id,chapter_id,updated_at,page,pct) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,series_id) DO UPDATE SET chapter_id=excluded.chapter_id, updated_at=excluded.updated_at, page=excluded.page, pct=excluded.pct')
      .run(req.user.id, a.s.id, a.c.id, now(), page, pct);
    res.json({ ok: true });
  });
  app.get('/api/chapters/:id/progress', needAuth, (req, res) => {
    const p = db.prepare('SELECT chapter_id, page, pct FROM progress WHERE user_id=? AND chapter_id=?').get(req.user.id, Number(req.params.id)); res.json(p || { page: 0, pct: 0 });
  });
  app.get('/api/history', needAuth, (req, res) => res.json(db.prepare(`SELECT p.series_id, p.chapter_id, p.page, p.pct, p.updated_at, s.title, s.type, s.cover, c.number, c.title ct, c.words
    FROM progress p JOIN series s ON s.id=p.series_id JOIN chapters c ON c.id=p.chapter_id WHERE p.user_id=? AND s.status!='removed' ORDER BY p.updated_at DESC LIMIT 50`).all(req.user.id)
    .map(r => ({ ...r, cover: r.cover || `/gen/cover/${r.series_id}.svg` }))));

  // ================= Discovery: charts, spotlight, related =================
  app.get('/api/charts', (req, res) => {
    const base = `${seriesSelect} WHERE s.status!='removed' AND chapter_count>0`, p = { now: now(), recent: now() - 30 * DAY, week: new Date(now() - 7 * DAY).toISOString().slice(0, 10) };
    const q = (cond, order, extra = {}) => db.prepare(`${base} ${cond} ORDER BY ${order} LIMIT 12`).all({ ...p, ...extra }).map(shapeSeries);
    const hasPaid = 'AND EXISTS (SELECT 1 FROM chapters c WHERE c.series_id=s.id AND c.price_coins>0)';
    res.json({
      // ranked by reader demand (unlocks), never by how much a creator spends
      paid: q(hasPaid, '(SELECT COUNT(*) FROM unlocks u JOIN chapters c ON c.id=u.chapter_id WHERE c.series_id=s.id) DESC, followers DESC'),
      free: q(`AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.series_id=s.id AND c.price_coins>0)`, '(s.views + likes*20 + followers*30) DESC'),
      rising: q('AND s.created_at > @recent', '((SELECT COALESCE(SUM(v.views),0) FROM view_log v WHERE v.series_id=s.id AND v.day>=@week) + likes*20 + followers*30) DESC'),
      completed: q("AND s.status='completed'", 'rating DESC, likes DESC'),
      new: q('', 'updated_at DESC'),
      spotlight: q('AND s.created_at > @recent AND (SELECT COUNT(*) FROM series s2 WHERE s2.creator_id=s.creator_id)<=2', '(s.id * 7919 + @day) % 97', { day: Math.floor(now() / DAY) }).slice(0, 6),
    });
  });
  app.get('/api/series/:id/related', (req, res) => {
    const id = Number(req.params.id), s = db.prepare('SELECT genres FROM series WHERE id=?').get(id); if (!s) return res.json([]);
    const ids = new Map();
    for (const r of db.prepare(`SELECT l2.series_id sid, COUNT(*) n FROM likes l1 JOIN likes l2 ON l2.user_id=l1.user_id AND l2.series_id!=l1.series_id WHERE l1.series_id=? GROUP BY l2.series_id`).all(id)) ids.set(r.sid, r.n * 10);
    for (const r of db.prepare(`SELECT f2.series_id sid, COUNT(*) n FROM follows f1 JOIN follows f2 ON f2.user_id=f1.user_id AND f2.series_id!=f1.series_id WHERE f1.series_id=? GROUP BY f2.series_id`).all(id)) ids.set(r.sid, (ids.get(r.sid) || 0) + r.n * 10);
    const mine = new Set((s.genres || '').split(',').filter(Boolean));
    const rows = db.prepare(`${seriesSelect} WHERE s.status!='removed' AND s.id!=@id AND chapter_count>0`).all({ now: now(), id });
    res.json(rows.map(r => { const shared = (r.genres || '').split(',').filter(g => mine.has(g)).length; return { s: r, score: (ids.get(r.id) || 0) + shared * 3 + (r.rating || 3) }; })
      .sort((a, b) => b.score - a.score).slice(0, 6).map(x => ({ ...shapeSeries(x.s), reason: ids.get(x.s.id) ? 'Readers who liked this also liked' : 'Similar genres' })));
  });

  // ================= Engagement: pinned comments, comment moderation by creators, polls =================
  const commentOwner = id => db.prepare('SELECT c.*, s.creator_id FROM comments c JOIN chapters ch ON ch.id=c.chapter_id JOIN series s ON s.id=ch.series_id WHERE c.id=?').get(id);
  app.post('/api/comments/:id/pin', needAuth, (req, res) => {
    const c = commentOwner(Number(req.params.id)); if (!c || (c.creator_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Only the creator can pin comments.');
    const pinned = c.pinned ? 0 : 1; if (pinned) db.prepare('UPDATE comments SET pinned=0 WHERE chapter_id=?').run(c.chapter_id);
    db.prepare('UPDATE comments SET pinned=? WHERE id=?').run(pinned, c.id); res.json({ pinned: !!pinned });
  });
  app.delete('/api/comments/:id', needAuth, (req, res) => {
    const c = commentOwner(Number(req.params.id)); if (!c || (c.creator_id !== req.user.id && c.user_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not allowed.');
    db.prepare("UPDATE comments SET status='hidden', pinned=0 WHERE id=?").run(c.id); res.json({ ok: true });
  });
  app.get('/api/creator/comments', needRole('creator', 'admin'), (req, res) => res.json(db.prepare(`SELECT c.id, c.body, c.created_at, c.pinned, c.chapter_id, u.username, ch.number, s.title st FROM comments c JOIN users u ON u.id=c.user_id
    JOIN chapters ch ON ch.id=c.chapter_id JOIN series s ON s.id=ch.series_id WHERE s.creator_id=? AND c.status='visible' ORDER BY c.id DESC LIMIT 60`).all(req.user.id)));

  const pollShape = (p, uid) => { const opts = JSON.parse(p.options), votes = db.prepare('SELECT choice, COUNT(*) n FROM poll_votes WHERE poll_id=? GROUP BY choice').all(p.id), my = uid ? db.prepare('SELECT choice FROM poll_votes WHERE poll_id=? AND user_id=?').get(p.id, uid)?.choice : undefined;
    return { id: p.id, question: p.question, options: opts.map((t, i) => ({ text: t, votes: votes.find(v => v.choice === i)?.n || 0 })), mine: my ?? null }; };
  app.get('/api/chapters/:id/poll', (req, res) => { const a = chapterAccess(req.user, Number(req.params.id)); if (!a || a.status) return res.json(null);   // polls follow chapter visibility
    const p = db.prepare('SELECT * FROM polls WHERE chapter_id=? ORDER BY id DESC').get(a.c.id); res.json(p ? pollShape(p, req.user?.id) : null); });
  app.post('/api/chapters/:id/poll', needRole('creator', 'admin'), (req, res) => {
    const a = chapterAccess(req.user, Number(req.params.id)); if (!a || (a.s.creator_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not your chapter.');
    const question = clean(req.body.question, 140), options = (Array.isArray(req.body.options) ? req.body.options : []).map(o => clean(o, 60)).filter(Boolean).slice(0, 5);
    if (question.length < 5 || options.length < 2) return fail(res, 400, 'A poll needs a question and 2-5 options.');
    db.prepare('DELETE FROM polls WHERE chapter_id=?').run(a.c.id);
    const id = db.prepare('INSERT INTO polls(chapter_id,question,options,created_at) VALUES(?,?,?,?)').run(a.c.id, question, JSON.stringify(options), now()).lastInsertRowid;
    res.json(pollShape(db.prepare('SELECT * FROM polls WHERE id=?').get(id), req.user.id));
  });
  app.post('/api/polls/:id/vote', needAuth, (req, res) => {
    const p = db.prepare('SELECT * FROM polls WHERE id=?').get(Number(req.params.id)); if (!p) return fail(res, 404, 'Poll not found.');
    const a = chapterAccess(req.user, p.chapter_id); if (!a || a.status || a.locked) return fail(res, 403, 'Read the chapter to vote.');
    const choice = parseInt(req.body.choice, 10); if (!(choice >= 0 && choice < JSON.parse(p.options).length)) return fail(res, 400, 'Invalid choice.');
    db.prepare('INSERT INTO poll_votes VALUES(?,?,?) ON CONFLICT(poll_id,user_id) DO UPDATE SET choice=excluded.choice').run(p.id, req.user.id, choice);
    res.json(pollShape(p, req.user.id));
  });

  // ================= Creator tools: edit / publish drafts / delete chapters, retention analytics =================
  const ownChapter = (req, res) => {
    const c = db.prepare('SELECT c.*, s.creator_id, s.status sstatus FROM chapters c JOIN series s ON s.id=c.series_id WHERE c.id=?').get(Number(req.params.id));
    if (!c || (c.creator_id !== req.user.id && req.user.role !== 'admin')) { fail(res, 403, 'Not your chapter.'); return null; } return c;
  };
  app.patch('/api/chapters/:id', needRole('creator', 'admin'), (req, res) => {
    const c = ownChapter(req, res); if (!c) return; const b = req.body;
    let publishAt = c.publish_at, draft = c.draft;
    if (b.publish === 'now') { publishAt = now() - 1000; draft = 0; }
    else if (b.publish === 'date' && Date.parse(b.publish_at)) { publishAt = Math.max(Date.parse(b.publish_at), now()); draft = 0; }
    else if (b.draft === true && c.publish_at > now()) draft = 1;
    db.prepare('UPDATE chapters SET title=?, author_note=?, draft=?, publish_at=?, notified=? WHERE id=?').run(b.title !== undefined ? clean(b.title, 100) || c.title : c.title,
      b.author_note !== undefined ? clean(b.author_note, 500) || null : c.author_note, draft, publishAt, publishAt !== c.publish_at ? 0 : c.notified, c.id);
    res.json({ ok: true });
  });
  app.delete('/api/chapters/:id', needRole('creator', 'admin'), (req, res) => {
    const c = ownChapter(req, res); if (!c) return;
    if (db.prepare('SELECT 1 FROM unlocks WHERE chapter_id=? LIMIT 1').get(c.id)) return fail(res, 400, 'Readers have paid for this chapter, so it cannot be deleted. Contact support if there is a problem.');
    db.prepare('DELETE FROM chapters WHERE id=?').run(c.id); db.prepare('DELETE FROM fingerprints WHERE chapter_id=?').run(c.id); res.json({ ok: true });
  });
  app.get('/api/creator/series/:id/retention', needRole('creator', 'admin'), (req, res) => {
    const s = db.prepare('SELECT * FROM series WHERE id=?').get(Number(req.params.id)); if (!s || (s.creator_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not your series.');
    const rows = db.prepare(`SELECT c.id, c.number, c.title, c.price_coins, c.views,
      (SELECT COUNT(*) FROM chapter_reads r WHERE r.chapter_id=c.id) readers, (SELECT COUNT(*) FROM unlocks u WHERE u.chapter_id=c.id) unlocks
      FROM chapters c WHERE c.series_id=? AND c.draft=0 AND c.publish_at<=? ORDER BY c.number`).all(s.id, now());
    const first = rows[0]?.readers || 0; let prev = null;
    res.json(rows.map(r => { const out = { ...r, retention: first ? Math.round(r.readers / first * 100) : null, dropoff: prev && prev.readers ? Math.round((1 - r.readers / prev.readers) * 100) : 0,
      // share of readers who reached the previous chapter and paid to continue
      conversion: r.price_coins && prev?.readers ? Math.round(r.unlocks / prev.readers * 100) : null }; prev = r; return out; }));
  });
};
module.exports.isPremium = isPremium;
