// Архивация броней: копия в bookings_archive + удаление из bookings.
// Используется cron-задачами, ручной архивацией и отменами (история не теряется).
const db = require('./db');
const { todayIso } = require('./utils');

const REASONS = ['past-day', 'sunday', 'manual', 'cancel-user', 'cancel-admin'];

const insertStmt = db.prepare(`
  INSERT INTO bookings_archive
    (booking_id, user_id, username, subscription_id, date, time_slot, telegram, phone, created_at, archive_reason)
  SELECT b.id, b.user_id, u.username, b.subscription_id, b.date, b.time_slot, b.telegram, b.phone, b.created_at, ?
  FROM bookings b LEFT JOIN users u ON u.id = b.user_id
  WHERE b.id = ?
`);
const deleteStmt = db.prepare('DELETE FROM bookings WHERE id = ?');

// Без собственной транзакции — вызывать внутри db.transaction или через archiveBookings
function archiveOne(bookingId, reason) {
  insertStmt.run(reason, bookingId);
  deleteStmt.run(bookingId);
}

function archiveBookings(rows, reason) {
  if (!rows.length) return 0;
  db.transaction(() => { for (const r of rows) archiveOne(r.id, reason); })();
  return rows.length;
}

// Все брони с датой раньше сегодняшней уходят в архив
function archivePastBookings(reason = 'past-day') {
  const rows = db.prepare('SELECT id FROM bookings WHERE date < ?').all(todayIso());
  const n = archiveBookings(rows, reason);
  if (n) console.log(`[archive:${reason}] прошедшие брони заархивированы: ${n}`);
  return n;
}

module.exports = { REASONS, archiveOne, archiveBookings, archivePastBookings };
