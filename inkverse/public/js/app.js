/* InkVerse SPA — vanilla JS, hash router. All user-supplied text goes through esc() before touching innerHTML. */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (c / 100).toFixed(2);
const ago = t => { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
const dt = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const COLORS = ['#ff6b6b', '#5f27cd', '#10ac84', '#ee5253', '#ff9f43', '#0abde3', '#c56cf0', '#576574'];
const avatar = n => `<div class="avatar" style="background:${COLORS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]}">${esc(n[0].toUpperCase())}</div>`;

const S = { user: null, token: localStorage.getItem('iv_token'), cfg: null, notifs: [], ws: null };
try { document.documentElement.dataset.theme = localStorage.getItem('iv_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch {}

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {}; if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let payload; if (form) payload = form; else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch('/api' + path, { method, headers, body: payload });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = r.status; throw e; }
  return data;
}
function toast(msg, type = '') { const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; $('#toasts').append(t); setTimeout(() => { t.style.transition = 'all .4s'; t.style.opacity = 0; t.style.transform = 'translateX(100%)'; setTimeout(() => t.remove(), 400); }, 3800); }
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } };
function coinBurst(x, y) { for (let i = 0; i < 9; i++) { const c = document.createElement('div'); c.className = 'coin-burst'; c.textContent = '🪙'; c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px'); c.style.setProperty('--dy', (-60 - Math.random() * 160) + 'px'); document.body.append(c); setTimeout(() => c.remove(), 1000); } }

// ---------------- reveal-on-scroll ----------------
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
function reveal(root = document) { $$('.scard,.chapter,.comic img,.novel-body p', root).forEach((el, i) => { if (!el.classList.contains('in')) { el.style.transitionDelay = Math.min(i % 12, 8) * 55 + 'ms'; io.observe(el); } }); }

// ---------------- modal ----------------
function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bg.style.opacity = 0; setTimeout(() => bg.remove(), 200); };
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  $('#modal-root').append(bg); onMount?.(bg.firstElementChild, close); return close;
}

// ---------------- series card ----------------
function card(s) {
  const blur = s.mature && !(S.user?.adult) ? 'mature-blur' : '';
  return `<a class="scard ${blur}" href="#/series/${s.id}"><div class="thumb"><span class="tag ${s.type}">${s.type}</span>${s.mature ? '<span class="tag m">18+</span>' : ''}<img class="cv" loading="lazy" src="${esc(s.cover)}" alt="${esc(s.title)} cover"></div>
  <div class="meta"><h3>${esc(s.title)}</h3><small>${esc(s.creator)} · ${s.rating ? '★ ' + s.rating : 'New'}</small></div></a>`;
}
const skeleton = n => `<div class="grid">${'<div class="shimmer"></div>'.repeat(n)}</div>`;

// ---------------- navigation ----------------
async function refreshMe() {
  if (!S.token) { S.user = null; return; }
  try { S.user = await api('/me'); S.notifs = await api('/notifications'); }
  catch (e) { if (e.status === 401) { S.token = null; S.user = null; localStorage.removeItem('iv_token'); } }   // network errors keep you signed in (offline reading)
}
function renderNav() {
  const u = S.user, unread = S.notifs.filter(n => !n.read).length, cur = location.hash.split('/')[1] || '';
  const link = (h, t, k = h) => `<a href="#/${h}" class="${cur === k ? 'active' : ''}">${t}</a>`;
  $('#nav').innerHTML = `
    <button class="pill burger" id="burger" aria-label="Menu">☰</button>
    <a class="logo" href="#/"><b>INK</b>VERSE</a>
    <nav class="nav-links" id="links">${link('', 'Home')}${link('browse', 'Browse')}${link('charts', 'Charts 🏆')}${link('channels', 'Channels 💬')}${u ? link('library', 'Library') : ''}${u && u.role !== 'reader' ? link('studio', 'Studio ✏️') : ''}${u?.role === 'admin' ? link('admin', 'Admin 🛡️') : ''}</nav>
    <div class="nav-right">
      <form class="search" id="sform"><input id="q" type="search" placeholder="Search comics & novels" aria-label="Search"></form>
      <button class="pill" id="theme" title="Toggle theme" aria-label="Toggle theme">🌓</button>
      ${u ? `<a class="pill ${u.premium ? 'pro' : ''}" href="#/premium" title="${u.premium ? 'Premium member' : 'Go Premium'}">⭐ <span class="lbl">${u.premium ? 'Premium' : 'Go Premium'}</span></a><a class="pill" href="#/wallet" title="Wallet">🪙 <span>${u.coins}</span></a>
        <button class="pill" id="bell" aria-label="Notifications">🔔${unread ? `<span class="badge">${unread}</span>` : ''}</button>
        <button class="pill" id="me">${esc(u.username)} <span class="lbl muted">▾</span></button>` : `<button class="btn small" id="login">Log in / Sign up</button>`}
    </div>`;
  $('#burger').onclick = () => $('#links').classList.toggle('open');
  $$('#links a').forEach(a => a.onclick = () => $('#links').classList.remove('open'));
  $('#theme').onclick = () => { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; try { localStorage.setItem('iv_theme', d); } catch {} };
  $('#sform').onsubmit = e => { e.preventDefault(); location.hash = '#/browse?q=' + encodeURIComponent($('#q').value); };
  if (u) { $('#bell').onclick = showNotifs; $('#me').onclick = showMenu; } else $('#login').onclick = () => authModal();
  bindSuggest();
}
function renderFooter() {
  $('#footer').innerHTML = `<div><a href="#/terms">Terms & Community Guidelines</a><a href="#/creators">Creator Program</a><a href="#/dmca">Copyright / DMCA</a><a href="#/privacy">Privacy</a><a href="#/downloads">⬇ Downloads</a></div><p style="margin-top:12px">© ${new Date().getFullYear()} InkVerse${S.cfg.payments === 'demo' ? ' — demo mode: payments are simulated.' : '.'}</p>`;
}
const showNotifs = guard(async () => {
  const list = S.notifs;
  modal(`<h2>Notifications</h2>${list.length ? list.map(n => `<div class="notif ${n.read ? '' : 'unread'}">${n.link ? `<a href="${esc(n.link)}">${esc(n.text)}</a>` : esc(n.text)}<br><small class="muted">${ago(n.created_at)}</small></div>`).join('') : '<p class="muted">Nothing yet.</p>'}`);
  await api('/notifications/read', { method: 'POST' }); S.notifs = S.notifs.map(n => ({ ...n, read: 1 })); renderNav();
});
function showMenu() {
  const u = S.user;
  modal(`<h2>${esc(u.username)}</h2><p class="muted">${u.role === 'admin' ? 'Moderator / Admin' : u.role === 'creator' ? 'Creator' : 'Reader'} · strikes: ${u.strikes}</p>
  <form class="form" id="prof" style="margin-top:14px"><label>Bio<textarea name="bio" maxlength="300">${esc(u.bio)}</textarea></label>
  <label class="check"><input type="checkbox" name="adult" ${u.adult ? 'checked' : ''}> I am 18 or older (needed to view mature series)</label>
  <button class="btn">Save profile</button></form>
  <div class="row" style="margin-top:14px"><span class="chip ${u.premium ? 'active' : ''}">${u.premium ? '⭐ Premium' : 'Free plan'}</span><a class="btn ghost small" href="#/premium" id="m-prem">${u.premium ? 'Manage plan' : 'Upgrade'}</a><a class="btn ghost small" href="#/highlights" id="m-hl">🖍 My highlights</a><button type="button" class="btn ghost small" id="m-sec">🔐 Security & data</button></div>
  ${u.email_verified ? '' : '<p class="muted" style="margin-top:10px;font-size:13px">✉️ Email not confirmed. <a href="#" id="m-ver" style="text-decoration:underline">Resend confirmation link</a></p>'}
  <h3 style="margin-top:18px">🏅 Achievements</h3><div id="bdg" class="row" style="margin-top:8px"><span class="muted">Loading…</span></div>
  ${u.strikes || u.muted_until > Date.now() ? `<h3 style="margin-top:18px">⚖️ Appeal a strike</h3><form class="form" id="apf" style="margin-top:8px"><textarea name="text" minlength="20" maxlength="1000" placeholder="Explain why the moderation action was a mistake…" required></textarea><button class="btn ghost small">Submit appeal</button></form>` : ''}
  <div class="row" style="margin-top:14px">${u.role === 'reader' ? '<button class="btn ghost" id="bc">Become a creator ✏️</button>' : ''}<button class="btn ghost" id="lo">Log out</button></div>`, (m, close) => {
    api('/me/badges').then(b => { $('#bdg', m).innerHTML = b.map(x => `<span class="chip ${x.earned ? 'active' : ''}" title="${esc(x.desc)}" style="${x.earned ? '' : 'opacity:.45;filter:grayscale(1)'}">${x.icon} ${esc(x.name)}</span>`).join(''); }).catch(() => {});
    $('#apf', m)?.addEventListener('submit', guard(async e => { e.preventDefault(); await api('/appeals', { method: 'POST', body: { text: e.target.text.value } }); toast('Appeal submitted. A moderator will review it.', 'ok'); close(); }));
    $('#prof', m).onsubmit = guard(async e => { e.preventDefault(); const f = new FormData(e.target); S.user = await api('/me', { method: 'PATCH', body: { bio: f.get('bio'), adult: f.get('adult') === 'on' } }); toast('Profile saved', 'ok'); close(); renderNav(); });
    $$('#m-prem,#m-hl', m).forEach(a => a.addEventListener('click', close));
    $('#m-sec', m).onclick = () => { close(); IV.securityModal(); };
    $('#m-ver', m)?.addEventListener('click', guard(async e => { e.preventDefault(); const r = await api('/auth/resend-verification', { method: 'POST' }); toast(r.sent ? 'Confirmation email sent.' : 'Email delivery is not configured on this server yet.', r.sent ? 'ok' : 'err'); }));
    $('#lo', m).onclick = () => { localStorage.removeItem('iv_token'); S.token = null; S.user = null; S.notifs = []; try { caches.delete('iv-offline'); } catch {} close(); renderNav(); route(); };
    $('#bc', m)?.addEventListener('click', guard(async () => { S.user = await api('/me/become-creator', { method: 'POST' }); toast('Welcome, creator! Open Studio to publish.', 'ok'); close(); renderNav(); location.hash = '#/studio'; }));
  });
}
function authModal(mode = 'login', after) {
  modal(`<h2>${mode === 'login' ? 'Welcome back' : 'Join InkVerse'}</h2>
  <form class="form" id="af">${mode === 'register' ? `<label>Username<input name="username" required minlength="3" maxlength="24" autocomplete="username"></label><label>Email<input name="email" type="email" required></label>` : '<label>Username or email<input name="login" required autocomplete="username"></label>'}
  <label>Password<input name="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
  ${mode === 'register' ? `<label>I want to<select name="role"><option value="reader">Read & chat (Reader)</option><option value="creator">Read, chat & publish for pay (Creator)</option></select></label>
  <label class="check"><input type="checkbox" name="adult"> I am 18+ (enables mature series)</label>
  <label class="check"><input type="checkbox" name="terms" required> I accept the <a href="#/terms" target="_blank" style="text-decoration:underline">Terms & Community Guidelines</a></label>` : ''}
  <button class="btn">${mode === 'login' ? 'Log in' : 'Create account'}</button>${mode === 'login' ? '<a href="#" id="fg" class="muted" style="font-size:13px;text-align:center;text-decoration:underline">Forgot your password?</a>' : ''}</form>
  <p class="muted" style="margin-top:14px;font-size:13px">${mode === 'login' ? `New here? <a href="#" id="sw" style="text-decoration:underline">Create an account</a>` : `Have an account? <a href="#" id="sw" style="text-decoration:underline">Log in</a>`}</p>`, (m, close) => {
    $('#sw', m).onclick = e => { e.preventDefault(); close(); authModal(mode === 'login' ? 'register' : 'login', after); };
    $('#fg', m)?.addEventListener('click', e => { e.preventDefault(); close(); modal(`<h2>Reset password</h2><form class="form" id="ff"><label>Account email<input name="email" type="email" required></label><button class="btn">Send reset link</button></form>`, (mm, c2) => {
      $('#ff', mm).onsubmit = guard(async ev => { ev.preventDefault(); await api('/auth/forgot', { method: 'POST', body: { email: ev.target.email.value } }); c2(); toast('If that email exists, a reset link is on its way.', 'ok'); }); }); });
    $('#af', m).onsubmit = guard(async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const body = mode === 'login' ? { login: f.get('login'), password: f.get('password') } : { username: f.get('username'), email: f.get('email'), password: f.get('password'), role: f.get('role'), adult: f.get('adult') === 'on', acceptTerms: f.get('terms') === 'on' };
      const r = await api('/auth/' + mode, { method: 'POST', body });
      S.token = r.token; localStorage.setItem('iv_token', r.token); close(); await refreshMe(); renderNav(); toast('Welcome, ' + r.user.username + '!', 'ok'); route(); after?.();
    });
  });
}
const needLogin = () => { if (!S.user) { authModal(); return false; } return true; };

