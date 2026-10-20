// Админские CRUD-операции над абонементами
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { DATE_RE, ymd } = require('../utils');

const router = express.Router();

// Расчёт expires_at (последний день действия, включительно): месяц от starts_at.
// 01.10 → 31.10, 15.10 → 14.11. Локальная дата, без toISOString (сдвиг по UTC).
function addOneMonth(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const daysInNext = new Date(y, m + 1, 0).getDate();
  const end = new Date(y, m, Math.min(d, daysInNext));
  end.setDate(end.getDate() - 1);
  return ymd(end);
}

// GET /api/admin/subscriptions
router.get('/admin/subscriptions', requireAuth, requireAdmin, (req, res) => {
  const { status, type, user_id } = req.query;
  let sql = `
    SELECT s.*, u.username
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE 1=1
  `;
  const params = [];
  if (status === 'active') { sql += ' AND s.is_active = 1'; }
  if (status === 'inactive') { sql += ' AND s.is_active = 0'; }
  if (type && ['4','8','12'].includes(type)) { sql += ' AND s.type = ?'; params.push(type); }
  if (user_id) { sql += ' AND s.user_id = ?'; params.push(Number(user_id)); }
  sql += ' ORDER BY s.id DESC';
  res.json({ subscriptions: db.prepare(sql).all(...params) });
});

// POST /api/admin/subscriptions — назначить
// Один активный абонемент на пользователя: деактивируем прежние
router.post('/admin/subscriptions', requireAuth, requireAdmin, (req, res) => {
  try {
    const { user_id, type, starts_at } = req.body || {};
    if (!['4','8','12'].includes(String(type))) {
      return res.status(400).json({ error: 'Некорректный тип абонемента (4/8/12)' });
    }
    if (!DATE_RE.test(starts_at || '')) {
      return res.status(400).json({ error: 'Некорректная дата начала' });
    }
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(user_id));
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const lessons_total = Number(type);
    const expires_at = addOneMonth(starts_at);

    const tx = db.transaction(() => {
      db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1')
        .run(user.id);
      const info = db.prepare(`
        INSERT INTO subscriptions
          (user_id, type, lessons_total, lessons_used, is_active, starts_at, expires_at, created_by)
        VALUES (?, ?, ?, 0, 1, ?, ?, ?)
      `).run(user.id, String(type), lessons_total, starts_at, expires_at, req.user.id);
      return info.lastInsertRowid;
    });
    const id = tx();

    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
    res.status(201).json({ subscription: sub });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PATCH /api/admin/subscriptions/:id — изменить/деактивировать
router.patch('/admin/subscriptions/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  if (!sub) return res.status(404).json({ error: 'Абонемент не найден' });

  const { is_active, lessons_total, lessons_used, expires_at } = req.body || {};
  const updates = [];
  const params = [];
  const total = Number.isInteger(lessons_total) ? lessons_total : sub.lessons_total;
  if (Number.isInteger(lessons_used) && lessons_used > total) {
    return res.status(400).json({ error: 'Использовано не может быть больше, чем всего занятий' });
  }
  if (expires_at != null) {
    if (!DATE_RE.test(expires_at)) return res.status(400).json({ error: 'Некорректная дата окончания' });
    updates.push('expires_at = ?'); params.push(expires_at);
  }
  if (typeof is_active === 'boolean') { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (Number.isInteger(lessons_total) && lessons_total > 0) { updates.push('lessons_total = ?'); params.push(lessons_total); }
  if (Number.isInteger(lessons_used) && lessons_used >= 0) { updates.push('lessons_used = ?'); params.push(lessons_used); }
  if (!updates.length) return res.status(400).json({ error: 'Нет полей для обновления' });
  params.push(id);
  db.prepare(`UPDATE subscriptions SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  res.json({ subscription: updated });
});

// DELETE /api/admin/subscriptions/:id — деактивировать
router.delete('/admin/subscriptions/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });
  const info = db.prepare('UPDATE subscriptions SET is_active = 0 WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Абонемент не найден' });
  res.json({ ok: true });
});

module.exports = router;