// Слоты: глобальные (time_slots) + переопределения на день (day_slots)
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { TIME_RE, DATE_RE, getEffectiveSlotsForDate } = require('../utils');

const router = express.Router();

// Общее (стандартное) расписание — только целые часы.
// Нестандартное время (14:30 и т.п.) добавляется поверх на конкретный день (day_slots).
const HOUR_RE = /^([01]\d|2[0-3]):00$/;
const HOUR_ONLY_ERROR = 'В общем расписании только целые часы (например, 14:00). ' +
  'Время вроде 14:30 добавляйте на нужный день через ⚙ в календаре';

function sortKey(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// ============================================================
// Публичные / пользовательские
// ============================================================

// GET /api/slots — если передан date → эффективные слоты на дату.
// Без date — активные глобальные (для обратной совместимости).
router.get('/slots', (req, res) => {
  const { date } = req.query;
  if (date) {
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Некорректная дата' });
    const times = getEffectiveSlotsForDate(date);
    return res.json({ slots: times.map(t => ({ time: t })), source: 'effective' });
  }
  const rows = db.prepare(
    'SELECT id, time, sort_order FROM time_slots WHERE is_active = 1 ORDER BY sort_order, time'
  ).all();
  res.json({ slots: rows, source: 'global' });
});

// ============================================================
// Админ: глобальные слоты (справочник)
// ============================================================
router.get('/admin/slots', requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM time_slots ORDER BY sort_order, time').all();
  res.json({ slots: rows });
});

