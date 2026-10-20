// Общие утилиты фронтенда
(function (global) {
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

  // Понедельник недели, содержащей date
  function mondayOf(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return d;
  }

  // Массив дат недели записи пн–вс (7 дней, вс помечается как выходной).
  // В воскресенье показываем следующую неделю — текущая уже прошла.
  function currentWeek(now = new Date()) {
    const base = new Date(now);
    if (base.getDay() === 0) base.setDate(base.getDate() + 1);
    const mon = mondayOf(base);
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      arr.push({ date: ymd(d), dayNum: d.getDate(), isSunday: d.getDay() === 0 });
    }
    return arr;
  }

  function formatDateRu(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function maskPhone(phone) {
    if (!phone) return '—';
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length !== 11) return phone;
    return `+7 (***) ***-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }

  function todayIso() { return ymd(new Date()); }

  // Экранирование для вставки в innerHTML
  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Баннер абонемента (общий для календаря и «Моих записей»)
  function subBannerHtml(data) {
    const s = data.subscription;
    if (!s) return { cls: 'sub-banner empty', html: 'У вас пока нет абонемента — обратитесь к администратору школы' };
    if (data.expired) {
      return { cls: 'sub-banner empty', html: `Абонемент на ${s.lessons_total} занятий истёк ${formatDateRu(s.expires_at)} — обратитесь к администратору` };
    }
    return {
      cls: 'sub-banner',
      html: `<span class="sub-badge">${s.lessons_total} занятий / мес</span>
        <span>Осталось занятий: <b>${data.remaining}</b> из ${s.lessons_total}</span>
        <span class="muted">действует по ${formatDateRu(s.expires_at)}</span>`
    };
  }

  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  // Дни ровно одного месяца: с 1-го по последнее число (28/29/30/31 — считает сам Date,
  // включая високосный февраль). lead — сколько пустых клеток поставить перед 1-м числом,
  // чтобы оно попало под свой день недели (неделя с понедельника).
  function monthDays(year, month) {
    const count = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let d = 1; d <= count; d++) days.push(`${year}-${pad(month + 1)}-${pad(d)}`);
    return { days, lead: (new Date(year, month, 1).getDay() + 6) % 7 };
  }

  // Сдвиг месяца: { year, month } → соседний месяц
  function shiftMonth(year, month, delta) {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  // Шапка месяца: «← Сентябрь | Октябрь 2026 | Ноябрь →» — сразу видно, куда переключаешь
  function monthNavHtml(year, month, prefix) {
    const prev = shiftMonth(year, month, -1), next = shiftMonth(year, month, 1);
    const now = new Date();
    const isCurrent = now.getFullYear() === year && now.getMonth() === month;
    return `
      <div class="month-nav">
        <button class="btn" id="${prefix}-prev">← ${MONTHS[prev.month]}${prev.year !== year ? ' ' + prev.year : ''}</button>
        <div class="calendar-title">${MONTHS[month]} ${year}</div>
        <button class="btn" id="${prefix}-next">${MONTHS[next.month]}${next.year !== year ? ' ' + next.year : ''} →</button>
        ${isCurrent ? '' : `<button class="btn btn-ghost" id="${prefix}-today">К текущему месяцу</button>`}
      </div>`;
  }

  global.U = {
    pad, ymd, mondayOf, currentWeek, formatDateRu, maskPhone, todayIso, esc, MONTHS,
    monthDays, shiftMonth, monthNavHtml, subBanner: subBannerHtml
  };
})(window);