// Copyright / infringement check for NEW uploads (cover, comic pages, novel text).
//
// How it works (all local, no third-party calls):
//   images : SHA-256 (exact copy) + 64-bit difference hash "dHash" (survives resizing, re-compression, small edits)
//   text   : sampled 5-word shingle hashes; "containment" = share of the new text found in an existing text
// New material is compared with (a) works uploaded by OTHER creators and (b) the admin "protected works"
// registry (known copyrighted material supplied by rights holders). Results:
//   block  -> upload refused, nothing is stored
//   review -> chapter is saved but hidden from readers until an admin approves it
//   pass   -> published normally
// Limits: it finds copies of material this platform has seen. It cannot search the open web for stolen work;
// the DMCA workflow remains the safety net. Thresholds are tunable below.
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { db } = require('./db');

const T = {
  imgHamming: 6,            // dHash distance <= 6 of 64 bits counts as "same picture"
  minImageStd: 8,           // ignore near-blank images (all-white pages match each other)
  blockOther: 0.8, reviewOther: 0.3,         // share of pages / text matching another creator's work
  blockProtected: 0.5, reviewProtected: 0.1, // stricter against the protected registry
  shingle: 5, minWords: 60,
};
const now = () => Date.now();

async function imageFingerprint(input) {
  const img = sharp(input, { failOn: 'none' });
  const buf = typeof input === 'string' ? fs.readFileSync(input) : input;
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const { data, info } = await img.clone().rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n, sum = 0, sq = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const a = data[y * 9 + x], b = data[y * 9 + x + 1]; bits = (bits << 1n) | (a > b ? 1n : 0n);
  }
  for (const v of data) { sum += v; sq += v * v; }
  const mean = sum / data.length, std = Math.sqrt(Math.max(0, sq / data.length - mean * mean));
  return { sha, phash: bits.toString(16).padStart(16, '0'), flat: std < T.minImageStd, channels: info.channels };
}
const hamming = (a, b) => { let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

function textFingerprint(text) {
  const words = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length < T.minWords) return null;
  const set = new Set();
  for (let i = 0; i + T.shingle <= words.length; i++) {
    const h = crypto.createHash('sha1').update(words.slice(i, i + T.shingle).join(' ')).digest().readUInt32BE(0);
    if (h % 3 === 0) set.add(h);                 // deterministic 1-in-3 sample keeps rows small
  }
  return { sha: crypto.createHash('sha256').update(words.join(' ')).digest('hex'), shingles: [...set].slice(0, 6000), words: words.length };
}

// Compare new prints with stored ones. `ownerId` works are never matched against themselves.
function compare({ ownerId, images = [], text = null }) {
  const matches = []; let worst = 0, verdict = 'pass';
  const bump = (v) => { if (v === 'block') verdict = 'block'; else if (v === 'review' && verdict !== 'block') verdict = 'review'; };
  if (images.length) {
    const rows = db.prepare("SELECT id, sha, phash, protected, owner_id, series_id, label FROM fingerprints WHERE kind='image' AND (owner_id IS NOT ? OR protected=1)").all(ownerId);
    const hit = { other: new Set(), prot: new Set() }, exactHits = new Set(); const info = [];
    images.forEach((im, i) => {
      for (const r of rows) {
        const exact = !im.flat && r.sha && r.sha === im.sha;   // identical blank/solid pages are common and prove nothing
        if (exact || (!im.flat && r.phash && hamming(im.phash, r.phash) <= T.imgHamming)) {
          (r.protected ? hit.prot : hit.other).add(i); if (exact) exactHits.add(i);
          if (info.length < 5) info.push({ page: i + 1, exact: !!exact, protected: !!r.protected, series_id: r.series_id, label: r.label });
        }
      }
    });
    const rOther = hit.other.size / images.length, rProt = hit.prot.size / images.length;
    if (rProt >= T.blockProtected || rOther >= T.blockOther) bump('block');
    else if (hit.prot.size || hit.other.size) bump('review');   // even one matching page of original art is worth a human look
    worst = Math.max(worst, rProt, rOther);
    if (info.length) matches.push({ type: 'image', pages_matched: new Set([...hit.other, ...hit.prot]).size, pages_total: images.length, protected_match: hit.prot.size > 0, samples: info });
  }
  if (text) {
    const mine = new Set(text.shingles), rows = db.prepare("SELECT shingles, protected, series_id, label FROM fingerprints WHERE kind='text' AND shingles IS NOT NULL AND (owner_id IS NOT ? OR protected=1)").all(ownerId);
    let best = { c: 0 };
    for (const r of rows) {
      const theirs = JSON.parse(r.shingles); let n = 0; for (const h of theirs) if (mine.has(h)) n++;
      const c = n / Math.max(1, Math.min(mine.size, theirs.length));
      if (c > best.c) best = { c, protected: !!r.protected, series_id: r.series_id, label: r.label };
    }
    if (best.c) {
      const [b, r] = best.protected ? [T.blockProtected, T.reviewProtected] : [T.blockOther, T.reviewOther];
      bump(best.c >= b ? 'block' : best.c >= r ? 'review' : 'pass'); worst = Math.max(worst, best.c);
      if (best.c >= r) matches.push({ type: 'text', overlap: +best.c.toFixed(2), protected_match: best.protected, series_id: best.series_id, label: best.label });
    }
    const exact = db.prepare("SELECT 1 FROM fingerprints WHERE kind='text' AND sha=? AND (owner_id IS NOT ? OR protected=1) LIMIT 1").get(text.sha, ownerId);
    if (exact) { bump('block'); worst = 1; matches.push({ type: 'text', overlap: 1, exact: true }); }
  }
  return { verdict, score: +worst.toFixed(3), matches };
}

