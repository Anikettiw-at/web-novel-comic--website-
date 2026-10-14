// End-to-end tests for v3: free/paid tiers, highlights, manga mode data, copyright check, creator tools, account security.  `npm test`
process.env.DB_FILE = require('path').join(require('os').tmpdir(), `inkverse-v3-${Date.now()}.db`);
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), `inkverse-up-${Date.now()}`);
process.env.HOLD_DAYS = '0';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
const crypto = require('crypto');
const sharp = require('sharp');
const assert = require('assert');
const { server } = require('./index');

let base; const token = {};
const call = async (m, p, body, who) => {
  const r = await fetch(base + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer ' + (token[who] || who) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const upload = async (p, fields, files, who) => {
  const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  files.forEach((f, i) => fd.append('pages', new Blob([f], { type: f[0] === 0xff ? 'image/jpeg' : 'image/png' }), String(i + 1).padStart(2, '0') + (f[0] === 0xff ? '.jpg' : '.png')));
  const r = await fetch(base + '/api' + p, { method: 'POST', headers: { Authorization: 'Bearer ' + token[who] }, body: fd });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const ok = (name, cond) => { assert(cond, 'FAILED: ' + name); console.log('  ✓', name); };
const seeded = n => { let s = n * 2654435761 % 2 ** 32; return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32; };
// structured picture (random coloured shapes): survives resizing / re-compression like real artwork
const art = async seed => { const r = seeded(seed); const shapes = Array.from({ length: 14 }, () => `<rect x="${r() * 300 | 0}" y="${r() * 400 | 0}" width="${40 + r() * 160 | 0}" height="${40 + r() * 160 | 0}" fill="rgb(${r() * 255 | 0},${r() * 255 | 0},${r() * 255 | 0})"/>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#fff"/>${shapes}</svg>`)).png().toBuffer(); };
const words = (seed, n) => { const r = seeded(seed), base = 'amber river lantern whisper copper tide marble orchard velvet harbor ember glacier compass thistle meadow cinder falcon ivory saffron quartz willow ripple summit lagoon thunder pewter mosaic canyon drift hollow'.split(' '); return Array.from({ length: n }, () => base[r() * base.length | 0] + (r() * 40 | 0)).join(' '); };
const hook = async obj => { const raw = JSON.stringify(obj), t = Math.floor(Date.now() / 1000), sig = crypto.createHmac('sha256', 'whsec_test_secret').update(`${t}.${raw}`).digest('hex');
  return (await fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: raw })).status; };

