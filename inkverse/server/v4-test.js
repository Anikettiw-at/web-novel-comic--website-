// End-to-end tests for v4: protected paid pages, refunds, reviews, Q&A, creator profiles, contests, email alerts, CSV.  `npm test`
process.env.DB_FILE = require('path').join(require('os').tmpdir(), `inkverse-v4-${Date.now()}.db`);
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), `inkverse-up4-${Date.now()}`);
process.env.HOLD_DAYS = '0';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
const crypto = require('crypto');
const sharp = require('sharp');
const assert = require('assert');
const { server, releaseTick } = require('./index');
const { db } = require('./db');

let base; const token = {};
const call = async (m, p, body, who) => {
  const r = await fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + (token[who] || who) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ok = (name, cond) => { assert(cond, 'FAILED: ' + name); console.log('  ✓', name); };
const seeded = n => { let s = n * 2654435761 % 2 ** 32; return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32; };
const art = async seed => { const r = seeded(seed); const shapes = Array.from({ length: 14 }, () => `<rect x="${r() * 300 | 0}" y="${r() * 400 | 0}" width="${40 + r() * 160 | 0}" height="${40 + r() * 160 | 0}" fill="rgb(${r() * 255 | 0},${r() * 255 | 0},${r() * 255 | 0})"/>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#fff"/>${shapes}</svg>`)).png().toBuffer(); };
const hook = async obj => { const raw = JSON.stringify(obj), t = Math.floor(Date.now() / 1000), sig = crypto.createHmac('sha256', 'whsec_test_secret').update(`${t}.${raw}`).digest('hex');
  return (await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: raw })).status; };
const mkSeries = async (who, fields) => { const fd = new FormData(); Object.entries(fields).forEach(([k, v]) => fd.append(k, v)); return (await fetch(base + '/api/series', { method: 'POST', headers: { Authorization: 'Bearer ' + token[who] }, body: fd })).json(); };
const words = (seed, n) => { const r = seeded(seed), b = 'amber river lantern whisper copper tide marble orchard velvet harbor ember glacier compass thistle meadow cinder falcon ivory saffron quartz willow ripple summit lagoon'.split(' '); return Array.from({ length: n }, () => b[r() * b.length | 0] + (r() * 40 | 0)).join(' '); };

