/* InkVerse extra pages: Premium, My highlights, Charts, Library (history + offline), email verification,
   admin copyright console, account security modal. */
(() => {
const { S, $, $$, esc, api, toast, guard, modal, money, dt, ago, on, card, route, renderNav, refreshMe, authModal } = IV;
const needUser = msg => { if (!S.user) throw Object.assign(new Error(msg), { status: 401 }); };

// ---------------- PREMIUM ----------------
on(/^\/premium$/, async (m, p) => {
  const P = S.cfg.premium; let info = null;
  if (S.user) { await refreshMe(); renderNav(); info = await api('/premium').catch(() => null); }
  const active = info?.active, price = money(P.cents);
  const rows = [['Read every free chapter', '✓', '✓'], ['Manga mode, page-turn animation, themes, read-aloud', '✓', '✓'], ['Offline chapters & synced progress', '✓', '✓'],
    ['Ads', 'House ads between chapters', 'None'], ['Highlights & notes', `${S.cfg.freeHighlightLimit} saved`, 'Unlimited'], ['Early-access chapters', 'Coins or wait', `${P.monthlyUnlocks} unlocks / month included`], ['Supports creators', 'Tips & coin unlocks', 'Creators are paid for every Premium unlock too']];
  const html = `<div class="wrap"><div class="plan card"><div class="big" style="font-size:54px">⭐</div><h2 class="display" style="font-size:40px">InkVerse Premium</h2>
    <div class="price">${price}<small class="muted" style="font-size:16px;font-family:Poppins"> / month</small></div>
    ${p.get('paid') ? '<div class="alert warn">Thanks! Your payment is being confirmed — Premium switches on within a few seconds.</div>' : ''}
    ${active ? `<div class="alert warn">You are a Premium member${info.cancelling ? ` — <b>cancelled</b>, access until ${dt(info.until)}` : ` — renews around ${dt(info.until)}`}. Early-access unlocks left this month: <b>${info.unlocksLeft}</b>.</div>` : ''}
    <table class="compare"><thead><tr><th></th><th>Free</th><th>⭐ Premium</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td><b>${r[2]}</b></td></tr>`).join('')}</tbody></table>
    <div class="row" style="justify-content:center;margin-top:22px">${active ? (info.cancelling ? '' : '<button class="btn ghost" id="cancel">Cancel subscription</button>') : `<button class="btn" id="sub">${S.user ? `Go Premium — ${price}/mo` : 'Log in to subscribe'}</button>`}</div>
    <p class="muted" style="margin-top:14px;font-size:12px">${S.cfg.payments === 'demo' ? 'Demo mode: no real charge is made.' : S.cfg.payments === 'stripe' ? 'Secure checkout by Stripe. Cancel any time; you keep access until the period ends.' : 'Subscriptions are not enabled yet.'}</p></div></div>`;
  return { html, mount(v) {
    $('#sub', v)?.addEventListener('click', guard(async () => { if (!S.user) return authModal(); const r = await api('/premium/subscribe', { method: 'POST' }); if (r.url) location.href = r.url; else { toast('Welcome to Premium! ⭐', 'ok'); await refreshMe(); renderNav(); route(); } }));
    $('#cancel', v)?.addEventListener('click', guard(async () => { if (!confirm('Cancel Premium? You keep access until the end of the paid period.')) return; await api('/premium/cancel', { method: 'POST' }); toast('Subscription cancelled', 'ok'); route(); }));
    if (p.get('paid')) setTimeout(async () => { await refreshMe(); renderNav(); }, 3000);
  } };
});

// ---------------- MY HIGHLIGHTS ----------------
on(/^\/highlights$/, async () => {
  needUser('Log in to see your highlights');
  const d = await api('/highlights'), groups = {};
  d.items.forEach(h => { (groups[h.chapter_id] ||= { h, items: [] }).items.push(h); });
  const html = `<div class="wrap" style="max-width:860px"><div class="section-head" style="margin-top:0"><h2>🖍 My highlights</h2><span class="muted">${d.items.length}${d.limit ? ' / ' + d.limit : ''} saved ${d.limit ? '· <a href="#/premium" style="text-decoration:underline">unlimited with Premium</a>' : '· ⭐ unlimited'}</span></div>
  ${d.items.length ? Object.values(groups).map(g => `<div class="card" style="margin-bottom:16px"><a href="#/read/${g.h.chapter_id}"><b>${esc(g.h.series_title)}</b> — Ch. ${g.h.number}: ${esc(g.h.chapter_title)}</a>
    ${g.items.map(h => `<div class="hl-item hl-${h.color}" data-id="${h.id}">${h.kind === 'text' ? `<div style="font-family:Merriweather,serif">“${esc(h.text)}”</div>` : `<div>🖼 Panel highlight on page ${h.page + 1}</div>`}${h.note ? `<div class="muted" style="margin-top:4px">📝 ${esc(h.note)}</div>` : ''}<div class="row" style="margin-top:6px"><small class="muted">${ago(h.created_at)}</small><a class="lnk" href="#/read/${h.chapter_id}">open</a><button class="lnk muted" data-del="${h.id}">🗑 remove</button></div></div>`).join('')}</div>`).join('')
    : '<div class="card"><h3>No highlights yet</h3><p class="muted">In any novel, select a passage and pick a colour. In comics, switch on the 🖍 Highlight tool and drag a box over a panel. Highlights stay with your account on every device.</p></div>'}</div>`;
  return { html, mount(v) { v.addEventListener('click', guard(async e => { const b = e.target.closest('[data-del]'); if (!b) return; await api('/highlights/' + b.dataset.del, { method: 'DELETE' }); b.closest('.hl-item').remove(); toast('Removed'); })); } };
});

// ---------------- CHARTS (fair ranking) ----------------
on(/^\/charts$/, async () => {
  const c = await api('/charts');
  const row = (title, sub, list, ranked = true) => list.length ? `<div class="section-head"><h2>${title}</h2><span class="muted">${sub}</span></div><div class="hscroll">${list.map((s, i) => `<div>${ranked ? `<b class="display" style="font-size:26px;color:var(--green)">#${i + 1}</b>` : ''}${card(s)}</div>`).join('')}</div>` : '';
  return `<div class="wrap"><div class="section-head" style="margin-top:0"><h2>🏆 Charts</h2></div>
  <div class="card" style="margin-bottom:10px"><b>How ranking works</b><p class="muted" style="font-size:14px;margin-top:4px">Charts are based on reader activity only — views, likes, follows and (for the paid chart) chapters readers chose to unlock. Nobody can pay for a higher spot. New series get a 1.5× boost in Trending for their first 30 days, and the Spotlight highlights creators publishing their first works.</p></div>
  ${row('🌱 New creator spotlight', 'Fresh voices worth a look', c.spotlight, false)}${row('🚀 Rising', 'New series gaining readers fastest this week', c.rising)}${row('💎 Top paid', 'Most-unlocked early-access series', c.paid)}${row('🆓 Top free', 'Most-read free series', c.free)}${row('✅ Completed', 'Finished stories you can binge', c.completed)}${row('🆕 Just updated', 'Latest chapters', c.new, false)}</div>`;
});

// ---------------- LIBRARY: continue, following, history, offline ----------------
async function offlineList() {
  try { const cache = await caches.open('iv-offline'), keys = await cache.keys(); const out = [];
    for (const k of keys) { const d = await (await cache.match(k)).json().catch(() => null); if (d) out.push(d); } return out.sort((a, b) => b.saved_at - a.saved_at); } catch { return []; }
}
on(/^\/library$/, async () => {
  needUser('Log in to see your library');
  const [l, hist, off] = await Promise.all([api('/library').catch(() => ({ continue: [], following: [] })), api('/history').catch(() => []), offlineList()]);
  const html = `<div class="wrap"><div class="section-head" style="margin-top:0"><h2>Continue reading</h2></div>${hist.length ? `<div class="grid">${hist.slice(0, 12).map(h => `<div><a class="scard" href="#/read/${h.chapter_id}"><div class="thumb"><span class="tag ${h.type}">${h.type}</span><img class="cv" loading="lazy" src="${esc(h.cover)}" alt=""></div><div class="meta"><h3>${esc(h.title)}</h3><small>Ch. ${h.number} · ${h.type === 'comic' ? 'page ' + (h.page + 1) : Math.round(h.pct) + '%'}</small></div></a></div>`).join('')}</div>` : '<p class="muted">Start reading and your progress shows up here.</p>'}
  <div class="section-head"><h2>Following</h2></div>${l.following.length ? `<div class="grid">${l.following.map(card).join('')}</div>` : '<p class="muted">Follow series to get new-chapter notifications.</p>'}
  <div class="section-head"><h2>⬇ Saved offline</h2><span class="muted">${off.length} chapter(s) on this device</span></div>
  ${off.length ? off.map(c => `<div class="chapter in"><span class="num">${c.number}</span><span class="t">${esc(c.series_title)} — ${esc(c.title)}<br><small class="muted">saved ${ago(c.saved_at)}</small></span><a class="btn small" href="#/read/${c.id}">Read</a> <button class="btn small ghost" data-rm="${c.id}">Remove</button></div>`).join('') : '<p class="muted">Use the ⬇ button in the reader to save chapters for offline reading.</p>'}
  <div class="section-head"><h2>Reading history</h2></div><div class="card" style="padding:6px 14px"><table><tbody>${hist.map(h => `<tr><td><a href="#/series/${h.series_id}">${esc(h.title)}</a></td><td>Ch. ${h.number}: ${esc(h.ct)}</td><td>${h.type === 'comic' ? 'Page ' + (h.page + 1) : Math.round(h.pct) + '% · ' + (h.words ? Math.max(1, Math.round(h.words * (1 - h.pct / 100) / 230)) + ' min left' : '')}</td><td class="muted">${ago(h.updated_at)}</td><td><a class="btn small ghost" href="#/read/${h.chapter_id}">Resume</a></td></tr>`).join('') || '<tr><td class="muted">Nothing read yet.</td></tr>'}</tbody></table></div></div>`;
  return { html, mount(v) { v.addEventListener('click', guard(async e => { const b = e.target.closest('[data-rm]'); if (!b) return; await (await caches.open('iv-offline')).delete('/offline/chapter/' + b.dataset.rm); b.closest('.chapter').remove(); toast('Removed from this device'); })); } };
});

// ---------------- EMAIL VERIFICATION ----------------
on(/^\/verify$/, async (m, p) => {
  let msg, ok = false; try { await api('/auth/verify-email', { method: 'POST', body: { token: p.get('token') } }); ok = true; msg = 'Your email is confirmed. Thank you!'; await refreshMe(); renderNav(); } catch (e) { msg = e.message; }
  return `<div class="wrap" style="max-width:520px"><div class="card" style="text-align:center"><div class="big" style="font-size:48px">${ok ? '✅' : '⚠️'}</div><h2>${esc(msg)}</h2><p style="margin-top:16px"><a class="btn" href="#/">Continue to InkVerse</a></p></div></div>`;
});

// ---------------- ADMIN: COPYRIGHT ----------------
on(/^\/admin\/copyright$/, async () => {
  if (S.user?.role !== 'admin') throw new Error('Moderators only.');
  const d = await api('/admin/copyright'), T = d.thresholds;
  const detail = k => k.details.map(x => x.type === 'image' ? `🖼 ${x.pages_matched}/${x.pages_total} pages match${x.protected_match ? ' a <b>protected work</b>' : ' another creator\'s upload'}` : `📄 ${Math.round(x.overlap * 100)}% text overlap${x.protected_match ? ' with a <b>protected work</b>' : ''}${x.exact ? ' (exact copy)' : ''}`).join('<br>') || '—';
  const html = `<div class="wrap"><a class="btn ghost small" href="#/admin">← Admin</a><div class="section-head"><h2>© Copyright review</h2></div>
  <p class="muted" style="margin-bottom:14px">New uploads are fingerprinted (image hashes + text shingles) and compared with other creators' work and the protected registry. ≥${Math.round(T.blockOther * 100)}% overlap is blocked automatically; ${Math.round(T.reviewOther * 100)}–${Math.round(T.blockOther * 100)}% is held here for a human decision. This catches copies of material InkVerse has seen — it cannot search the whole web, so keep the DMCA process.</p>
  <div class="card" style="padding:6px 14px;overflow-x:auto"><table><thead><tr><th>When</th><th>Creator / work</th><th>Findings</th><th>Result</th><th></th></tr></thead><tbody>${d.queue.map(k => `<tr><td>${dt(k.created_at)}</td><td><b>${esc(k.creator || '?')}</b><br><small class="muted">${esc(k.series_title || '')}${k.number ? ' ch.' + k.number : ''}</small>${k.chapter_id ? ` <a class="lnk" href="#/read/${k.chapter_id}">preview</a>` : ''}</td><td>${detail(k)}<br><small class="muted">score ${k.score}</small></td><td>${k.verdict === 'block' ? '⛔ blocked' : k.status === 'open' ? '⏳ held' : k.status}</td><td>${k.verdict === 'review' && k.status === 'open' ? `<button class="btn small" data-a="approve" data-id="${k.id}">Approve</button> <button class="btn small danger" data-a="reject" data-id="${k.id}">Reject & delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing flagged yet.</td></tr>'}</tbody></table></div>
  <div class="section-head"><h2>🛡 Protected works registry</h2></div><div class="card"><p class="muted">Register copyrighted images or text supplied by a rights holder. Uploads that match are blocked.</p>
  <form class="form" id="pf" style="margin-top:12px"><label>Name of work / rights holder<input name="label" required maxlength="100" placeholder="e.g. Publisher X — Title Y"></label><label>Reference images (optional)<input type="file" name="images" accept="image/*" multiple></label><label>Reference text (optional, 60+ words)<textarea name="text" style="min-height:90px"></textarea></label><button class="btn small">Add to registry</button></form>
  <table style="margin-top:14px"><tbody>${d.registry.map(r => `<tr><td>${esc(r.label)}</td><td>${r.kind} × ${r.n}</td><td class="muted">${ago(r.at)}</td><td><button class="btn small ghost" data-rm="${esc(r.label)}">Remove</button></td></tr>`).join('') || '<tr><td class="muted">Registry is empty.</td></tr>'}</tbody></table></div></div>`;
  return { html, mount(v) {
    v.addEventListener('click', guard(async e => { const b = e.target.closest('[data-a]'); if (b) { await api('/admin/copyright/' + b.dataset.id, { method: 'POST', body: { action: b.dataset.a } }); toast('Done', 'ok'); route(); }
      const r = e.target.closest('[data-rm]'); if (r && confirm('Remove from registry?')) { await api('/admin/copyright/protect?label=' + encodeURIComponent(r.dataset.rm), { method: 'DELETE' }); route(); } }));
    $('#pf', v).onsubmit = guard(async e => { e.preventDefault(); const f = new FormData(e.target); if (!f.get('text')) f.delete('text'); f.delete('images'); for (const file of e.target.images.files) f.append('images', file);
      const r = await api('/admin/copyright/protect', { method: 'POST', form: f }); toast(`Registered (${r.images} image(s)${r.text ? ' + text' : ''})`, 'ok'); route(); });
  } };
});

// ---------------- ACCOUNT SECURITY & DATA ----------------
IV.securityModal = () => modal(`<h2>🔐 Security & your data</h2>
  <form class="form" id="cp" style="margin-top:12px"><b>Change password</b><label>Current password<input name="current" type="password" required autocomplete="current-password"></label><label>New password (8+ characters)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><button class="btn small">Update password</button></form>
  <div class="row" style="margin-top:16px"><button class="btn ghost small" id="lo-all">Sign out of all devices</button><button class="btn ghost small" id="exp">⬇ Download my data</button></div>
  <form class="form" id="del" style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px"><b>Delete account</b><small class="muted">Removes your profile, library, highlights and personal data. Comments are anonymised. This cannot be undone.</small><label>Confirm with your password<input name="password" type="password" required></label><button class="btn danger small">Delete my account</button></form>`, (m, close) => {
    const setToken = t => { S.token = t; localStorage.setItem('iv_token', t); };
    $('#cp', m).onsubmit = guard(async e => { e.preventDefault(); const r = await api('/auth/change-password', { method: 'POST', body: { current: e.target.current.value, password: e.target.password.value } }); setToken(r.token); toast('Password updated; other devices were signed out.', 'ok'); close(); });
    $('#lo-all', m).onclick = guard(async () => { const r = await api('/auth/logout-all', { method: 'POST' }); setToken(r.token); toast('Signed out everywhere else.', 'ok'); });
    $('#exp', m).onclick = guard(async () => { const r = await fetch('/api/me/export', { headers: { Authorization: 'Bearer ' + S.token } }); if (!r.ok) throw new Error('Export failed'); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'inkverse-my-data.json'; a.click(); });
    $('#del', m).onsubmit = guard(async e => { e.preventDefault(); if (!confirm('Really delete your account forever?')) return; await api('/me', { method: 'DELETE', body: { password: e.target.password.value } }); localStorage.removeItem('iv_token'); try { caches.delete('iv-offline'); } catch {} S.token = null; S.user = null; close(); renderNav(); location.hash = '#/'; toast('Your account was deleted.'); });
  });
})();
