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

function mount(app, { authLimiter, fail }) {
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
    db.transaction(() => { db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), row.user_id); db.prepare('DELETE FROM password_resets WHERE user_id=?').run(row.user_id); })();
    res.json({ ok: true });
  });
}
module.exports = { mount, sendMail };
