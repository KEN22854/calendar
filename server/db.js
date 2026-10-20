// Инициализация SQLite, автосоздание/миграция схемы, seed слотов
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || './data/booking.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ШАГ 1. Только таблицы. Индексы — после миграций.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('4','8','12')),
    lessons_total INTEGER NOT NULL,
    lessons_used INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS time_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS day_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(date, time)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subscription_id INTEGER,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    telegram TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(date, time_slot),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS bookings_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    subscription_id INTEGER,
    date TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    telegram TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now')),
    archive_reason TEXT NOT NULL DEFAULT 'manual'
  );
`);

// ШАГ 2. Мягкие миграции колонок
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column);
}
if (!hasColumn('users', 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  console.log('[db] миграция: users.role');
}
if (!hasColumn('bookings', 'subscription_id')) {
  db.exec('ALTER TABLE bookings ADD COLUMN subscription_id INTEGER');
  console.log('[db] миграция: bookings.subscription_id');
}
if (!hasColumn('bookings_archive', 'username')) {
  db.exec('ALTER TABLE bookings_archive ADD COLUMN username TEXT');
  console.log('[db] миграция: bookings_archive.username');
}
if (!hasColumn('bookings_archive', 'archive_reason')) {
  db.exec("ALTER TABLE bookings_archive ADD COLUMN archive_reason TEXT NOT NULL DEFAULT 'manual'");
  console.log('[db] миграция: bookings_archive.archive_reason');
}

// ШАГ 3. Индексы (колонки уже гарантированно существуют)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
  CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_subs_active ON subscriptions(is_active);
  CREATE INDEX IF NOT EXISTS idx_archive_date ON bookings_archive(date);
  CREATE INDEX IF NOT EXISTS idx_archive_reason ON bookings_archive(archive_reason);
  CREATE INDEX IF NOT EXISTS idx_slots_time ON time_slots(time);
  CREATE INDEX IF NOT EXISTS idx_day_slots_date ON day_slots(date);
`);

// ШАГ 4. Seed глобальных слотов 09:00–20:00
const slotCount = db.prepare('SELECT COUNT(*) AS c FROM time_slots').get().c;
if (slotCount === 0) {
  const insert = db.prepare('INSERT INTO time_slots (time, sort_order, is_active) VALUES (?, ?, 1)');
  const tx = db.transaction(() => {
    for (let h = 9; h <= 20; h++) {
      insert.run(String(h).padStart(2, '0') + ':00', h * 60);
    }
  });
  tx();
  console.log('[db] seed: добавлены слоты 09:00–20:00');
}

// ШАГ 5. Разовое исправление day_slots (user_version 1).
// Раньше одна правка дня создавала набор из одного слота, и остальные окна дня пропадали.
// Теперь набор дня всегда полный: дописываем в такие дни недостающие активные глобальные слоты.
// Уже скрытые (is_active = 0) времена остаются скрытыми.
if (db.pragma('user_version', { simple: true }) < 1) {
  const dates = db.prepare('SELECT DISTINCT date FROM day_slots').all().map(r => r.date);
  const globals = db.prepare('SELECT time FROM time_slots WHERE is_active = 1').all().map(r => r.time);
  const insert = db.prepare('INSERT OR IGNORE INTO day_slots (date, time, is_active) VALUES (?, ?, 1)');
  db.transaction(() => {
    for (const d of dates) for (const t of globals) insert.run(d, t);
    db.pragma('user_version = 1');
  })();
  if (dates.length) console.log(`[db] миграция: восстановлены слоты дней (${dates.length} дн.)`);
}

// ШАГ 6. user_version 2: стандарт — только целые часы, у дня храним лишь отличия.
// - нецелые часы (14:30 и т.п.) убираем из общего расписания — их добавляют на конкретный день;
// - из day_slots убираем строки, совпадающие со стандартом, и отключённое нестандартное время.
if (db.pragma('user_version', { simple: true }) < 2) {
  db.transaction(() => {
    const removed = db.prepare("DELETE FROM time_slots WHERE substr(time, 4, 2) <> '00'").run().changes;
    if (removed) console.log(`[db] миграция: из общего расписания убрано нецелых часов: ${removed}`);
    db.exec(`
      DELETE FROM day_slots
      WHERE (is_active = 1 AND time IN (SELECT time FROM time_slots WHERE is_active = 1))
         OR (is_active = 0 AND time NOT IN (SELECT time FROM time_slots WHERE is_active = 1));
    `);
    db.pragma('user_version = 2');
  })();
}

module.exports = db;