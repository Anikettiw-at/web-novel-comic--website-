/* InkVerse reader: vertical scroll, animated page-turning "book" view, manga (right-to-left, double-page) mode,
   persistent highlights, text-to-speech, reader themes, progress sync, offline saving. Uses the IV toolkit from app.js. */
(() => {
const { S, $, $$, esc, api, toast, guard, needLogin, coinBurst, on, leave, inline, bindSpoilers, reportModal, avatar, ago } = IV;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const LANG = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA' };
const COLORS = ['yellow', 'green', 'pink', 'blue'];

// ---------------- preferences (local + synced to the account) ----------------
let prefs = { fs: 18, lh: 1.9, font: 'serif', flip: true, dual: true, rate: 1, mode: 'scroll', ...store.get('iv_prefs', {}) };
let prefsFor = null, saveT;
async function syncPrefs() { if (!S.user || prefsFor === S.user.id) return; prefsFor = S.user.id; try { Object.assign(prefs, await api('/me/prefs')); store.set('iv_prefs', prefs); } catch {} }
function setPref(k, val) { prefs[k] = val; store.set('iv_prefs', prefs); if (S.user) { clearTimeout(saveT); saveT = setTimeout(() => api('/me/prefs', { method: 'PUT', body: prefs }).catch(() => {}), 700); } }
const readerTheme = () => prefs.theme || (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

async function loadChapter(id) {
  try { return await api('/chapters/' + id); }
  catch (e) {
    if (e.status) throw e;   // real HTTP error; only fall back to the offline copy when the network is down
    const hit = await caches.open('iv-offline').then(c => c.match('/offline/chapter/' + id)).catch(() => null);
    if (hit) return { ...(await hit.json()), _offline: true };
    throw e;
  }
}

// ---------------- the page-turning book ----------------
// n pages, optionally shown two at a time (spread), left-to-right or right-to-left (manga). render(p) must return a fresh DOM node.
// A "leaf" (front + back face) rotates around the spine with CSS 3D; while it turns, the pages underneath are already the right ones.
function Book(root, o) {
  const k = o.spread ? 2 : 1, views = Math.max(1, Math.ceil(o.n / k)); let v = Math.min(Math.max(o.start || 0, 0), views - 1), busy = false;
  root.innerHTML = ''; root.classList.toggle('rtl', !!o.rtl); root.classList.toggle('spread', k === 2);
  const stage = document.createElement('div'); stage.className = 'bk-stage'; root.append(stage);
  const slots = Array.from({ length: k }, () => { const s = document.createElement('div'); s.className = 'bk-slot'; stage.append(s); return s; });
  const blank = () => { const d = document.createElement('div'); d.className = 'pg-blank'; return d; };
  const page = p => (p >= 0 && p < o.n) ? o.render(p) : blank();
  const fill = (slot, p) => slot.replaceChildren(page(p));
  const show = view => { v = view; slots.forEach((s, j) => fill(s, view * k + j)); o.onChange?.(view * k, views); };
  const face = (cls, node) => { const f = document.createElement('div'); f.className = 'bk-face ' + cls; if (node) f.append(node); return f; };
  function go(target) {
    if (busy) return 'busy';   // a turn is in flight: swallow the click (do NOT treat it as "end of chapter")
    if (target < 0 || target >= views || target === v) return false;
    if (!o.animate()) { show(target); return true; }
    const fwd = target > v, fi = k - 1, fslot = slots[fi]; let front, back = null;
    if (fwd) { front = v * k + fi; if (k === 2) back = target * k; fill(fslot, target * k + fi); }       // under-layer already shows the destination
    else { front = target * k + fi; if (k === 2) { back = v * k; fill(slots[0], target * k); } }
    const leaf = document.createElement('div'); leaf.className = 'bk-leaf';
    leaf.append(face('front', page(front)), face('back', back != null ? page(back) : blank()));
    const shade = document.createElement('div'); shade.className = 'bk-shade'; leaf.append(shade);
    Object.assign(leaf.style, { left: fslot.offsetLeft + 'px', top: fslot.offsetTop + 'px', width: fslot.offsetWidth + 'px', height: fslot.offsetHeight + 'px', transformOrigin: o.rtl ? 'right center' : 'left center' });
    stage.append(leaf); busy = true;
    const sign = o.rtl ? 1 : -1, from = fwd ? 0 : sign * 180, to = fwd ? sign * 180 : 0, dur = 720;
    let finished = false; const done = () => { if (finished) return; finished = true; leaf.remove(); show(target); busy = false; };
    setTimeout(done, dur + 250);   // background tabs can pause animations; never get stuck mid-turn
    const a = leaf.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }], { duration: dur, easing: 'cubic-bezier(.645,.045,.355,1)', fill: 'forwards' });
    shade.animate([{ opacity: 0 }, { opacity: .6, offset: .5 }, { opacity: 0 }], { duration: dur });
    a.onfinish = done; a.oncancel = done; return true;
  }
  show(v);
  return { next: () => go(v + 1), prev: () => go(v - 1), goPage: p => go(Math.floor(p / k)), jump: p => show(Math.floor(p / k)), refresh: () => show(v), get page() { return v * k; }, views, k };
}

