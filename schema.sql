-- Полная схема BookCal v4
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
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

-- Переопределения слотов на конкретную дату.
-- Если для даты есть хотя бы одна строка → используются только активные day_slots.
-- Если строк нет → используются глобальные time_slots.
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

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_active ON subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_archive_date ON bookings_archive(date);
CREATE INDEX IF NOT EXISTS idx_archive_reason ON bookings_archive(archive_reason);
CREATE INDEX IF NOT EXISTS idx_slots_time ON time_slots(time);
CREATE INDEX IF NOT EXISTS idx_day_slots_date ON day_slots(date);

INSERT INTO time_slots (time, sort_order, is_active)
SELECT t, (CAST(substr(t,1,2) AS INTEGER) * 60 + CAST(substr(t,4,2) AS INTEGER)), 1
FROM (SELECT '09:00' t UNION ALL SELECT '10:00' UNION ALL SELECT '11:00' UNION ALL SELECT '12:00'
      UNION ALL SELECT '13:00' UNION ALL SELECT '14:00' UNION ALL SELECT '15:00' UNION ALL SELECT '16:00'
      UNION ALL SELECT '17:00' UNION ALL SELECT '18:00' UNION ALL SELECT '19:00' UNION ALL SELECT '20:00')
WHERE (SELECT COUNT(*) FROM time_slots) = 0;