router.post('/admin/slots', requireAuth, requireAdmin, (req, res) => {
  const { time } = req.body || {};
  if (!TIME_RE.test(time || '')) {
    return res.status(400).json({ error: 'Некорректное время. Формат HH:MM (00:00–23:59)' });
  }
  if (!HOUR_RE.test(time)) return res.status(400).json({ error: HOUR_ONLY_ERROR });
  const exists = db.prepare('SELECT id FROM time_slots WHERE time = ?').get(time);
  if (exists) return res.status(409).json({ error: 'Слот с таким временем уже существует' });

  const info = db.prepare('INSERT INTO time_slots (time, sort_order, is_active) VALUES (?, ?, 1)')
    .run(time, sortKey(time));
  res.status(201).json({ slot: db.prepare('SELECT * FROM time_slots WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/admin/slots/:id(\\d+)', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  const slot = db.prepare('SELECT * FROM time_slots WHERE id = ?').get(id);
  if (!slot) return res.status(404).json({ error: 'Слот не найден' });

  const { time, is_active } = req.body || {};
  const updates = [], params = [];
  if (time != null) {
    if (!TIME_RE.test(time)) return res.status(400).json({ error: 'Формат времени HH:MM' });
    if (!HOUR_RE.test(time)) return res.status(400).json({ error: HOUR_ONLY_ERROR });
    const clash = db.prepare('SELECT id FROM time_slots WHERE time = ? AND id <> ?').get(time, id);
    if (clash) return res.status(409).json({ error: 'Слот с таким временем уже существует' });
    updates.push('time = ?'); params.push(time);
    updates.push('sort_order = ?'); params.push(sortKey(time));
  }
  if (typeof is_active === 'boolean') {
    updates.push('is_active = ?'); params.push(is_active ? 1 : 0);
  }
  if (!updates.length) return res.status(400).json({ error: 'Нет полей для обновления' });
  params.push(id);
  db.prepare(`UPDATE time_slots SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ slot: db.prepare('SELECT * FROM time_slots WHERE id = ?').get(id) });
});

router.delete('/admin/slots/:id(\\d+)', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  const info = db.prepare('DELETE FROM time_slots WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Слот не найден' });
  res.json({ ok: true });
});

// ============================================================
// Админ: время на конкретный день (day_slots)
// ============================================================
// Стандартные часы (time_slots) есть у каждого дня всегда — их можно только отключить на день.
// Нестандартное время (14:30 и т.п.) добавляется на один день и свободно удаляется.
// В day_slots лежат только отличия дня от стандарта, поэтому правка одного дня
// не влияет на другие, а изменения общего расписания сразу видны во всех днях.
// Все мутации возвращают актуальное состояние дня — клиент обновляет окно сразу.

const MAX_EXTRA_PER_DAY = 48;

function globalActiveTimes() {
  return db.prepare('SELECT time FROM time_slots WHERE is_active = 1 ORDER BY sort_order, time')
    .all().map(r => r.time);
}

function bookingAt(date, time) {
  return db.prepare(`
    SELECT b.id, u.username FROM bookings b JOIN users u ON u.id = b.user_id
    WHERE b.date = ? AND b.time_slot = ?
  `).get(date, time);
}

function dayState(date) {
  const standard = globalActiveTimes();
  const rows = db.prepare('SELECT time, is_active FROM day_slots WHERE date = ?').all(date);
  const byTime = new Map();
  for (const t of standard) byTime.set(t, { time: t, standard: true, is_active: 1 });
  for (const r of rows) {
    const s = byTime.get(r.time) || { time: r.time, standard: false };
    s.is_active = r.is_active;
    byTime.set(r.time, s);
  }
  // Убираем «пустые» строки: нестандартное время, которое отключено, не показываем
  const slots = Array.from(byTime.values()).filter(s => s.standard || s.is_active);

  // Брони прикрепляем к слотам; бронь на время вне расписания тоже показываем
  const bookings = db.prepare(`
    SELECT b.id, b.time_slot, u.username FROM bookings b JOIN users u ON u.id = b.user_id
    WHERE b.date = ?
  `).all(date);
  for (const b of bookings) {
    let s = slots.find(x => x.time === b.time_slot);
    if (!s) { s = { time: b.time_slot, standard: false, is_active: 0, orphan: true }; slots.push(s); }
    s.booking = { id: b.id, username: b.username };
  }
  slots.sort((a, b) => a.time.localeCompare(b.time));
  const changed = slots.some(s => (s.standard && !s.is_active) || (!s.standard && s.is_active));
  return { date, changed, slots, effective: getEffectiveSlotsForDate(date) };
}

function sendError(res, e) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  throw e;
}
function httpError(status, message) {
  const e = new Error(message); e.status = status; return e;
}

router.get('/admin/slots/day', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.query;
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Некорректная дата' });
  res.json(dayState(date));
});

// Добавить / включить / отключить время на один день: { date, time, is_active? }
router.post('/admin/slots/day', requireAuth, requireAdmin, (req, res) => {
  const { date, time, is_active } = req.body || {};
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Некорректная дата' });
  if (!TIME_RE.test(time || '')) return res.status(400).json({ error: 'Формат времени HH:MM (например, 14:30)' });
  const active = is_active === false ? 0 : 1;
  const isStandard = globalActiveTimes().includes(time);

  try {
    db.transaction(() => {
      if (!active && bookingAt(date, time)) {
        throw httpError(409, `На ${time} есть запись — сначала отмените её`);
      }
      // Стандартный час в обычном состоянии (включён) — отличие не храним
      if (isStandard && active) {
        db.prepare('DELETE FROM day_slots WHERE date = ? AND time = ?').run(date, time);
        return;
      }
      const existing = db.prepare('SELECT id FROM day_slots WHERE date = ? AND time = ?').get(date, time);
      if (existing) {
        db.prepare('UPDATE day_slots SET is_active = ? WHERE id = ?').run(active, existing.id);
        return;
      }
      const count = db.prepare('SELECT COUNT(*) AS c FROM day_slots WHERE date = ? AND is_active = 1').get(date).c;
      if (active && count >= MAX_EXTRA_PER_DAY) throw httpError(400, 'Слишком много дополнительного времени на один день');
      db.prepare('INSERT INTO day_slots (date, time, is_active) VALUES (?, ?, ?)').run(date, time, active);
    })();
  } catch (e) { return sendError(res, e); }
  res.json(dayState(date));
});

// Удалить добавленное время из дня: DELETE /admin/slots/day?date=...&time=...
router.delete('/admin/slots/day', requireAuth, requireAdmin, (req, res) => {
  const { date, time } = req.query;
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Некорректная дата' });
  if (!TIME_RE.test(time || '')) return res.status(400).json({ error: 'Формат времени HH:MM' });
  if (globalActiveTimes().includes(time)) {
    return res.status(400).json({ error: 'Стандартный час нельзя удалить — его можно отключить на этот день' });
  }
  if (bookingAt(date, time)) {
    return res.status(409).json({ error: `На ${time} есть запись — сначала отмените её` });
  }
  db.prepare('DELETE FROM day_slots WHERE date = ? AND time = ?').run(date, time);
  res.json(dayState(date));
});

// Вернуть дню стандартное расписание (убрать все отличия)
router.post('/admin/slots/day/reset', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body || {};
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Некорректная дата' });
  db.prepare('DELETE FROM day_slots WHERE date = ?').run(date);
  res.json(dayState(date));
});

module.exports = router;
