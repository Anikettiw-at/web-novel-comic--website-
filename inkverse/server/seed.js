// Demo data. Runs automatically when the database is empty; `npm run seed` forces a re-seed of missing demo users.
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const DAY = 24 * 3600 * 1000;

const LOREM = [
  'The rain had not stopped for three days, and the city of Lumen glowed beneath it like a bruise of neon. Mira pulled her hood lower and stepped through the market, counting the lanterns that were not supposed to be lit.',
  '"You shouldn\'t be here," the old clockmaker whispered. "Not after what happened at the Spire." Mira only smiled, turning the brass key in her palm. It was warm. It had been warm since the night the stars went out.',
  'Behind them, the bells began to ring in the wrong order. One. Four. Nine. A pattern only the dead should know. Mira felt the key pulse in time with them, and for the first time in years, she was not afraid.',
  'They ran. Across rooftops slick with rain, past billboards that whispered her name in languages she had never learned. At the edge of the district, the gate stood open — and on the other side, someone was waiting.',
];
const novelText = n => `Chapter ${n}\n\n` + LOREM.concat(LOREM).join('\n\n') + `\n\n(To be continued in chapter ${n + 1}…)`;

function ensureUser(username, email, password, role, extra = {}) {
  const ex = db.prepare('SELECT * FROM users WHERE username=?').get(username); if (ex) return ex;
  const info = db.prepare('INSERT INTO users(username,email,pass_hash,role,adult,coins,payout_email,tax_ok,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(username, email, bcrypt.hashSync(password, 10), role, 1, extra.coins || 0, extra.payout || null, extra.tax || 0, Date.now() - 30 * DAY);
  return db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
}

function run() {
  // Production: SEED_DEMO=false skips demo accounts/content; ADMIN_EMAIL + ADMIN_PASSWORD create your real admin.
  if (process.env.SEED_DEMO === 'false') {
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) ensureUser(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, 'admin');
    return;
  }
  const admin = ensureUser('admin', 'admin@inkverse.test', 'Admin123!', 'admin');
  const nova = ensureUser('NovaInk', 'nova@inkverse.test', 'Creator123!', 'creator', { coins: 300, payout: 'nova@inkverse.test', tax: 1 });
  const kai = ensureUser('KaiWrites', 'kai@inkverse.test', 'Creator123!', 'creator', { coins: 300, payout: 'kai@inkverse.test', tax: 1 });
  const reader = ensureUser('ReaderRay', 'reader@inkverse.test', 'Reader123!', 'reader', { coins: 500 });
  if (db.prepare('SELECT COUNT(*) c FROM series').get().c > 0) return;

  const mk = (u, title, type, genres, syn, schedule, mature = 0) => db.prepare('INSERT INTO series(creator_id,title,type,synopsis,genres,schedule,mature,views,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(u.id, title, type, syn, genres, schedule, mature, Math.floor(Math.random() * 5000) + 500, Date.now() - 20 * DAY).lastInsertRowid;
  const ch = (sid, n, title, type, price, free_after, publishAt) => db.prepare('INSERT INTO chapters(series_id,number,title,content,pages,price_coins,publish_at,free_at,notified,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)').run(
    sid, n, title, type === 'novel' ? novelText(n) : null,
    type === 'comic' ? JSON.stringify([1, 2, 3, 4, 5].map(p => `/gen/page/${sid}/${n * 10 + p}.svg`)) : null,
    price, publishAt, price && free_after ? publishAt + free_after * DAY : null, Date.now() - 20 * DAY);

  const series = [
    [nova, 'Starfall Academy', 'comic', 'Fantasy,Action', 'A scholarship kid discovers the academy trains heroes to hunt fallen stars — and she is one.', 'weekly', 12],
    [nova, 'Neon Ronin', 'comic', 'Sci-Fi,Action', 'In a rain-soaked cyber-city, a masterless swordsman guards the last analog archive.', 'weekly', 8],
    [kai, 'The Clockmaker\'s Key', 'novel', 'Mystery,Fantasy', 'A brass key that is always warm, a city that never sleeps, and bells that ring for the dead.', 'weekly', 6],
    [kai, 'My Villain Roommate', 'comic', 'Comedy,Romance', 'Moving in with the city\'s most wanted supervillain was supposed to be a budget decision.', 'bulk', 5],
    [nova, 'Dungeon Café', 'novel', 'Isekai,Comedy,Slice of Life', 'Reincarnated as the owner of a café inside a dungeon. The adventurers want refills.', 'bulk', 5],
    [kai, 'Midnight Ledger', 'novel', 'Thriller,Drama', 'An accountant finds a second set of books — written in blood-red ink.', 'weekly', 4],
  ];
  series.forEach(([u, title, type, g, syn, sched, count], i) => {
    const sid = mk(u, title, type, g, syn, sched);
    for (let n = 1; n <= count; n++) {
      const at = sched === 'weekly' ? Date.now() - (count - n) * 7 * DAY - DAY : Date.now() - 10 * DAY;
      const premium = n > count - 2 && i % 2 === 0; // latest 2 chapters premium (early access) on some series
      ch(sid, n, n === 1 ? 'The Beginning' : `Episode ${n}`, type, premium ? 15 : 0, premium ? 7 : 0, at);
    }
    if (i === 0) ch(sid, count + 1, 'Coming soon (scheduled)', type, 0, 0, Date.now() + 3 * DAY); // scheduled example
  });
  const ids = db.prepare('SELECT id FROM series').all().map(r => r.id);
  // 30 days of synthetic traffic so creator analytics charts have something to draw
  for (const sid of ids) for (let d = 29; d >= 0; d--) db.prepare('INSERT OR IGNORE INTO view_log VALUES(?,?,?)').run(sid, new Date(Date.now() - d * DAY).toISOString().slice(0, 10), Math.floor(20 + Math.random() * 60 + (30 - d) * 2));
  for (const sid of ids) { db.prepare('INSERT OR IGNORE INTO likes VALUES(?,?)').run(reader.id, sid); db.prepare('INSERT OR IGNORE INTO ratings VALUES(?,?,?)').run(reader.id, sid, 4 + (sid % 2)); }
  db.prepare('INSERT INTO follows VALUES(?,?)').run(reader.id, ids[0]);

  const chan = (owner, sid, name, desc, tag) => db.prepare('INSERT INTO channels(owner_id,series_id,name,description,tag,created_at) VALUES(?,?,?,?,?,?)').run(owner.id, sid, name, desc, tag, Date.now()).lastInsertRowid;
  const c1 = chan(nova, ids[0], 'Starfall General', 'Spoiler-free chat about Starfall Academy', 'general');
  chan(reader, ids[0], 'Ch.12 SPOILERS', 'Discuss the latest twist. Spoilers ahead!', 'spoilers');
  chan(kai, ids[2], 'Who rings the bells? (theories)', 'Theory crafting for The Clockmaker\'s Key', 'theories');
  db.prepare('INSERT INTO messages(channel_id,user_id,body,created_at) VALUES(?,?,?,?)').run(c1, nova.id, 'Welcome to the channel! Please tag spoilers with ||double bars||.', Date.now());
  console.log('Seeded demo data.');
}

module.exports = { run };
if (require.main === module) run();
