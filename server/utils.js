// Утилиты: даты/недели, телефоны, слоты (глобальные и по дате)
const db = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TG_RE = /^@?[a-zA-Z0-9_]{5,32}$/;

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}
// Неделя записи для пользователя: пн–сб. Воскресенье — выходной,
// поэтому в воскресенье открывается уже следующая неделя.
function currentWeekRange(now = new Date()) {
  const base = new Date(now);
  if (base.getDay() === 0) base.setDate(base.getDate() + 1);
  const mon = mondayOf(base);
  const sat = new Date(mon);
  sat.setDate(mon.getDate() + 5);
  return { monday: ymd(mon), saturday: ymd(sat) };
}
function isSunday(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  return new Date(dateStr + 'T00:00:00').getDay() === 0;
}
function isPastDate(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  return dateStr < ymd(new Date());
}
function todayIso() { return ymd(new Date()); }

function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  let d = digits;
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length !== 11 || d[0] !== '7') return null;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}
function maskPhone(phone) {
  if (!phone) return '—';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length !== 11) return phone;
  return `+7 (***) ***-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}
function normalizeTelegram(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!TG_RE.test(t)) return null;
  return t.startsWith('@') ? t : '@' + t;
}

// --- Глобальные слоты ---
function getActiveSlotTimes() {
  return db.prepare(
    'SELECT time FROM time_slots WHERE is_active = 1 ORDER BY sort_order, time'
  ).all().map(r => r.time);
}
function isValidActiveSlot(time) {
  if (!TIME_RE.test(time || '')) return false;
  return !!db.prepare(
    'SELECT 1 FROM time_slots WHERE time = ? AND is_active = 1'
  ).get(time);
}

// --- Эффективные слоты на дату ---
// Стандарт (активные time_slots, целые часы) есть у каждого дня всегда.
// day_slots хранят только отличия дня от стандарта:
//   is_active = 1 → время добавлено на этот день (например, 14:30);
//   is_active = 0 → время отключено на этот день.
function getEffectiveSlotsForDate(date) {
  if (!DATE_RE.test(date || '')) return [];
  const dayRows = db.prepare('SELECT time, is_active FROM day_slots WHERE date = ?').all(date);
  const result = new Set(getActiveSlotTimes());
  for (const r of dayRows) {
    if (r.is_active === 1) result.add(r.time); else result.delete(r.time);
  }
  return Array.from(result).sort();
}

function isValidSlotForDate(date, time) {
  if (!TIME_RE.test(time || '')) return false;
  return getEffectiveSlotsForDate(date).includes(time);
}

module.exports = {
  DATE_RE, TIME_RE, TG_RE,
  pad, ymd, mondayOf, currentWeekRange,
  isSunday, isPastDate, todayIso,
  normalizePhone, maskPhone, normalizeTelegram,
  getActiveSlotTimes, isValidActiveSlot,
  getEffectiveSlotsForDate, isValidSlotForDate
};