// ---------------- text highlights ----------------
const rangeOffset = (p, node, off) => { const r = document.createRange(); r.selectNodeContents(p); r.setEnd(node, off); return r.toString().length; };
function paintPara(el, text, hls) {
  const mine = hls.filter(h => h.kind === 'text' && h.para === +el.dataset.p).map(h => {   // re-anchor if the stored offsets no longer match
    let s = h.start, e = h.end; if (text.slice(s, e) !== h.text) { s = text.indexOf(h.text); e = s + h.text.length; } return s < 0 ? null : { ...h, s, e }; }).filter(Boolean).sort((a, b) => a.s - b.s);
  if (!mine.length) { if (el.childElementCount) el.textContent = text; return; }
  let out = '', pos = 0;
  for (const h of mine) { if (h.s < pos) continue; out += esc(text.slice(pos, h.s)) + `<mark class="hl hl-${h.color}${h.note ? ' has-note' : ''}" data-hid="${h.id}" ${h.note ? `title="${esc(h.note)}"` : ''}>${esc(text.slice(h.s, h.e))}</mark>`; pos = h.e; }
  el.innerHTML = out + esc(text.slice(pos));
}

const commentHtml = (c, ctx) => `<div class="comment ${c.pinned ? 'pinned' : ''}" data-cid="${c.id}">${avatar(c.username)}<div style="flex:1"><b>${esc(c.username)}</b>${c.role !== 'reader' ? `<span class="role ${c.role}">${c.role}</span>` : ''}${c.pinned ? ' <span class="chip active" style="padding:1px 8px;font-size:11px">📌 Pinned by creator</span>' : ''} <small class="muted">${ago(c.created_at)}</small><div>${inline(c.body)}</div>
  <button data-rep="${c.id}" class="muted lnk">🚩 report</button>${ctx.creator ? `<button data-pin="${c.id}" class="muted lnk">${c.pinned ? '📌 unpin' : '📌 pin'}</button>` : ''}${ctx.creator || ctx.me === c.user_id ? `<button data-del="${c.id}" class="muted lnk">🗑 delete</button>` : ''}</div></div>`;

const pollHtml = (p) => { if (!p) return ''; const total = p.options.reduce((a, o) => a + o.votes, 0);
  return `<div class="card poll" data-poll="${p.id}"><b>🗳 ${esc(p.question)}</b><small class="muted"> — help decide where the story goes</small>${p.options.map((o, i) => { const pc = total ? Math.round(o.votes / total * 100) : 0;
    return `<button class="poll-opt ${p.mine === i ? 'mine' : ''}" data-i="${i}"><span class="bar" style="width:${pc}%"></span><span class="lbl">${p.mine === i ? '✓ ' : ''}${esc(o.text)}</span><span class="pct">${pc}%</span></button>`; }).join('')}<small class="muted">${total} vote${total === 1 ? '' : 's'}${S.user ? '' : ' · log in to vote'}</small></div>`; };

const qaHtml = (list, ctx) => list.map(q => `<div class="card" style="margin-bottom:10px;padding:12px 16px"><b>Q:</b> ${esc(q.question)} <small class="muted">— ${esc(q.username)}${q.answer ? '' : ' · waiting for an answer'}</small>
  ${q.answer ? `<div style="margin-top:6px;border-left:4px solid var(--green);padding-left:10px"><b>A:</b> ${esc(q.answer)}</div>` : ctx.creator ? `<form class="row" data-ans="${q.id}" style="margin-top:8px"><input name="a" maxlength="1000" placeholder="Answer…" style="flex:1;padding:8px 12px;border-radius:99px;border:1px solid var(--line);background:var(--bg)"><button class="btn small">Answer</button></form>` : ''}</div>`).join('') || '<p class="muted">No answered questions yet.</p>';

const adHtml = () => S.user?.premium ? '' : `<div class="ad"><small>Ad · free plan</small><div class="row" style="justify-content:space-between"><span>📖 Read without ads, highlight without limits and unlock early chapters.</span><a class="btn small" href="#/premium">Try Premium</a></div></div>`;

