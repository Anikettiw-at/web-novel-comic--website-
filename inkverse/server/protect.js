// Protected delivery of PAID comic pages.
// Pages of priced chapters are never exposed as public /uploads/ URLs. The chapter API returns short-lived signed
// links (/pages/:chapterId/:n?k=...) bound to the reader and chapter; each image is served with a faint per-reader
// watermark (username + id) so a leaked page can be traced. Deterrent, not DRM: screenshots can't be prevented.
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const { db } = require('./db');

const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = ({ SECRET, upDir }) => {
  const signPages = (c, pages, user) => {
    if (!(c.price_coins > 0)) return pages;                    // free chapters stay plain public files
    const k = jwt.sign({ u: user?.id || 0, n: user?.username || '', c: c.id }, SECRET, { expiresIn: '6h' });
    return pages.map((p, i) => p.startsWith('/uploads/') ? `/pages/${c.id}/${i}?k=${k}` : p);
  };
  function mount(app) {
    const limiter = rateLimit({ windowMs: 10 * 60_000, limit: 3000, standardHeaders: true, legacyHeaders: false });
    app.get('/pages/:id/:n', limiter, async (req, res) => {
      let t; try { t = jwt.verify(String(req.query.k || ''), SECRET); } catch { return res.status(403).type('text').send('Link expired. Reload the chapter.'); }
      const id = Number(req.params.id), n = Number(req.params.n);
      if (t.c !== id) return res.status(403).type('text').send('Forbidden');
      const c = db.prepare('SELECT pages FROM chapters WHERE id=?').get(id), pages = c?.pages ? JSON.parse(c.pages) : [];
      const url = pages[n]; if (!url || !url.startsWith('/uploads/')) return res.status(404).end();
      const file = path.join(upDir, path.basename(url)); if (!fs.existsSync(file)) return res.status(404).end();
      try {
        const meta = await sharp(file).metadata(), w = meta.width, h = meta.height, label = xml(t.u ? `${t.n} · InkVerse #${t.u}` : 'InkVerse'), fs_ = Math.max(14, Math.round(w / 28));
        const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="p" width="${fs_ * 14}" height="${fs_ * 6}" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><text x="0" y="${fs_ * 2}" font-family="Arial,sans-serif" font-size="${fs_}" fill="#fff" fill-opacity=".16" stroke="#000" stroke-opacity=".12" stroke-width="1">${label}</text></pattern></defs><rect width="${w}" height="${h}" fill="url(#p)"/></svg>`);
        let img = sharp(file).rotate().composite([{ input: svg }]);
        const png = meta.format === 'png' || meta.format === 'gif';
        img = png ? img.png() : meta.format === 'webp' ? img.webp({ quality: 90 }) : img.jpeg({ quality: 90 });
        res.set({ 'Content-Type': png ? 'image/png' : meta.format === 'webp' ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'private, max-age=21600', 'X-Content-Type-Options': 'nosniff' }).send(await img.toBuffer());
      } catch (e) { console.error('page watermark failed', e.message); res.status(500).end(); }
    });
  }
  return { signPages, mount };
};
