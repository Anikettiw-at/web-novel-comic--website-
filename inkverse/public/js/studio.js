/* InkVerse creator studio: new series (monetization, manga direction, tags), chapter upload with drafts + copyright check,
   chapter manager, retention analytics, comment management, series settings. */
(() => {
const { S, $, $$, esc, api, toast, guard, modal, money, dt, on, tabsHtml, route, ago } = IV;
const chips = (name, list, sel = []) => list.map(g => `<label class="chip ${sel.includes(g) ? 'active' : ''}"><input type="checkbox" name="${name}" value="${esc(g)}" ${sel.includes(g) ? 'checked' : ''} style="display:none">${esc(g)}</label>`).join('');
function limitChips(root, max, label) { $$('.chip input', root).forEach(i => i.onchange = () => { const grp = $$(`.chip input[name="${i.name}"]:checked`, root); if (grp.length > max(i.name)) { i.checked = false; return toast(`Max ${max(i.name)} ${label(i.name)}`, 'err'); } i.parentElement.classList.toggle('active', i.checked); }); }
const MAXES = { g: 4, tag: 6, warn: 6 }, LABELS = { g: 'genres', tag: 'tags', warn: 'content warnings' };

const monetizationFields = (s = {}) => `<fieldset class="form" style="border:1px solid var(--line);border-radius:12px;padding:14px"><legend style="font-weight:700;font-size:13px">How will you earn?</legend>
  ${[['free', '🆓 Free — build an audience (ad-supported; tips still work)'], ['hybrid', '🎁 Hybrid — first chapters free, later chapters early-access (recommended)'], ['paid', '💎 Paid — every chapter costs coins (they can become free later)']].map(([v, t]) => `<label class="check"><input type="radio" name="monetization" value="${v}" ${(s.monetization || 'hybrid') === v ? 'checked' : ''}> ${t}</label>`).join('')}
  <label data-for="hybrid">Free chapters at the start (hybrid)<input type="number" name="free_chapters" min="0" max="200" value="${s.free_chapters ?? 20}"></label>
  <label data-for="paid hybrid">Default early-access price (coins, ${S.cfg.minCoinsPerChapter}–${S.cfg.maxCoinsPerChapter})<input type="number" name="default_price" min="0" max="${S.cfg.maxCoinsPerChapter}" value="${s.default_price ?? 10}"></label>
  <small class="muted">You keep ${S.cfg.creatorShareUnlockPct}% of coin value on unlocks and ${S.cfg.creatorShareTip * 100}% of tips. Free chapters earn through tips and your growing audience.</small></fieldset>`;
function bindMonetization(root) {
  const sync = () => { const m = $('input[name=monetization]:checked', root).value; $$('[data-for]', root).forEach(l => l.hidden = !l.dataset.for.split(' ').includes(m)); };
  $$('input[name=monetization]', root).forEach(r => r.onchange = sync); sync();
}
const metaFields = (s = {}, comic = true) => `
  <label>Language<select name="language">${Object.entries(S.cfg.languages).map(([k, v]) => `<option value="${k}" ${(s.language || 'en') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  ${comic ? `<label>Reading direction<select name="reading_dir"><option value="vertical" ${s.reading_dir === 'vertical' ? 'selected' : ''}>⬇ Vertical scroll (webtoon / manhwa)</option><option value="ltr" ${s.reading_dir === 'ltr' ? 'selected' : ''}>➡ Left-to-right pages (western comic)</option><option value="rtl" ${s.reading_dir === 'rtl' ? 'selected' : ''}>🈶 Right-to-left pages (manga)</option></select></label>` : ''}
  <div><b style="font-size:13px">Tropes / tags (up to 6)</b><div style="margin-top:8px">${chips('tag', S.cfg.tags, s.tags || [])}</div></div>
  <div><b style="font-size:13px">Content warnings</b><div style="margin-top:8px">${chips('warn', S.cfg.warnings, s.warnings || [])}</div></div>`;

on(/^\/studio\/new$/, async () => {
  if (!S.user || S.user.role === 'reader') throw new Error('Creators only.');
  const html = `<div class="wrap" style="max-width:720px"><div class="section-head" style="margin-top:0"><h2>New series</h2></div><form class="form card" id="nf">
  <label>Title<input name="title" required maxlength="80"></label><label>Format<select name="type" id="ty"><option value="comic">Comic / manga / manhwa (image pages)</option><option value="novel">Web novel (text)</option></select></label>
  <label>Synopsis<textarea name="synopsis" maxlength="1500" required></textarea></label>
  <div><b style="font-size:13px">Genres (up to 4)</b><div style="margin-top:8px">${chips('g', S.cfg.genres)}</div></div>
  <div id="meta">${metaFields({}, true)}</div>
  ${monetizationFields()}
  <label>Release plan<select name="schedule"><option value="weekly">Weekly schedule (new chapter every 7 days)</option><option value="bulk">Batch release (publish many at once)</option></select></label>
  <label>Cover image (3:4, max 8MB — optional, a cover is generated otherwise)<input type="file" name="cover" accept="image/*"></label>
  <label class="check"><input type="checkbox" name="mature"> Contains mature content (18+ readers only)</label>
  <label class="check"><input type="checkbox" required> I own all rights to this work and agree to the Creator Terms. I understand uploads are checked for copyright infringement.</label>
  <div id="err"></div><button class="btn">Create series</button></form></div>`;
  return { html, mount(v) {
    const lim = () => limitChips(v, k => MAXES[k] || 4, k => LABELS[k] || 'items'); lim(); bindMonetization(v);
    $('#ty', v).onchange = e => { $('#meta', v).innerHTML = metaFields({}, e.target.value === 'comic'); lim(); };
    $('#nf', v).onsubmit = guard(async e => {
      e.preventDefault(); const f = new FormData(e.target); f.set('genres', f.getAll('g').join(',')); f.set('tags', f.getAll('tag').join(',')); f.set('warnings', f.getAll('warn').join(',')); f.set('mature', f.get('mature') === 'on');
      if (!f.get('cover')?.size) f.delete('cover');
      try { const r = await api('/series', { method: 'POST', form: f }); toast('Series created! Add your first chapter.', 'ok'); location.hash = '#/studio/series/' + r.id; }
      catch (er) { $('#err', v).innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; throw er; }
    });
  } };
});

on(/^\/studio\/series\/(\d+)$/, async (m, p) => {
  if (!S.user) throw Object.assign(new Error('Log in first'), { status: 401 });
  const s = await api('/series/' + m[1]); if (!s.own) throw new Error('This is not your series.');
  const novel = s.type === 'novel', tab = p.get('t') || 'one';
  const priceNote = { free: 'This series is free — chapters are always free.', hybrid: `First ${s.free_chapters} chapters are free; later chapters use the price below (default ${s.default_price} coins).`, paid: `Paid series — chapters use the price below (default ${s.default_price} coins).` }[s.monetization];
  const pubFields = `<fieldset class="form" style="border:1px solid var(--line);border-radius:12px;padding:14px"><legend style="font-weight:700;font-size:13px">Release & price</legend>
    <label class="check"><input type="radio" name="publish_mode" value="now" ${s.schedule === 'bulk' ? 'checked' : ''}> Publish immediately</label>
    <label class="check"><input type="radio" name="publish_mode" value="weekly" ${s.schedule === 'weekly' ? 'checked' : ''}> Weekly — auto-schedule into the next free 7-day slot</label>
    <label class="check"><input type="radio" name="publish_mode" value="date"> Pick a date <input type="datetime-local" name="publish_at" style="width:auto"></label>
    <label class="check"><input type="checkbox" name="draft"> 📝 Save as draft (only you can see it until you publish)</label>
    ${s.monetization === 'free' ? '' : `<small class="muted">${priceNote}</small><label>Early-access price override (coins; empty = default; 0 = free)<input type="number" name="price_coins" min="0" max="${S.cfg.maxCoinsPerChapter}" placeholder="${s.default_price}"></label>
    <label>Becomes free after (days, 0 = stays premium; max ${S.cfg.maxFreeAfterDays})<input type="number" name="free_after_days" min="0" max="${S.cfg.maxFreeAfterDays}" value="7"></label>`}</fieldset>`;
  const statusChip = c => c.draft ? '<span class="chip">📝 draft</span>' : c.held ? '<span class="chip" style="background:#ffd23f;color:#111">⏳ copyright review</span>' : c.scheduled ? `⏰ ${dt(c.publish_at)}` : '✅ live';
  const html = `<div class="wrap" style="max-width:940px"><a class="btn ghost small" href="#/series/${s.id}">← View public page</a><div class="section-head"><h2>${esc(s.title)}</h2><span class="chip">${s.status}</span></div>
  <div class="row" style="margin-bottom:16px"><span class="muted">${s.chapters.length} chapters (${s.chapters.filter(c => c.scheduled).length} scheduled, ${s.chapters.filter(c => c.draft).length} drafts) · ${{ free: '🆓 free', hybrid: '🎁 hybrid', paid: '💎 paid' }[s.monetization]}${s.reading_dir === 'rtl' ? ' · 🈶 manga' : ''}</span></div>
  ${tabsHtml([['one', novel ? 'Add chapter' : 'Upload chapter'], ...(novel ? [['bulk', 'Bulk import']] : []), ['list', 'Chapters'], ['stats', '📊 Reader analytics'], ['cm', '💬 Comments'], ['set', '⚙ Settings']], tab)}
  <section data-p="one" ${tab === 'one' ? '' : 'hidden'}><form class="form card" id="cf"><label>Chapter title<input name="title" required maxlength="100"></label>
  ${novel ? '<label>Text (blank line = new paragraph)<textarea name="content" style="min-height:300px" required minlength="50"></textarea></label><div class="row"><button type="button" class="btn ghost small" id="cc">🔎 Check for copyright issues first</button><small class="muted" id="ccr"></small></div>'
    : '<div class="drop" id="drop"><label>Page images in reading order (PNG/JPG/WebP, vertical strips welcome — name them 01, 02, 03…)<input type="file" name="pages" accept="image/*" multiple required></label><small class="muted" id="fc"></small></div>'}
  <label>Author's note to readers (optional)<textarea name="author_note" maxlength="500" style="min-height:70px"></textarea></label>
  ${pubFields}<div id="err"></div><button class="btn">Publish / schedule chapter</button><small class="muted">🛡 Every upload is checked against other creators' work and a registry of protected works. Matches are blocked or held for review.</small></form></section>
  ${novel ? `<section data-p="bulk" ${tab === 'bulk' ? '' : 'hidden'}><form class="form card" id="bf"><p class="muted">Paste many chapters at once. Start each with a line like <code># Chapter title</code>.</p><textarea name="text" style="min-height:260px" placeholder="# The Beginning&#10;Once upon a time…&#10;&#10;# Chapter two&#10;…"></textarea>${pubFields.replace(/name="publish_at"/, 'name="publish_at_unused"')}<div id="err2"></div><button class="btn">Import chapters</button></form></section>` : ''}
  <section data-p="list" ${tab === 'list' ? '' : 'hidden'}><div class="card" style="padding:6px 14px;overflow-x:auto"><table><thead><tr><th>#</th><th>Title</th><th>Status</th><th>Price</th><th>Reads</th><th></th></tr></thead><tbody>${s.chapters.map(c => `<tr><td>#${c.number}</td><td>${esc(c.title)}</td><td>${statusChip(c)}</td><td>${c.price_coins ? '🪙' + c.price_coins : 'free'}</td><td>👁 ${c.views}</td>
    <td class="row" style="gap:6px;flex-wrap:nowrap"><a class="btn small ghost" href="#/read/${c.id}">Open</a>${c.draft || c.scheduled ? `<button class="btn small" data-pub="${c.id}">Publish now</button>` : ''}<button class="btn small ghost" data-ed="${c.id}" data-t="${esc(c.title)}">Edit</button><button class="btn small ghost" data-pr="${c.id}" title="Timestamped proof of ownership">🪪 Proof</button><button class="btn small danger" data-dl="${c.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No chapters yet.</td></tr>'}</tbody></table></div></section>
  <section data-p="stats" ${tab === 'stats' ? '' : 'hidden'}><div class="card" id="stats"><p class="muted">Loading…</p></div></section>
  <section data-p="cm" ${tab === 'cm' ? '' : 'hidden'}><div class="card" id="cmt"><p class="muted">Loading…</p></div></section>
  <section data-p="set" ${tab === 'set' ? '' : 'hidden'}><form class="form card" id="sf"><label>Status<select name="status">${['ongoing', 'hiatus', 'completed'].map(x => `<option ${s.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Synopsis<textarea name="synopsis" maxlength="1500">${esc(s.synopsis)}</textarea></label>
    <label>Release plan<select name="schedule"><option value="weekly" ${s.schedule === 'weekly' ? 'selected' : ''}>Weekly</option><option value="bulk" ${s.schedule === 'bulk' ? 'selected' : ''}>Batch</option></select></label>${metaFields(s, !novel)}${monetizationFields(s)}<button class="btn">Save settings</button><small class="muted">Changing monetization affects chapters you upload from now on; chapters readers already paid for stay unlocked.</small></form></section></div>`;
  return { html, mount(v) {
    const show = t => { $$('.tabs button', v).forEach(x => x.classList.toggle('active', x.dataset.t === t)); $$('section[data-p]', v).forEach(x => x.hidden = x.dataset.p !== t); if (t === 'stats') loadStats(); if (t === 'cm') loadComments(); };
    $$('.tabs button', v).forEach(b => b.onclick = () => show(b.dataset.t)); limitChips(v, k => MAXES[k] || 4, k => LABELS[k] || 'items'); bindMonetization($('#sf', v));
    $('input[type=file][name=pages]', v)?.addEventListener('change', e => $('#fc').textContent = e.target.files.length + ' page(s) selected');
    $('#cc', v)?.addEventListener('click', guard(async () => { const r = await api('/copyright/check-text', { method: 'POST', body: { text: $('#cf textarea[name=content]').value } }); $('#ccr').textContent = (r.verdict === 'pass' ? '✅ ' : '⚠️ ') + (r.message || r.note); }));
    const describe = er => er.copyright ? `<div class="alert bad"><b>Copyright check</b><br>${esc(er.message)}</div>` : `<div class="alert bad">${esc(er.message)}</div>`;
    const normalize = f => { if (f.get('publish_at')) f.set('publish_at', new Date(f.get('publish_at')).toISOString()); f.set('draft', f.get('draft') === 'on'); if (f.get('price_coins') === '') f.delete('price_coins'); return f; };
    $('#cf', v).onsubmit = async e => {
      e.preventDefault(); const btn = $('button.btn:not(.ghost):last-of-type', e.target); btn.disabled = true; btn.textContent = 'Checking & uploading…';
      try {
        const r = await api(`/series/${s.id}/chapters`, { method: 'POST', form: normalize(new FormData(e.target)) });
        if (r.status === 'pending_review') toast('Uploaded — held for a quick copyright review before it goes live.', 'ok'); else if (r.draft) toast('Draft saved', 'ok'); else toast(r.publish_at > Date.now() ? 'Scheduled for ' + dt(r.publish_at) : 'Published!', 'ok'); route();
      } catch (er) { $('#err', v).innerHTML = describe(er); toast(er.message, 'err'); btn.disabled = false; btn.textContent = 'Publish / schedule chapter'; }
    };
    $('#bf', v)?.addEventListener('submit', async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.draft = f.draft === 'on'; if (f.price_coins === '') delete f.price_coins;
      try { const r = await api(`/series/${s.id}/chapters/bulk`, { method: 'POST', body: f }); toast(r.created + ' chapters imported' + (r.held ? ` (${r.held} held for copyright review)` : ''), 'ok'); route(); } catch (er) { $('#err2', v).innerHTML = describe(er); } });
    $('#sf', v).onsubmit = guard(async e => { e.preventDefault(); const f = new FormData(e.target); const body = Object.fromEntries(f); body.tags = f.getAll('tag').join(','); body.warnings = f.getAll('warn').join(','); await api('/series/' + s.id, { method: 'PATCH', body }); toast('Settings saved', 'ok'); route(); });
    // chapter actions
    $('section[data-p=list]', v).addEventListener('click', guard(async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pub) { await api('/chapters/' + b.dataset.pub, { method: 'PATCH', body: { publish: 'now' } }); toast('Published', 'ok'); route(); }
      if (b.dataset.ed) { const t = prompt('Chapter title', b.dataset.t); if (t) { await api('/chapters/' + b.dataset.ed, { method: 'PATCH', body: { title: t } }); toast('Saved', 'ok'); route(); } }
      if (b.dataset.dl && confirm('Delete this chapter permanently?')) { await api('/chapters/' + b.dataset.dl, { method: 'DELETE' }); toast('Deleted', 'ok'); route(); }
      if (b.dataset.pr) { const r = await api(`/chapters/${b.dataset.pr}/proof`); modal(`<h2>Proof of ownership</h2><p class="muted">Server-signed record of what you uploaded and when. Keep it with your files; support can verify the signature.</p><pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;background:var(--bg);padding:12px;border-radius:10px;margin:12px 0">${esc(JSON.stringify(r, null, 2))}</pre><button class="btn small" id="dlp">Download</button>`, m => {
        $('#dlp', m).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })); a.download = `inkverse-proof-ch${b.closest('tr').children[0].textContent.slice(1)}.json`; a.click(); }; }); }
    }));
    // analytics: where readers drop off and which chapter converts to paid
    let loadedStats = false, loadedCm = false;
    const loadStats = guard(async () => {
      if (loadedStats) return; loadedStats = true; const rows = await api(`/creator/series/${s.id}/retention`);
      $('#stats', v).innerHTML = rows.length ? `<h3>Reader retention & conversion</h3><p class="muted" style="margin:6px 0 12px">Readers are counted once per chapter (logged-in readers). Big drop-offs show where the story loses people; conversion is the share of readers of the previous chapter who paid to continue.</p>
      <div style="overflow-x:auto"><table><thead><tr><th>Ch.</th><th>Readers</th><th>Retention vs ch.1</th><th>Drop-off</th><th>Paid unlocks</th><th>Conversion</th></tr></thead><tbody>${rows.map(r => `<tr><td>#${r.number} ${esc(r.title)}</td><td>${r.readers}</td><td><div class="rbar"><i style="width:${r.retention ?? 0}%"></i></div><small class="muted">${r.retention ?? '—'}%</small></td><td ${r.dropoff >= 35 ? 'style="color:var(--pink);font-weight:700"' : ''}>${r.number === 1 ? '—' : r.dropoff + '%'}</td><td>${r.price_coins ? r.unlocks : '—'}</td><td>${r.conversion != null ? r.conversion + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Analytics appear once readers start reading.</p>';
    });
    const loadComments = guard(async () => {
      if (loadedCm) return; loadedCm = true; const rows = (await api('/creator/comments')).filter(c => c.st === s.title);
      $('#cmt', v).innerHTML = `<h3>Latest comments</h3>${rows.map(c => `<div class="comment" data-c="${c.id}"><div style="flex:1"><b>${esc(c.username)}</b> <small class="muted">on ch.${c.number} · ${ago(c.created_at)}</small>${c.pinned ? ' 📌' : ''}<div>${IV.inline(c.body)}</div><a class="lnk muted" href="#/read/${c.chapter_id}">open chapter</a><button class="lnk muted" data-pin="${c.id}">${c.pinned ? 'unpin' : '📌 pin'}</button><button class="lnk muted" data-del="${c.id}">🗑 delete</button></div></div>`).join('') || '<p class="muted">No comments yet.</p>'}`;
      $('#cmt', v).onclick = guard(async e => { const pin = e.target.closest('[data-pin]'), del = e.target.closest('[data-del]');
        if (pin) { await api(`/comments/${pin.dataset.pin}/pin`, { method: 'POST' }); loadedCm = false; loadComments(); } if (del && confirm('Delete this comment?')) { await api(`/comments/${del.dataset.del}`, { method: 'DELETE' }); del.closest('.comment').remove(); } });
    });
    if (tab === 'stats') loadStats(); if (tab === 'cm') loadComments();
  } };
});
})();