// ---------------- the reader page ----------------
on(/^\/read\/(\d+)$/, async m => {
  await syncPrefs();
  const c = await loadChapter(m[1]);
  const isNovel = c.type === 'novel';
  const bar = `<div class="reader-bar" id="rbar"><a class="btn ghost small" href="#/series/${c.series_id}">← ${esc(c.series_title)}</a><b class="t">Ch. ${c.number}: ${esc(c.title)}</b><small class="muted" id="meta"></small><span style="margin-left:auto" class="row">
    ${c.locked ? '' : isNovel ? '<button class="btn ghost small" id="bk" title="Switch scroll / book view (B)">📖 Book view</button><button class="btn ghost small" id="tts" title="Read aloud (T)">🔊 Listen</button><button class="btn ghost small" id="as" title="Auto-scroll (S)">⏬ Auto-scroll</button>'
      : '<select class="btn ghost small" id="mode" aria-label="Reading mode"><option value="scroll">⬇ Scroll</option><option value="paged">📄 Paged</option><option value="manga">🈶 Manga (right-to-left)</option></select><button class="btn ghost small" id="hlt" title="Draw highlights on panels (H)">🖍 Highlight tool</button>'}
    ${c.locked ? '' : '<button class="btn ghost small" id="set" aria-label="Reader settings">⚙ Aa</button><button class="btn ghost small" id="off" title="Save this chapter for offline reading">⬇</button>'}
    ${c.prev ? `<a class="btn ghost small" href="#/read/${c.prev}">‹ Prev</a>` : ''}${c.next ? `<a class="btn small" href="#/read/${c.next}">Next ›</a>` : ''}</span></div>`;

  if (c.locked) {
    const prem = S.user?.premium;
    const html = `${bar}<div class="paywall card"><div class="big">🔒</div><h2 class="display" style="font-size:34px">Early-access chapter</h2><p class="muted" style="margin:10px 0 18px">Unlock for <b>🪙 ${c.price_coins}</b> to read now${c.free_at ? `, or wait — it becomes free on <b>${new Date(c.free_at).toLocaleDateString()}</b>` : ''}. ${S.cfg.creatorShareUnlockPct}% supports the creator directly.</p>
    <div class="row" style="justify-content:center"><button class="btn" id="unlock">Unlock for 🪙 ${c.price_coins}</button>${prem ? '<button class="btn pink" id="pun">⭐ Use a Premium unlock</button>' : ''}<a class="btn ghost" href="#/wallet">Get coins</a></div>
    ${prem ? '' : `<p class="muted" style="margin-top:16px;font-size:13px">⭐ <a href="#/premium" style="text-decoration:underline">Premium</a> members get ${S.cfg.premium.monthlyUnlocks} early-access unlocks every month, no ads.</p>`}</div>`;
    return { html, mount(v) {
      const after = async () => { toast('Unlocked! Enjoy ✨', 'ok'); setTimeout(IV.route, 400); };
      $('#unlock', v).onclick = guard(async e => { if (!needLogin()) return; const { clientX: x, clientY: y } = e; const r = await api(`/chapters/${c.id}/unlock`, { method: 'POST' }); S.user.coins = r.coins ?? S.user.coins; coinBurst(x, y); IV.renderNav(); after(); });
      $('#pun', v)?.addEventListener('click', guard(async () => { const r = await api(`/chapters/${c.id}/premium-unlock`, { method: 'POST' }); toast(`${r.left} Premium unlocks left this month`, 'ok'); after(); }));
    } };
  }

  const online = !c._offline;
  const [comments, poll, hlsInit, qa] = await Promise.all([
    online ? api(`/chapters/${c.id}/comments`).catch(() => []) : [], online ? api(`/chapters/${c.id}/poll`).catch(() => null) : null,
    online && S.user ? api(`/chapters/${c.id}/highlights`).catch(() => []) : [], online ? api(`/chapters/${c.id}/qa`).catch(() => []) : []]);
  const ctx = { creator: S.user && (S.user.id === c.creator_id || S.user.role === 'admin'), me: S.user?.id };
  const note = c.author_note ? `<div class="card" style="max-width:760px;margin:24px auto 0;border-left:5px solid var(--green)"><b>✍️ Note from ${esc(c.creator)}</b><p style="margin-top:6px;white-space:pre-line">${esc(c.author_note)}</p></div>` : '';
  const reacts = `<div class="row" id="reacts" style="justify-content:center;margin:24px 0 0">${S.cfg.reactions.map(e => `<button class="chip ${c.mine?.includes(e) ? 'active' : ''}" data-e="${e}" style="font-size:18px">${e} <span>${c.reactions?.[e] || 0}</span></button>`).join('')}</div>`;
  const end = `${note}${reacts}<div class="wrap" style="max-width:760px"><div id="pollbox">${pollHtml(poll)}</div>${ctx.creator && online ? '<p style="margin-top:10px"><button class="btn ghost small" id="newpoll">🗳 Add a poll to this chapter</button></p>' : ''}
  <div class="row" style="justify-content:center;margin:20px 0 14px">${c.prev ? `<a class="btn ghost" href="#/read/${c.prev}">‹ Previous</a>` : ''}${c.next ? `<a class="btn" href="#/read/${c.next}">Next chapter ›</a>` : `<a class="btn" href="#/series/${c.series_id}">Back to series</a>`}</div>${adHtml()}
  <div class="section-head" style="margin-top:20px"><h2>🙋 Ask ${esc(c.creator)}</h2><span class="muted">Questions about this chapter</span></div>
  <div id="qa">${qaHtml(qa, ctx)}</div>${online ? `<form class="row" id="qaf" style="margin:10px 0"><input name="q" maxlength="300" placeholder="${S.user ? 'Ask the creator a question…' : 'Log in to ask a question'}" style="flex:1;min-width:200px;padding:10px 14px;border-radius:99px;border:1px solid var(--line);background:var(--bg)"><button class="btn small">Ask</button></form>` : ''}
  <div class="section-head" style="margin-top:20px"><h2>💬 Comments</h2><span class="muted">Moderated · tag spoilers with ||text||</span></div>
  <form class="form" id="cmf" style="margin-bottom:10px"><textarea name="b" maxlength="2000" placeholder="${S.user ? 'Share your thoughts…' : 'Log in to comment'}" style="min-height:70px"></textarea><div><button class="btn small">Post comment</button></div></form>
  <div id="cml">${comments.map(x => commentHtml(x, ctx)).join('') || '<p class="muted">Be the first to comment.</p>'}</div></div>`;
  const html = `${bar}${adHtml().replace('class="ad"', 'class="ad slim"')}${c._offline ? '<div class="ad slim"><small>Offline</small> Reading a saved copy. Progress will sync when you reconnect.</div>' : ''}
  <div class="rd rd-surface ${c.protect ? 'protected' : ''}" id="rd"><div id="holder"></div>
    <div class="pgnav" id="pgnav" hidden><button class="btn ghost small" id="pp">‹</button><b id="pi"></b><button class="btn ghost small" id="pnx">›</button></div></div>
  <div class="rd-panel" id="panel" hidden></div>${end}`;

  return { html, mount(v) {
    const rd = $('#rd', v), holder = $('#holder', v), rbar = $('#rbar', v), paras = isNovel ? (c.content || '').split(/\n{2,}/) : [];
    const rtlText = c.language === 'ar';
    let hls = [...hlsInit], book = null, tool = false, pageNow = c.resume?.page || 0, pctNow = c.resume?.pct || 0, metaT, progT, alive = true;
    let mode = isNovel ? (prefs.mode === 'paged' ? 'paged' : 'scroll') : store.get('iv_mode_' + c.series_id, null) || (c.reading_dir === 'rtl' ? 'manga' : c.reading_dir === 'ltr' ? 'paged' : 'scroll');
    leave(() => { alive = false; stopTTS(); stopAuto(); document.onkeydown = null; window.onscroll = null; window.removeEventListener('resize', onResize); $('#hlbar')?.remove(); $('#hlpop')?.remove(); });

    // ---- look & feel
    const applyLook = () => { rd.style.setProperty('--fs', prefs.fs + 'px'); rd.style.setProperty('--lh', prefs.lh); rd.dataset.font = prefs.font; rd.dataset.theme = readerTheme(); };
    if (c.protect) {   // paid chapter: deterrents against copying (not a guarantee) + a faint per-reader watermark
      for (const ev of ['copy', 'cut', 'contextmenu', 'dragstart']) rd.addEventListener(ev, e => e.preventDefault());
      if (S.user) { const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200'><text x='20' y='110' transform='rotate(-24 150 100)' font-family='Arial' font-size='16' fill='%23888'>${esc(S.user.username)} · InkVerse #${S.user.id}</text></svg>`; rd.style.setProperty('--wm', `url("data:image/svg+xml;utf8,${svg}")`); rd.classList.add('wm'); }
    }
    const useSpread = () => !isNovel ? (mode !== 'scroll' && prefs.dual && innerWidth >= 900) : (mode === 'paged' && prefs.dual && innerWidth >= 1000);
    const saveProg = () => { if (!S.user || !online) return; clearTimeout(progT); progT = setTimeout(() => api(`/chapters/${c.id}/progress`, { method: 'POST', body: { page: pageNow, pct: pctNow } }).catch(() => {}), 1200); };
    const updateMeta = () => {
      const mins = c.words ? Math.max(1, Math.round(c.words * (1 - pctNow / 100) / 230)) : 0;
      $('#meta', v).textContent = isNovel ? `${c.words ? c.words.toLocaleString() + ' words · ' : ''}${mins ? '~' + mins + ' min left · ' : ''}${Math.round(pctNow)}%` : `Page ${Math.min(pageNow + 1, c.pages.length)} / ${c.pages.length}`;
      saveProg();
    };

    // ---- highlight data helpers
    const repaint = () => { if (isNovel) { $$('p[data-p]', rd).forEach(p => paintPara(p, paras[+p.dataset.p], hls)); if (book) book.refresh(); } else { $$('.pg-img', rd).forEach(w => decorate(w, +w.dataset.page)); if (book) book.refresh(); } };
    const addHl = async body => {
      if (!S.user) { needLogin(); return null; }
      try { const h = await api(`/chapters/${c.id}/highlights`, { method: 'POST', body }); hls.push(h); repaint(); return h; }
      catch (e) { toast(e.message, 'err'); if (e.status === 402) setTimeout(() => toast('Open the profile menu → Upgrade for unlimited highlights.'), 900); return null; }
    };

    // ---- comics
    const decorate = (w, p) => { $$('.hl-box', w).forEach(x => x.remove()); hls.filter(h => h.kind === 'region' && h.page === p).forEach(h => { const b = document.createElement('button'); b.className = `hl-box hl-${h.color}`; b.dataset.hid = h.id; b.title = h.note || 'Highlighted — click to edit'; Object.assign(b.style, { left: h.x + '%', top: h.y + '%', width: h.w + '%', height: h.h + '%' }); w.append(b); }); };
    const pageEl = (p, lazy) => { const w = document.createElement('div'); w.className = 'pg-img'; w.dataset.page = p; const img = new Image(); img.alt = `Page ${p + 1}`; img.draggable = false; if (lazy) img.loading = 'lazy'; img.onload = () => img.classList.add('in'); img.src = c.pages[p]; if (img.complete) img.classList.add('in'); w.append(img); decorate(w, p); return w; };
    rd.addEventListener('pointerdown', e => {   // drag a box over a panel to highlight it
      const w = e.target.closest('.pg-img'); if (!tool || !w || e.target.closest('.hl-box')) return; e.preventDefault();
      const r = w.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, box = document.createElement('div'); box.className = 'hl-box draft'; w.append(box);
      const geom = ev => { const x = Math.max(r.left, Math.min(x0, ev.clientX)), y = Math.max(r.top, Math.min(y0, ev.clientY)), x2 = Math.min(r.right, Math.max(x0, ev.clientX)), y2 = Math.min(r.bottom, Math.max(y0, ev.clientY));
        return { x: (x - r.left) / r.width * 100, y: (y - r.top) / r.height * 100, w: (x2 - x) / r.width * 100, h: (y2 - y) / r.height * 100 }; };
      const mv = ev => { const g = geom(ev); Object.assign(box.style, { left: g.x + '%', top: g.y + '%', width: g.w + '%', height: g.h + '%' }); };
      const up = async ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); box.remove(); const g = geom(ev);
        if (g.w >= 3 && g.h >= 3) await addHl({ kind: 'region', page: +w.dataset.page, ...g, color: store.get('iv_hlcolor', 'yellow') }); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });

    // ---- novels: paint, book layout
    const paintAll = root => $$('p[data-p]', root).forEach(p => paintPara(p, paras[+p.dataset.p], hls));
    const parasHtml = cls => paras.map((t, i) => `<p ${cls} data-p="${i}">${esc(t)}</p>`).join('');
    function novelBook(startPct) {
      const spread = useSpread(), W = spread ? Math.min((innerWidth - 40) / 2, 520) : Math.min(innerWidth - 24, 640), H = Math.max(380, Math.min(innerHeight - 150, 800)), pad = 30, Wi = Math.floor(W - pad * 2), Hi = Math.floor(H - pad * 2 - 14);
      holder.innerHTML = `<div class="book" id="book" style="--pw:${Math.floor(W)}px;--ph:${Math.floor(H)}px"></div><div id="meas" style="position:absolute;left:-99999px;top:0;visibility:hidden"></div>`;
      const master = document.createElement('article'); master.className = 'novel-body cols'; master.dir = rtlText ? 'rtl' : 'ltr';
      Object.assign(master.style, { width: Wi + 'px', height: Hi + 'px', columnWidth: Wi + 'px', columnGap: '0', position: 'absolute', left: '0', top: '0' });
      master.innerHTML = parasHtml(''); paintAll(master); $('#meas', v).append(master);
      const build = () => {
        const n = Math.max(1, Math.ceil(master.scrollWidth / Wi - 0.02));
        const render = p => { const pg = document.createElement('div'); pg.className = 'pg-paper'; pg.style.padding = pad + 'px'; const vw = document.createElement('div'); vw.className = 'pg-text'; vw.style.cssText = `width:${Wi}px;height:${Hi}px;overflow:hidden`;
          const cl = master.cloneNode(true); Object.assign(cl.style, { transform: `translateX(${-p * Wi}px)`, position: 'static' }); vw.append(cl); const no = document.createElement('div'); no.className = 'pgno'; no.textContent = p + 1; pg.append(vw, no); return pg; };
        book = Book($('#book', v), { n, spread, rtl: rtlText, start: Math.min(Math.ceil(n / (spread ? 2 : 1)) - 1, Math.floor(startPct / 100 * Math.ceil(n / (spread ? 2 : 1)))), render, animate: () => prefs.flip && !reduced(), onChange: (p, views) => { pageNow = p; pctNow = views > 1 ? p / (spread ? 2 : 1) / (views - 1) * 100 : 100; $('#pi', v).textContent = spread ? `${p + 1}–${Math.min(p + 2, n)} / ${n}` : `${p + 1} / ${n}`; updateMeta(); } });
        book.pageOfPara = i => { const el = $(`p[data-p="${i}"]`, master); return el ? Math.floor(el.offsetLeft / Wi) : 0; };
      };
      (document.fonts?.ready || Promise.resolve()).then(() => { if (alive && mode === 'paged') build(); });
    }
    function comicBook() {
      const spread = useSpread(), rtl = mode === 'manga', W = spread ? Math.min((innerWidth - 24) / 2, 560) : Math.min(innerWidth - 24, 760), H = Math.max(360, innerHeight - 140);
      holder.innerHTML = `<div class="book comic-book" id="book" style="--pw:${Math.floor(W)}px;--ph:${Math.floor(H)}px"></div>`;
      book = Book($('#book', v), { n: c.pages.length, spread, rtl, start: Math.min(Math.floor(pageNow / (spread ? 2 : 1)), Math.ceil(c.pages.length / (spread ? 2 : 1)) - 1), render: p => pageEl(p, false), animate: () => prefs.flip && !reduced(), onChange: (p) => { pageNow = p; pctNow = (p + 1) / c.pages.length * 100; [p - 2, p - 1, p + 2, p + 3].forEach(i => c.pages[i] && (new Image().src = c.pages[i])); $('#pi', v).textContent = spread ? `${p + 1}–${Math.min(p + 2, c.pages.length)} / ${c.pages.length}` : `${p + 1} / ${c.pages.length}`; updateMeta(); } });
    }

    // ---- scroll views
    function scrollView() {
      if (isNovel) { holder.innerHTML = `<article class="novel-body" id="art" dir="${rtlText ? 'rtl' : 'ltr'}">${parasHtml('class="in"')}</article>`; paintAll(holder); }
      else { holder.innerHTML = '<div class="comic" id="comic"></div>'; c.pages.forEach((_, p) => $('#comic', v).append(pageEl(p, true))); }
      requestAnimationFrame(() => { const h = document.documentElement; if (pctNow > 1 && pctNow < 99) scrollTo({ top: pctNow / 100 * (h.scrollHeight - innerHeight), behavior: 'instant' }); });
    }
    function onScroll() {
      if (!$('#rbar')) { $('#progress').style.width = '0'; window.onscroll = null; return; }
      const h = document.documentElement, pct = Math.max(0, Math.min(100, scrollY / Math.max(1, h.scrollHeight - innerHeight) * 100)); $('#progress').style.width = pct + '%';
      rbar.classList.toggle('hide', scrollY > lastY && scrollY > 200); lastY = scrollY;
      if (mode === 'scroll') { pctNow = pct; if (!isNovel) { const mid = innerHeight / 2, w = $$('.pg-img', rd).find(x => { const r = x.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }); if (w) pageNow = +w.dataset.page; } updateMeta(); }
    }
    let lastY = scrollY; window.onscroll = onScroll;

    // ---- render according to mode
    function render(keepPct) {
      stopAuto(); book = null; tool = false; $('#hlt', v)?.classList.remove('on');
      const startPct = keepPct ?? pctNow; $('#pgnav', v).hidden = mode === 'scroll';
      const sel = $('#mode', v); if (sel) sel.value = mode; const bk = $('#bk', v); if (bk) bk.textContent = mode === 'paged' ? '📜 Scroll view' : '📖 Book view';
      applyLook();
      if (mode === 'scroll') scrollView(); else if (isNovel) novelBook(startPct); else comicBook();
      updateMeta();
    }
    const turn = dir => { if (!book) return; const r = dir === 'next' ? book.next() : book.prev(); if (r !== false) return; if (dir === 'next' && c.next) location.hash = '#/read/' + c.next; else if (dir === 'prev' && c.prev) location.hash = '#/read/' + c.prev; };
    const rtlBook = () => (!isNovel && mode === 'manga') || (isNovel && rtlText);
    $('#pp', v).onclick = () => turn(rtlBook() ? 'next' : 'prev'); $('#pnx', v).onclick = () => turn(rtlBook() ? 'prev' : 'next');
    // tap zones & swipe on the book
    let sx = 0, sy = 0;
    rd.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    rd.addEventListener('touchend', e => { if (!book || tool) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && !getSelection().toString()) turn((dx < 0) !== rtlBook() ? 'next' : 'prev'); });
    rd.addEventListener('click', e => {
      if (!book || tool || e.target.closest('.hl-box,mark,.pgnav') || getSelection().toString()) return;
      const r = $('#book', v).getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (x < .28) turn(rtlBook() ? 'next' : 'prev'); else if (x > .72) turn(rtlBook() ? 'prev' : 'next'); else rbar.classList.toggle('hide');
    });
    const onResize = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { if (alive && mode !== 'scroll') render(pctNow); }, 250); }; })(); window.addEventListener('resize', onResize);

    // ---- toolbar controls
    $('#mode', v)?.addEventListener('change', e => { mode = e.target.value; store.set('iv_mode_' + c.series_id, mode); render(pageNow / c.pages.length * 100); if (mode !== 'scroll') book?.jump(pageNow); });
    $('#bk', v)?.addEventListener('click', () => { mode = mode === 'paged' ? 'scroll' : 'paged'; setPref('mode', mode); stopTTS(); render(pctNow); });
    $('#hlt', v)?.addEventListener('click', () => { if (!needLogin()) return; tool = !tool; $('#hlt', v).classList.toggle('on', tool); rd.classList.toggle('drawing', tool); toast(tool ? 'Drag a box over a panel to highlight it. Click the button again to stop.' : 'Highlight tool off'); });
    $('#off', v)?.addEventListener('click', guard(async () => {
      const cache = await caches.open('iv-offline'); await cache.put('/offline/chapter/' + c.id, new Response(JSON.stringify({ ...c, saved_at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
      if (c.pages) { const ic = await caches.open('iv-img-v1'); await Promise.all(c.pages.map(u => ic.add(u).catch(() => {}))); }
      toast('Saved for offline reading ✓ (see Library → Offline)', 'ok');
    }));
    // settings panel
    $('#set', v)?.addEventListener('click', () => {
      const pn = $('#panel', v); if (!pn.hidden) { pn.hidden = true; return; }
      const th = [['light', '#ffffff', '#222'], ['sepia', '#f4ecd8', '#433422'], ['dark', '#1c1f26', '#e6e8ec'], ['black', '#000000', '#cfd2d8']];
      pn.innerHTML = `<b>Reading settings</b><div class="row" style="margin:10px 0">${th.map(([k, bg, ink]) => `<button class="swatch ${readerTheme() === k ? 'on' : ''}" data-th="${k}" style="background:${bg};color:${ink}" aria-label="${k} theme">Aa</button>`).join('')}</div>
      ${isNovel ? `<label>Font<select id="pf"><option value="serif">Serif</option><option value="sans">Sans-serif</option><option value="dyslexic">Easy-read</option></select></label>
      <label>Text size <span id="fsv">${prefs.fs}px</span><input type="range" id="pfs" min="13" max="30" value="${prefs.fs}"></label><label>Line spacing <span id="lhv">${prefs.lh}</span><input type="range" id="plh" min="1.3" max="2.4" step=".1" value="${prefs.lh}"></label>
      <label>Read-aloud speed <span id="rtv">${prefs.rate}×</span><input type="range" id="prt" min=".5" max="2" step=".1" value="${prefs.rate}"></label>` : ''}
      <label class="check"><input type="checkbox" id="pfl" ${prefs.flip ? 'checked' : ''}> Page-turn animation</label>
      <label class="check"><input type="checkbox" id="pdu" ${prefs.dual ? 'checked' : ''}> Two-page spread on wide screens</label><p class="muted" style="font-size:12px">Settings sync to your account.</p>`;
      pn.hidden = false; const pf = $('#pf', pn); if (pf) pf.value = prefs.font;
      pn.onclick = e => { const t = e.target.closest('[data-th]'); if (t) { setPref('theme', t.dataset.th); $$('.swatch', pn).forEach(x => x.classList.toggle('on', x === t)); applyLook(); } };
      pn.oninput = e => { const id = e.target.id;
        if (id === 'pfs') { setPref('fs', +e.target.value); $('#fsv', pn).textContent = e.target.value + 'px'; applyLook(); if (mode === 'paged') render(pctNow); }
        if (id === 'plh') { setPref('lh', +e.target.value); $('#lhv', pn).textContent = e.target.value; applyLook(); if (mode === 'paged') render(pctNow); }
        if (id === 'prt') { setPref('rate', +e.target.value); $('#rtv', pn).textContent = e.target.value + '×'; }
        if (id === 'pf') { setPref('font', e.target.value); applyLook(); if (mode === 'paged') render(pctNow); }
        if (id === 'pfl') setPref('flip', e.target.checked); if (id === 'pdu') { setPref('dual', e.target.checked); if (mode !== 'scroll') render(pctNow); } };
    });

    // ---- auto-scroll (novel scroll view)
    let autoT = null, speed = 1; function stopAuto() { clearInterval(autoT); autoT = null; const b = $('#as'); if (b) b.textContent = '⏬ Auto-scroll'; }
    $('#as', v)?.addEventListener('click', () => { if (autoT) return stopAuto(); if (mode !== 'scroll') { mode = 'scroll'; setPref('mode', 'scroll'); render(pctNow); } $('#as').textContent = '⏸ Stop'; autoT = setInterval(() => { if (!$('#as')) return stopAuto(); scrollBy(0, speed); }, 16); });

    // ---- text-to-speech (browser voices; no data leaves the device)
    let ttsOn = false, ttsIdx = 0;
    const chunks = t => { const out = []; let cur = ''; for (const s of t.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [t]) { if ((cur + s).length > 180 && cur) { out.push(cur); cur = s; } else cur += s; } if (cur.trim()) out.push(cur); return out; };
    function stopTTS() { ttsOn = false; try { speechSynthesis.cancel(); } catch {} $$('.tts-now').forEach(x => x.classList.remove('tts-now')); const b = $('#tts'); if (b) b.textContent = '🔊 Listen'; }
    function speak(i, j = 0) {
      if (!alive || !ttsOn || i >= paras.length) return stopTTS();
      const cs = chunks(paras[i]); if (j >= cs.length) return speak(i + 1, 0);
      if (j === 0) { $$('.tts-now').forEach(x => x.classList.remove('tts-now'));
        if (mode === 'paged' && book?.pageOfPara) book.goPage(book.pageOfPara(i)); const el = $(`#holder p[data-p="${i}"]`); el?.classList.add('tts-now'); if (mode === 'scroll') el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const u = new SpeechSynthesisUtterance(cs[j]); u.lang = LANG[c.language] || 'en-US'; u.rate = prefs.rate; u.onend = () => speak(i, j + 1); u.onerror = () => stopTTS(); ttsIdx = i; speechSynthesis.speak(u);
    }
    $('#tts', v)?.addEventListener('click', () => {
      if (!('speechSynthesis' in window)) return toast('Read-aloud is not supported by this browser.', 'err');
      if (ttsOn) return stopTTS(); ttsOn = true; $('#tts').textContent = '⏹ Stop';
      let start = 0; if (mode === 'scroll') start = Math.max(0, $$('#holder p[data-p]').findIndex(p => p.getBoundingClientRect().top > 90)); else if (book?.pageOfPara) { const cur = book.page; start = Math.max(0, paras.findIndex((_, i) => book.pageOfPara(i) >= cur)); }
      speak(start);
    });

    // ---- novel highlights: select text -> pick a colour
    function toolbar(r, anchor) {
      $('#hlbar')?.remove(); const bar = document.createElement('div'); bar.id = 'hlbar'; bar.className = 'hlbar';
      bar.innerHTML = S.user ? COLORS.map(cl => `<button class="dot hl-${cl}" data-c="${cl}" aria-label="Highlight ${cl}"></button>`).join('') : '<button class="btn small" data-login>Log in to save highlights</button>';
      const rc = r.getBoundingClientRect(); Object.assign(bar.style, { left: Math.max(8, Math.min(innerWidth - 190, rc.left + rc.width / 2 - 80)) + 'px', top: Math.max(8, rc.top - 46) + 'px' });
      bar.addEventListener('mousedown', e => e.preventDefault());   // keep the text selected while clicking a colour
      bar.addEventListener('click', async e => { if (e.target.closest('[data-login]')) return needLogin(); const b = e.target.closest('[data-c]'); if (!b) return; store.set('iv_hlcolor', b.dataset.c); bar.remove(); getSelection().removeAllRanges(); await addHl({ kind: 'text', ...anchor, color: b.dataset.c }); });
      document.body.append(bar);
    }
    let selT; document.addEventListener('selectionchange', onSel); leave(() => document.removeEventListener('selectionchange', onSel));
    function onSel() {
      clearTimeout(selT); selT = setTimeout(() => {
        if (!isNovel || !alive) return; const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) { $('#hlbar')?.remove(); return; }
        const r = sel.getRangeAt(0), p = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer)?.closest?.('p[data-p]'); if (!p || !rd.contains(p)) { $('#hlbar')?.remove(); return; }
        const para = +p.dataset.p, text = paras[para]; let start = rangeOffset(p, r.startContainer, r.startOffset), end = p.contains(r.endContainer) ? rangeOffset(p, r.endContainer, r.endOffset) : text.length;
        while (start < end && /\s/.test(text[start])) start++; while (end > start && /\s/.test(text[end - 1])) end--;
        if (end - start < 2) { $('#hlbar')?.remove(); return; } toolbar(r, { para, start, end, text: text.slice(start, end) });
      }, 220);
    }
    // click a highlight to change colour, add a note or delete it
    rd.addEventListener('click', e => { const t = e.target.closest('mark[data-hid],.hl-box[data-hid]'); if (!t) return; const h = hls.find(x => x.id === +t.dataset.hid); if (h) popover(h, t.getBoundingClientRect()); });
    function popover(h, rc) {
      $('#hlpop')?.remove(); const pop = document.createElement('div'); pop.id = 'hlpop'; pop.className = 'hlpop card';
      pop.innerHTML = `<div class="row">${COLORS.map(cl => `<button class="dot hl-${cl} ${h.color === cl ? 'sel' : ''}" data-c="${cl}" aria-label="${cl}"></button>`).join('')}<button class="btn danger small" data-del style="margin-left:auto">Delete</button></div><textarea maxlength="500" placeholder="Add a note…" style="margin-top:8px;width:100%;min-height:60px">${esc(h.note || '')}</textarea><div class="row" style="margin-top:8px"><button class="btn small" data-save>Save</button><button class="btn ghost small" data-close>Close</button></div>`;
      Object.assign(pop.style, { left: Math.max(8, Math.min(innerWidth - 300, rc.left)) + 'px', top: Math.min(innerHeight - 200, rc.bottom + 8) + 'px' }); document.body.append(pop);
      let color = h.color; pop.onclick = guard(async e => {
        const cb = e.target.closest('[data-c]'); if (cb) { color = cb.dataset.c; $$('.dot', pop).forEach(d => d.classList.toggle('sel', d === cb)); }
        if (e.target.closest('[data-close]')) pop.remove();
        if (e.target.closest('[data-save]')) { const u = await api('/highlights/' + h.id, { method: 'PATCH', body: { color, note: $('textarea', pop).value } }); Object.assign(h, u); pop.remove(); repaint(); toast('Highlight saved', 'ok'); }
        if (e.target.closest('[data-del]')) { await api('/highlights/' + h.id, { method: 'DELETE' }); hls = hls.filter(x => x.id !== h.id); pop.remove(); repaint(); toast('Highlight removed'); } });
    }

    // ---- keyboard
    document.onkeydown = e => {
      if (!$('#rbar') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; const k = e.key;
      if (k === 'ArrowRight') { if (book) { e.preventDefault(); turn(rtlBook() ? 'prev' : 'next'); } else if (c.next) location.hash = '#/read/' + c.next; }
      else if (k === 'ArrowLeft') { if (book) { e.preventDefault(); turn(rtlBook() ? 'next' : 'prev'); } else if (c.prev) location.hash = '#/read/' + c.prev; }
      else if (k === 'Escape') { $('#panel', v).hidden = true; $('#hlpop')?.remove(); }
      else if (k.toLowerCase() === 'b') $('#bk', v)?.click(); else if (k.toLowerCase() === 'h') $('#hlt', v)?.click(); else if (k.toLowerCase() === 't') $('#tts', v)?.click(); else if (k.toLowerCase() === 's') $('#as', v)?.click();
      else if (k === '+') speed = Math.min(6, speed + 1); else if (k === '-') speed = Math.max(1, speed - 1);
    };

    // ---- end-of-chapter: reactions, poll, comments
    $('#reacts', v).addEventListener('click', guard(async e => { const b = e.target.closest('[data-e]'); if (!b || !needLogin()) return; const r = await api(`/chapters/${c.id}/react`, { method: 'POST', body: { emoji: b.dataset.e } }); const n = $('span', b); n.textContent = +n.textContent + (r.on ? 1 : -1); b.classList.toggle('active', r.on); }));
    $('#pollbox', v).addEventListener('click', guard(async e => { const b = e.target.closest('.poll-opt'); if (!b || !needLogin()) return; const p = await api(`/polls/${$('.poll', v).dataset.poll}/vote`, { method: 'POST', body: { choice: +b.dataset.i } }); $('#pollbox', v).innerHTML = pollHtml(p); }));
    $('#newpoll', v)?.addEventListener('click', guard(async () => {
      const q = prompt('Poll question (e.g. "Should Mira trust the clockmaker?")'); if (!q) return; const o = prompt('Options, separated by | (2 to 5)', 'Yes | No'); if (!o) return;
      const p = await api(`/chapters/${c.id}/poll`, { method: 'POST', body: { question: q, options: o.split('|') } }); $('#pollbox', v).innerHTML = pollHtml(p); toast('Poll published', 'ok'); }));
    $('#cmf', v).onsubmit = guard(async e => { e.preventDefault(); if (!needLogin()) return; const ta = e.target.b; const r = await api(`/chapters/${c.id}/comments`, { method: 'POST', body: { body: ta.value } }); ta.value = ''; $('#cml').insertAdjacentHTML('afterbegin', commentHtml(r, ctx)); bindSpoilers($('#cml')); });
    $('#cml', v).addEventListener('click', guard(async e => {
      const rep = e.target.closest('[data-rep]'); if (rep && needLogin()) return reportModal('comment', +rep.dataset.rep);
      const pin = e.target.closest('[data-pin]'); if (pin) { await api(`/comments/${pin.dataset.pin}/pin`, { method: 'POST' }); IV.route(); }
      const del = e.target.closest('[data-del]'); if (del && confirm('Delete this comment?')) { await api(`/comments/${del.dataset.del}`, { method: 'DELETE' }); del.closest('.comment').remove(); } }));
    $('#qaf', v)?.addEventListener('submit', guard(async e => { e.preventDefault(); if (!needLogin()) return; await api(`/chapters/${c.id}/qa`, { method: 'POST', body: { question: e.target.q.value } }); e.target.q.value = ''; $('#qa', v).innerHTML = qaHtml(await api(`/chapters/${c.id}/qa`), ctx); toast('Question sent — you will be notified when it is answered.', 'ok'); }));
    $('#qa', v).addEventListener('submit', guard(async e => { const f = e.target.closest('[data-ans]'); if (!f) return; e.preventDefault(); await api(`/qa/${f.dataset.ans}/answer`, { method: 'POST', body: { answer: f.a.value } }); $('#qa', v).innerHTML = qaHtml(await api(`/chapters/${c.id}/qa`), ctx); toast('Answer published', 'ok'); }));
    bindSpoilers(v);
    document.addEventListener('click', function away(e) { if (!$('#rbar')) return document.removeEventListener('click', away); if (!e.target.closest('#panel,#set')) $('#panel') && ($('#panel').hidden = true); if (!e.target.closest('#hlpop,mark,.hl-box')) $('#hlpop')?.remove(); });

    render();
    if (c.resume && (c.resume.page > 0 || c.resume.pct > 3) && mode === 'scroll') toast(isNovel ? `Resumed where you left off (${Math.round(c.resume.pct)}%)` : `Resumed at page ${c.resume.page + 1}`);
  } };
});
})();