server.listen(0, async () => {
  base = 'http://localhost:' + server.address().port;
  try {
    console.log('\nv3 feature tests');
    ok('health check', (await (await fetch(base + '/healthz')).json()).ok === true);
    for (const [k, l, pw] of [['reader', 'ReaderRay', 'Reader123!'], ['nova', 'NovaInk', 'Creator123!'], ['kai', 'KaiWrites', 'Creator123!'], ['admin', 'admin', 'Admin123!']]) token[k] = (await call('POST', '/auth/login', { login: l, password: pw })).data.token;
    const cfg = (await call('GET', '/config')).data; ok('config exposes premium + tags + languages', cfg.premium.cents === 799 && cfg.tags.length && cfg.languages.ja);

    // ---- sign up -> email verification -> account security
    let captured = ''; const orig = console.log; console.log = (...a) => { captured += a.join(' ') + '\n'; };
    const reg = await call('POST', '/auth/register', { username: 'FreshFan', email: 'fresh@inkverse.test', password: 'password123', acceptTerms: true, role: 'reader' });
    await new Promise(r => setTimeout(r, 250)); console.log = orig;
    ok('signup works and returns premium=false', reg.status === 200 && reg.data.user.premium === false && reg.data.user.email_verified === false);
    const vt = (captured.match(/verify\?token=([a-f0-9]{64})/) || [])[1]; ok('verification email generated', !!vt);
    ok('bad verification token rejected', (await call('POST', '/auth/verify-email', { token: 'z'.repeat(64) })).status === 400);
    ok('email verification works', (await call('POST', '/auth/verify-email', { token: vt })).status === 200 && (await call('GET', '/me', null, reg.data.token)).data.email_verified === true);
    const cp = await call('POST', '/auth/change-password', { current: 'wrongpass1', password: 'newpassword1' }, reg.data.token); ok('change password needs the current password', cp.status === 403);
    const cp2 = await call('POST', '/auth/change-password', { current: 'password123', password: 'newpassword1' }, reg.data.token);
    ok('password change returns a fresh token', cp2.status === 200 && !!cp2.data.token);
    ok('old token is revoked after password change', (await call('GET', '/me', null, reg.data.token)).status === 401);
    ok('new token works', (await call('GET', '/me', null, cp2.data.token)).status === 200);
    const lo = await call('POST', '/auth/logout-all', null, cp2.data.token); ok('logout everywhere revokes tokens', lo.status === 200 && (await call('GET', '/me', null, cp2.data.token)).status === 401 && (await call('GET', '/me', null, lo.data.token)).status === 200);
    ok('data export works', (await call('GET', '/me/export', null, lo.data.token)).data.profile.username === 'FreshFan');
    ok('delete account needs password', (await call('DELETE', '/me', { password: 'nope' }, lo.data.token)).status === 403);
    ok('delete account works', (await call('DELETE', '/me', { password: 'newpassword1' }, lo.data.token)).status === 200 && (await call('POST', '/auth/login', { login: 'FreshFan', password: 'newpassword1' })).status === 401);

    // ---- monetization modes: hybrid (first 2 chapters free), manga direction, tags
    const fd = new FormData(); Object.entries({ title: 'Hybrid Tale', type: 'novel', synopsis: 'A test story', genres: 'Fantasy', monetization: 'hybrid', free_chapters: '2', default_price: '10', language: 'en', tags: 'Slow Burn,Revenge,NotATag', warnings: 'Violence', reading_dir: 'ltr' }).forEach(([k, v]) => fd.append(k, v));
    const sr = await fetch(base + '/api/series', { method: 'POST', headers: { Authorization: 'Bearer ' + token.nova }, body: fd }).then(r => r.json()); const sid = sr.id; ok('create hybrid series', !!sid);
    const chText = i => `${words(100 + i, 90)}\n\n${words(200 + i, 90)}`;
    const ids = []; for (let i = 1; i <= 4; i++) { const r = await call('POST', `/series/${sid}/chapters`, { title: 'Ch ' + i, content: chText(i), publish_mode: 'now' }, 'nova'); ids.push(r.data.id); }
    const d1 = (await call('GET', '/series/' + sid, null, 'reader')).data;
    ok('first 2 chapters free, later ones priced at default', d1.chapters.length === 4 && !d1.chapters[0].locked && !d1.chapters[1].locked && d1.chapters[2].locked && d1.chapters[2].price_coins === 10);
    ok('tags are validated against the allowed list', d1.tags.join() === 'Slow Burn,Revenge' && d1.warnings.join() === 'Violence');
    ok('word count + reading time data stored', d1.chapters[0].words > 100);
    ok('locked chapter hides its text', (await call('GET', '/chapters/' + ids[2], null, 'reader')).data.content === undefined);
    ok('series filter by tag', (await call('GET', '/series?tag=Revenge')).data.some(s => s.id === sid));
    ok('content-warning filter hides series', !(await call('GET', '/series?safe=Violence')).data.some(s => s.id === sid));
    ok('free chapter readable', (await call('GET', '/chapters/' + ids[0], null, 'reader')).data.content.includes('amber'));

    // ---- free tier vs Premium
    const hl1 = (await call('GET', '/chapters/' + ids[0], null, 'reader')).data; const paras = hl1.content.split(/\n{2,}/);
    const mkHl = (para, a, b, color = 'yellow') => call('POST', `/chapters/${ids[0]}/highlights`, { kind: 'text', para, start: a, end: b, text: paras[para].slice(a, b), color }, 'reader');
    const h1 = await mkHl(0, 0, 12); ok('create a text highlight', h1.status === 200 && h1.data.id);
    ok('overlapping highlight rejected', (await mkHl(0, 5, 20)).status === 409);
    ok('wrong text rejected (selection must match chapter)', (await call('POST', `/chapters/${ids[0]}/highlights`, { kind: 'text', para: 0, start: 20, end: 30, text: 'nonsense' }, 'reader')).status === 400);
    ok('highlights persist (list)', (await call('GET', `/chapters/${ids[0]}/highlights`, null, 'reader')).data.length === 1);
    const up = await call('PATCH', '/highlights/' + h1.data.id, { color: 'pink', note: 'great line' }, 'reader'); ok('edit colour + note', up.data.color === 'pink' && up.data.note === 'great line');
    ok('other users cannot see my highlights', (await call('GET', `/chapters/${ids[0]}/highlights`, null, 'nova')).data.length === 0);
    ok('other users cannot edit them', (await call('PATCH', '/highlights/' + h1.data.id, { note: 'x' }, 'nova')).status === 404);
    ok('anonymous cannot highlight', (await call('POST', `/chapters/${ids[0]}/highlights`, { kind: 'text' })).status === 401);
    ok('cannot highlight a locked chapter', (await call('POST', `/chapters/${ids[2]}/highlights`, { kind: 'text', para: 0, start: 0, end: 5, text: 'abcde' }, 'reader')).status === 403);
    let n = 1, last; for (let i = 1; i < 40 && n < cfg.freeHighlightLimit + 1; i++) { last = await mkHl(1, i * 4, i * 4 + 3); if (last.status === 200) n++; else break; }
    ok(`free accounts are limited to ${cfg.freeHighlightLimit} highlights`, last.status === 402 && n === cfg.freeHighlightLimit);
    ok('premium status false for free reader', (await call('GET', '/premium', null, 'reader')).data.active === false);
    ok('premium unlock refused for free users', (await call('POST', `/chapters/${ids[2]}/premium-unlock`, null, 'reader')).status === 402);
    const sub = await call('POST', '/premium/subscribe', null, 'reader'); ok('subscribe (demo mode)', sub.status === 200 && sub.data.demo);
    ok('profile shows premium', (await call('GET', '/me', null, 'reader')).data.premium === true);
    ok('premium removes the highlight cap', (await mkHl(1, 200, 205)).status === 200);
    const before = (await call('GET', '/premium', null, 'reader')).data.unlocksLeft;
    const pu = await call('POST', `/chapters/${ids[2]}/premium-unlock`, null, 'reader'); ok('premium unlock works and uses the monthly allowance', pu.status === 200 && (await call('GET', '/premium', null, 'reader')).data.unlocksLeft === before - 1);
    ok('unlocked chapter is readable', !!(await call('GET', '/chapters/' + ids[2], null, 'reader')).data.content);
    ok('creator is credited for premium unlocks', (await call('GET', '/creator/dashboard', null, 'nova')).data.series.find(s => s.id === sid).earned_cents > 0);
    ok('second subscribe blocked', (await call('POST', '/premium/subscribe', null, 'reader')).status === 400);
    ok('cancel keeps access until period end', (await call('POST', '/premium/cancel', null, 'reader')).status === 200 && (await call('GET', '/me', null, 'reader')).data.premium === true);

    // ---- Stripe subscription webhooks
    const me = (await call('GET', '/me', null, 'kai')).data;
    ok('subscription checkout (wrong amount) ignored', (await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_sub0', mode: 'subscription', payment_status: 'paid', client_reference_id: String(me.id), amount_total: 1, customer: 'cus_1', subscription: 'sub_1' } } })) === 200 && (await call('GET', '/me', null, 'kai')).data.premium === false);
    await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_sub1', mode: 'subscription', payment_status: 'paid', client_reference_id: String(me.id), amount_total: 799, customer: 'cus_1', subscription: 'sub_1' } } });
    ok('Stripe subscription webhook activates premium', (await call('GET', '/me', null, 'kai')).data.premium === true);
    const until0 = (await call('GET', '/me', null, 'kai')).data.plan_until;
    await hook({ type: 'invoice.paid', data: { object: { customer: 'cus_1', amount_paid: 799, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 90 * 86400 } }] } } } });
    ok('renewal invoice extends premium', (await call('GET', '/me', null, 'kai')).data.plan_until > until0);
    await hook({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
    ok('subscription deletion ends premium', (await call('GET', '/me', null, 'kai')).data.premium === false);

    // ---- drafts + chapter editing
    const dr = await call('POST', `/series/${sid}/chapters`, { title: 'Draft ch', content: chText(9), draft: true }, 'nova'); ok('save draft', dr.data.draft === true);
    ok('draft invisible to readers', !(await call('GET', '/series/' + sid, null, 'reader')).data.chapters.some(c => c.id === dr.data.id) && (await call('GET', '/chapters/' + dr.data.id, null, 'reader')).status === 404);
    ok('draft visible to its creator', (await call('GET', '/series/' + sid, null, 'nova')).data.chapters.some(c => c.id === dr.data.id && c.draft));
    ok('publish draft now', (await call('PATCH', '/chapters/' + dr.data.id, { publish: 'now' }, 'nova')).status === 200 && (await call('GET', '/chapters/' + dr.data.id, null, 'reader')).status === 200);
    ok('other creators cannot edit my chapter', (await call('PATCH', '/chapters/' + dr.data.id, { title: 'hack' }, 'kai')).status === 403);
    ok('paid-for chapters cannot be deleted', (await call('DELETE', '/chapters/' + ids[2], null, 'nova')).status === 400);
    ok('unpaid chapter can be deleted', (await call('DELETE', '/chapters/' + dr.data.id, null, 'nova')).status === 200);

    // ---- polls, pinned comments, retention analytics
    ok('creator adds a poll', (await call('POST', `/chapters/${ids[0]}/poll`, { question: 'Who should win?', options: ['Mira', 'The Clockmaker'] }, 'nova')).data.options.length === 2);
    ok('reader cannot create polls', (await call('POST', `/chapters/${ids[0]}/poll`, { question: 'Hello there?', options: ['a', 'b'] }, 'reader')).status === 403);
    const pid = (await call('GET', `/chapters/${ids[0]}/poll`)).data.id; const vote = await call('POST', `/polls/${pid}/vote`, { choice: 1 }, 'reader'); ok('reader votes in poll', vote.data.options[1].votes === 1 && vote.data.mine === 1);
    ok('invalid poll choice rejected', (await call('POST', `/polls/${pid}/vote`, { choice: 9 }, 'reader')).status === 400);
    const cm = await call('POST', `/chapters/${ids[0]}/comments`, { body: 'Loved this chapter!' }, 'reader');
    ok('reader cannot pin comments', (await call('POST', `/comments/${cm.data.id}/pin`, null, 'reader')).status === 403);
    ok('creator pins a comment', (await call('POST', `/comments/${cm.data.id}/pin`, null, 'nova')).data.pinned === true && (await call('GET', `/chapters/${ids[0]}/comments`)).data[0].pinned === true);
    ok('creator can see/manage comments', (await call('GET', '/creator/comments', null, 'nova')).data.some(c => c.id === cm.data.id));
    ok('creator deletes a comment', (await call('DELETE', '/comments/' + cm.data.id, null, 'nova')).status === 200 && !(await call('GET', `/chapters/${ids[0]}/comments`)).data.length);
    const ret = (await call('GET', `/creator/series/${sid}/retention`, null, 'nova')).data; ok('retention analytics per chapter', ret.length >= 3 && ret[0].readers >= 1 && ret[0].retention === 100);
    ok('retention analytics are creator-only', (await call('GET', `/creator/series/${sid}/retention`, null, 'reader')).status === 403);
    ok('progress saved with page + percent', (await call('POST', `/chapters/${ids[0]}/progress`, { page: 3, pct: 42 }, 'reader')).data.ok && (await call('GET', '/chapters/' + ids[0], null, 'reader')).data.resume.pct === 42);
    ok('reading history', (await call('GET', '/history', null, 'reader')).data.some(h => h.chapter_id === ids[0] && h.pct === 42));
    ok('synced reader preferences', (await call('PUT', '/me/prefs', { theme: 'sepia', fs: 22, mode: 'paged', evil: 'x', font: 'comic' }, 'reader')).data.theme === 'sepia' && (await call('GET', '/me/prefs', null, 'reader')).data.fs === 22 && !(await call('GET', '/me/prefs', null, 'reader')).data.font);

    // ---- discovery
    const ch = (await call('GET', '/charts')).data; ok('charts: all sections present', ['paid', 'free', 'rising', 'completed', 'new', 'spotlight'].every(k => Array.isArray(ch[k])));
    ok('rising chart lists a new series', ch.rising.length > 0);
    ok('related series endpoint', Array.isArray((await call('GET', '/series/' + sid + '/related')).data));

    // ---- COPYRIGHT CHECK: text
    const original = `${words(500, 150)}\n\n${words(501, 150)}`;
    const a1 = await call('POST', `/series/${sid}/chapters`, { title: 'Original', content: original, publish_mode: 'now' }, 'nova'); ok('original text passes the copyright check', a1.status === 200 && a1.data.status === 'ok');
    const kaiSeries = (await call('GET', '/series?creator=' + (await call('GET', '/me', null, 'kai')).data.id)).data.find(s => s.type === 'novel');
    const stolen = await call('POST', `/series/${kaiSeries.id}/chapters`, { title: 'Copied', content: original, publish_mode: 'now' }, 'kai');
    ok('verbatim copy of another creator is BLOCKED', stolen.status === 422 && stolen.data.copyright.verdict === 'block');
    const w = original.split(' '); const tweaked = w.map((x, i) => i % 9 === 0 ? 'zzz' + i : x).join(' ');
    const lightEdit = await call('POST', `/series/${kaiSeries.id}/chapters`, { title: 'Lightly edited copy', content: tweaked, publish_mode: 'now' }, 'kai');
    ok('lightly edited copy is blocked or held', lightEdit.status === 422 || lightEdit.data.status === 'pending_review');
    ok('own re-upload is allowed', (await call('POST', `/series/${sid}/chapters`, { title: 'Repost', content: original, publish_mode: 'now' }, 'nova')).status === 200);
    ok('unrelated text passes', (await call('POST', `/series/${kaiSeries.id}/chapters`, { title: 'Mine', content: `${words(900, 120)}`, publish_mode: 'now' }, 'kai')).data.status === 'ok');
    ok('dry-run copyright check endpoint', (await call('POST', '/copyright/check-text', { text: original }, 'kai')).data.verdict === 'block');
    // partial overlap goes to human review
    const half = original.split(' ').slice(0, 130).join(' ') + ' ' + words(777, 170);
    const partial = await call('POST', `/series/${kaiSeries.id}/chapters`, { title: 'Partly similar', content: half, publish_mode: 'now' }, 'kai');
    ok('partial overlap is held for admin review', partial.status === 200 && partial.data.status === 'pending_review');
    ok('held chapter is hidden from readers', (await call('GET', '/chapters/' + partial.data.id, null, 'reader')).status === 404 && !(await call('GET', '/series/' + kaiSeries.id, null, 'reader')).data.chapters.some(c => c.id === partial.data.id));
    const q = (await call('GET', '/admin/copyright', null, 'admin')).data; ok('admin sees the review queue', q.queue.some(k => k.chapter_id === partial.data.id && k.status === 'open'));
    ok('overview counts open reviews', (await call('GET', '/admin/overview', null, 'admin')).data.openCopyright >= 1);
    ok('non-admin cannot see the queue', (await call('GET', '/admin/copyright', null, 'kai')).status === 403);
    const item = q.queue.find(k => k.chapter_id === partial.data.id);
    ok('admin approves -> chapter goes live', (await call('POST', '/admin/copyright/' + item.id, { action: 'approve' }, 'admin')).status === 200 && (await call('GET', '/chapters/' + partial.data.id, null, 'reader')).status === 200);
    const partial2 = await call('POST', `/series/${kaiSeries.id}/chapters`, { title: 'Partly similar 2', content: original.split(' ').slice(0, 125).join(' ') + ' ' + words(778, 170), publish_mode: 'now' }, 'kai');
    if (partial2.data.status === 'pending_review') { const it = (await call('GET', '/admin/copyright', null, 'admin')).data.queue.find(k => k.chapter_id === partial2.data.id);
      ok('admin rejects -> chapter deleted', (await call('POST', '/admin/copyright/' + it.id, { action: 'reject' }, 'admin')).status === 200 && (await call('GET', '/series/' + kaiSeries.id, null, 'admin')).data.chapters.every(c => c.id !== partial2.data.id)); }
    // protected works registry
    const protectedText = words(4242, 160); const fdp = new FormData(); fdp.append('label', 'Big Publisher — Famous Novel'); fdp.append('text', protectedText);
    ok('admin registers a protected work', (await fetch(base + '/api/admin/copyright/protect', { method: 'POST', headers: { Authorization: 'Bearer ' + token.admin }, body: fdp })).status === 200);
    const pirate = await call('POST', `/series/${kaiSeries.id}/chapters`, { title: 'Pirated', content: protectedText.split(' ').slice(0, 100).join(' ') + ' ' + words(31, 60), publish_mode: 'now' }, 'kai');
    ok('material matching the protected registry is blocked', pirate.status === 422 && /rights holder/.test(pirate.data.error));
    // ---- COPYRIGHT CHECK: images
    const comicSeries = (await call('GET', '/series?creator=' + (await call('GET', '/me', null, 'nova')).data.id)).data.find(s => s.type === 'comic');
    const kaiComic = (await call('GET', '/series?creator=' + (await call('GET', '/me', null, 'kai')).data.id)).data.find(s => s.type === 'comic');
    const pages = [await art(1), await art(2), await art(3)];
    const up1 = await upload(`/series/${comicSeries.id}/chapters`, { title: 'Art chapter', publish_mode: 'now' }, pages, 'nova'); ok('original artwork passes', up1.status === 200 && up1.data.status === 'ok');
    const reencoded = await Promise.all(pages.map(p => sharp(p).resize(240, 320).jpeg({ quality: 55 }).toBuffer()));
    const up2 = await upload(`/series/${kaiComic.id}/chapters`, { title: 'Stolen art', publish_mode: 'now' }, reencoded, 'kai');
    ok('resized + re-compressed copy of artwork is BLOCKED (perceptual hash)', up2.status === 422 && up2.data.copyright.verdict === 'block');
    ok('blocked upload leaves no chapter behind', !(await call('GET', '/series/' + kaiComic.id, null, 'kai')).data.chapters.some(c => c.title === 'Stolen art'));
    const up3 = await upload(`/series/${kaiComic.id}/chapters`, { title: 'Own art', publish_mode: 'now' }, [await art(11), await art(12)], 'kai'); ok('different artwork passes', up3.status === 200 && up3.data.status === 'ok');
    const blank = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#fff' } }).png().toBuffer();
    ok('blank pages never trigger false positives', (await upload(`/series/${comicSeries.id}/chapters`, { title: 'blank1', publish_mode: 'now' }, [blank], 'nova')).status === 200 && (await upload(`/series/${kaiComic.id}/chapters`, { title: 'blank2', publish_mode: 'now' }, [blank], 'kai')).status === 200);
    const mixed = await upload(`/series/${kaiComic.id}/chapters`, { title: 'Mixed', publish_mode: 'now' }, [reencoded[0], await art(21), await art(22), await art(23)], 'kai');
    ok('1 of 4 stolen pages is held for review (not auto-blocked)', mixed.status === 200 && mixed.data.status === 'pending_review');
    // cover check
    const fdc = new FormData(); Object.entries({ title: 'Cover thief', type: 'comic', synopsis: 'x' }).forEach(([k, v]) => fdc.append(k, v)); fdc.append('cover', new Blob([reencoded[1]], { type: 'image/jpeg' }), 'c.jpg');
    ok('a copied cover image is rejected', (await fetch(base + '/api/series', { method: 'POST', headers: { Authorization: 'Bearer ' + token.kai }, body: fdc })).status === 422);
    // ownership proof
    const proof = await call('GET', '/chapters/' + up1.data.id + '/proof', null, 'nova'); ok('ownership proof is signed', proof.status === 200 && proof.data.signature.length === 64 && proof.data.statement.sha256.length === 3);
    ok('proof is private to the creator', (await call('GET', '/chapters/' + up1.data.id + '/proof', null, 'kai')).status === 403);

    // ---- manga mode + paid-chapter flags reach the reader
    await call('PATCH', '/series/' + comicSeries.id, { reading_dir: 'rtl', monetization: 'free', language: 'ja' }, 'nova');
    const cs = (await call('GET', '/series/' + comicSeries.id)).data; ok('series carries manga direction + language', cs.reading_dir === 'rtl' && cs.language === 'ja' && cs.monetization === 'free');
    ok('reader payload includes reading direction', (await call('GET', '/chapters/' + up1.data.id, null, 'reader')).data.reading_dir === 'rtl');
    ok('paid chapters are flagged for copy protection', (await call('GET', '/chapters/' + ids[2], null, 'reader')).data.protect === true && (await call('GET', '/chapters/' + ids[0], null, 'reader')).data.protect === false);
    console.log('\nAll v3 checks passed.'); process.exit(0);
  } catch (e) { console.error('\n' + e.message); process.exit(1); }
});
