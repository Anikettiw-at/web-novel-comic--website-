const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(process.env.DB_FILE || path.join(dataDir, 'inkverse.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'reader',          -- reader | creator | admin
  bio TEXT DEFAULT '',
  coins INTEGER NOT NULL DEFAULT 0,
  payout_email TEXT,
  tax_ok INTEGER NOT NULL DEFAULT 0,            -- creator accepted payout terms / tax info
  adult INTEGER NOT NULL DEFAULT 0,             -- confirmed 18+ for mature content
  strikes INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL,                           -- comic | novel
  synopsis TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '',
  cover TEXT,
  schedule TEXT NOT NULL DEFAULT 'weekly',      -- weekly | bulk
  mature INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ongoing',       -- ongoing | completed | hiatus | removed
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT,                                 -- novel text
  pages TEXT,                                   -- comic: JSON array of image urls
  price_coins INTEGER NOT NULL DEFAULT 0,
  publish_at INTEGER NOT NULL,
  free_at INTEGER,                              -- when premium chapter becomes free (NULL = never)
  notified INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(series_id, number)
);
CREATE TABLE IF NOT EXISTS unlocks (user_id INTEGER, chapter_id INTEGER, created_at INTEGER, PRIMARY KEY(user_id, chapter_id));
CREATE TABLE IF NOT EXISTS follows (user_id INTEGER, series_id INTEGER, PRIMARY KEY(user_id, series_id));
CREATE TABLE IF NOT EXISTS likes (user_id INTEGER, series_id INTEGER, PRIMARY KEY(user_id, series_id));
CREATE TABLE IF NOT EXISTS ratings (user_id INTEGER, series_id INTEGER, stars INTEGER, PRIMARY KEY(user_id, series_id));
CREATE TABLE IF NOT EXISTS progress (user_id INTEGER, series_id INTEGER, chapter_id INTEGER, updated_at INTEGER, PRIMARY KEY(user_id, series_id));
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',       -- visible | hidden
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  series_id INTEGER REFERENCES series(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  tag TEXT NOT NULL DEFAULT 'general',          -- general | spoilers | theories | fan-art | recs
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channel_mutes (channel_id INTEGER, user_id INTEGER, PRIMARY KEY(channel_id, user_id));
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id),     -- NULL = auto-moderation
  target_type TEXT NOT NULL,                    -- message | comment | series | user
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',          -- open | actioned | dismissed
  action TEXT,
  resolved_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,                           -- purchase | unlock | tip_sent | tip_received | payout
  coins INTEGER NOT NULL DEFAULT 0,
  cents REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL,
  cents REAL NOT NULL,
  source TEXT NOT NULL,                         -- unlock | tip
  series_id INTEGER,
  available_at INTEGER NOT NULL,                -- refund/chargeback hold
  payout_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL,
  cents REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',     -- requested | paid | rejected
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dmca (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL,
  claimant TEXT NOT NULL,
  email TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',          -- open | takedown | counter | dismissed
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ch_series ON chapters(series_id, number);
CREATE INDEX IF NOT EXISTS idx_msg_channel ON messages(channel_id, id);
CREATE INDEX IF NOT EXISTS idx_cm_chapter ON comments(chapter_id, id);
`);


// ---- v2: advanced features ----
db.exec(`
CREATE TABLE IF NOT EXISTS view_log (series_id INTEGER, day TEXT, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(series_id, day));
CREATE TABLE IF NOT EXISTS reactions (chapter_id INTEGER, user_id INTEGER, emoji TEXT, PRIMARY KEY(chapter_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',          -- open | accepted | rejected
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, action TEXT, target TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS blocked_words (word TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, created_at INTEGER);   -- idempotency: one credit per Checkout session
CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
`);
function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('users', 'streak', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'last_checkin', 'INTEGER NOT NULL DEFAULT 0');   // UTC day number
addColumn('chapters', 'author_note', 'TEXT');
addColumn('earnings', 'payer_id', 'INTEGER');
addColumn('earnings', 'coins', 'INTEGER NOT NULL DEFAULT 0');

// ---- Business rules (single source of truth; exposed at /api/config) ----
const RULES = {
  coinPacks: [
    { id: 'p200', coins: 200, cents: 199 },
    { id: 'p500', coins: 500, cents: 449 },
    { id: 'p1200', coins: 1200, cents: 999 },
    { id: 'p2600', coins: 2600, cents: 1999 },
  ],
  coinValueCents: 0.8,        // net value of 1 coin after payment-processor fees & taxes (pack price ~1c/coin)
  creatorShareUnlock: 0.70,   // creator share of net coin value on chapter unlocks
  creatorShareTip: 0.90,      // creator share on tips (platform keeps 10%)
  minPayoutCents: 5000,       // $50 minimum payout
  holdDays: Number(process.env.HOLD_DAYS ?? 14), // earnings held for refund/chargeback window
  minCoinsPerChapter: 5,
  maxCoinsPerChapter: 100,
  maxFreeAfterDays: 60,
  genres: ['Fantasy', 'Romance', 'Action', 'Sci-Fi', 'Horror', 'Comedy', 'Slice of Life', 'Mystery', 'Drama', 'Isekai', 'Superhero', 'Thriller'],
  checkinRewards: [5, 5, 10, 10, 15, 15, 30],   // 7-day streak ladder (funded from platform's share)
  reactions: ['🔥', '😂', '😭', '😮', '❤️'],
  channelTags: ['general', 'spoilers', 'theories', 'fan-art', 'recs'],
};

module.exports = { db, RULES };
