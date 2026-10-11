// Automated first line of moderation + strike system. Humans (admins) handle the report queue.
const { db } = require('./db');

// Small demo list. In production use a maintained list / ML classifier and per-language rules.
const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'faggot', 'retard', 'kys', 'kill yourself'];
let SLUR_REGEX;
function reloadWords() { // built-in list + admin-managed list, tolerant of spacing/punctuation tricks
  const extra = db.prepare('SELECT word FROM blocked_words').all().map(r => r.word);
  SLUR_REGEX = new RegExp('(' + [...BAD_WORDS, ...extra].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('').join('[\\s._*-]*')).join('|') + ')', 'ig');
}
reloadWords();
const URL_REGEX = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|ru|xyz|ly|gg)\b/i;
const NEW_ACCOUNT_MS = 24 * 3600 * 1000;
const lastMsg = new Map(); // userId -> { t, body, count }

function now() { return Date.now(); }

function addStrike(user, reason) {
  const strikes = user.strikes + 1;
  let muted = user.muted_until;
  // Escalation ladder: 1 warn, 2 -> 10 min mute, 3 -> 1 day mute, 5 -> ban pending review
  if (strikes === 2) muted = now() + 10 * 60 * 1000;
  if (strikes >= 3) muted = now() + 24 * 3600 * 1000;
  const banned = strikes >= 5 ? 1 : 0;
  db.prepare('UPDATE users SET strikes=?, muted_until=?, banned=? WHERE id=?').run(strikes, muted, banned, user.id);
  db.prepare('INSERT INTO notifications(user_id,text,created_at) VALUES(?,?,?)').run(
    user.id, `Moderation notice (strike ${strikes}): ${reason}. Repeated violations lead to mutes and bans.`, now());
  return { strikes, muted, banned };
}

// Returns { ok, body, reason, flagged }
function screenText(user, raw, { kind = 'chat' } = {}) {
  let body = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!body) return { ok: false, reason: 'Message is empty.' };
  if (body.length > (kind === 'chat' ? 500 : 2000)) return { ok: false, reason: 'Message too long.' };
  if (user.banned) return { ok: false, reason: 'Your account is banned.' };
  if (user.muted_until > now()) {
    const mins = Math.ceil((user.muted_until - now()) / 60000);
    return { ok: false, reason: `You are muted for ${mins} more minute(s).` };
  }
  const prev = lastMsg.get(user.id);
  if (kind === 'chat' && prev) {
    if (now() - prev.t < 1200) return { ok: false, reason: 'Slow down — you are sending messages too fast.' };
    if (prev.body === body.toLowerCase() && now() - prev.t < 30000) return { ok: false, reason: 'Duplicate message blocked.' };
  }
  const newAccount = now() - user.created_at < NEW_ACCOUNT_MS;
  if (URL_REGEX.test(body) && newAccount && user.role !== 'admin') {
    return { ok: false, reason: 'Links are disabled for accounts younger than 24 hours (anti-spam).' };
  }
  if (body.length > 12 && body.replace(/[^A-Z]/g, '').length / body.replace(/[^A-Za-z]/g, '').length > 0.8) {
    body = body.toLowerCase(); // tame SHOUTING
  }
  let flagged = false;
  body = body.replace(SLUR_REGEX, m => { flagged = true; return '*'.repeat(m.length); });
  lastMsg.set(user.id, { t: now(), body: String(raw).trim().toLowerCase() });
  if (flagged) {
    const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    addStrike(fresh, 'Offensive language was filtered from your message');
  }
  return { ok: true, body, flagged };
}

// N distinct user reports on one target auto-hides it until an admin reviews it.
const AUTO_HIDE_THRESHOLD = 3;
function fileReport({ reporterId, targetType, targetId, reason }) {
  if (reporterId) {
    const dup = db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='open'")
      .get(reporterId, targetType, targetId);
    if (dup) return { duplicate: true };
  }
  const info = db.prepare('INSERT INTO reports(reporter_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?)')
    .run(reporterId || null, targetType, targetId, String(reason).slice(0, 300), now());
  const n = db.prepare("SELECT COUNT(DISTINCT reporter_id) c FROM reports WHERE target_type=? AND target_id=? AND status='open'").get(targetType, targetId).c;
  let autoHidden = false;
  if (n >= AUTO_HIDE_THRESHOLD) {
    if (targetType === 'message') { db.prepare("UPDATE messages SET status='hidden' WHERE id=?").run(targetId); autoHidden = true; }
    if (targetType === 'comment') { db.prepare("UPDATE comments SET status='hidden' WHERE id=?").run(targetId); autoHidden = true; }
  }
  return { id: info.lastInsertRowid, autoHidden };
}

module.exports = { screenText, fileReport, addStrike, reloadWords };
