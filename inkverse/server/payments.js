// Real payments via Stripe Checkout (REST, no SDK) + signed webhook that credits coins exactly once.
//   STRIPE_SECRET_KEY      sk_live_... / sk_test_...      -> enables real checkout
//   STRIPE_WEBHOOK_SECRET  whsec_...                      -> required to credit coins
//   PUBLIC_URL             https://yourdomain.com         -> redirect base (falls back to request host)
//   DEMO_PAYMENTS=false    disables the free demo checkout (set this in production)
const crypto = require('crypto');
const express = require('express');
const { db, RULES } = require('./db');

const now = () => Date.now();
const paymentsMode = () => process.env.STRIPE_SECRET_KEY ? 'stripe' : (process.env.DEMO_PAYMENTS === 'false' ? 'off' : 'demo');

function verifySignature(raw, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map(kv => kv.split('=')).filter(a => a.length === 2));
  const sigs = String(header || '').split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.`).update(raw).digest('hex');
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// Must be mounted BEFORE express.json(): signature verification needs the raw body.
function mountWebhook(app) {
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Webhook secret not configured.' });
    if (!verifySignature(req.body, req.headers['stripe-signature'], secret)) return res.status(400).json({ error: 'Bad signature.' });
    let event; try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad payload.' }); }
    const obj = event.data.object;
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {           // Premium started
      const uid = Number(obj.client_reference_id);
      if (obj.payment_status === 'paid' && db.prepare('SELECT 1 FROM users WHERE id=?').get(uid) && obj.amount_total === RULES.premium.cents) db.transaction(() => {
        if (db.prepare('INSERT OR IGNORE INTO stripe_events(id,created_at) VALUES(?,?)').run(obj.id, now()).changes === 0) return;
        db.prepare('UPDATE users SET stripe_customer=?, stripe_sub=?, sub_cancel=0, plan_until=MAX(plan_until,?) WHERE id=?').run(obj.customer, obj.subscription, now() + RULES.premium.days * 86400000, uid);
        db.prepare('INSERT INTO transactions(user_id,type,cents,note,created_at) VALUES(?,?,?,?,?)').run(uid, 'subscription', RULES.premium.cents, 'Premium ' + obj.id, now());
        db.prepare('INSERT INTO notifications(user_id,text,link,created_at) VALUES(?,?,?,?)').run(uid, 'Welcome to InkVerse Premium! Ads are off and your perks are active.', '#/premium', now());
      })();
      return res.json({ received: true });
    }
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {          // renewal: extend to the paid period end
      const end = obj.lines?.data?.[0]?.period?.end;
      if (obj.customer && end && obj.amount_paid > 0) db.prepare('UPDATE users SET plan_until=MAX(plan_until,?), sub_cancel=0 WHERE stripe_customer=?').run(end * 1000 + 86400000, obj.customer);
      return res.json({ received: true });
    }
    if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {            // money went back to the buyer: claw the coins back / end Premium
      const pi = obj.payment_intent, full = event.type === 'charge.dispute.created' || (obj.amount_refunded >= obj.amount && obj.amount > 0);
      const row = pi && db.prepare('SELECT * FROM stripe_payments WHERE payment_intent=? AND reversed=0').get(pi);
      if (row && full) db.transaction(() => {
        db.prepare('UPDATE stripe_payments SET reversed=1 WHERE session_id=?').run(row.session_id);
        db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(row.coins, row.user_id);   // may go negative: blocks spending until topped up
        db.prepare('INSERT INTO transactions(user_id,type,coins,cents,note,created_at) VALUES(?,?,?,?,?,?)').run(row.user_id, 'refund', -row.coins, -row.cents, 'Refund/dispute ' + row.session_id, now());
        db.prepare('INSERT INTO notifications(user_id,text,link,created_at) VALUES(?,?,?,?)').run(row.user_id, `A payment was refunded, so ${row.coins} coins were removed from your wallet.`, '#/wallet', now());
      })();
      else if (!row && full && obj.customer) db.prepare('UPDATE users SET plan_until=?, sub_cancel=0 WHERE stripe_customer=? AND plan_until>?').run(now(), obj.customer, now());   // refunded Premium invoice
      return res.json({ received: true });
    }
    if (event.type === 'customer.subscription.deleted') { db.prepare('UPDATE users SET plan_until=?, sub_cancel=0, stripe_sub=NULL WHERE stripe_customer=?').run(now(), obj.customer); return res.json({ received: true }); }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = obj;
      if (s.mode === 'subscription') return res.json({ received: true });
      if (s.payment_status !== 'paid') return res.json({ received: true });
      const pack = RULES.coinPacks.find(p => p.id === s.metadata?.pack), uid = Number(s.client_reference_id);
      const user = db.prepare('SELECT id FROM users WHERE id=?').get(uid);
      // Never trust metadata alone: amount and currency must match our price list.
      if (!pack || !user || s.amount_total !== pack.cents || String(s.currency).toLowerCase() !== 'usd') {
        console.error('Stripe webhook rejected: mismatch', s.id); return res.json({ received: true, ignored: true });
      }
      db.transaction(() => {
        if (db.prepare('INSERT OR IGNORE INTO stripe_events(id,created_at) VALUES(?,?)').run(s.id, now()).changes === 0) return; // replay
        db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(pack.coins, uid);
        db.prepare('INSERT OR IGNORE INTO stripe_payments(session_id,payment_intent,user_id,coins,cents,created_at) VALUES(?,?,?,?,?,?)').run(s.id, s.payment_intent || null, uid, pack.coins, pack.cents, now());
        db.prepare('INSERT INTO transactions(user_id,type,coins,cents,note,created_at) VALUES(?,?,?,?,?,?)').run(uid, 'purchase', pack.coins, pack.cents, 'Stripe payment ' + s.id, now());
        db.prepare('INSERT INTO notifications(user_id,text,link,created_at) VALUES(?,?,?,?)').run(uid, `Payment received: ${pack.coins} coins added to your wallet.`, '#/wallet', now());
      })();
    }
    res.json({ received: true });
  });
}

// Minimal Stripe REST helper (form-encoded POST), shared with the subscription routes.
async function stripeCall(path, params) {
  const r = await fetch('https://api.stripe.com/v1' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || 'Stripe error'); return data;
}

function mountRoutes(app, { needAuth, fail, needVerified = (q, r, n) => n() }) {
  app.post('/api/wallet/checkout', needAuth, needVerified, async (req, res) => {
    if (paymentsMode() !== 'stripe') return fail(res, 400, 'Card payments are not enabled on this site.');
    const pack = RULES.coinPacks.find(p => p.id === req.body.pack); if (!pack) return fail(res, 400, 'Unknown pack.');
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const body = new URLSearchParams({
      mode: 'payment', client_reference_id: String(req.user.id), customer_email: req.user.email,
      success_url: `${base}/#/wallet?paid=1`, cancel_url: `${base}/#/wallet`,
      'metadata[pack]': pack.id, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(pack.cents), 'line_items[0][price_data][product_data][name]': `${pack.coins} InkVerse coins`,
    });
    try {
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const data = await r.json(); if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
      res.json({ url: data.url });
    } catch (e) { console.error('Stripe checkout error:', e.message); fail(res, 502, 'Could not start checkout. Please try again.'); }
  });
}

module.exports = { mountWebhook, mountRoutes, paymentsMode, verifySignature, stripeCall };
