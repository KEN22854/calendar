// Точка входа: Express, seed админа, cron-архивация прошедших дней
require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { archivePastBookings } = require('./archive');

const authRoutes = require('./routes/auth.routes');
const bookingRoutes = require('./routes/bookings.routes');
const subscriptionRoutes = require('./routes/subscriptions.routes');
const adminRoutes = require('./routes/admin.routes');
const slotRoutes = require('./routes/slots.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

app.use('/api', authRoutes);
app.use('/api', bookingRoutes);
app.use('/api', subscriptionRoutes);
app.use('/api', adminRoutes);
app.use('/api', slotRoutes);

// HTML-страницы
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'index.html')));
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'login.html')));
app.get('/register', (_req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'register.html')));
app.get('/my-bookings', (_req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'my-bookings.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'admin.html')));

// --- Архивация прошедших дней ---
// Брони с date < сегодня переносятся в bookings_archive и удаляются из bookings:
// на сайте видны только сегодня+будущее, а полная история остаётся в разделе «История».
// Воскресенье — выходной, поэтому в вс архивируется вся прошедшая неделя (reason='sunday').
// Будущие брони (например, созданные админом на следующую неделю) не трогаются.
function nightlyArchive() {
  const isSunday = new Date().getDay() === 0;
  archivePastBookings(isSunday ? 'sunday' : 'past-day');
}
cron.schedule('1 0 * * *', nightlyArchive, { timezone: 'Europe/Moscow' });
// Стартовая догоняющая проверка (если сервер был выключен в полночь)
nightlyArchive();

// Seed администратора
async function seedAdmin() {
  if (String(process.env.SEED_ADMIN).toLowerCase() !== 'true') return;
  const login = (process.env.ADMIN_LOGIN || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!login || !password) {
    console.warn('[seed] SEED_ADMIN=true, но ADMIN_LOGIN/ADMIN_PASSWORD не заданы — пропуск');
    return;
  }
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) { console.log('[seed] администратор уже существует'); return; }
  const hash = await bcrypt.hash(password, 10);
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(login);
  if (exists) {
    db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?").run(hash, exists.id);
    console.log(`[seed] ${login} повышен до администратора`);
  } else {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(login, hash);
    console.log(`[seed] администратор ${login} создан`);
  }
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

seedAdmin().finally(() => {
  app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
});