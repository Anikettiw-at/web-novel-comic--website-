// Email + password reset. SMTP is optional: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
// Without SMTP (development only) the reset link is printed to the server console.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { db } = require('./db');

let transport;
async function sendMail({ to, subject, text }) {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV !== 'production') console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
    else console.warn('SMTP not configured: email to', to, 'was not sent');
    return false;
  }
  transport ||= nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  return true;
}

function mount(app, { authLimiter, fail, needAuth, publicUser, sign }) {
  const sha = t => crypto.createHash('sha256').update(t).digest('hex');
  app.post('/api/auth/forgot', authLimiter, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const u = /^\S+@\S+\.\S+$/.test(email) && db.prepare('SELECT * FROM users WHERE email=? AND banned=0').get(email);
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<?').run(u.id, Date.now());
      db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(sha(token), u.id, Date.now() + 3600_000);
      const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      sendMail({ to: u.email, subject: 'Reset your InkVerse password', text: `Hi ${u.username},\n\nReset your password (valid for 1 hour):\n${base}/#/reset?token=${token}\n\nIf you did not ask for this, ignore this email.` }).catch(e => console.error('mail error', e.message));
    }
    res.json({ ok: true }); // same answer whether or not the email exists (no account enumeration)
  });
  app.post('/api/auth/reset', authLimiter, async (req, res) => {
    const password = String(req.body.password || ''); if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters.');
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND expires_at>?').get(sha(String(req.body.token || '')), Date.now());
    if (!row) return fail(res, 400, 'This reset link is invalid or has expired.');
    db.transaction(() => { db.prepare('UPDATE users SET pass_hash=?, token_version=token_version+1 WHERE id=?').run(bcrypt.hashSync(password, 10), row.user_id); db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.user_id); })();
    res.json({ ok: true });
  });

  // ---- email verification (links are emailed only when SMTP is configured; REQUIRE_VERIFIED=true gates publishing & purchases)
  const baseUrl = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  async function sendVerification(u, req) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM email_tokens WHERE user_id=? OR expires_at<?').run(u.id, Date.now());
    db.prepare('INSERT INTO email_tokens VALUES(?,?,?)').run(sha(token), u.id, Date.now() + 24 * 3600_000);
    return sendMail({ to: u.email, subject: 'Confirm your InkVerse email', text: `Hi ${u.username},

Confirm your email address (valid 24 hours):
${baseUrl(req)}/#/verify?token=${token}
` });
  }
  app.sendVerification = sendVerification;
  app.post('/api/auth/verify-email', authLimiter, (req, res) => {
    const row = db.prepare('SELECT * FROM email_tokens WHERE token_hash=? AND expires_at>?').get(sha(String(req.body.token || '')), Date.now());
    if (!row) return fail(res, 400, 'This confirmation link is invalid or has expired.');
    db.transaction(() => { db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(row.user_id); db.prepare('DELETE FROM email_tokens WHERE user_id=?').run(row.user_id); })();
    res.json({ ok: true });
  });
  app.post('/api/auth/resend-verification', authLimiter, needAuth, async (req, res) => {
    if (req.user.email_verified) return res.json({ ok: true, already: true });
    const sent = await sendVerification(req.user, req).catch(() => false); res.json({ ok: true, sent });
  });

  // ---- account security
  app.post('/api/auth/change-password', authLimiter, needAuth, async (req, res) => {
    const cur = String(req.body.current || ''), next = String(req.body.password || '');
    if (!(await bcrypt.compare(cur, req.user.pass_hash))) return fail(res, 403, 'Current password is incorrect.');
    if (next.length < 8) return fail(res, 400, 'New password must be at least 8 characters.');
    db.prepare('UPDATE users SET pass_hash=?, token_version=token_version+1 WHERE id=?').run(await bcrypt.hash(next, 10), req.user.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id); res.json({ ok: true, token: sign(u) });   // other devices are signed out
  });
  app.post('/api/auth/logout-all', needAuth, (req, res) => {
    db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(req.user.id);
    res.json({ ok: true, token: sign(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
  });

  // ---- your data: export (GDPR/CCPA) and deletion
  app.get('/api/me/export', needAuth, (req, res) => {
    const id = req.user.id, all = (sql) => db.prepare(sql).all(id);
    res.setHeader('Content-Disposition', 'attachment; filename="inkverse-my-data.json"');
    res.json({ exported_at: new Date().toISOString(), profile: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)), email: req.user.email,
      progress: all('SELECT * FROM progress WHERE user_id=?'), highlights: all('SELECT * FROM highlights WHERE user_id=?'), comments: all('SELECT * FROM comments WHERE user_id=?'),
      follows: all('SELECT * FROM follows WHERE user_id=?'), likes: all('SELECT * FROM likes WHERE user_id=?'), ratings: all('SELECT * FROM ratings WHERE user_id=?'),
      transactions: all('SELECT * FROM transactions WHERE user_id=?'), series: all('SELECT id,title,type,created_at FROM series WHERE creator_id=?') });
  });
  app.delete('/api/me', authLimiter, needAuth, async (req, res) => {
    if (!(await bcrypt.compare(String(req.body.password || ''), req.user.pass_hash))) return fail(res, 403, 'Password is incorrect.');
    if (req.user.role === 'admin') return fail(res, 400, 'Admins must be demoted before deleting their account.');
    if (req.user.plan_until > Date.now() && req.user.stripe_sub && !req.user.sub_cancel) return fail(res, 400, 'Cancel your Premium subscription first (Premium page) so you are not billed again.');
    const owed = db.prepare('SELECT COALESCE(SUM(cents),0) v FROM earnings WHERE creator_id=? AND payout_id IS NULL').get(req.user.id).v;
    if (owed > 0) return fail(res, 400, 'You still have unpaid creator earnings. Withdraw them (or contact support) before deleting your account.');
    const id = req.user.id;
    db.transaction(() => {
      for (const t of ['progress', 'highlights', 'follows', 'likes', 'ratings', 'reactions', 'unlocks', 'notifications', 'poll_votes', 'chapter_reads', 'premium_unlocks', 'password_resets', 'email_tokens']) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id);
      db.prepare("UPDATE comments SET body='[deleted]', status='hidden' WHERE user_id=?").run(id);
      db.prepare("UPDATE users SET username=?, email=?, bio='', payout_email=NULL, pass_hash=?, banned=1, token_version=token_version+1, stripe_customer=NULL, stripe_sub=NULL, prefs='{}' WHERE id=?")
        .run('deleted_' + id, `deleted+${id}@invalid.invalid`, crypto.randomBytes(32).toString('hex'), id);
    })();
    res.json({ ok: true });
  });
}
module.exports = { mount, sendMail };
