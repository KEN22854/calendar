-- Миграция v3: таблица слотов + поле archive_reason + username в архиве
BEGIN;

CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slots_time ON time_slots(time);

-- Дефолтные слоты, если пусто
INSERT INTO time_slots (time, sort_order, is_active)
SELECT t, (CAST(substr(t,1,2) AS INTEGER) * 60 + CAST(substr(t,4,2) AS INTEGER)), 1
FROM (SELECT '09:00' t UNION ALL SELECT '10:00' UNION ALL SELECT '11:00' UNION ALL SELECT '12:00'
      UNION ALL SELECT '13:00' UNION ALL SELECT '14:00' UNION ALL SELECT '15:00' UNION ALL SELECT '16:00'
      UNION ALL SELECT '17:00' UNION ALL SELECT '18:00' UNION ALL SELECT '19:00' UNION ALL SELECT '20:00')
WHERE (SELECT COUNT(*) FROM time_slots) = 0;

-- Добавляем поля в архив (если их нет — SQLite не поддерживает IF NOT EXISTS для ALTER, поэтому
-- эти ALTER-ы нужно применять на пустой / старой схеме. Для уже мигрированной БД — пропустить вручную.)
-- ALTER TABLE bookings_archive ADD COLUMN username TEXT;
-- ALTER TABLE bookings_archive ADD COLUMN archive_reason TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_archive_reason ON bookings_archive(archive_reason);

COMMIT;