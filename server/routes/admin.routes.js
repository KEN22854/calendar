// Админские маршруты: брони, ручное создание, архив, пользователи, экспорт
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { REASONS, archiveOne, archivePastBookings } = require('../archive');
const {
  DATE_RE, normalizePhone, normalizeTelegram,
  isValidSlotForDate, todayIso
} = require('../utils');

const router = express.Router();

// --- GET /api/admin/bookings (фильтры, пагинация) ---
router.get('/admin/bookings', requireAuth, requireAdmin, (req, res) => {
  const { from, to, user, subscription_id, page = '1', limit = '50', sort = 'date', dir = 'desc' } = req.query;
  const allowedSort = new Set(['id','date','time_slot','username','created_at']);
  const sortCol = allowedSort.has(sort) ? sort : 'date';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [], params = [];
  if (from && DATE_RE.test(from)) { where.push('b.date >= ?'); params.push(from); }
  if (to && DATE_RE.test(to)) { where.push('b.date <= ?'); params.push(to); }
  if (user) { where.push('u.username LIKE ?'); params.push(`%${user}%`); }
  if (subscription_id) { where.push('b.subscription_id = ?'); params.push(Number(subscription_id)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM bookings b JOIN users u ON u.id = b.user_id ${whereSql}`
  ).get(...params).c;

  const lim = Math.min(2000, Math.max(1, Number(limit) || 50));
  const p = Math.max(1, Number(page) || 1);
  const offset = (p - 1) * lim;

  const rows = db.prepare(`
    SELECT b.*, u.username, s.type AS sub_type, s.lessons_used, s.lessons_total
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    LEFT JOIN subscriptions s ON s.id = b.subscription_id
    ${whereSql}
    ORDER BY ${sortCol === 'username' ? 'u.username' : 'b.' + sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, lim, offset);

  res.json({ bookings: rows, total, page: p, limit: lim });
});

// --- POST /api/admin/bookings — создать бронь вручную ---
// Админ может поставить бронь ЛЮБОМУ пользователю, на любую дату.
// Валидация слота — по эффективным слотам выбранной даты (day_slots или глобальные).
router.post('/admin/bookings', requireAuth, requireAdmin, (req, res) => {
  try {
    const { user_id, date, time_slot, telegram, phone, use_subscription } = req.body || {};

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(user_id));
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Некорректная дата' });
    if (!isValidSlotForDate(date, time_slot)) {
      return res.status(400).json({ error: 'Этот слот недоступен в выбранный день' });
    }

    const tg = normalizeTelegram(telegram);
    if (!tg) return res.status(400).json({ error: 'Некорректный Telegram (5–32 символа)' });
    const ph = normalizePhone(phone);
    if (!ph) return res.status(400).json({ error: 'Некорректный телефон (11 цифр, +7...)' });

    let sub = null;
    if (use_subscription !== false) {
      sub = db.prepare(`
        SELECT * FROM subscriptions
        WHERE user_id = ? AND is_active = 1
        ORDER BY id DESC LIMIT 1
      `).get(user.id);
      if (sub && (sub.lessons_used >= sub.lessons_total || date < sub.starts_at || date > sub.expires_at)) sub = null;
    }

    const tx = db.transaction(() => {
      if (sub) {
        db.prepare('UPDATE subscriptions SET lessons_used = lessons_used + 1 WHERE id = ?').run(sub.id);
      }
      try {
        const info = db.prepare(`
          INSERT INTO bookings (user_id, subscription_id, date, time_slot, telegram, phone)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(user.id, sub ? sub.id : null, date, time_slot, tg, ph);
        return info.lastInsertRowid;
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
          const err = new Error('Это время уже занято');
          err.status = 409;
          throw err;
        }
        throw e;
      }
    });

    try {
      const id = tx();
      const booking = db.prepare(`
        SELECT b.*, u.username FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?
      `).get(id);
      res.status(201).json({ booking, subscription_used: !!sub });
    } catch (e) {
      if (e.status === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// --- POST /api/admin/archive/past — вручную заархивировать прошедшие брони ---
router.post('/admin/archive/past', requireAuth, requireAdmin, (_req, res) => {
  res.json({ archived: archivePastBookings('manual') });
});

// --- GET /api/admin/bookings/archive ---
router.get('/admin/bookings/archive', requireAuth, requireAdmin, (req, res) => {
  const { page = '1', limit = '50', reason, from, to, user } = req.query;
  const where = [], params = [];
  if (reason && REASONS.includes(reason)) {
    where.push('a.archive_reason = ?'); params.push(reason);
  }
  if (from && DATE_RE.test(from)) { where.push('a.date >= ?'); params.push(from); }
  if (to && DATE_RE.test(to)) { where.push('a.date <= ?'); params.push(to); }
  if (user) { where.push('a.username LIKE ?'); params.push(`%${user}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM bookings_archive a ${whereSql}`).get(...params).c;
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const p = Math.max(1, Number(page) || 1);
  const offset = (p - 1) * lim;

  const rows = db.prepare(`
    SELECT a.* FROM bookings_archive a ${whereSql}
    ORDER BY a.archived_at DESC, a.date DESC LIMIT ? OFFSET ?
  `).all(...params, lim, offset);

  res.json({ bookings: rows, total, page: p, limit: lim });
});

// --- DELETE /api/admin/bookings/:id — удалить с возвратом занятия ---
router.delete('/admin/bookings/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ error: 'Бронь не найдена' });

  // Запись уходит в историю (reason='cancel-admin'), занятие возвращается в абонемент
  const tx = db.transaction(() => {
    archiveOne(id, 'cancel-admin');
    if (b.subscription_id) {
      const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(b.subscription_id);
      if (sub && sub.lessons_used > 0) {
        db.prepare('UPDATE subscriptions SET lessons_used = lessons_used - 1 WHERE id = ?').run(sub.id);
      }
    }
  });
  tx();
  res.json({ ok: true });
});

// --- GET /api/admin/history — вся история записей (активные + архив) ---
// status: active | done (прошедшие/архив по дате) | cancelled | all
// Используется и календарём истории, и списком.
const HISTORY_SQL = `
  SELECT 'b' || b.id AS key, b.id AS booking_id, b.user_id, u.username, b.subscription_id,
         b.date, b.time_slot, b.telegram, b.phone, b.created_at,
         NULL AS archived_at, NULL AS archive_reason,
         CASE WHEN b.date < @today THEN 'done' ELSE 'active' END AS status
  FROM bookings b LEFT JOIN users u ON u.id = b.user_id
  UNION ALL
  SELECT 'a' || a.id, a.booking_id, a.user_id, COALESCE(a.username, u.username), a.subscription_id,
         a.date, a.time_slot, a.telegram, a.phone, a.created_at,
         a.archived_at, a.archive_reason,
         CASE WHEN a.archive_reason LIKE 'cancel-%' THEN 'cancelled' ELSE 'done' END
  FROM bookings_archive a LEFT JOIN users u ON u.id = a.user_id
`;

// Общие фильтры истории (from/to/user/status) → FROM ... WHERE + именованные параметры
function historyFilter(query) {
  const { from, to, user, status } = query;
  const where = [], params = { today: todayIso() };
  if (from && DATE_RE.test(from)) { where.push('h.date >= @from'); params.from = from; }
  if (to && DATE_RE.test(to)) { where.push('h.date <= @to'); params.to = to; }
  if (user) { where.push('h.username LIKE @user'); params.user = `%${user}%`; }
  if (['active', 'done', 'cancelled'].includes(status)) { where.push('h.status = @status'); params.status = status; }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const base = `FROM (${HISTORY_SQL}) h LEFT JOIN subscriptions s ON s.id = h.subscription_id ${whereSql}`;
  return { base, params };
}

router.get('/admin/history', requireAuth, requireAdmin, (req, res) => {
  const { page = '1', limit = '50', dir = 'desc' } = req.query;
  const { base, params } = historyFilter(req.query);
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) AS c ${base}`).get(params).c;
  const stats = db.prepare(`SELECT h.status, COUNT(*) AS c ${base} GROUP BY h.status`).all(params);

  const lim = Math.min(5000, Math.max(1, Number(limit) || 50));
  const p = Math.max(1, Number(page) || 1);
  const rows = db.prepare(`
    SELECT h.*, s.type AS sub_type ${base}
    ORDER BY h.date ${sortDir}, h.time_slot ${sortDir}, h.key
    LIMIT @lim OFFSET @off
  `).all({ ...params, lim, off: (p - 1) * lim });

  res.json({
    items: rows, total, page: p, limit: lim,
    stats: Object.fromEntries(stats.map(r => [r.status, r.c]))
  });
});

// --- GET /api/admin/history.csv — выгрузка истории с теми же фильтрами ---
router.get('/admin/history.csv', requireAuth, requireAdmin, (req, res) => {
  const { base, params } = historyFilter(req.query);
  const rows = db.prepare(
    `SELECT h.*, s.type AS sub_type ${base} ORDER BY h.date DESC, h.time_slot DESC`
  ).all(params);

  const statusLabel = { active: 'Запланировано', done: 'Прошло', cancelled: 'Отменено' };
  const header = ['ID брони','Дата','Время','Пользователь','Telegram','Телефон','Абонемент','Статус','Причина архивации','Создана','Заархивирована'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([r.booking_id, r.date, r.time_slot, r.username, r.telegram, r.phone, r.sub_type || '',
      statusLabel[r.status], r.archive_reason || '', r.created_at, r.archived_at || '']
      .map(csvEscape).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="history.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --- GET /api/admin/users ---
router.get('/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at,
           (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id) AS bookings_count,
           (SELECT id FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1
            ORDER BY s.id DESC LIMIT 1) AS active_sub_id,
           (SELECT type FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1
            ORDER BY s.id DESC LIMIT 1) AS active_sub_type,
           (SELECT lessons_total FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1
            ORDER BY s.id DESC LIMIT 1) AS active_sub_total,
           (SELECT lessons_used FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1
            ORDER BY s.id DESC LIMIT 1) AS active_sub_used,
           (SELECT expires_at FROM subscriptions s WHERE s.user_id = u.id AND s.is_active = 1
            ORDER BY s.id DESC LIMIT 1) AS active_sub_expires
    FROM users u ORDER BY u.id DESC
  `).all();
  res.json({ users: rows });
});

// --- GET /api/admin/export.csv ---
router.get('/admin/export.csv', requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.date, b.time_slot, u.username, b.telegram, b.phone,
           s.type AS sub_type, b.created_at
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    LEFT JOIN subscriptions s ON s.id = b.subscription_id
    ORDER BY b.date DESC, b.time_slot DESC
  `).all();

  const header = ['ID','Дата','Время','Пользователь','Telegram','Телефон','Абонемент','Создана'];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([r.id, r.date, r.time_slot, r.username, r.telegram, r.phone, r.sub_type || '', r.created_at]
      .map(escape).join(';'));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
  res.send(csv);
});

module.exports = router;