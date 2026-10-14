// v4: written reviews, chapter Q&A, public creator profiles + following, contests, earnings CSV export.
const { db, RULES } = require('./db');
const { screenText } = require('./moderation');
const DAY = 24 * 3600 * 1000;
const now = () => Date.now();

module.exports = function mount(app, { needAuth, needRole, needVerified, fail, clean, notify, audit, seriesSelect, shapeSeries, chapterAccess }) {
  const hasRead = (uid, sid) => !!db.prepare('SELECT 1 FROM chapter_reads WHERE user_id=? AND series_id=? LIMIT 1').get(uid, sid) || !!db.prepare('SELECT 1 FROM progress WHERE user_id=? AND series_id=?').get(uid, sid);

  // ================= Reviews =================
  const reviewShape = (r, uid) => ({ id: r.id, user_id: r.user_id, username: r.username, stars: r.stars, body: r.body, created_at: r.created_at, helpful: r.helpful, voted: !!r.voted, mine: r.user_id === uid });
  app.get('/api/series/:id/reviews', (req, res) => {
    const sid = Number(req.params.id), uid = req.user?.id || 0;
    const items = db.prepare(`SELECT v.*, u.username, (SELECT COUNT(*) FROM review_votes h WHERE h.review_id=v.id) helpful,
      (SELECT 1 FROM review_votes h WHERE h.review_id=v.id AND h.user_id=?) voted FROM reviews v JOIN users u ON u.id=v.user_id
      WHERE v.series_id=? AND v.status='visible' ORDER BY helpful DESC, v.id DESC LIMIT 50`).all(uid, sid).map(r => reviewShape(r, uid));
    const dist = [0, 0, 0, 0, 0]; for (const r of db.prepare("SELECT stars, COUNT(*) n FROM reviews WHERE series_id=? AND status='visible' GROUP BY stars").all(sid)) dist[r.stars - 1] = r.n;
    const count = dist.reduce((a, b) => a + b, 0);
    res.json({ summary: { count, avg: count ? +(dist.reduce((a, n, i) => a + n * (i + 1), 0) / count).toFixed(2) : null, dist }, items, canReview: !!req.user && hasRead(uid, sid) });
  });
  app.post('/api/series/:id/reviews', needAuth, (req, res) => {
    const s = db.prepare("SELECT * FROM series WHERE id=? AND status!='removed'").get(Number(req.params.id)); if (!s) return fail(res, 404, 'Series not found.');
    if (s.creator_id === req.user.id) return fail(res, 400, "You can't review your own series.");
    if (!hasRead(req.user.id, s.id)) return fail(res, 403, 'Read at least one chapter before reviewing.');
    const stars = Math.round(Number(req.body.stars)); if (!(stars >= 1 && stars <= 5)) return fail(res, 400, 'Choose 1-5 stars.');
    const body = clean(req.body.body, 2000); if (body.length < 20) return fail(res, 400, 'Please write at least 20 characters.');
    const r = screenText(req.user, body, { kind: 'comment' }); if (!r.ok) return fail(res, 400, r.reason);
    db.transaction(() => {
      db.prepare("INSERT INTO reviews(series_id,user_id,stars,body,created_at) VALUES(?,?,?,?,?) ON CONFLICT(series_id,user_id) DO UPDATE SET stars=excluded.stars, body=excluded.body, status='visible', created_at=excluded.created_at").run(s.id, req.user.id, stars, r.body, now());
      db.prepare('INSERT INTO ratings VALUES(?,?,?) ON CONFLICT(user_id,series_id) DO UPDATE SET stars=excluded.stars').run(req.user.id, s.id, stars);   // keeps the headline rating in sync
    })();
    notify(s.creator_id, `${req.user.username} reviewed "${s.title}" (${'★'.repeat(stars)})`, `#/series/${s.id}`);
    res.json({ ok: true });
  });
  app.post('/api/reviews/:id/helpful', needAuth, (req, res) => {
    const r = db.prepare("SELECT * FROM reviews WHERE id=? AND status='visible'").get(Number(req.params.id)); if (!r) return fail(res, 404, 'Review not found.');
    if (r.user_id === req.user.id) return fail(res, 400, "You can't vote on your own review.");
    const had = db.prepare('DELETE FROM review_votes WHERE review_id=? AND user_id=?').run(r.id, req.user.id).changes;
    if (!had) db.prepare('INSERT INTO review_votes VALUES(?,?)').run(r.id, req.user.id); res.json({ on: !had });
  });
  app.delete('/api/reviews/:id', needAuth, (req, res) => {
    const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(Number(req.params.id)); if (!r || (r.user_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not allowed.');
    db.prepare('DELETE FROM reviews WHERE id=?').run(r.id); res.json({ ok: true });
  });

  // ================= Chapter Q&A (reader asks, creator answers) =================
  app.get('/api/chapters/:id/qa', (req, res) => {
    const a = chapterAccess(req.user, Number(req.params.id)); if (!a || a.status) return res.json([]);
    const mine = a.own;
    res.json(db.prepare("SELECT q.*, u.username FROM qa q JOIN users u ON u.id=q.user_id WHERE q.chapter_id=? AND q.status='visible' ORDER BY (q.answer IS NOT NULL) DESC, q.id DESC LIMIT 50").all(a.c.id)
      .filter(q => q.answer || mine || q.user_id === req.user?.id)
      .map(q => ({ id: q.id, username: q.username, question: q.question, answer: q.answer, answered_at: q.answered_at, created_at: q.created_at, mine: q.user_id === req.user?.id })));
  });
  app.post('/api/chapters/:id/qa', needAuth, (req, res) => {
    const a = chapterAccess(req.user, Number(req.params.id)); if (!a || a.status || a.locked) return fail(res, 403, 'Read the chapter to ask a question.');
    if (db.prepare("SELECT COUNT(*) n FROM qa WHERE chapter_id=? AND user_id=? AND answer IS NULL").get(a.c.id, req.user.id).n >= 2) return fail(res, 429, 'You already have 2 unanswered questions on this chapter.');
    const r = screenText(req.user, req.body.question, { kind: 'comment' }); if (!r.ok) return fail(res, 400, r.reason); if (r.body.length < 8) return fail(res, 400, 'Ask a complete question.');
    const id = db.prepare('INSERT INTO qa(chapter_id,user_id,question,created_at) VALUES(?,?,?,?)').run(a.c.id, req.user.id, r.body, now()).lastInsertRowid;
    notify(a.s.creator_id, `${req.user.username} asked a question on "${a.s.title}" ch.${a.c.number}`, `#/read/${a.c.id}`); res.json({ id });
  });
  app.post('/api/qa/:id/answer', needAuth, (req, res) => {
    const q = db.prepare('SELECT q.*, s.creator_id, s.title st FROM qa q JOIN chapters c ON c.id=q.chapter_id JOIN series s ON s.id=c.series_id WHERE q.id=?').get(Number(req.params.id));
    if (!q || (q.creator_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Only the creator can answer.');
    const answer = clean(req.body.answer, 1000); if (answer.length < 2) return fail(res, 400, 'Write an answer.');
    db.prepare('UPDATE qa SET answer=?, answered_at=? WHERE id=?').run(answer, now(), q.id); notify(q.user_id, `${req.user.username} answered your question about "${q.st}"`, `#/read/${q.chapter_id}`); res.json({ ok: true });
  });
  app.delete('/api/qa/:id', needAuth, (req, res) => {
    const q = db.prepare('SELECT q.*, s.creator_id FROM qa q JOIN chapters c ON c.id=q.chapter_id JOIN series s ON s.id=c.series_id WHERE q.id=?').get(Number(req.params.id));
    if (!q || (q.creator_id !== req.user.id && q.user_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not allowed.');
    db.prepare("UPDATE qa SET status='hidden' WHERE id=?").run(q.id); res.json({ ok: true });
  });

  // ================= Creator profiles =================
  app.get('/api/creators/:id', (req, res) => {
    const u = db.prepare("SELECT id,username,bio,role,created_at FROM users WHERE id=? AND banned=0 AND role IN ('creator','admin')").get(Number(req.params.id)); if (!u) return fail(res, 404, 'Creator not found.');
    const series = db.prepare(`${seriesSelect} WHERE s.creator_id=@u AND s.status!='removed' AND chapter_count>0 ORDER BY updated_at DESC`).all({ now: now(), u: u.id }).map(shapeSeries);
    res.json({ ...u, series, followers: db.prepare('SELECT COUNT(*) n FROM creator_follows WHERE creator_id=?').get(u.id).n,
      totals: { series: series.length, followers: series.reduce((a, s) => a + s.followers, 0), views: series.reduce((a, s) => a + s.views, 0) },
      following: req.user ? !!db.prepare('SELECT 1 FROM creator_follows WHERE user_id=? AND creator_id=?').get(req.user.id, u.id) : false });
  });
  app.post('/api/creators/:id/follow', needAuth, (req, res) => {
    const id = Number(req.params.id); if (id === req.user.id) return fail(res, 400, "You can't follow yourself.");
    if (!db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('creator','admin') AND banned=0").get(id)) return fail(res, 404, 'Creator not found.');
    const had = db.prepare('DELETE FROM creator_follows WHERE user_id=? AND creator_id=?').run(req.user.id, id).changes;
    if (!had) db.prepare('INSERT INTO creator_follows VALUES(?,?)').run(req.user.id, id); res.json({ on: !had });
  });

  // ================= Contests =================
  const admin = needRole('admin');
  const standings = (cid, uid) => db.prepare(`SELECT e.series_id, s.title, s.cover, s.type, u.username creator, e.creator_id, (SELECT COUNT(*) FROM contest_votes v WHERE v.contest_id=e.contest_id AND v.series_id=e.series_id) votes,
      ${uid ? '(SELECT 1 FROM contest_votes v WHERE v.contest_id=e.contest_id AND v.series_id=e.series_id AND v.user_id=?)' : '0'} mine
      FROM contest_entries e JOIN series s ON s.id=e.series_id JOIN users u ON u.id=e.creator_id WHERE e.contest_id=? ORDER BY votes DESC, e.created_at ASC`).all(...(uid ? [uid, cid] : [cid]))
    .map(r => ({ ...r, cover: r.cover || `/gen/cover/${r.series_id}.svg`, mine: !!r.mine }));
  function closeContest(c) {
    const top = standings(c.id)[0];
    db.prepare("UPDATE contests SET status='closed', winner_series_id=? WHERE id=?").run(top && top.votes > 0 ? top.series_id : null, c.id);
    if (top && top.votes > 0) notify(top.creator_id, `🏆 "${top.title}" won the contest "${c.title}"! ${c.prize ? 'Prize: ' + c.prize + '. ' : ''}We will contact you about the prize.`, `#/contests`);
    for (const e of db.prepare('SELECT DISTINCT creator_id FROM contest_entries WHERE contest_id=?').all(c.id)) if (!top || e.creator_id !== top.creator_id) notify(e.creator_id, `The contest "${c.title}" has ended. Thank you for entering!`, '#/contests');
  }
  const tick = () => { for (const c of db.prepare("SELECT * FROM contests WHERE status='open' AND ends_at<=?").all(now())) closeContest(c); };
  app.get('/api/contests', (req, res) => res.json(db.prepare('SELECT c.*, (SELECT COUNT(*) FROM contest_entries e WHERE e.contest_id=c.id) entries, (SELECT title FROM series s WHERE s.id=c.winner_series_id) winner FROM contests c ORDER BY (c.status=\'open\') DESC, c.ends_at DESC LIMIT 30').all()));
  app.get('/api/contests/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM contests WHERE id=?').get(Number(req.params.id)); if (!c) return fail(res, 404, 'Contest not found.');
    const myVote = req.user ? db.prepare('SELECT series_id FROM contest_votes WHERE contest_id=? AND user_id=?').get(c.id, req.user.id)?.series_id || null : null;
    const mySeries = req.user && ['creator', 'admin'].includes(req.user.role) ? db.prepare("SELECT id,title FROM series WHERE creator_id=? AND status!='removed'").all(req.user.id) : [];
    const entered = req.user ? !!db.prepare('SELECT 1 FROM contest_entries WHERE contest_id=? AND creator_id=?').get(c.id, req.user.id) : false;
    res.json({ ...c, entries: standings(c.id, req.user?.id), myVote, mySeries, entered });
  });
  app.post('/api/admin/contests', admin, (req, res) => {
    const title = clean(req.body.title, 80), days = Math.max(1, Math.min(90, parseInt(req.body.days, 10) || 14)); if (title.length < 4) return fail(res, 400, 'Give the contest a title.');
    const id = db.prepare('INSERT INTO contests(title,description,prize,ends_at,created_at) VALUES(?,?,?,?,?)').run(title, clean(req.body.description, 1000), clean(req.body.prize, 200), now() + days * DAY, now()).lastInsertRowid;
    audit(req, 'contest_create', title); res.json({ id });
  });
  app.post('/api/admin/contests/:id/close', admin, (req, res) => {
    const c = db.prepare("SELECT * FROM contests WHERE id=? AND status='open'").get(Number(req.params.id)); if (!c) return fail(res, 404, 'No open contest.');
    closeContest(c); audit(req, 'contest_close', c.title); res.json({ ok: true });
  });
  app.post('/api/contests/:id/enter', needRole('creator', 'admin'), (req, res) => {
    const c = db.prepare("SELECT * FROM contests WHERE id=? AND status='open' AND ends_at>?").get(Number(req.params.id), now()); if (!c) return fail(res, 404, 'This contest is closed.');
    const s = db.prepare("SELECT * FROM series WHERE id=? AND creator_id=? AND status!='removed'").get(Number(req.body.series_id), req.user.id); if (!s) return fail(res, 403, 'Pick one of your own series.');
    if (!db.prepare("SELECT 1 FROM chapters WHERE series_id=? AND draft=0 AND review='ok' AND publish_at<=? LIMIT 1").get(s.id, now())) return fail(res, 400, 'Publish at least one chapter first.');
    if (db.prepare('SELECT 1 FROM contest_entries WHERE contest_id=? AND creator_id=?').get(c.id, req.user.id)) return fail(res, 409, 'You can enter one series per contest.');
    db.prepare('INSERT INTO contest_entries VALUES(?,?,?,?)').run(c.id, s.id, req.user.id, now()); res.json({ ok: true });
  });
  app.post('/api/contests/:id/vote', needAuth, needVerified, (req, res) => {
    const c = db.prepare("SELECT * FROM contests WHERE id=? AND status='open' AND ends_at>?").get(Number(req.params.id), now()); if (!c) return fail(res, 404, 'This contest is closed.');
    const e = db.prepare('SELECT * FROM contest_entries WHERE contest_id=? AND series_id=?').get(c.id, Number(req.body.series_id)); if (!e) return fail(res, 404, 'Not an entry in this contest.');
    if (e.creator_id === req.user.id) return fail(res, 400, "You can't vote for your own entry.");
    if (!hasRead(req.user.id, e.series_id)) return fail(res, 403, 'Read at least one chapter of a series before voting for it.');   // anti-abuse: votes come from readers
    db.prepare('INSERT INTO contest_votes VALUES(?,?,?) ON CONFLICT(contest_id,user_id) DO UPDATE SET series_id=excluded.series_id').run(c.id, req.user.id, e.series_id); res.json({ ok: true });
  });

  // ================= Earnings export (CSV) =================
  const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };   // also defuses spreadsheet formula injection
  app.get('/api/creator/earnings.csv', needRole('creator', 'admin'), (req, res) => {
    const rows = db.prepare(`SELECT e.created_at, e.source, s.title, e.coins, e.cents, e.available_at, e.payout_id, p.status pstatus FROM earnings e LEFT JOIN series s ON s.id=e.series_id LEFT JOIN payouts p ON p.id=e.payout_id WHERE e.creator_id=? ORDER BY e.id DESC`).all(req.user.id);
    const out = [['date', 'source', 'series', 'coins', 'earned_usd', 'status']].concat(rows.map(r => [new Date(r.created_at).toISOString().slice(0, 10), r.source, r.title, r.coins, (r.cents / 100).toFixed(4),
      r.payout_id ? (r.pstatus === 'paid' ? 'paid out' : 'in payout request') : r.available_at > now() ? 'on hold' : 'available']));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="inkverse-earnings.csv"' }).send(out.map(r => r.map(csvCell).join(',')).join('\n'));
  });
  return { tick };
};
