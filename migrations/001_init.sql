-- Миграция с версии 1 (только users/bookings) до промежуточной схемы v2.
-- ВНИМАНИЕ: выполняется один раз. Дублирующие ALTER вызовут ошибку — не запускайте повторно.
BEGIN;

-- Добавляем role к users
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Создаём subscriptions и archive
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

CREATE TABLE IF NOT EXISTS bookings_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  subscription_id INTEGER,
  date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  telegram TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Добавляем subscription_id к bookings
ALTER TABLE bookings ADD COLUMN subscription_id INTEGER;

COMMIT;