// Full pre-publish check. files: multer disk files (comic pages). Returns result + the prints to store on success.
async function checkUpload({ ownerId, files = [], text = null }) {
  const images = []; for (const f of files) { try { images.push(await imageFingerprint(f.path)); } catch { /* unreadable image: skip, upload filter already restricts types */ } }
  const tfp = text ? textFingerprint(text) : null;
  const res = compare({ ownerId, images, text: tfp });
  return { ...res, prints: { images, text: tfp } };
}

function store({ ownerId, seriesId, chapterId, prints, label = null, isProtected = 0 }) {
  const ins = db.prepare('INSERT INTO fingerprints(kind,sha,phash,shingles,owner_id,series_id,chapter_id,protected,label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (const im of prints.images || []) ins.run('image', im.sha, im.flat ? null : im.phash, null, ownerId, seriesId, chapterId, isProtected, label, now());
    if (prints.text) ins.run('text', prints.text.sha, null, JSON.stringify(prints.text.shingles), ownerId, seriesId, chapterId, isProtected, label, now());
  })();
}
const logCheck = ({ chapterId, seriesId, userId, res }) => db.prepare('INSERT INTO copyright_checks(chapter_id,series_id,user_id,score,verdict,details,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(chapterId || null, seriesId, userId, res.score, res.verdict, JSON.stringify(res.matches), res.verdict === 'review' ? 'open' : 'approved', now()).lastInsertRowid;

const explain = res => res.matches.some(m => m.protected_match)
  ? 'This upload matches a copyrighted work registered by a rights holder, so it can\'t be published.'
  : 'This upload is substantially identical to material already uploaded by another creator. Only upload work you own.';

// Index any chapters published before this feature existed (production databases). Demo data is skipped.
async function backfill() {
  if (process.env.SEED_DEMO !== 'false') return;
  const rows = db.prepare('SELECT c.id, c.series_id, c.content, c.pages, s.creator_id FROM chapters c JOIN series s ON s.id=c.series_id WHERE NOT EXISTS (SELECT 1 FROM fingerprints f WHERE f.chapter_id=c.id)').all();
  for (const c of rows) {
    try {
      const prints = { images: [], text: c.content ? textFingerprint(c.content) : null };
      for (const p of c.pages ? JSON.parse(c.pages) : []) { const f = require('path').join(upDirOf(), require('path').basename(p)); if (p.startsWith('/uploads/') && fs.existsSync(f)) prints.images.push(await imageFingerprint(f)); }
      store({ ownerId: c.creator_id, seriesId: c.series_id, chapterId: c.id, prints });
    } catch (e) { console.error('fingerprint backfill failed for chapter', c.id, e.message); }
  }
}
let _up = null; const upDirOf = () => _up;

function mount(app, { needRole, fail, clean, notify, audit, secret, upDir }) {
  _up = upDir;
  const admin = needRole('admin');
  const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 20 }, fileFilter: (r, f, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(f.mimetype)) });

  app.get('/api/admin/copyright', admin, (req, res) => {
    const queue = db.prepare(`SELECT k.*, s.title series_title, c.number, c.title chapter_title, u.username creator FROM copyright_checks k
      LEFT JOIN series s ON s.id=k.series_id LEFT JOIN chapters c ON c.id=k.chapter_id LEFT JOIN users u ON u.id=k.user_id
      WHERE k.verdict IN ('review','block') ORDER BY (k.status='open') DESC, k.id DESC LIMIT 60`).all().map(r => ({ ...r, details: JSON.parse(r.details || '[]') }));
    const registry = db.prepare("SELECT label, kind, COUNT(*) n, MAX(created_at) at FROM fingerprints WHERE protected=1 GROUP BY label, kind ORDER BY at DESC LIMIT 50").all();
    res.json({ queue, registry, thresholds: T });
  });
  // Rights holders / admins register known copyrighted material (images and/or text) so copies are blocked on upload.
  app.post('/api/admin/copyright/protect', admin, mem.array('images', 20), async (req, res) => {
    const label = clean(req.body.label, 100); if (label.length < 2) return fail(res, 400, 'Give the work a name (e.g. "Publisher X – Title").');
    const prints = { images: [], text: null };
    for (const f of req.files || []) { try { prints.images.push(await imageFingerprint(f.buffer)); } catch { /* skip unreadable */ } }
    if (req.body.text) { prints.text = textFingerprint(req.body.text); if (!prints.text) return fail(res, 400, `Text must be at least ${T.minWords} words.`); }
    if (!prints.images.length && !prints.text) return fail(res, 400, 'Provide images or text to register.');
    store({ ownerId: null, seriesId: null, chapterId: null, prints, label, isProtected: 1 });
    audit(req, 'copyright_protect', label); res.json({ ok: true, images: prints.images.length, text: !!prints.text });
  });
  app.post('/api/admin/copyright/:id', admin, (req, res) => {
    const k = db.prepare("SELECT * FROM copyright_checks WHERE id=? AND status='open' AND verdict='review'").get(Number(req.params.id)); if (!k) return fail(res, 404, 'Nothing to review.');
    const ok = req.body.action === 'approve';
    db.transaction(() => {
      db.prepare('UPDATE copyright_checks SET status=? WHERE id=?').run(ok ? 'approved' : 'rejected', k.id);
      if (k.chapter_id) {
        if (ok) db.prepare("UPDATE chapters SET review='ok' WHERE id=?").run(k.chapter_id);
        else { db.prepare('DELETE FROM fingerprints WHERE chapter_id=?').run(k.chapter_id); db.prepare('DELETE FROM chapters WHERE id=?').run(k.chapter_id); }
      }
      notify(k.user_id, ok ? 'Your chapter passed the copyright review and is now live.' : 'Your chapter was removed after a copyright review. Only upload work you own — repeated violations lead to a ban.');
      audit(req, 'copyright_' + (ok ? 'approve' : 'reject'), `check#${k.id} chapter#${k.chapter_id}`);
    })();
    res.json({ ok: true });
  });
  app.delete('/api/admin/copyright/protect', admin, (req, res) => {
    const n = db.prepare('DELETE FROM fingerprints WHERE protected=1 AND label=?').run(clean(req.query.label, 100)).changes; audit(req, 'copyright_unprotect', req.query.label); res.json({ removed: n });
  });
  // Creator: dry-run a text before uploading
  app.post('/api/copyright/check-text', needRole('creator', 'admin'), async (req, res) => {
    const t = textFingerprint(String(req.body.text || '').slice(0, 300000)); if (!t) return res.json({ verdict: 'pass', score: 0, matches: [], note: 'Too short to compare.' });
    const r = compare({ ownerId: req.user.id, text: t }); res.json({ verdict: r.verdict, score: r.score, message: r.verdict === 'pass' ? 'No matches found.' : explain(r) });
  });
  // Creator: timestamped, server-signed proof that this exact content was uploaded by you at this time
  app.get('/api/chapters/:id/proof', needRole('creator', 'admin'), (req, res) => {
    const c = db.prepare('SELECT c.id, c.number, c.title, c.created_at, s.title st, s.creator_id, u.username FROM chapters c JOIN series s ON s.id=c.series_id JOIN users u ON u.id=s.creator_id WHERE c.id=?').get(Number(req.params.id));
    if (!c || (c.creator_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 403, 'Not your chapter.');
    const prints = db.prepare('SELECT kind, sha FROM fingerprints WHERE chapter_id=? ORDER BY id').all(c.id);
    const statement = { platform: 'InkVerse', creator: c.username, series: c.st, chapter: c.number, title: c.title, uploaded_at: new Date(c.created_at).toISOString(), sha256: prints.map(p => p.sha) };
    const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(statement)).digest('hex');
    res.json({ statement, signature, note: 'Signature is an HMAC by InkVerse; contact support to verify a certificate.' });
  });
  return { T };
}

module.exports = { mount, checkUpload, store, logCheck, explain, textFingerprint, imageFingerprint, compare, backfill };