server.listen(0, async () => {
  base = 'http://localhost:' + server.address().port;
  try {
    console.log('\nv4 feature tests');
    for (const [k, l, pw] of [['reader', 'ReaderRay', 'Reader123!'], ['nova', 'NovaInk', 'Creator123!'], ['kai', 'KaiWrites', 'Creator123!'], ['admin', 'admin', 'Admin123!']]) token[k] = (await call('POST', '/auth/login', { login: l, password: pw })).data.token;
    const me = {}; for (const k of ['reader', 'nova', 'kai']) me[k] = (await call('GET', '/me', null, k)).data;

    // ---- protected paid comic pages
    const sid = (await mkSeries('nova', { title: 'Paid Pages', type: 'comic', synopsis: 'x', monetization: 'paid', default_price: '10' })).id;
    const fd = new FormData(); fd.append('title', 'Paid ch'); fd.append('publish_mode', 'now');
    for (const [i, s] of [41, 42].entries()) fd.append('pages', new Blob([await art(s)], { type: 'image/png' }), `0${i + 1}.png`);
    const up = await (await fetch(base + `/api/series/${sid}/chapters`, { method: 'POST', headers: { Authorization: 'Bearer ' + token.nova }, body: fd })).json(); const chId = up.id; ok('paid comic chapter uploaded', !!chId);
    ok('locked paid chapter exposes no pages', (await call('GET', '/chapters/' + chId, null, 'reader')).data.pages === undefined);
    await call('POST', `/chapters/${chId}/unlock`, null, 'reader'); await call('POST', `/chapters/${chId}/unlock`, null, 'kai');
    const pr = (await call('GET', '/chapters/' + chId, null, 'reader')).data, pk = (await call('GET', '/chapters/' + chId, null, 'kai')).data;
    ok('paid pages are served through signed links, not public uploads', pr.pages.every(p => p.startsWith('/pages/')) && !pr.pages.some(p => p.includes('/uploads/')));
    const imgR = await fetch(base + pr.pages[0]); const bufR = Buffer.from(await imgR.arrayBuffer());
    ok('signed page link works without a login header and is an image', imgR.status === 200 && /image\//.test(imgR.headers.get('content-type')) && bufR.length > 500);
    const bufK = Buffer.from(await (await fetch(base + pk.pages[0])).arrayBuffer());
    ok('each reader gets a differently watermarked copy', !bufR.equals(bufK));
    const raw = await art(41); ok('served page differs from the raw upload (watermark applied)', !bufR.equals(raw));
    ok('tampered token rejected', (await fetch(base + pr.pages[0].replace(/.$/, c => c === 'a' ? 'b' : 'a'))).status === 403);
    ok('token is bound to its chapter', (await fetch(base + `/pages/${chId + 1}/0?k=` + pr.pages[0].split('k=')[1])).status === 403);
    ok('no token, no page', (await fetch(base + `/pages/${chId}/0`)).status === 403);
    const free = await mkSeries('nova', { title: 'Free Pages', type: 'comic', synopsis: 'x', monetization: 'free' }); const fd2 = new FormData(); fd2.append('title', 'Free ch'); fd2.append('publish_mode', 'now'); fd2.append('pages', new Blob([await art(77)], { type: 'image/png' }), '01.png');
    const fc = await (await fetch(base + `/api/series/${free.id}/chapters`, { method: 'POST', headers: { Authorization: 'Bearer ' + token.nova }, body: fd2 })).json();
    ok('free chapters keep plain public image URLs', (await call('GET', '/chapters/' + fc.id)).data.pages[0].startsWith('/uploads/'));

    // ---- refunds & chargebacks
    const coins0 = (await call('GET', '/wallet', null, 'reader')).data.coins;
    const pay = (id, pi) => ({ type: 'checkout.session.completed', data: { object: { id, mode: 'payment', payment_status: 'paid', client_reference_id: String(me.reader.id), metadata: { pack: 'p500' }, amount_total: 449, currency: 'usd', payment_intent: pi } } });
    await hook(pay('cs_r1', 'pi_1')); ok('purchase credited', (await call('GET', '/wallet', null, 'reader')).data.coins === coins0 + 500);
    await hook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 449, amount_refunded: 100 } } }); ok('partial refund does not claw back coins', (await call('GET', '/wallet', null, 'reader')).data.coins === coins0 + 500);
    await hook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 449, amount_refunded: 449 } } }); ok('full refund removes the coins', (await call('GET', '/wallet', null, 'reader')).data.coins === coins0);
    await hook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 449, amount_refunded: 449 } } }); ok('refund replay is idempotent', (await call('GET', '/wallet', null, 'reader')).data.coins === coins0);
    ok('refund appears in the ledger', (await call('GET', '/wallet', null, 'reader')).data.history.some(h => h.type === 'refund' && h.coins === -500));
    await hook(pay('cs_r2', 'pi_2')); await hook({ type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_2' } } }); ok('chargeback claws coins back', (await call('GET', '/wallet', null, 'reader')).data.coins === coins0);

    // ---- earnings CSV
    const csv = await fetch(base + '/api/creator/earnings.csv', { headers: { Authorization: 'Bearer ' + token.nova } }); const txt = await csv.text();
    ok('creator earnings CSV export', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && txt.startsWith('date,source,series,coins,earned_usd,status') && txt.split('\n').length > 2);
    ok('CSV is creator-only', (await fetch(base + '/api/creator/earnings.csv', { headers: { Authorization: 'Bearer ' + token.reader } })).status === 403);

    // ---- reviews
    const star = (await call('GET', '/series')).data.find(s => s.title === 'Starfall Academy');
    const fresh = (await call('POST', '/auth/register', { username: 'NewReader', email: 'newreader@inkverse.test', password: 'password123', acceptTerms: true })).data.token; token.fresh = fresh;
    ok('cannot review before reading', (await call('POST', `/series/${star.id}/reviews`, { stars: 5, body: 'This is a wonderful story, really.' }, 'fresh')).status === 403);
    const ch1 = (await call('GET', '/series/' + star.id, null, 'fresh')).data.chapters[0]; await call('GET', '/chapters/' + ch1.id, null, 'fresh');
    ok('review needs a real text body', (await call('POST', `/series/${star.id}/reviews`, { stars: 5, body: 'short' }, 'fresh')).status === 400);
    ok('review needs 1-5 stars', (await call('POST', `/series/${star.id}/reviews`, { stars: 9, body: 'This is a wonderful story, really.' }, 'fresh')).status === 400);
    ok('reader posts a review', (await call('POST', `/series/${star.id}/reviews`, { stars: 5, body: 'This is a wonderful story, really.' }, 'fresh')).status === 200);
    ok('creators cannot review their own series', (await call('POST', `/series/${star.id}/reviews`, { stars: 5, body: 'My own masterpiece, obviously great.' }, 'nova')).status === 400);
    let rv = (await call('GET', `/series/${star.id}/reviews`, null, 'reader')).data; ok('review summary + list', rv.summary.count === 1 && rv.summary.avg === 5 && rv.items[0].username === 'NewReader');
    ok('review updates the headline rating', (await call('GET', '/series/' + star.id)).data.rating !== null);
    const rid = rv.items[0].id; ok('mark review helpful', (await call('POST', `/reviews/${rid}/helpful`, null, 'reader')).data.on === true && (await call('GET', `/series/${star.id}/reviews`, null, 'reader')).data.items[0].helpful === 1);
    ok('cannot vote on own review', (await call('POST', `/reviews/${rid}/helpful`, null, 'fresh')).status === 400);
    await call('POST', `/series/${star.id}/reviews`, { stars: 2, body: 'On second thought the pacing dragged a lot.' }, 'fresh'); ok('editing keeps one review per reader', (await call('GET', `/series/${star.id}/reviews`)).data.summary.count === 1);
    ok('others cannot delete my review', (await call('DELETE', '/reviews/' + rid, null, 'reader')).status === 403);
    const rep = await call('POST', '/report', { target_type: 'review', target_id: rid, reason: 'Spam' }, 'reader'); ok('reviews can be reported', rep.status === 200);
    ok('admin sees reported review content', (await call('GET', '/admin/reports', null, 'admin')).data.some(r => r.target_type === 'review' && /pacing/.test(r.target?.body || '')));
    ok('author deletes own review', (await call('DELETE', '/reviews/' + rid, null, 'fresh')).status === 200);

    // ---- chapter Q&A
    const q = await call('POST', `/chapters/${ch1.id}/qa`, { question: 'Who is the masked figure on page 3?' }, 'fresh'); ok('reader asks a question', q.status === 200);
    ok('unanswered question hidden from other readers', (await call('GET', `/chapters/${ch1.id}/qa`, null, 'reader')).data.length === 0 && (await call('GET', `/chapters/${ch1.id}/qa`, null, 'fresh')).data.length === 1);
    ok('creator sees the question', (await call('GET', `/chapters/${ch1.id}/qa`, null, 'nova')).data.length === 1);
    ok('readers cannot answer', (await call('POST', `/qa/${q.data.id}/answer`, { answer: 'A secret!' }, 'reader')).status === 403);
    ok('creator answers', (await call('POST', `/qa/${q.data.id}/answer`, { answer: 'That is the Clockmaker — more in chapter 5.' }, 'nova')).status === 200);
    ok('answered Q&A is public', (await call('GET', `/chapters/${ch1.id}/qa`)).data[0].answer.includes('Clockmaker'));
    ok('asker is notified of the answer', (await call('GET', '/notifications', null, 'fresh')).data.some(n => /answered your question/.test(n.text)));

    // ---- creator profiles, following, new-series alerts
    ok('public creator profile', (await call('GET', '/creators/' + me.nova.id)).data.series.length >= 2);
    ok('readers have no public creator page', (await call('GET', '/creators/' + me.reader.id)).status === 404);
    ok('follow a creator', (await call('POST', `/creators/${me.nova.id}/follow`, null, 'reader')).data.on === true && (await call('GET', '/creators/' + me.nova.id, null, 'reader')).data.following === true);
    ok('cannot follow yourself', (await call('POST', `/creators/${me.nova.id}/follow`, null, 'nova')).status === 400);
    const ns = await mkSeries('nova', { title: 'Brand New Saga', type: 'novel', synopsis: 'x', monetization: 'free' });
    await call('POST', `/series/${ns.id}/chapters`, { title: 'One', content: words(5, 80), publish_mode: 'now' }, 'nova'); await releaseTick();
    ok('followers are told about a creator\'s new series', (await call('GET', '/notifications', null, 'reader')).data.some(n => /published a new series: Brand New Saga/.test(n.text)));

    // ---- opt-in email alerts
    ok('email_notify is a profile setting', (await call('PATCH', '/me', { email_notify: true }, 'reader')).data.email_notify === true);
    await call('POST', `/series/${ns.id}/follow`, null, 'reader'); db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(me.reader.id);
    let out = ''; const orig = console.log; console.log = (...a) => { out += a.join(' ') + '\n'; };
    await call('POST', `/series/${ns.id}/chapters`, { title: 'Two', content: words(6, 80), publish_mode: 'now' }, 'nova'); await releaseTick(); console.log = orig;
    ok('opted-in followers get an email digest', /\[mail:dev\] to=reader@inkverse.test subject="New chapter on InkVerse"/.test(out) && /Brand New Saga — chapter 2/.test(out));
    await call('PATCH', '/me', { email_notify: false }, 'reader'); out = ''; console.log = (...a) => { out += a.join(' ') + '\n'; };
    await call('POST', `/series/${ns.id}/chapters`, { title: 'Three', content: words(7, 80), publish_mode: 'now' }, 'nova'); await releaseTick(); console.log = orig;
    ok('opting out stops the emails', !/to=reader@inkverse.test/.test(out));

    // ---- contests
    ok('only admins create contests', (await call('POST', '/admin/contests', { title: 'Nope contest', days: 7 }, 'nova')).status === 403);
    const cid = (await call('POST', '/admin/contests', { title: 'Summer Debut Contest', description: 'Best new series', prize: '$500', days: 7 }, 'admin')).data.id; ok('admin creates a contest', !!cid);
    ok('readers cannot enter', (await call('POST', `/contests/${cid}/enter`, { series_id: ns.id }, 'reader')).status === 403);
    ok('cannot enter someone else\'s series', (await call('POST', `/contests/${cid}/enter`, { series_id: ns.id }, 'kai')).status === 403);
    ok('creator enters a series', (await call('POST', `/contests/${cid}/enter`, { series_id: ns.id }, 'nova')).status === 200);
    ok('one entry per creator', (await call('POST', `/contests/${cid}/enter`, { series_id: free.id }, 'nova')).status === 409);
    const kaiSer = (await call('GET', '/series?creator=' + me.kai.id)).data[0];
    await call('POST', `/contests/${cid}/enter`, { series_id: kaiSer.id }, 'kai');
    ok('voting requires reading the series', (await call('POST', `/contests/${cid}/vote`, { series_id: ns.id }, 'fresh')).status === 403);
    const nsCh = (await call('GET', '/series/' + ns.id, null, 'fresh')).data.chapters[0]; await call('GET', '/chapters/' + nsCh.id, null, 'fresh');
    ok('reader votes after reading', (await call('POST', `/contests/${cid}/vote`, { series_id: ns.id }, 'fresh')).status === 200);
    ok('creators cannot vote for themselves', (await call('POST', `/contests/${cid}/vote`, { series_id: ns.id }, 'nova')).status === 400);
    ok('only entries can be voted for', (await call('POST', `/contests/${cid}/vote`, { series_id: free.id }, 'fresh')).status === 404);
    let cd = (await call('GET', '/contests/' + cid, null, 'fresh')).data; ok('standings show votes and my vote', cd.entries[0].series_id === ns.id && cd.entries[0].votes === 1 && cd.myVote === ns.id);
    const kaiCh = (await call('GET', '/series/' + kaiSer.id, null, 'fresh')).data.chapters[0]; await call('GET', '/chapters/' + kaiCh.id, null, 'fresh');
    await call('POST', `/contests/${cid}/vote`, { series_id: kaiSer.id }, 'fresh'); cd = (await call('GET', '/contests/' + cid, null, 'fresh')).data;
    ok('one vote per person (changing moves it)', cd.myVote === kaiSer.id && cd.entries.reduce((a, e) => a + e.votes, 0) === 1);
    await call('POST', `/contests/${cid}/vote`, { series_id: ns.id }, 'fresh');
    ok('admin closes the contest -> winner + notification', (await call('POST', `/admin/contests/${cid}/close`, null, 'admin')).status === 200 && (await call('GET', '/contests/' + cid)).data.winner_series_id === ns.id && (await call('GET', '/notifications', null, 'nova')).data.some(n => /won the contest/.test(n.text)));
    ok('closed contests reject votes', (await call('POST', `/contests/${cid}/vote`, { series_id: ns.id }, 'reader')).status === 404);
    const c2 = (await call('POST', '/admin/contests', { title: 'Auto closing contest', days: 1 }, 'admin')).data.id; await call('POST', `/contests/${c2}/enter`, { series_id: free.id }, 'nova');
    db.prepare('UPDATE contests SET ends_at=? WHERE id=?').run(Date.now() - 1000, c2); await releaseTick();
    ok('expired contests close automatically', (await call('GET', '/contests/' + c2)).data.status === 'closed');
    ok('contest list', (await call('GET', '/contests')).data.length === 2);
    console.log('\nAll v4 checks passed.'); process.exit(0);
  } catch (e) { console.error('\n' + e.message); process.exit(1); }
});