// ---------------- router ----------------
const routes = []; const leave = [];
const on = (re, fn) => routes.push([re, fn]);
let routeToken = 0;
async function route() {
  const view = $('#view'); const t = ++routeToken;
  const [path, qs] = (location.hash.slice(1) || '/').split('?'); const params = new URLSearchParams(qs || '');
  for (const f of leave.splice(0)) try { f(); } catch {}
  window.scrollTo({ top: 0 }); $('#progress').style.width = '0'; document.body.classList.remove('sepia'); delete document.body.dataset.reader;
  if (S.ws && !path.startsWith('/channel/')) { S.ws.close(); S.ws = null; }
  renderNav();
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      view.innerHTML = `<div class="wrap">${skeleton(6)}</div>`;
      try { const html = await fn(m, params); if (t !== routeToken) return; if (html !== undefined) { view.innerHTML = `<div class="page-enter">${html.html ?? html}</div>`; reveal(view); html.mount?.(view); } }
      catch (e) { if (t === routeToken) view.innerHTML = `<div class="wrap page-enter"><div class="card"><h2>😕 ${esc(e.message)}</h2><p class="muted" style="margin:10px 0 18px">${e.status === 401 ? 'Please log in to continue.' : ''}</p><a class="btn" href="#/">Back home</a></div></div>`; }
      view.focus({ preventScroll: true }); return;
    }
  }
  view.innerHTML = `<div class="wrap"><div class="card"><h2>404 — page not found</h2><a class="btn" href="#/">Go home</a></div></div>`;
}

const checkin = guard(async e => {
  const r = await api('/checkin', { method: 'POST' }); S.user.coins = r.coins; S.user.streak = r.streak; S.user.can_checkin = false;
  coinBurst(e.clientX, e.clientY); toast(`+${r.reward} coins! Day ${r.streak} of your streak 🔥`, 'ok'); renderNav(); e.target.textContent = 'Claimed today ✓'; e.target.disabled = true;
});

// live search suggestions (debounced)
function bindSuggest() {
  const input = $('#q'), form = $('#sform'); if (!input) return; let t, box = document.createElement('div');
  box.style.cssText = 'position:absolute;top:44px;left:0;right:0;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;z-index:120;display:none;min-width:280px';
  form.append(box);
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    if (input.value.trim().length < 2) { box.style.display = 'none'; return; }
    const r = await fetch('/api/search/suggest?q=' + encodeURIComponent(input.value.trim())).then(r => r.json()).catch(() => []);
    box.innerHTML = r.map(s => `<a href="#/series/${s.id}" style="display:flex;gap:10px;align-items:center;padding:8px 12px"><img src="${esc(s.cover)}" alt="" width="30" height="40" style="object-fit:cover;border-radius:6px"><span><b style="font-size:13px">${esc(s.title)}</b><br><small class="muted">${s.type} · ${esc(s.creator)}</small></span></a>`).join('') || '<div class="muted" style="padding:12px">No matches</div>';
    box.style.display = 'block'; }, 200); });
  box.addEventListener('click', () => { box.style.display = 'none'; input.value = ''; });
  input.addEventListener('blur', () => setTimeout(() => box.style.display = 'none', 200));
}

