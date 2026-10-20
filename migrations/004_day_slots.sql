-- Миграция v4: переопределения слотов на конкретный день
BEGIN;

CREATE TABLE IF NOT EXISTS day_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, time)
);

CREATE INDEX IF NOT EXISTS idx_day_slots_date ON day_slots(date);

COMMIT;