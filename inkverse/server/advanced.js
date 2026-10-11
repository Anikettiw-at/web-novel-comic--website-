// v2 "advanced" features, mounted onto the main app: reactions, streaks, badges, recommendations,
// search suggestions, analytics, supporters leaderboard, appeals, audit log, editable word filter.
const { db, RULES } = require('./db');
const { reloadWords } = require('./moderation');
const DAY = 24 * 3600 * 1000;
const now = () => Date.now();

module.exports = function mount(app, { needAuth, needRole, fail, clean, notify, audit, seriesSelect, shapeSeries }) {
  // ---- chapter reactions
  app.post('/api/chapters/:id/react', needAuth, (req, res) => {
    const emoji = req.body.emoji; if (!RULES.reactions.includes(emoji)) return fail(res, 400, 'Unsupported reaction.');
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM chapters WHERE id=? AND publish_at<=?').get(id, now())) return fail(res, 404, 'Chapter not found.');
    const had = db.prepare('DELETE FROM reactions WHERE chapter_id=? AND user_id=? AND emoji=?').run(id, req.user.id, emoji).changes;
    if (!had) db.prepare('INSERT INTO reactions VALUES(?,?,?)').run(id, req.user.id, emoji);
    res.json({ on: !had });
  });

  // ---- daily check-in streak (retention loop; free coins are funded from the platform margin, never from creators)
  app.post('/api/checkin', needAuth, (req, res) => {
    const day = Math.floor(now() / DAY), u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (u.last_checkin === day) return fail(res, 400, 'Already claimed today — come back tomorrow!');
    const streak = u.last_checkin === day - 1 ? u.streak + 1 : 1, reward = RULES.checkinRewards[(streak - 1) % RULES.checkinRewards.length];
    db.transaction(() => {
      db.prepare('UPDATE users SET coins=coins+?, streak=?, last_checkin=? WHERE id=?').run(reward, streak, day, u.id);
      db.prepare('INSERT INTO transactions(user_id,type,coins,note,created_at) VALUES(?,?,?,?,?)').run(u.id, 'bonus', reward, `Daily check-in (day ${streak})`, now());
    })();
    res.json({ reward, streak, coins: u.coins + reward });
  });

  // ---- achievements (computed on the fly)
  app.get('/api/me/badges', needAuth, (req, res) => {
    const u = req.user, c = (sql) => db.prepare(sql).get(u.id).n;
    const read = c('SELECT COUNT(*) n FROM progress WHERE user_id=?'), comments = c('SELECT COUNT(*) n FROM comments WHERE user_id=?'),
      msgs = c('SELECT COUNT(*) n FROM messages WHERE user_id=?'), hosted = c('SELECT COUNT(*) n FROM channels WHERE owner_id=?'),
      tips = c("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND type='tip_sent'"), unlocks = c('SELECT COUNT(*) n FROM unlocks WHERE user_id=?'),
      pub = c('SELECT COUNT(*) n FROM series WHERE creator_id=?'), chs = c('SELECT COUNT(*) n FROM chapters ch JOIN series s ON s.id=ch.series_id WHERE s.creator_id=?');
    res.json([
      { icon: '📖', name: 'Bookworm', desc: 'Start reading 3 series', earned: read >= 3 },
      { icon: '💬', name: 'Chatterbox', desc: 'Post 10 chat messages', earned: msgs >= 10 },
      { icon: '✍️', name: 'Critic', desc: 'Leave 5 comments', earned: comments >= 5 },
      { icon: '🏠', name: 'Host', desc: 'Host a discussion channel', earned: hosted >= 1 },
      { icon: '💖', name: 'Supporter', desc: 'Tip a creator', earned: tips >= 1 },
      { icon: '🔓', name: 'Early Bird', desc: 'Unlock 3 early-access chapters', earned: unlocks >= 3 },
      { icon: '🔥', name: 'On Fire', desc: '7-day check-in streak', earned: u.streak >= 7 },
      { icon: '🎨', name: 'Creator', desc: 'Publish your first series', earned: pub >= 1 },
      { icon: '📚', name: 'Prolific', desc: 'Publish 10 chapters', earned: chs >= 10 },
    ]);
  });

  // ---- personalised recommendations: genre affinity from likes / follows / reading / ratings
  app.get('/api/recommendations', needAuth, (req, res) => {
    const uid = req.user.id, w = {};
    const bump = (genres, v) => (genres || '').split(',').filter(Boolean).forEach(g => w[g] = (w[g] || 0) + v);
    for (const r of db.prepare('SELECT s.genres FROM likes l JOIN series s ON s.id=l.series_id WHERE l.user_id=?').all(uid)) bump(r.genres, 2);
    for (const r of db.prepare('SELECT s.genres FROM follows f JOIN series s ON s.id=f.series_id WHERE f.user_id=?').all(uid)) bump(r.genres, 3);
    for (const r of db.prepare('SELECT s.genres FROM progress p JOIN series s ON s.id=p.series_id WHERE p.user_id=?').all(uid)) bump(r.genres, 2);
    for (const r of db.prepare('SELECT s.genres, r.stars FROM ratings r JOIN series s ON s.id=r.series_id WHERE r.user_id=?').all(uid)) bump(r.genres, r.stars >= 4 ? 2 : -1);
    const seen = new Set([...db.prepare('SELECT series_id FROM progress WHERE user_id=?').all(uid), ...db.prepare('SELECT series_id FROM follows WHERE user_id=?').all(uid)].map(r => r.series_id));
    const rows = db.prepare(`${seriesSelect} WHERE s.status!='removed' AND chapter_count>0`).all({ now: now() }).filter(s => !seen.has(s.id));
    res.json(rows.map(s => {
      const gs = s.genres.split(',').filter(Boolean), aff = gs.reduce((a, g) => a + (w[g] || 0), 0);
      const best = [...gs].sort((a, b) => (w[b] || 0) - (w[a] || 0))[0];
      return { ...shapeSeries(s), score: aff * 10 + (s.rating || 3) * 2 + Math.log10(1 + s.views) + s.followers, reason: aff > 0 ? `Because you like ${best}` : 'Popular right now' };
    }).sort((a, b) => b.score - a.score).slice(0, 12));
  });

  // ---- search autocomplete
  app.get('/api/search/suggest', (req, res) => {
    const q = clean(req.query.q, 40); if (q.length < 2) return res.json([]);
    res.json(db.prepare("SELECT s.id, s.title, s.type, u.username creator FROM series s JOIN users u ON u.id=s.creator_id WHERE s.status!='removed' AND (s.title LIKE ? OR u.username LIKE ?) ORDER BY (s.title LIKE ?) DESC, s.views DESC LIMIT 6")
      .all(`%${q}%`, `%${q}%`, `${q}%`).map(r => ({ ...r, cover: `/gen/cover/${r.id}.svg` })));
  });

  // ---- supporters leaderboard + creator analytics
  app.get('/api/series/:id/supporters', (req, res) => res.json(db.prepare(
    'SELECT u.username, SUM(e.coins) coins FROM earnings e JOIN users u ON u.id=e.payer_id WHERE e.series_id=? AND e.payer_id IS NOT NULL GROUP BY e.payer_id ORDER BY coins DESC LIMIT 5').all(Number(req.params.id))));
  app.get('/api/creator/analytics', needRole('creator', 'admin'), (req, res) => {
    const days = []; for (let i = 29; i >= 0; i--) days.push(new Date(now() - i * DAY).toISOString().slice(0, 10));
    const vmap = Object.fromEntries(db.prepare('SELECT v.day, SUM(v.views) n FROM view_log v JOIN series s ON s.id=v.series_id WHERE s.creator_id=? GROUP BY v.day').all(req.user.id).map(r => [r.day, r.n]));
    const emap = Object.fromEntries(db.prepare("SELECT date(created_at/1000,'unixepoch') d, SUM(cents) n FROM earnings WHERE creator_id=? GROUP BY d").all(req.user.id).map(r => [r.d, r.n]));
    res.json({
      days, views: days.map(d => vmap[d] || 0), earnings: days.map(d => +(emap[d] || 0).toFixed(2)),
      split: db.prepare('SELECT source, ROUND(SUM(cents),2) cents, COUNT(*) n FROM earnings WHERE creator_id=? GROUP BY source').all(req.user.id),
      topChapters: db.prepare('SELECT c.title, c.number, s.title st, c.views FROM chapters c JOIN series s ON s.id=c.series_id WHERE s.creator_id=? ORDER BY c.views DESC LIMIT 5').all(req.user.id),
      supporters: db.prepare('SELECT u.username, SUM(e.coins) coins FROM earnings e JOIN users u ON u.id=e.payer_id WHERE e.creator_id=? AND e.payer_id IS NOT NULL GROUP BY e.payer_id ORDER BY coins DESC LIMIT 5').all(req.user.id),
    });
  });

  // ---- appeals: users contest strikes/mutes, admins review (transparency + due process)
  app.post('/api/appeals', needAuth, (req, res) => {
    const text = clean(req.body.text, 1000); if (text.length < 20) return fail(res, 400, 'Please explain your appeal (20+ characters).');
    if (!req.user.strikes && req.user.muted_until < now()) return fail(res, 400, 'You have no active strikes or mutes to appeal.');
    if (db.prepare("SELECT 1 FROM appeals WHERE user_id=? AND status='open'").get(req.user.id)) return fail(res, 400, 'You already have an appeal under review.');
    db.prepare('INSERT INTO appeals(user_id,text,created_at) VALUES(?,?,?)').run(req.user.id, text, now()); res.json({ ok: true });
  });
  const admin = needRole('admin');
  app.get('/api/admin/appeals', admin, (req, res) => res.json(db.prepare("SELECT a.*, u.username, u.strikes FROM appeals a JOIN users u ON u.id=a.user_id ORDER BY (a.status='open') DESC, a.id DESC LIMIT 50").all()));
  app.post('/api/admin/appeals/:id', admin, (req, res) => {
    const a = db.prepare("SELECT * FROM appeals WHERE id=? AND status='open'").get(Number(req.params.id)); if (!a) return fail(res, 404, 'No open appeal.');
    const ok = req.body.action === 'accept';
    db.transaction(() => {
      db.prepare('UPDATE appeals SET status=? WHERE id=?').run(ok ? 'accepted' : 'rejected', a.id);
      if (ok) db.prepare('UPDATE users SET strikes=MAX(strikes-1,0), muted_until=0 WHERE id=?').run(a.user_id);
      notify(a.user_id, ok ? 'Your appeal was accepted: one strike removed and any mute lifted.' : 'Your appeal was reviewed and the decision stands.');
      audit(req, 'appeal_' + (ok ? 'accept' : 'reject'), a.id);
    })();
    res.json({ ok: true });
  });

  // ---- audit log + admin-editable blocked words
  app.get('/api/admin/audit', admin, (req, res) => res.json(db.prepare('SELECT a.*, u.username FROM audit a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.id DESC LIMIT 100').all()));
  app.get('/api/admin/words', admin, (req, res) => res.json(db.prepare('SELECT word FROM blocked_words ORDER BY word').all().map(r => r.word)));
  app.post('/api/admin/words', admin, (req, res) => {
    const w = clean(req.body.word, 30).toLowerCase(); if (w.length < 2) return fail(res, 400, 'Word too short.');
    if (req.body.remove) db.prepare('DELETE FROM blocked_words WHERE word=?').run(w); else db.prepare('INSERT OR IGNORE INTO blocked_words VALUES(?)').run(w);
    reloadWords(); audit(req, req.body.remove ? 'word_remove' : 'word_add', w); res.json({ ok: true });
  });
};
