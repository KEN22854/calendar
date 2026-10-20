// Бронирования пользователя: текущая неделя (пн–сб), абонемент, слоты на дату
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { archiveOne } = require('../archive');
const {
  DATE_RE,
  currentWeekRange, isSunday, isPastDate,
  normalizePhone, normalizeTelegram, maskPhone,
  getEffectiveSlotsForDate, isValidSlotForDate, todayIso
} = require('../utils');

const router = express.Router();

function getActiveSubscription(userId) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ? AND is_active = 1
    ORDER BY id DESC LIMIT 1
  `).get(userId);
}

router.get('/bookings', requireAuth, (req, res) => {
  const { date } = req.query;
  if (!date || !DATE_RE.test(date)) return res.status(400).json({ error: 'Некорректная дата' });

  if (req.user.role === 'user') {
    const { monday, saturday } = currentWeekRange();
    if (date < monday || date > saturday) {
      return res.status(403).json({ error: 'Доступны только даты текущей недели (пн–сб)' });
    }
  }

  const rows = db.prepare(`
    SELECT b.id, b.time_slot, b.telegram, b.phone, b.user_id, b.subscription_id, b.created_at,
           u.username
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    WHERE b.date = ?
    ORDER BY b.time_slot
  `).all(date);

  // Записи показываем, даже если их время потом убрали из расписания дня
  const slots = Array.from(new Set([...getEffectiveSlotsForDate(date), ...rows.map(r => r.time_slot)])).sort();

  const taken = rows.map(r => {
    const own = r.user_id === req.user.id;
    return {
      time_slot: r.time_slot,
      id: r.id,
      own,
      telegram: r.telegram,
      phone: own ? r.phone : maskPhone(r.phone),
      username: r.username
    };
  });

  res.json({ date, slots, taken });
});

router.post('/bookings', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ error: 'Администратор создаёт брони через админ-панель' });
    }
    const { date, time_slot, telegram, phone } = req.body || {};

    if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'Некорректная дата' });
    if (!isValidSlotForDate(date, time_slot)) {
      return res.status(400).json({ error: 'Этот слот недоступен в выбранный день' });
    }
    if (isSunday(date)) return res.status(400).json({ error: 'Воскресенье — выходной' });
    if (isPastDate(date)) return res.status(400).json({ error: 'Нельзя бронировать прошедшую дату' });

    const { monday, saturday } = currentWeekRange();
    if (date < monday || date > saturday) {
      return res.status(400).json({ error: 'Можно бронировать только текущую неделю (пн–сб)' });
    }

    const tg = normalizeTelegram(telegram);
    if (!tg) return res.status(400).json({ error: 'Некорректный Telegram (5–32 символа)' });
    const ph = normalizePhone(phone);
    if (!ph) return res.status(400).json({ error: 'Некорректный телефон (11 цифр, +7...)' });

    const sub = getActiveSubscription(req.user.id);
    if (!sub || sub.lessons_used >= sub.lessons_total) {
      return res.status(400).json({ error: 'Нет активного абонемента или закончились занятия' });
    }
    if (date < sub.starts_at || date > sub.expires_at) {
      return res.status(400).json({
        error: `Абонемент действует с ${sub.starts_at} по ${sub.expires_at}`
      });
    }

    const tx = db.transaction(() => {
      db.prepare('UPDATE subscriptions SET lessons_used = lessons_used + 1 WHERE id = ?').run(sub.id);
      try {
        const info = db.prepare(`
          INSERT INTO bookings (user_id, subscription_id, date, time_slot, telegram, phone)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(req.user.id, sub.id, date, time_slot, tg, ph);
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
      const bookingId = tx();
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      res.status(201).json({ booking });
    } catch (e) {
      if (e.status === 409) return res.status(409).json({ error: e.message });
      throw e;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/my-bookings', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM bookings WHERE user_id = ?
    ORDER BY date DESC, time_slot ASC
  `).all(req.user.id);
  res.json({ bookings: rows });
});

router.delete('/bookings/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Некорректный id' });

  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ error: 'Бронь не найдена' });
  if (b.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Можно отменять только свои брони' });
  }

  // Отмена не удаляет запись бесследно — она уходит в историю (reason='cancel-user')
  const tx = db.transaction(() => {
    archiveOne(id, 'cancel-user');
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

router.get('/my-subscription', requireAuth, (req, res) => {
  const sub = getActiveSubscription(req.user.id);
  if (!sub) return res.json({ subscription: null });
  res.json({
    subscription: sub,
    remaining: Math.max(0, sub.lessons_total - sub.lessons_used),
    expired: todayIso() > sub.expires_at
  });
});

module.exports = router;