// ---------------- HOME ----------------
on(/^\/?$/, async () => {
  const [trending, fresh, top] = await Promise.all([api('/series?sort=trending'), api('/series?sort=new'), api('/series?sort=top')]);
  let lib = null, recs = []; if (S.user) [lib, recs] = await Promise.all([api('/library').catch(() => null), api('/recommendations').catch(() => [])]);
  const heroes = trending.slice(0, 4);
  const ckCard = S.user ? `<div class="card row" style="margin-top:20px;justify-content:space-between"><div><b>🔥 Daily check-in</b> <span class="muted">· ${S.user.streak}-day streak · 7-day ladder pays up to 30 coins</span></div><button class="btn small" id="ck" ${S.user.can_checkin ? '' : 'disabled'}>${S.user.can_checkin ? 'Claim free coins' : 'Claimed today ✓'}</button></div>` : '';
  const html = `<div class="wrap">
  <div class="hero" id="hero">${heroes.map((s, i) => `<div class="slide ${i ? '' : 'active'}"><div class="bg" style="background-image:url('${esc(s.cover)}')"></div><img class="cover" src="${esc(s.cover)}" alt=""><div>
    <span class="chip active">🔥 Trending #${i + 1}</span><h1>${esc(s.title)}</h1><p>${esc(s.synopsis)}</p>
    <div class="row"><a class="btn" href="#/series/${s.id}">Start reading →</a><span>${s.genres.map(esc).join(' · ')} · ★ ${s.rating || '—'}</span></div></div></div>`).join('')}
    <button class="hero-arrow" style="left:14px" id="hp" aria-label="Previous">‹</button><button class="hero-arrow" style="right:14px" id="hn" aria-label="Next">›</button>
    <div class="dots">${heroes.map((_, i) => `<button class="${i ? '' : 'active'}" aria-label="Slide ${i + 1}"></button>`).join('')}</div></div>
  ${ckCard}
  ${recs.length ? `<div class="section-head"><h2>✨ Picked for you</h2><span class="muted">Based on what you read, like & follow</span></div><div class="hscroll">${recs.map(s => `<div>${card(s)}<small class="muted" style="display:block;margin-top:-4px">${esc(s.reason)}</small></div>`).join('')}</div>` : ''}
  ${lib?.continue?.length ? `<div class="section-head"><h2>Continue reading</h2></div><div class="hscroll">${lib.continue.map(card).join('')}</div>` : ''}
  <div class="section-head"><h2>🔥 Trending now</h2><a class="muted" href="#/browse?sort=trending">See all →</a></div><div class="hscroll">${trending.map(card).join('')}</div>
  <div class="section-head"><h2>🆕 Fresh updates</h2><a class="muted" href="#/browse?sort=new">See all →</a></div><div class="hscroll">${fresh.map(card).join('')}</div>
  <div class="section-head"><h2>⭐ Top rated</h2></div><div class="hscroll">${top.map(card).join('')}</div>
  <div class="section-head"><h2>Browse by genre</h2></div><div>${S.cfg.genres.map(g => `<a class="chip" href="#/browse?genre=${encodeURIComponent(g)}">${g}</a>`).join('')}</div>
  <div class="banner"><div><h2>Create. Publish. Get paid.</h2><p style="margin:14px 0 22px;opacity:.9">Upload comics or web novels weekly or all at once. Readers unlock early-access chapters with coins and tip their favourites — you keep the lion's share.</p><a class="btn" href="#/creators">See the Creator Program</a></div>
  <div class="split"><div><b>70%</b> of every chapter unlock</div><div style="animation-delay:.15s"><b>90%</b> of every tip</div><div style="animation-delay:.3s"><b>$50</b> minimum payout</div></div></div></div>`;
  return { html, mount(v) {
    const slides = $$('.slide', v), dots = $$('.dots button', v); let i = 0, timer;
    const go = n => { slides[i].classList.remove('active'); slides[i].classList.add('leaving'); dots[i].classList.remove('active'); const old = slides[i]; setTimeout(() => old.classList.remove('leaving'), 800); i = (n + slides.length) % slides.length; slides[i].classList.add('active'); dots[i].classList.add('active'); };
    const auto = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && $('#hero')) go(i + 1); else if (!$('#hero')) clearInterval(timer); }, 6000); };
    $('#ck', v)?.addEventListener('click', checkin);
    $('#hn', v).onclick = () => { go(i + 1); auto(); }; $('#hp', v).onclick = () => { go(i - 1); auto(); }; dots.forEach((d, k) => d.onclick = () => { go(k); auto(); }); auto();
  } };
});

// ---------------- BROWSE ----------------
on(/^\/browse$/, async (m, p) => {
  const f = { q: p.get('q') || '', type: p.get('type') || '', genre: p.get('genre') || '', sort: p.get('sort') || 'trending', status: p.get('status') || '', monetization: p.get('monetization') || '', language: p.get('language') || '', tag: p.get('tag') || '' };
  const list = await api('/series?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v)));
  const q = o => '#/browse?' + new URLSearchParams(Object.entries({ ...f, ...o }).filter(([, v]) => v));
  setTimeout(() => { const l = $('#lang'); if (l) l.onchange = () => { location.hash = q({ language: l.value }); }; }, 0);
  return `<div class="wrap"><div class="section-head" style="margin-top:0"><h2>Browse${f.q ? ` “${esc(f.q)}”` : ''}</h2><span class="muted">${list.length} results</span></div>
  <div style="margin-bottom:10px">${[['', 'All'], ['comic', 'Comics'], ['novel', 'Web novels']].map(([v, t]) => `<a class="chip ${f.type === v ? 'active' : ''}" href="${q({ type: v })}">${t}</a>`).join('')}<span class="muted"> | </span>${[['trending', '🔥 Trending'], ['new', '🆕 Newest'], ['top', '⭐ Top rated']].map(([v, t]) => `<a class="chip ${f.sort === v ? 'active' : ''}" href="${q({ sort: v })}">${t}</a>`).join('')}</div>
  <div style="margin-bottom:10px">${[['', 'Any status'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['hiatus', 'Hiatus']].map(([v, t]) => `<a class="chip ${f.status === v ? 'active' : ''}" href="${q({ status: v })}">${t}</a>`).join('')}<span class="muted"> | </span>${[['', 'Any price'], ['free', '🆓 Free'], ['hybrid', '🎁 Free + early access'], ['paid', '💎 Paid']].map(([v, t]) => `<a class="chip ${f.monetization === v ? 'active' : ''}" href="${q({ monetization: v })}">${t}</a>`).join('')}<span class="muted"> | </span><select class="chip" id="lang" aria-label="Language"><option value="">🌐 Any language</option>${Object.entries(S.cfg.languages).map(([k, v]) => `<option value="${k}" ${f.language === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <div style="margin-bottom:10px">${S.cfg.genres.map(g => `<a class="chip ${f.genre === g ? 'active' : ''}" href="${q({ genre: f.genre === g ? '' : g })}">${g}</a>`).join('')}</div>
  <div style="margin-bottom:20px">${S.cfg.tags.map(t => `<a class="chip ${f.tag === t ? 'active' : ''}" href="${q({ tag: f.tag === t ? '' : t })}">#${t}</a>`).join('')}</div>
  ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<div class="card"><h3>Nothing found 🕵️</h3><p class="muted">Try another search or genre.</p></div>'}</div>`;
});

// ---------------- SERIES ----------------
on(/^\/series\/(\d+)$/, async m => {
  const [s, sup, rel] = await Promise.all([api('/series/' + m[1]), api(`/series/${m[1]}/supporters`).catch(() => []), api(`/series/${m[1]}/related`).catch(() => [])]); const me = s.me;
  const canRead = s.chapters.find(c => !c.scheduled);
  const cont = me?.progress ? s.chapters.find(c => c.id === me.progress) : null;
  const html = `<div class="wrap"><div class="s-head"><img class="cover" src="${esc(s.cover)}" alt="${esc(s.title)}">
  <div><div class="row"><span class="chip active">${s.type === 'novel' ? '📖 Web novel' : '🎨 Comic'}</span>${s.mature ? '<span class="chip" style="background:#e5484d;color:#fff">18+</span>' : ''}<span class="chip">${esc(s.status)}</span><span class="chip">${s.schedule === 'weekly' ? '🗓 Weekly' : '📦 Batch release'}</span><span class="chip">${{ free: '🆓 Free', paid: '💎 Paid', hybrid: s.free_chapters ? `🎁 First ${s.free_chapters} chapters free` : '🎁 Free + early access' }[s.monetization]}</span>${s.reading_dir === 'rtl' ? '<span class="chip">📖 Manga (right-to-left)</span>' : ''}<span class="chip">🌐 ${esc(S.cfg.languages[s.language] || s.language)}</span>${s.status === 'removed' ? '<span class="chip" style="background:#e5484d;color:#fff">REMOVED</span>' : ''}</div>
  <h1 style="margin:10px 0 6px">${esc(s.title)}</h1><p class="muted">by <b>${esc(s.creator)}</b> · ${s.genres.map(esc).join(' · ') || '—'}</p>
  ${s.tags.length ? `<div style="margin-top:8px">${s.tags.map(t => `<a class="chip" href="#/browse?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
  ${s.warnings.length ? `<p style="margin-top:8px;font-size:13px">⚠️ <b>Content warnings:</b> ${s.warnings.map(esc).join(', ')}</p>` : ''}
  <div class="row" style="margin:14px 0"><span>★ <b>${s.rating || '—'}</b></span><span>❤️ <b id="lk">${s.likes}</b></span><span>👥 <b id="fl">${s.followers}</b></span><span>👁 <b>${s.views}</b></span><span>📚 <b>${s.chapter_count}</b> chapters</span></div>
  <p style="max-width:680px;margin-bottom:18px;white-space:pre-line">${esc(s.synopsis)}</p>
  <div class="row">${canRead ? `<a class="btn" href="#/read/${(cont || canRead).id}">${cont ? 'Continue ch. ' + cont.number : 'Start reading'} →</a>` : ''}
  <button class="btn ghost ${me?.following ? 'on' : ''}" id="fo">${me?.following ? '✓ Following' : '＋ Follow'}</button><button class="btn ghost ${me?.liked ? 'on' : ''}" id="li">${me?.liked ? '❤️ Liked' : '🤍 Like'}</button>
  <button class="btn pink" id="tip">🪙 Tip creator</button><button class="btn ghost small" id="rep">🚩 Report</button>${s.own ? `<a class="btn ghost" href="#/studio/series/${s.id}">Manage</a>` : ''}</div>
  <div style="margin-top:18px"><span class="muted" style="font-size:13px">Your rating</span><div class="stars" id="stars">${[1, 2, 3, 4, 5].map(i => `<button class="${i <= (me?.rating || 0) ? 'on' : ''}" data-s="${i}" aria-label="${i} stars">★</button>`).join('')}</div></div></div></div>
  <div class="section-head"><h2>Chapters</h2></div><div id="chs">${s.chapters.length ? [...s.chapters].reverse().map(c => `<a class="chapter" href="#/read/${c.id}"><span class="num">${c.number}</span><span class="t">${esc(c.title)}<br><small class="muted">${c.draft ? 'Draft — only you can see this' : c.held ? 'Held for copyright review' : c.scheduled ? 'Goes live ' + dt(c.publish_at) : new Date(c.publish_at).toLocaleDateString()}${c.words ? ' · ' + c.words.toLocaleString() + ' words · ~' + Math.max(1, Math.round(c.words / 230)) + ' min' : ''}</small></span>
    ${c.scheduled ? '<span class="lock sched">⏰ Scheduled</span>' : c.locked ? `<span class="lock">🪙 ${c.price_coins}${c.free_at ? ' · free ' + new Date(c.free_at).toLocaleDateString() : ''}</span>` : c.price_coins ? '<span class="lock read">Unlocked</span>' : ''}</a>`).join('') : '<p class="muted">No chapters yet.</p>'}</div>
  ${rel.length ? `<div class="section-head"><h2>👀 You might also like</h2><span class="muted">${esc(rel[0].reason)}</span></div><div class="hscroll">${rel.map(card).join('')}</div>` : ''}
  ${sup.length ? `<div class="section-head"><h2>🏆 Top supporters</h2></div><div class="row">${sup.map((x, i) => `<div class="card row" style="padding:12px 18px;gap:10px">${['🥇', '🥈', '🥉', '🎖️', '🎖️'][i]} ${avatar(x.username)}<div><b>${esc(x.username)}</b><br><small class="muted">🪙 ${x.coins} supported</small></div></div>`).join('')}</div>` : ''}
  <div class="section-head"><h2>💬 Discussion channels</h2><button class="btn small" id="newch">＋ Host a channel</button></div>
  <div id="chl">${s.channels.length ? s.channels.map(c => `<a class="chapter in" href="#/channel/${c.id}"><span class="ch-tag ${c.tag}">${c.tag === 'spoilers' ? '⚠ spoilers' : c.tag}</span><span class="t">${esc(c.name)}<br><small class="muted">${esc(c.description)}</small></span><span class="live">Join</span></a>`).join('') : '<p class="muted">No channels yet — start the first one!</p>'}</div></div>`;
  return { html, mount(v) {
    $('#fo', v).onclick = guard(async () => { if (!needLogin()) return; const r = await api(`/series/${s.id}/follow`, { method: 'POST' }); $('#fo').textContent = r.on ? '✓ Following' : '＋ Follow'; $('#fo').classList.toggle('on', r.on); $('#fl').textContent = +$('#fl').textContent + (r.on ? 1 : -1); toast(r.on ? "You'll be notified of new chapters" : 'Unfollowed', 'ok'); });
    $('#li', v).onclick = guard(async () => { if (!needLogin()) return; const r = await api(`/series/${s.id}/like`, { method: 'POST' }); $('#li').textContent = r.on ? '❤️ Liked' : '🤍 Like'; $('#li').classList.toggle('on', r.on); $('#lk').textContent = +$('#lk').textContent + (r.on ? 1 : -1); });
    $$('#stars button', v).forEach(b => b.onclick = guard(async () => { if (!needLogin()) return; await api(`/series/${s.id}/rate`, { method: 'POST', body: { stars: b.dataset.s } }); $$('#stars button').forEach(x => x.classList.toggle('on', +x.dataset.s <= +b.dataset.s)); toast('Thanks for rating!', 'ok'); }));
    $('#tip', v).onclick = e => { if (!needLogin()) return; const { clientX: x, clientY: y } = e; modal(`<h2>Tip ${esc(s.creator)}</h2><p class="muted">The creator receives <b>${S.cfg.creatorShareTip * 100}%</b> of your tip. You have 🪙 ${S.user.coins}.</p><form class="form" id="tf" style="margin-top:14px"><label>Coins<select name="coins"><option>10</option><option>50</option><option>100</option><option>500</option></select></label><button class="btn pink">Send tip</button></form>`, (mm, close) => {
      $('#tf', mm).onsubmit = guard(async ev => { ev.preventDefault(); const r = await api('/tip', { method: 'POST', body: { series_id: s.id, coins: $('select', mm).value } }); S.user.coins = r.coins; renderNav(); close(); coinBurst(x, y); toast('Tip sent — you made their day! 🎉', 'ok'); }); }); };
    $('#rep', v).onclick = () => { if (!needLogin()) return; reportModal('series', s.id); };
    $('#newch', v).onclick = () => { if (needLogin()) channelModal(s.id); };
  } };
});

function reportModal(type, id) {
  modal(`<h2>Report content</h2><form class="form" id="rf"><label>Reason<select name="r"><option>Harassment or hate speech</option><option>Spam or scam</option><option>Spoilers in a non-spoiler area</option><option>Sexual / graphic content</option><option>Copyright infringement</option><option>Other</option></select></label><label>Details (optional)<textarea name="d" maxlength="200"></textarea></label><button class="btn danger">Submit report</button></form><p class="muted" style="margin-top:10px;font-size:12px">Reports are reviewed by moderators. Content reported by several people is hidden automatically until reviewed.</p>`, (m, close) => {
    $('#rf', m).onsubmit = guard(async e => { e.preventDefault(); const f = new FormData(e.target); await api('/report', { method: 'POST', body: { target_type: type, target_id: id, reason: f.get('r') + (f.get('d') ? ' — ' + f.get('d') : '') } }); close(); toast('Report sent. Thank you for keeping InkVerse safe.', 'ok'); }); });
}
function channelModal(seriesId) {
  modal(`<h2>Host a channel</h2><form class="form" id="cf"><label>Channel name<input name="name" required minlength="3" maxlength="40" placeholder="e.g. Ch.12 reactions"></label><label>Description<input name="description" maxlength="200"></label>
  <label>Topic tag<select name="tag">${S.cfg.channelTags.map(t => `<option value="${t}">${t === 'spoilers' ? 'spoilers ahead (messages blurred by default)' : t}</option>`).join('')}</select></label><button class="btn">Create channel</button></form><p class="muted" style="margin-top:10px;font-size:12px">As host you can mute disruptive members. Site moderators watch every channel.</p>`, (m, close) => {
    $('#cf', m).onsubmit = guard(async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const r = await api('/channels', { method: 'POST', body: { ...f, series_id: seriesId } }); close(); location.hash = '#/channel/' + r.id; }); });
}

// ---------------- READER lives in reader.js ----------------
const inline = t => esc(t).replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" title="Spoiler — click to reveal">$1</span>');
function bindSpoilers(root) { $$('.spoiler,.spoil-msg', root).forEach(el => el.onclick = () => el.classList.toggle('shown')); }

// ---------------- CHANNELS ----------------
on(/^\/channels$/, async () => {
  const list = await api('/channels');
  return `<div class="wrap"><div class="section-head" style="margin-top:0"><h2>💬 Discussion channels</h2><button class="btn" id="nc">＋ Host a channel</button></div>
  <p class="muted" style="margin-bottom:18px">Pick a tag so everyone knows what to expect. <b>Spoilers ahead</b> channels blur messages until you click them. All chat is auto-moderated and reviewed by moderators.</p>
  ${list.map(c => `<a class="chapter in" href="#/channel/${c.id}"><span class="ch-tag ${c.tag}">${c.tag === 'spoilers' ? '⚠ spoilers ahead' : c.tag}</span><span class="t">${esc(c.name)}<br><small class="muted">${c.series_title ? esc(c.series_title) + ' · ' : ''}hosted by ${esc(c.owner)} · ${c.msg_count} messages</small></span><span class="live">Join</span></a>`).join('') || '<p class="muted">No channels yet.</p>'}</div>`
});
document.addEventListener('click', e => { if (e.target.id === 'nc') { if (needLogin()) channelModal(null); } });

on(/^\/channel\/(\d+)$/, async m => {
  const ch = await api('/channels/' + m[1]);
  const spoiler = ch.tag === 'spoilers';
  const html = `<div class="wrap"><div class="chat"><div><div class="chat-head"><a href="#/channels" class="btn ghost small">←</a><span class="ch-tag ${ch.tag}">${spoiler ? '⚠ spoilers ahead' : ch.tag}</span><b>${esc(ch.name)}</b><span class="muted">${ch.series_title ? `· <a href="#/series/${ch.series_id}" style="text-decoration:underline">${esc(ch.series_title)}</a>` : ''} · host ${esc(ch.owner)}</span><span class="live" id="pres" style="margin-left:auto">connecting…</span></div>
    <div class="rules">📜 Be respectful. No hate, harassment, spam or piracy links. Use <b>||double bars||</b> to hide spoilers${spoiler ? '. Messages here are blurred — click to reveal.' : '.'} Offensive words are filtered and earn strikes.</div></div>
    <div class="chat-log" id="log"></div>
    <form class="chat-form" id="cf"><input id="ci" maxlength="500" autocomplete="off" placeholder="${S.user ? 'Message the channel…' : 'Log in to chat'}" ${S.user ? '' : 'disabled'}><button class="btn" ${S.user ? '' : 'disabled'}>Send</button>${S.user ? '' : '<button type="button" class="btn ghost" id="lg">Log in</button>'}</form></div></div>`;
  return { html, mount(v) {
    const log = $('#log', v); const isHost = S.user && (S.user.id === ch.owner_id || S.user.role === 'admin');
    const add = msg => {
      const me = S.user?.id === msg.user_id; const el = document.createElement('div'); el.className = 'msg' + (me ? ' me' : ''); el.id = 'm' + msg.id;
      el.innerHTML = `${avatar(msg.username)}<div><div class="who">${esc(msg.username)}${msg.role !== 'reader' ? `<span class="role ${msg.role}">${msg.role}</span>` : ''} <small class="muted">${ago(msg.created_at)}</small></div><div class="bubble"><span class="${spoiler ? 'spoil-msg' : ''}">${inline(msg.body)}</span></div>
      <div class="acts">${!me && S.user ? `<button data-r="${msg.id}">🚩 Report</button>` : ''}${isHost && !me && msg.role !== 'admin' ? `<button data-mu="${msg.user_id}">🔇 Mute user</button>` : ''}</div></div>`;
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 140; log.append(el); bindSpoilers(el); if (near || me) log.scrollTop = log.scrollHeight;
    };
    ch.messages.forEach(add); log.scrollTop = log.scrollHeight;
    log.onclick = guard(async e => { const r = e.target.closest('[data-r]'); if (r) reportModal('message', +r.dataset.r); const mu = e.target.closest('[data-mu]'); if (mu && confirm('Mute this user in this channel?')) { await api(`/channels/${ch.id}/mute`, { method: 'POST', body: { user_id: +mu.dataset.mu } }); toast('User muted in this channel', 'ok'); } });
    $('#lg', v)?.addEventListener('click', () => authModal());
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); S.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', channel: ch.id, token: S.token }));
    ws.onmessage = ev => { const d = JSON.parse(ev.data);
      if (d.type === 'msg') add(d.message); else if (d.type === 'presence') $('#pres') && ($('#pres').textContent = d.count + ' online');
      else if (d.type === 'hide') { const el = $('#m' + d.id); if (el) { el.classList.add('removed'); $('.bubble', el).textContent = 'Message removed by moderation.'; } }
      else if (d.type === 'error') toast(d.error, 'err'); else if (d.type === 'notice') toast(d.text, 'err'); };
    ws.onclose = () => { const p = $('#pres'); if (p) { p.textContent = 'offline'; p.style.animation = 'none'; } };
    $('#cf', v).onsubmit = e => { e.preventDefault(); const i = $('#ci'); if (!i.value.trim()) return; if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'msg', body: i.value })); i.value = ''; };
  } };
});

// ---------------- WALLET ----------------
on(/^\/wallet$/, async (m, p) => {
  if (!S.user) throw Object.assign(new Error('Log in to open your wallet'), { status: 401 });
  const w = await api('/wallet');
  const html = `<div class="wrap"><div class="section-head" style="margin-top:0"><h2>Wallet</h2></div><div class="stats"><div class="stat"><span class="muted">Your coins</span><b>🪙 ${w.coins}</b></div><div class="stat"><span class="muted">Check-in streak</span><b>🔥 ${S.user.streak}</b><button class="btn small" id="ck" style="margin-top:8px" ${S.user.can_checkin ? '' : 'disabled'}>${S.user.can_checkin ? 'Claim today\'s coins' : 'Claimed ✓'}</button></div></div>
  <p class="muted" style="margin-bottom:16px">Coins unlock early-access chapters and tip creators. <b>${S.cfg.creatorShareUnlockPct}%</b> of what you spend on unlocks goes to the creator. ${S.cfg.payments === 'demo' ? '<i>Demo checkout — no real money is charged.</i>' : S.cfg.payments === 'stripe' ? 'Secure card checkout by Stripe.' : '<b>Coin purchases are not enabled yet.</b>'}</p>
  <p style="margin-bottom:16px"><a class="chip active" href="#/premium">⭐ Premium: ad-free reading, unlimited highlights and ${S.cfg.premium.monthlyUnlocks} early-access unlocks a month — ${money(S.cfg.premium.cents)}/mo</a></p>
  <div class="packs">${w.packs.map(p => `<div class="pack" data-p="${p.id}"><div class="c">🪙 ${p.coins}</div><div style="font-weight:700;font-size:20px">${money(p.cents)}</div><small class="muted">${(p.cents / p.coins).toFixed(2)}¢ / coin</small><br><button class="btn small" style="margin-top:12px">Buy</button></div>`).join('')}</div>
  <div class="section-head"><h2>History</h2></div><div class="card" style="padding:6px 14px"><table><thead><tr><th>When</th><th>Type</th><th>Coins</th><th>Note</th></tr></thead><tbody>${w.history.map(h => `<tr><td>${dt(h.created_at)}</td><td>${h.type.replace('_', ' ')}</td><td>${h.coins > 0 ? '+' : ''}${h.coins || ''}${h.cents && h.type === 'purchase' ? ` (${money(h.cents)})` : ''}</td><td>${esc(h.note)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No activity yet.</td></tr>'}</tbody></table></div></div>`;
  return { html, mount(v) { $('#ck', v)?.addEventListener('click', async e => { await checkin(e); setTimeout(route, 900); }); if (p.get('paid')) { toast('Payment received — your coins will appear in a moment 🪙', 'ok'); setTimeout(async () => { await refreshMe(); renderNav(); }, 2500); }
    $$('.pack', v).forEach(pk => pk.onclick = guard(async e => {
      if (S.cfg.payments === 'stripe') { const r = await api('/wallet/checkout', { method: 'POST', body: { pack: pk.dataset.p } }); location.href = r.url; return; }
      if (S.cfg.payments !== 'demo') return toast('Coin purchases are not enabled yet.', 'err');
      const r = await api('/wallet/buy', { method: 'POST', body: { pack: pk.dataset.p } }); S.user.coins = r.coins; coinBurst(e.clientX, e.clientY); toast('Coins added! 🪙', 'ok'); setTimeout(route, 700); })); } };
});

// ---------------- STUDIO ----------------
// dependency-free SVG area chart with hover tooltips (<title>) and animated draw-in
function chart(vals, labels, color, fmt) {
  const W = 520, H = 160, P = 8, max = Math.max(...vals, 1), step = (W - P * 2) / (vals.length - 1 || 1);
  const pts = vals.map((v, i) => [P + i * step, H - P - (v / max) * (H - P * 2)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin-top:8px" role="img" aria-label="30 day chart"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
  <path d="${line} L${P + (vals.length - 1) * step} ${H - P} L${P} ${H - P}Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.4s var(--ease) forwards"/>
  ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${color}" opacity="0" style="cursor:pointer"><title>${labels[i]}: ${fmt(vals[i])}</title><set attributeName="opacity" to="1" begin="mouseover" end="mouseout"/></circle>`).join('')}</svg>
  <div class="row muted" style="justify-content:space-between;font-size:11px"><span>${labels[0]}</span><span>peak ${fmt(max)}</span><span>${labels[labels.length - 1]}</span></div>`;
}
const tabsHtml = (names, cur) => `<div class="tabs">${names.map(([k, t]) => `<button data-t="${k}" class="${k === cur ? 'active' : ''}">${t}</button>`).join('')}</div>`;
on(/^\/studio$/, async (m, p) => {
  if (!S.user) throw Object.assign(new Error('Log in to open the Studio'), { status: 401 });
  if (S.user.role === 'reader') throw new Error('Studio is for creators. Use the menu → "Become a creator".');
  const [d, an] = await Promise.all([api('/creator/dashboard'), api('/creator/analytics')]), e = d.earnings, u = S.user;
  const html = `<div class="wrap"><div class="section-head" style="margin-top:0"><h2>Creator Studio</h2><a class="btn" href="#/studio/new">＋ New series</a></div>
  <div class="stats"><div class="stat"><span class="muted">Available to withdraw</span><b>${money(e.available)}</b></div><div class="stat"><span class="muted">Pending (${d.holdDays}-day hold)</span><b>${money(e.pending)}</b></div><div class="stat"><span class="muted">Lifetime earnings</span><b>${money(e.lifetime)}</b></div><div class="stat"><span class="muted">Total views</span><b>${d.totalViews}</b></div><div class="stat"><span class="muted">Followers</span><b>${d.totalFollowers}</b></div></div>
  <div class="card"><h3>💸 Payouts</h3><p class="muted" style="margin:6px 0 12px">Minimum payout ${money(d.minPayoutCents)}. Earnings are held ${d.holdDays} days to cover refunds/chargebacks. You earn ${S.cfg.creatorShareUnlockPct}% of chapter unlocks and ${S.cfg.creatorShareTip * 100}% of tips.</p>
  <form class="form" id="pf" style="grid-template-columns:1fr auto;align-items:end"><label>Payout email (PayPal/bank contact)<input name="payout_email" type="email" value="${esc(u.payout_email || '')}" required></label><span></span>
  <label class="check" style="grid-column:1/-1"><input type="checkbox" name="tax" ${u.tax_ok ? 'checked' : ''}> I confirm I own the rights to everything I publish and that I'm responsible for taxes on my earnings.</label>
  <div class="row" style="grid-column:1/-1"><button class="btn ghost">Save payout settings</button><button type="button" class="btn" id="po" ${e.available >= d.minPayoutCents ? '' : 'disabled'}>Request payout ${money(e.available)}</button></div></form>
  ${d.payouts.length ? `<table style="margin-top:14px"><tbody>${d.payouts.map(p => `<tr><td>${dt(p.created_at)}</td><td>${money(p.cents)}</td><td>${p.status}</td></tr>`).join('')}</tbody></table>` : ''}</div>
  <div class="section-head"><h2>📈 Analytics · last 30 days</h2></div>
  <div class="row" style="align-items:stretch"><div class="card" style="flex:1;min-width:300px"><b>Views</b> <span class="muted">· ${an.views.reduce((a, b) => a + b, 0)} total</span>${chart(an.views, an.days, '#00d564', v => v + ' views')}</div>
  <div class="card" style="flex:1;min-width:300px"><b>Earnings</b> <span class="muted">· ${money(an.earnings.reduce((a, b) => a + b, 0))} (pre-hold)</span>${chart(an.earnings, an.days, '#ff4d8d', v => money(v))}</div></div>
  <div class="row" style="align-items:stretch;margin-top:14px"><div class="card" style="flex:1;min-width:260px"><b>🏆 Top supporters</b>${an.supporters.map(x => `<div class="row" style="margin-top:8px">${avatar(x.username)}<b>${esc(x.username)}</b><span class="muted" style="margin-left:auto">🪙 ${x.coins}</span></div>`).join('') || '<p class="muted">Supporters appear after unlocks and tips.</p>'}</div>
  <div class="card" style="flex:1;min-width:260px"><b>🔥 Most-read chapters</b>${an.topChapters.map(x => `<div class="row" style="margin-top:8px"><span>${esc(x.st)} #${x.number}</span><span class="muted" style="margin-left:auto">👁 ${x.views}</span></div>`).join('') || '<p class="muted">No chapters yet.</p>'}</div>
  <div class="card" style="flex:1;min-width:260px"><b>💰 Revenue mix</b>${an.split.map(x => `<div class="row" style="margin-top:8px"><span>${x.source === 'unlock' ? '🔓 Chapter unlocks' : '💖 Tips'} <small class="muted">(${x.n})</small></span><span style="margin-left:auto">${money(x.cents)}</span></div>`).join('') || '<p class="muted">No revenue yet.</p>'}</div></div>
  <div class="section-head"><h2>Your series</h2></div>${d.series.length ? `<div class="grid">${d.series.map(s => `<div>${card(s)}<small class="muted">💰 ${money(s.earned_cents)} · 👁 ${s.views}</small><br><a class="btn small ghost" href="#/studio/series/${s.id}" style="margin-top:6px">Manage</a></div>`).join('')}</div>` : '<p class="muted">You haven\'t published anything yet. Create your first series!</p>'}</div>`;
  return { html, mount(v) {
    $('#pf', v).onsubmit = guard(async ev => { ev.preventDefault(); const f = new FormData(ev.target); S.user = await api('/me', { method: 'PATCH', body: { payout_email: f.get('payout_email'), tax_ok: f.get('tax') === 'on' } }); toast('Payout settings saved', 'ok'); });
    $('#po', v).onclick = guard(async () => { await api('/creator/payout', { method: 'POST' }); toast('Payout requested — an admin will review it.', 'ok'); route(); });
  } };
});

// ---------------- ADMIN ----------------
on(/^\/admin$/, async (m, p) => {
  if (S.user?.role !== 'admin') throw new Error('Moderators only.');
  const tab = p.get('t') || 'reports';
  const [ov, reports, payouts, dmca, appeals, audit, words] = await Promise.all([api('/admin/overview'), api('/admin/reports'), api('/admin/payouts'), api('/admin/dmca'), api('/admin/appeals'), api('/admin/audit'), api('/admin/words')]);
  const html = `<div class="wrap"><div class="section-head" style="margin-top:0"><h2>Moderation & Operations</h2><a class="btn" href="#/admin/copyright">© Copyright review${ov.openCopyright ? ` (${ov.openCopyright})` : ''}</a></div>
  <div class="stats"><div class="stat"><span class="muted">Users</span><b>${ov.users}</b></div><div class="stat"><span class="muted">Series</span><b>${ov.series}</b></div><div class="stat"><span class="muted">Open reports</span><b>${ov.openReports}</b></div><div class="stat"><span class="muted">Pending payouts</span><b>${ov.pendingPayouts}</b></div><div class="stat"><span class="muted">Coin sales</span><b>${money(ov.grossCents)}</b></div><div class="stat"><span class="muted">Creator earnings accrued</span><b>${money(ov.creatorEarnedCents)}</b></div></div>
  ${tabsHtml([['reports', `Reports (${reports.length})`], ['payouts', 'Payouts'], ['dmca', `Copyright (${dmca.filter(d => d.status === 'open').length})`], ['appeals', `Appeals (${appeals.filter(a => a.status === 'open').length})`], ['words', 'Word filter'], ['audit', 'Audit log'], ['users', 'Users']], tab)}
  <section data-p="appeals" ${tab === 'appeals' ? '' : 'hidden'}><div class="card" style="padding:6px 14px"><table><thead><tr><th>User</th><th>Appeal</th><th>Status</th><th></th></tr></thead><tbody>${appeals.map(a => `<tr><td>${esc(a.username)}<br><small class="muted">${a.strikes} strike(s)</small></td><td>${esc(a.text)}<br><small class="muted">${dt(a.created_at)}</small></td><td>${a.status}</td><td>${a.status === 'open' ? `<button class="btn small" data-apid="${a.id}" data-a="accept">Accept</button> <button class="btn small ghost" data-apid="${a.id}" data-a="reject">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No appeals.</td></tr>'}</tbody></table></div></section>
  <section data-p="words" ${tab === 'words' ? '' : 'hidden'}><div class="card"><p class="muted">Extra blocked words (matched even with spacing/punctuation tricks). Matches are masked and the author gets a strike.</p><form class="row" id="wf" style="margin:12px 0"><input name="word" placeholder="add a word" style="padding:10px 14px;border-radius:99px;border:1px solid var(--line);background:var(--bg)"><button class="btn small">Add</button></form><div>${words.map(w => `<span class="chip">${esc(w)} <a href="#" data-rw="${esc(w)}" aria-label="remove ${esc(w)}">✕</a></span>`).join('') || '<span class="muted">No custom words yet.</span>'}</div></div></section>
  <section data-p="audit" ${tab === 'audit' ? '' : 'hidden'}><div class="card" style="padding:6px 14px"><table><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th></tr></thead><tbody>${audit.map(a => `<tr><td>${dt(a.created_at)}</td><td>${esc(a.username)}</td><td>${esc(a.action)}</td><td>${esc(a.target)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No actions logged yet.</td></tr>'}</tbody></table></div></section>
  <section data-p="reports" ${tab === 'reports' ? '' : 'hidden'}><div class="card" style="padding:6px 14px"><table><thead><tr><th>Type</th><th>Content</th><th>Reason</th><th>Action</th></tr></thead><tbody>${reports.map(r => `<tr><td>${r.target_type}<br><small class="muted">#${r.target_id}</small></td><td><b>${esc(r.target?.author || '')}</b><br>${esc(r.target?.body || '(gone)')}${r.target?.status === 'hidden' ? '<br><small class="muted">auto-hidden</small>' : ''}</td><td>${esc(r.reason)}<br><small class="muted">by ${esc(r.reporter || 'auto-mod')}</small></td><td class="row" style="gap:6px"><button class="btn small ghost" data-rid="${r.id}" data-a="dismiss">Dismiss</button><button class="btn small" data-rid="${r.id}" data-a="hide">Remove</button><button class="btn small pink" data-rid="${r.id}" data-a="warn">Remove + strike</button><button class="btn small danger" data-rid="${r.id}" data-a="ban">Remove + ban</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">🎉 Queue is clear.</td></tr>'}</tbody></table></div></section>
  <section data-p="payouts" ${tab === 'payouts' ? '' : 'hidden'}><div class="card" style="padding:6px 14px"><table><thead><tr><th>Creator</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${payouts.map(p => `<tr><td>${esc(p.username)}<br><small class="muted">${esc(p.payout_email || '')}</small></td><td>${money(p.cents)}</td><td>${p.status}</td><td>${p.status === 'requested' ? `<button class="btn small" data-pid="${p.id}" data-a="approve">Mark paid</button> <button class="btn small ghost" data-pid="${p.id}" data-a="reject">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No payouts.</td></tr>'}</tbody></table></div></section>
  <section data-p="dmca" ${tab === 'dmca' ? '' : 'hidden'}><div class="card" style="padding:6px 14px"><table><tbody>${dmca.map(d => `<tr><td><b>${esc(d.title)}</b><br><small class="muted">${esc(d.claimant)} · ${esc(d.email)}</small></td><td>${esc(d.details)}</td><td>${d.status}</td><td>${d.status === 'open' ? `<button class="btn small danger" data-did="${d.id}" data-a="takedown">Take down</button> <button class="btn small ghost" data-did="${d.id}" data-a="dismiss">Dismiss</button>` : d.status === 'takedown' ? `<button class="btn small ghost" data-did="${d.id}" data-a="counter">Restore (counter-notice)</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">No claims.</td></tr>'}</tbody></table></div></section>
  <section data-p="users" ${tab === 'users' ? '' : 'hidden'}><form class="search" id="uf" style="margin-bottom:12px"><input id="uq" placeholder="Search username" style="width:260px"></form><div id="ul"></div></section></div>`;
  return { html, mount(v) {
    $$('.tabs button', v).forEach(b => b.onclick = () => { $$('.tabs button', v).forEach(x => x.classList.toggle('active', x === b)); $$('section[data-p]', v).forEach(x => x.hidden = x.dataset.p !== b.dataset.t); if (b.dataset.t === 'users') loadUsers(''); });
    const act = (sel, url) => $$(sel, v).forEach(b => b.onclick = guard(async () => { await api(url(b), { method: 'POST', body: { action: b.dataset.a } }); toast('Done', 'ok'); const t = $('.tabs .active', v).dataset.t; location.hash = '#/admin?t=' + t; route(); }));
    act('[data-rid]', b => '/admin/reports/' + b.dataset.rid); act('[data-pid]', b => '/admin/payouts/' + b.dataset.pid); act('[data-did]', b => '/admin/dmca/' + b.dataset.did); act('[data-apid]', b => '/admin/appeals/' + b.dataset.apid);
    const wordCall = guard(async (word, remove) => { await api('/admin/words', { method: 'POST', body: { word, remove } }); location.hash = '#/admin?t=words'; route(); });
    $('#wf', v).onsubmit = e => { e.preventDefault(); wordCall(e.target.word.value, false); };
    $$('[data-rw]', v).forEach(a => a.onclick = e => { e.preventDefault(); wordCall(a.dataset.rw, true); });
    const loadUsers = guard(async q => { const us = await api('/admin/users?q=' + encodeURIComponent(q)); $('#ul').innerHTML = `<div class="card" style="padding:6px 14px"><table><thead><tr><th>User</th><th>Role</th><th>Strikes</th><th>Status</th><th></th></tr></thead><tbody>${us.map(u => `<tr><td>${esc(u.username)}<br><small class="muted">${esc(u.email)}</small></td><td>${u.role}</td><td>${u.strikes}</td><td>${u.banned ? '⛔ banned' : u.muted_until > Date.now() ? '🔇 muted' : 'ok'}</td><td>${u.role === 'admin' ? (u.id === S.user.id ? '<span class="muted">you</span>' : `<button class="btn small ghost" data-uid="${u.id}" data-a="demote">Remove moderator</button>`) : u.banned ? `<button class="btn small ghost" data-uid="${u.id}" data-a="unban">Unban</button>` : `<button class="btn small ghost" data-uid="${u.id}" data-a="unmute">Unmute</button> <button class="btn small danger" data-uid="${u.id}" data-a="ban">Ban</button> <button class="btn small" data-uid="${u.id}" data-a="promote">Make moderator</button>`}</td></tr>`).join('')}</tbody></table></div>`; $$('[data-uid]').forEach(b => b.onclick = guard(async () => { await api('/admin/users/' + b.dataset.uid, { method: 'POST', body: { action: b.dataset.a } }); toast('Updated', 'ok'); loadUsers($('#uq').value); })); });
    $('#uf', v).onsubmit = e => { e.preventDefault(); loadUsers($('#uq').value); }; if (tab === 'users') loadUsers('');
  } };
});

// ---------------- STATIC PAGES ----------------
const doc = (title, body) => `<div class="wrap" style="max-width:820px"><div class="section-head" style="margin-top:0"><h2>${title}</h2></div><div class="card" style="line-height:1.8">${body}</div></div>`;
on(/^\/terms$/, async () => doc('Terms & Community Guidelines', `<h3>Community rules</h3><ul style="padding-left:20px"><li>Be respectful. No harassment, hate speech, threats or doxxing.</li><li>Tag spoilers: use <b>||spoiler||</b> inline or host a <b>Spoilers ahead</b> channel.</li><li>No spam, scams, or links to pirated content. New accounts can't post links for 24 hours.</li><li>Mature series must be flagged 18+. Sexual content involving minors is banned and reported to authorities.</li><li>Only upload work you own or have written permission to publish.</li></ul>
  <h3>Moderation ladder</h3><p>Filtered word → strike. Strike 2: 10-minute mute. Strike 3: 24-hour mute. Strike 5: account ban. Content reported by 3 different users is hidden automatically until a moderator reviews it. You can appeal any action by contacting support.</p>
  <h3>Payments</h3><p>Coins are non-transferable and non-refundable once spent. Creators earn ${S.cfg.creatorShareUnlockPct}% of the net value of coins spent on their chapters and ${S.cfg.creatorShareTip * 100}% of tips. Earnings are held ${S.cfg.holdDays} days; payouts start at ${money(S.cfg.minPayoutCents)} and require payout details and tax confirmation. Creators keep ownership of their work and grant InkVerse a licence only to host and display it.</p>`));
on(/^\/creators$/, async () => doc('Creator Program', `<p>Publish comics or web novels, weekly or all at once, and get paid by your readers.</p><ul style="padding-left:20px"><li><b>${S.cfg.creatorShareUnlockPct}%</b> of net coin value on every early-access chapter unlock</li><li><b>${S.cfg.creatorShareTip * 100}%</b> of every tip</li><li>You choose price (${S.cfg.minCoinsPerChapter}–${S.cfg.maxCoinsPerChapter} coins) and when it becomes free (the "wait or pay" model)</li><li>Schedule releases weekly, pick a date, or bulk-publish a backlog</li><li>Payouts from ${money(S.cfg.minPayoutCents)} after a ${S.cfg.holdDays}-day safety hold</li><li>You own your IP. DMCA protection and moderated communities.</li></ul><p style="margin-top:14px"><a class="btn" href="#/studio">Open Studio</a></p>`));
on(/^\/dmca$/, async () => ({ html: doc('Copyright / DMCA notice', `<p class="muted">If your copyrighted work was published here without permission, tell us. Accepted claims lead to takedown; creators may counter-notify. Repeat infringers are banned.</p><form class="form" id="df" style="margin-top:14px"><label>Series ID (from its page URL)<input name="series_id" type="number" required></label><label>Your name / company<input name="claimant" required></label><label>Contact email<input name="email" type="email" required></label><label>Describe the work and the infringement (30+ chars)<textarea name="details" minlength="30" required></textarea></label><label class="check"><input type="checkbox" required> I have a good-faith belief that the use is unauthorized, and the information is accurate.</label><button class="btn">Submit claim</button></form>`),
  mount(v) { $('#df', v).onsubmit = guard(async e => { e.preventDefault(); await api('/dmca', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Claim received. We\'ll review it shortly.', 'ok'); e.target.reset(); }); } }));

on(/^\/downloads$/, async () => {
  const files = await api('/downloads'); const kb = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  return `<div class="wrap" style="max-width:900px"><div class="section-head" style="margin-top:0"><h2>⬇ Downloads</h2></div><p class="muted" style="margin-bottom:18px">Everything you need to understand, run and deploy InkVerse.</p>
  ${files.length ? files.map(f => `<div class="chapter in"><span class="ch-tag ${f.kind === 'PDF' ? 'spoilers' : f.kind === 'ZIP' ? 'fan-art' : f.kind === 'README' ? 'recs' : 'theories'}">${esc(f.kind)}</span><span class="t">${esc(f.title)}<br><small class="muted">${esc(f.desc)} · ${kb(f.bytes)}</small></span><a class="btn small" href="${esc(f.url)}" download>Download</a></div>`).join('') : '<div class="card"><p>No files built yet. Run <code>npm run build:downloads</code> on the server.</p></div>'}</div>`;
});

on(/^\/reset$/, async (m, p) => ({ html: `<div class="wrap" style="max-width:480px"><div class="section-head" style="margin-top:0"><h2>Choose a new password</h2></div><form class="form card" id="rf2"><label>New password (8+ characters)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><button class="btn">Update password</button></form></div>`,
  mount(v) { $('#rf2', v).onsubmit = guard(async e => { e.preventDefault(); await api('/auth/reset', { method: 'POST', body: { token: p.get('token'), password: e.target.password.value } }); toast('Password updated — please log in.', 'ok'); location.hash = '#/'; authModal(); }); } }));
on(/^\/privacy$/, async () => doc('Privacy Policy', `<p class="muted">Template for a demo platform — have it reviewed by a lawyer and adapt it before launch.</p><h3>What we collect</h3><ul style="padding-left:20px"><li>Account data: username, email, hashed password, optional bio, 18+ confirmation.</li><li>Activity: reading progress, follows, likes, ratings, comments, chat messages, reports and moderation actions.</li><li>Payments: purchases are processed by Stripe; we store the pack, amount and a payment reference — never card numbers. Creators provide a payout email.</li></ul>
  <h3>How we use it</h3><p>To run the service, personalise recommendations, keep the community safe (moderation, abuse prevention), process payments and payouts, and send account emails such as password resets.</p>
  <h3>Sharing</h3><p>We do not sell personal data. We share it only with service providers needed to operate InkVerse (hosting, payments, email) and when the law requires it. Usernames, comments and chat messages are visible to other users.</p>
  <h3>Your choices</h3><p>You can edit your profile, and request export or deletion of your account by contacting support. Some records (payments, moderation logs) may be retained as required by law.</p><h3>Security & cookies</h3><p>Passwords are hashed; connections use HTTPS. We store a login token and your theme/reader preferences in your browser's local storage; we do not use advertising cookies.</p>`));

// ---------------- shared toolkit for reader.js / studio.js / pages.js ----------------
window.IV = { S, $, $$, esc, money, ago, dt, avatar, api, toast, guard, modal, card, coinBurst, needLogin, authModal, route, renderNav, refreshMe, on, leave: f => leave.push(f), tabsHtml, inline, bindSpoilers, reportModal, skeleton };

// ---------------- boot ----------------
window.addEventListener('hashchange', route);
(async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { S.cfg = await fetch('/api/config').then(r => r.json()); localStorage.setItem('iv_cfg', JSON.stringify(S.cfg)); }
  catch { S.cfg = JSON.parse(localStorage.getItem('iv_cfg') || 'null'); if (!S.cfg) { document.body.innerHTML = '<p style="padding:40px">You appear to be offline. Reconnect to load InkVerse.</p>'; return; } }
  await refreshMe(); renderFooter(); route();
  setInterval(async () => { if (S.token && !document.hidden) { try { S.notifs = await api('/notifications'); renderNav(); } catch {} } }, 60000);
})();
})();
