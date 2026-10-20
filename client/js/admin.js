// Админ-панель: Календарь / Список / История (аудит) / Пользователи / Абонементы / Слоты
(function () {
  if (!requireAdminPage()) return;
  renderHeader({ showAdmin: true, active: 'admin' });

  const main = document.getElementById('admin-main');
  const loading = document.getElementById('loading');
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const tabs = document.getElementById('admin-nav');

  function closeModal() { modal.classList.remove('show'); }
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  async function run(fn) {
    loading.classList.add('show');
    try { await fn(); }
    catch (e) { toast(e.message, 'error'); }
    finally { loading.classList.remove('show'); }
  }

  function renderAdminBookingModal(b) {
    modalBody.innerHTML = `
      <h3>Бронь #${b.id}</h3>
      <div class="modal-info">
        <span>Дата · время</span><b>${U.formatDateRu(b.date)} · ${b.time_slot}</b>
        <span>Пользователь</span><b>@${b.username} (ID ${b.user_id})</b>
        <span>Telegram</span><b>${b.telegram}</b>
        <span>Телефон</span><b>${b.phone}</b>
        <span>Абонемент</span><b>${b.sub_type ? `${b.sub_type} занятий · ${b.lessons_used}/${b.lessons_total}` : '—'}</b>
        <span>Создана</span><b>${b.created_at}</b>
      </div>
      <div class="form-actions">
        <button class="btn" id="modal-close">Закрыть</button>
        <button class="btn btn-danger" id="modal-delete">Отменить запись</button>
      </div>
    `;
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-delete').onclick = async () => {
      if (!confirm('Отменить запись? Занятие вернётся в абонемент, запись останется в истории.')) return;
      try {
        await API.request(`/api/admin/bookings/${b.id}`, { method: 'DELETE', auth: true });
        toast('Запись отменена', 'success');
        closeModal();
        refreshCurrentTab();
      } catch (e) { toast(e.message, 'error'); }
    };
    modal.classList.add('show');
  }

  function openCreateBookingModal(preset = {}) {
    Promise.all([
      API.request('/api/admin/users', { auth: true }),
      API.request('/api/slots?date=' + (preset.date || U.todayIso()))
    ]).then(([usersData, slotsData]) => {
      const users = usersData.users;
      const slots = slotsData.slots;
      modalBody.innerHTML = `
        <h3>Создать бронь вручную</h3>
        <form id="create-booking-form">
          <div class="field"><label>Пользователь</label>
            <select class="input" id="cb-user">
              ${users.map(u => `<option value="${u.id}" ${preset.user_id === u.id ? 'selected' : ''}>@${u.username} (ID ${u.id})</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Дата (можно воскресенье или прошедшую)</label>
            <input class="input" type="date" id="cb-date" value="${preset.date || U.todayIso()}" required />
          </div>
          <div class="field"><label>Слот</label>
            <select class="input" id="cb-slot">
              ${slots.map(s => `<option value="${s.time}" ${preset.time_slot === s.time ? 'selected' : ''}>${s.time}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Telegram</label>
            <input class="input" id="cb-tg" type="text" placeholder="@nickname" value="${preset.telegram || ''}" required />
          </div>
          <div class="field"><label>Телефон</label>
            <input class="input" id="cb-phone" type="tel" placeholder="+7 (___) ___-__-__" value="${preset.phone || ''}" required />
          </div>
          <div class="field">
            <label><input type="checkbox" id="cb-use-sub" checked /> Списать занятие с абонемента (если есть)</label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="cb-cancel">Отмена</button>
            <button type="submit" class="btn btn-primary">Создать</button>
          </div>
        </form>
      `;
      document.getElementById('cb-cancel').onclick = closeModal;
      // Слоты зависят от даты (у дня могут быть свои окна) — перезагружаем при смене даты
      document.getElementById('cb-date').addEventListener('change', async (ev) => {
        try {
          const r = await API.request('/api/slots?date=' + ev.target.value);
          document.getElementById('cb-slot').innerHTML =
            r.slots.map(s => `<option value="${s.time}">${s.time}</option>`).join('') ||
            '<option value="" disabled selected>Нет окон в этот день</option>';
        } catch (err) { toast(err.message, 'error'); }
      });
      const phone = document.getElementById('cb-phone');
      phone.addEventListener('input', () => {
        let d = phone.value.replace(/\D/g, '');
        if (d.startsWith('8')) d = '7' + d.slice(1);
        if (!d.startsWith('7')) d = '7' + d;
        d = d.slice(0, 11);
        let out = '+7';
        if (d.length > 1) out += ` (${d.slice(1, 4)}`;
        if (d.length >= 4) out += `) ${d.slice(4, 7)}`;
        if (d.length >= 7) out += `-${d.slice(7, 9)}`;
        if (d.length >= 9) out += `-${d.slice(9, 11)}`;
        phone.value = out;
      });
      document.getElementById('create-booking-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const body = {
            user_id: Number(document.getElementById('cb-user').value),
            date: document.getElementById('cb-date').value,
            time_slot: document.getElementById('cb-slot').value,
            telegram: document.getElementById('cb-tg').value.trim(),
            phone: phone.value.trim(),
            use_subscription: document.getElementById('cb-use-sub').checked
          };
          const r = await API.request('/api/admin/bookings', { method: 'POST', auth: true, body });
          toast(r.subscription_used ? 'Бронь создана, занятие списано' : 'Бронь создана (без абонемента)', 'success');
          closeModal();
          refreshCurrentTab();
        } catch (e) { toast(e.message, 'error'); }
      };
      modal.classList.add('show');
    }).catch(e => toast(e.message, 'error'));
  }

  // --- вкладка Календарь ---
  const calState = { year: new Date().getFullYear(), month: new Date().getMonth() };
  const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  // Сетка месяца: пустые клетки до 1-го числа, затем только дни этого месяца
  function fillMonthGrid(grid, lead, days, fill) {
    grid.innerHTML = '';
    for (let i = 0; i < lead; i++) {
      grid.insertAdjacentHTML('beforeend', '<div class="day day-blank" aria-hidden="true"></div>');
    }
    for (const date of days) {
      const cell = document.createElement('div');
      cell.dataset.date = date;
      grid.appendChild(cell);
      fill(cell, date);
    }
  }

  // Кнопки «← пред. месяц / след. месяц → / к текущему» для любого календаря
  function bindMonthNav(prefix, state) {
    const go = (delta) => { Object.assign(state, U.shiftMonth(state.year, state.month, delta)); refreshCurrentTab(); };
    document.getElementById(`${prefix}-prev`).onclick = () => go(-1);
    document.getElementById(`${prefix}-next`).onclick = () => go(1);
    const today = document.getElementById(`${prefix}-today`);
    if (today) today.onclick = () => {
      const n = new Date(); state.year = n.getFullYear(); state.month = n.getMonth();
      refreshCurrentTab();
    };
  }

  async function renderCalendarTab() {
    const { days, lead } = U.monthDays(calState.year, calState.month);
    main.innerHTML = `
      <div class="card">
        <div class="calendar-header">
          ${U.monthNavHtml(calState.year, calState.month, 'cal')}
          <button class="btn btn-primary" id="create-booking-btn">+ Создать бронь</button>
        </div>
        <p class="hint">Нажмите ⚙ у дня, чтобы настроить время занятий только на этот день.</p>
        <div class="weekdays"><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div></div>
        <div class="grid" id="cal-grid"><div class="empty">Загрузка…</div></div>
      </div>
    `;
    document.getElementById('create-booking-btn').onclick = () => openCreateBookingModal();
    bindMonthNav('cal', calState);

    const from = days[0], to = days[days.length - 1];
    const data = await API.request(`/api/admin/bookings?from=${from}&to=${to}&limit=2000&sort=date&dir=asc`, { auth: true });
    const byDate = {};
    for (const b of data.bookings) (byDate[b.date] = byDate[b.date] || []).push(b);

    // Стандартные часы — чтобы выделять в ячейках добавленное на день время
    const std = await API.request('/api/slots');
    calState.standard = std.slots.map(x => x.time);

    const slotsByDate = {};
    await Promise.all(days.map(async (date) => {
      const r = await API.request(`/api/slots?date=${date}`);
      slotsByDate[date] = r.slots.map(x => x.time);
    }));

    fillMonthGrid(document.getElementById('cal-grid'), lead, days,
      (cell, date) => fillDayCell(cell, date, slotsByDate[date], byDate[date] || []));
  }

  // Отрисовка одной ячейки дня. Используется и при полной отрисовке, и для точечного обновления.
  function fillDayCell(cell, date, slotTimes, bookings) {
    const d = new Date(date + 'T00:00:00');
    const isSunday = d.getDay() === 0;
    cell.className = 'day';
    if (isSunday) cell.classList.add('sunday');
    if (date < U.todayIso()) cell.classList.add('past-admin');
    if (date === U.todayIso()) cell.classList.add('today');
    cell.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'day-head';
    header.innerHTML = `<span class="day-num">${d.getDate()}</span>`;
    const cfgBtn = document.createElement('button');
    cfgBtn.className = 'day-cfg';
    cfgBtn.title = `Настроить время на ${U.formatDateRu(date)}`;
    cfgBtn.textContent = '⚙';
    cfgBtn.onclick = (e) => { e.stopPropagation(); openDaySlotsModal(date); };
    header.appendChild(cfgBtn);
    cell.appendChild(header);

    if (isSunday && !bookings.length) {
      cell.insertAdjacentHTML('beforeend', '<div class="sunday-note">Выходной</div>');
      return;
    }
    // Брони показываем всегда, даже если их время убрали из расписания дня
    const times = Array.from(new Set([...slotTimes, ...bookings.map(b => b.time_slot)])).sort();
    if (!times.length) {
      cell.insertAdjacentHTML('beforeend', '<div class="sunday-note">Нет окон</div>');
      return;
    }
    times.forEach(time => {
      const b = bookings.find(x => x.time_slot === time);
      const chip = document.createElement('div');
      chip.textContent = time;
      if (b) {
        chip.className = 'slot-mini taken';
        chip.title = `@${b.username} · ${b.telegram}`;
        chip.addEventListener('click', () => renderAdminBookingModal(b));
      } else {
        chip.className = 'slot-mini free' + ((calState.standard || []).includes(time) ? '' : ' extra');
        chip.title = 'Свободно — создать бронь';
        chip.addEventListener('click', () => openCreateBookingModal({ date, time_slot: time }));
      }
      cell.appendChild(chip);
    });
  }

  // Точечно перерисовать один день в календаре (после правки слотов)
  async function refreshDayCell(date) {
    const cell = main.querySelector(`.day[data-date="${date}"]`);
    if (!cell) return;
    const [slots, bk] = await Promise.all([
      API.request(`/api/slots?date=${date}`),
      API.request(`/api/admin/bookings?from=${date}&to=${date}&limit=200`, { auth: true })
    ]);
    fillDayCell(cell, date, slots.slots.map(x => x.time), bk.bookings);
  }

  // === Окно «Время занятий на один день» ===
  // Все изменения касаются только выбранной даты. Список обновляется на месте после каждого действия.
  async function openDaySlotsModal(date) {
    const d = new Date(date + 'T00:00:00');
    modalBody.innerHTML = `
      <h3>Время занятий · ${U.formatDateRu(date)}, ${WEEKDAYS_FULL[d.getDay()]}</h3>
      <p class="hint" id="ds-mode"></p>
      <div class="day-slots" id="ds-list"><div class="empty">Загрузка…</div></div>
      <form class="day-slots-add" id="ds-add-form">
        <input class="input" id="ds-time" type="time" step="300" required />
        <button class="btn btn-primary" type="submit">+ Добавить время</button>
      </form>
      <div class="form-actions">
        <button class="btn btn-ghost" id="ds-reset" hidden>Вернуть стандарт</button>
        <button class="btn" id="ds-close">Готово</button>
      </div>
    `;
    modal.classList.add('show');
    document.getElementById('ds-close').onclick = closeModal;

    const list = document.getElementById('ds-list');
    let busy = false;

    function render(state) {
      const e = U.esc;
      document.getElementById('ds-mode').innerHTML = state.changed
        ? 'Стандартные часы есть всегда, у этого дня есть <b>свои изменения</b>. Они действуют только на эту дату.'
        : 'День идёт по <b>стандарту</b> — каждый час. Добавленное время и отключения применятся только к этой дате.';
      document.getElementById('ds-reset').hidden = !state.changed;

      const scroll = list.scrollTop;
      list.innerHTML = state.slots.length ? state.slots.map(s => {
        const status = s.booking
          ? `<span class="ds-status taken">занято · @${e(s.booking.username)}</span>`
          : s.is_active ? '<span class="ds-status free">свободно</span>'
          : '<span class="ds-status off">отключено</span>';
        const kind = s.standard
          ? '<span class="ds-kind">стандарт</span>'
          : '<span class="ds-kind extra">добавлено</span>';
        const locked = s.booking ? 'disabled title="На это время есть запись — сначала отмените её"' : '';
        let actions = '';
        if (!s.orphan) {
          // Стандартный час: только включить/отключить. Добавленное время: удалить.
          actions = s.standard
            ? (s.is_active
              ? `<button class="btn btn-ghost btn-xs" data-act="off" data-time="${e(s.time)}" ${locked}>Отключить</button>`
              : `<button class="btn btn-primary btn-xs" data-act="on" data-time="${e(s.time)}">Включить</button>`)
            : `<button class="btn btn-danger btn-xs" data-act="del" data-time="${e(s.time)}" ${locked} aria-label="Удалить ${e(s.time)}">✕ Удалить</button>`;
        }
        return `
          <div class="ds-row ${s.is_active ? '' : 'off'} ${s.standard ? '' : 'extra'}">
            <b class="ds-time">${e(s.time)}</b>
            <span class="ds-info">${kind}${status}</span>
            <span class="ds-actions">${actions}</span>
          </div>`;
      }).join('') : '<div class="empty">На этот день нет ни одного времени — добавьте ниже</div>';
      list.scrollTop = scroll;
    }

    // Выполнить действие → получить новое состояние дня → обновить окно и ячейку календаря
    async function act(request, highlight) {
      if (busy) return;
      busy = true;
      list.classList.add('is-busy');
      try {
        const state = await request();
        render(state);
        if (highlight) {
          const row = list.querySelector(`[data-time="${highlight}"]`)?.closest('.ds-row');
          if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'nearest' }); }
        }
        refreshDayCell(date).catch(() => {});
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        busy = false;
        list.classList.remove('is-busy');
      }
    }

    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn || btn.disabled) return;
      const time = btn.dataset.time;
      if (btn.dataset.act === 'del') {
        act(() => API.request(`/api/admin/slots/day?date=${date}&time=${encodeURIComponent(time)}`, { method: 'DELETE', auth: true }));
      } else {
        act(() => API.request('/api/admin/slots/day', {
          method: 'POST', auth: true, body: { date, time, is_active: btn.dataset.act === 'on' }
        }), time);
      }
    });

    document.getElementById('ds-add-form').onsubmit = (ev) => {
      ev.preventDefault();
      const input = document.getElementById('ds-time');
      const time = input.value.slice(0, 5);
      if (!time) return;
      act(() => API.request('/api/admin/slots/day', {
        method: 'POST', auth: true, body: { date, time, is_active: true }
      }), time).then(() => { input.value = ''; input.focus(); });
    };

    document.getElementById('ds-reset').onclick = () => {
      if (!confirm('Вернуть этому дню стандарт (каждый час)? Добавленное время и отключения этого дня будут убраны.')) return;
      act(() => API.request('/api/admin/slots/day/reset', { method: 'POST', auth: true, body: { date } }));
    };

    await act(() => API.request(`/api/admin/slots/day?date=${date}`, { auth: true }));
  }

  // --- вкладка Список броней ---
  const listState = { page: 1, limit: 50, sort: 'date', dir: 'desc', from: '', to: '', user: '', subscription_id: '' };
  async function renderBookingsTab() {
    main.innerHTML = `
      <div class="card">
        <h2 class="page-title">Список броней</h2>
        <div class="admin-filters">
          <div class="field"><label>С даты</label><input class="input" type="date" id="f-from" value="${listState.from}" /></div>
          <div class="field"><label>По дату</label><input class="input" type="date" id="f-to" value="${listState.to}" /></div>
          <div class="field"><label>Логин</label><input class="input" type="text" id="f-user" value="${listState.user}" /></div>
          <div class="field"><label>ID абонемента</label><input class="input" type="text" id="f-sub" value="${listState.subscription_id}" /></div>
          <button class="btn btn-primary" id="f-apply">Применить</button>
          <button class="btn btn-ghost" id="f-reset">Сбросить</button>
          <button class="btn btn-primary" id="create-booking-btn2">+ Создать бронь</button>
          <button class="btn btn-primary" id="export-btn">Экспорт CSV</button>
        </div>
        <div class="table-wrap"><table class="data-table" id="bookings-table"><thead></thead><tbody></tbody></table></div>
        <div class="pagination" id="pagination"></div>
      </div>
    `;
    document.getElementById('create-booking-btn2').onclick = () => openCreateBookingModal();
    document.getElementById('f-apply').onclick = () => {
      listState.from = document.getElementById('f-from').value;
      listState.to = document.getElementById('f-to').value;
      listState.user = document.getElementById('f-user').value.trim();
      listState.subscription_id = document.getElementById('f-sub').value.trim();
      listState.page = 1;
      renderBookingsTab();
    };
    document.getElementById('f-reset').onclick = () => {
      listState.from = listState.to = listState.user = listState.subscription_id = '';
      listState.page = 1;
      renderBookingsTab();
    };
    document.getElementById('export-btn').onclick = () => {
      fetch('/api/admin/export.csv', { headers: { Authorization: `Bearer ${API.token()}` } })
        .then(async (r) => {
          if (!r.ok) throw new Error('Ошибка экспорта');
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'bookings.csv'; a.click();
          URL.revokeObjectURL(url);
        }).catch(e => toast(e.message, 'error'));
    };

    const q = new URLSearchParams({
      page: String(listState.page), limit: String(listState.limit),
      sort: listState.sort, dir: listState.dir
    });
    if (listState.from) q.set('from', listState.from);
    if (listState.to) q.set('to', listState.to);
    if (listState.user) q.set('user', listState.user);
    if (listState.subscription_id) q.set('subscription_id', listState.subscription_id);

    const data = await API.request('/api/admin/bookings?' + q.toString(), { auth: true });
    const thead = document.querySelector('#bookings-table thead');
    const tbody = document.querySelector('#bookings-table tbody');
    const cols = [
      ['id','ID'], ['date','Дата'], ['time_slot','Время'], ['username','Пользователь'],
      ['telegram','Telegram'], ['phone','Телефон'], ['sub_type','Абонемент'],
      ['created_at','Создана'], ['actions','Действия']
    ];
    thead.innerHTML = '<tr>' + cols.map(([k, label]) => {
      const sortable = ['id','date','time_slot','username','created_at'].includes(k);
      const arrow = listState.sort === k ? (listState.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th>${label}${sortable ? `<button class="btn" style="padding:2px 6px;font-size:11px;margin-left:4px" data-sort="${k}">↕${arrow}</button>` : ''}</th>`;
    }).join('') + '</tr>';
    thead.querySelectorAll('[data-sort]').forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.sort;
        if (listState.sort === k) listState.dir = listState.dir === 'asc' ? 'desc' : 'asc';
        else { listState.sort = k; listState.dir = 'asc'; }
        renderBookingsTab();
      };
    });

    tbody.innerHTML = data.bookings.length ? data.bookings.map(b => `
      <tr>
        <td>${b.id}</td><td>${U.formatDateRu(b.date)}</td><td>${b.time_slot}</td>
        <td>@${b.username}</td><td>${b.telegram}</td><td>${b.phone}</td>
        <td>${b.sub_type ? `${b.sub_type} · ${b.lessons_used}/${b.lessons_total}` : '—'}</td>
        <td>${b.created_at}</td>
        <td><button class="btn btn-danger" data-del="${b.id}" style="padding:4px 10px;font-size:12px">Отменить</button></td>
      </tr>
    `).join('') : `<tr><td colspan="9" class="empty">Нет данных</td></tr>`;

    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Отменить запись? Она останется в истории.')) return;
        try {
          await API.request(`/api/admin/bookings/${btn.dataset.del}`, { method: 'DELETE', auth: true });
          toast('Удалено', 'success');
          renderBookingsTab();
        } catch (e) { toast(e.message, 'error'); }
      };
    });

    const totalPages = Math.max(1, Math.ceil(data.total / listState.limit));
    const pag = document.getElementById('pagination');
    pag.innerHTML = `
      <button class="btn" id="p-prev" ${listState.page <= 1 ? 'disabled' : ''}>←</button>
      <span class="page-info">Стр. ${listState.page} из ${totalPages} · всего ${data.total}</span>
      <button class="btn" id="p-next" ${listState.page >= totalPages ? 'disabled' : ''}>→</button>
    `;
    document.getElementById('p-prev').onclick = () => { listState.page--; renderBookingsTab(); };
    document.getElementById('p-next').onclick = () => { listState.page++; renderBookingsTab(); };
  }

  // --- вкладка История (аудит): все записи — активные, прошедшие, отменённые ---
  // Два вида: календарь месяца и обычный список с пагинацией.
  const STATUS_LABEL = { active: 'Запланировано', done: 'Прошло', cancelled: 'Отменено' };
  const REASON_LABEL = {
    'past-day': 'прошедший день', 'sunday': 'воскресная архивация', 'manual': 'ручная архивация',
    'cancel-user': 'отменил ученик', 'cancel-admin': 'отменил админ'
  };
  const historyState = {
    view: 'calendar', year: new Date().getFullYear(), month: new Date().getMonth(),
    user: '', status: '', from: '', to: '', page: 1, limit: 50
  };

  function statusBadge(status) {
    return `<span class="status-badge status-${status}">${STATUS_LABEL[status] || status}</span>`;
  }

  function historyQuery(extra) {
    const q = new URLSearchParams(extra);
    if (historyState.user) q.set('user', historyState.user);
    if (historyState.status) q.set('status', historyState.status);
    return q;
  }

  function renderHistoryItemModal(h) {
    const e = U.esc;
    modalBody.innerHTML = `
      <h3>Запись #${e(h.booking_id)} ${statusBadge(h.status)}</h3>
      <div class="modal-info">
        <span>Дата · время</span><b>${U.formatDateRu(h.date)} · ${e(h.time_slot)}</b>
        <span>Ученик</span><b>@${e(h.username || '—')} (ID ${e(h.user_id)})</b>
        <span>Telegram</span><b>${e(h.telegram)}</b>
        <span>Телефон</span><b>${e(h.phone)}</b>
        <span>Абонемент</span><b>${h.sub_type ? `${e(h.sub_type)} занятий (ID ${e(h.subscription_id)})` : '—'}</b>
        <span>Создана</span><b>${e(h.created_at)}</b>
        ${h.archived_at ? `<span>В архиве с</span><b>${e(h.archived_at)} · ${e(REASON_LABEL[h.archive_reason] || h.archive_reason)}</b>` : ''}
      </div>
      <div class="form-actions">
        <button class="btn" id="modal-close">Закрыть</button>
        ${h.status === 'active' ? '<button class="btn btn-danger" id="modal-delete">Отменить запись</button>' : ''}
      </div>
    `;
    document.getElementById('modal-close').onclick = closeModal;
    const del = document.getElementById('modal-delete');
    if (del) {
      del.onclick = async () => {
        if (!confirm('Отменить запись? Занятие вернётся в абонемент, запись останется в истории.')) return;
        try {
          await API.request(`/api/admin/bookings/${h.booking_id}`, { method: 'DELETE', auth: true });
          toast('Запись отменена', 'success');
          closeModal();
          refreshCurrentTab();
        } catch (err) { toast(err.message, 'error'); }
      };
    }
    modal.classList.add('show');
  }

  function renderHistoryDayModal(date, items) {
    const e = U.esc;
    modalBody.innerHTML = `
      <h3>${U.formatDateRu(date)} — записей: ${items.length}</h3>
      <div class="history-day-list">
        ${items.map((h, i) => `
          <button class="history-row status-${h.status}" data-i="${i}">
            <b>${e(h.time_slot)}</b><span>@${e(h.username || '—')}</span>${statusBadge(h.status)}
          </button>`).join('')}
      </div>
      <div class="form-actions"><button class="btn" id="modal-close">Закрыть</button></div>
    `;
    document.getElementById('modal-close').onclick = closeModal;
    modalBody.querySelectorAll('[data-i]').forEach(btn => {
      btn.onclick = () => renderHistoryItemModal(items[Number(btn.dataset.i)]);
    });
    modal.classList.add('show');
  }

  async function renderAuditTab() {
    const st = historyState;
    const isCal = st.view === 'calendar';
    main.innerHTML = `
      <div class="card">
        <div class="calendar-header">
          <h2 class="page-title" style="margin:0">История записей</h2>
          <div class="segmented">
            <button data-view="calendar" class="${isCal ? 'active' : ''}">📅 Календарь</button>
            <button data-view="list" class="${!isCal ? 'active' : ''}">📋 Список</button>
          </div>
        </div>
        <p class="hint">Все записи за всё время: запланированные, прошедшие и отменённые (учеником или админом).</p>
        <div class="admin-filters">
          <div class="field"><label>Ученик (логин)</label><input class="input" type="text" id="h-user" value="${U.esc(st.user)}" /></div>
          <div class="field"><label>Статус</label>
            <select class="input" id="h-status">
              <option value="">Все</option>
              <option value="active">Запланировано</option>
              <option value="done">Прошло</option>
              <option value="cancelled">Отменено</option>
            </select>
          </div>
          ${isCal ? '' : `
          <div class="field"><label>С даты</label><input class="input" type="date" id="h-from" value="${st.from}" /></div>
          <div class="field"><label>По дату</label><input class="input" type="date" id="h-to" value="${st.to}" /></div>`}
          <button class="btn btn-primary" id="h-apply">Применить</button>
          <button class="btn btn-ghost" id="h-reset">Сбросить</button>
          <button class="btn" id="h-export">Экспорт CSV</button>
          <button class="btn btn-ghost" id="h-archive-past">Заархивировать прошедшие</button>
        </div>
        <div class="stats-row" id="h-stats"></div>
        <div id="h-body"><div class="empty">Загрузка…</div></div>
      </div>
    `;
    document.getElementById('h-status').value = st.status;
    main.querySelectorAll('[data-view]').forEach(btn => {
      btn.onclick = () => { st.view = btn.dataset.view; st.page = 1; refreshCurrentTab(); };
    });
    document.getElementById('h-apply').onclick = () => {
      st.user = document.getElementById('h-user').value.trim();
      st.status = document.getElementById('h-status').value;
      if (!isCal) {
        st.from = document.getElementById('h-from').value;
        st.to = document.getElementById('h-to').value;
      }
      st.page = 1;
      refreshCurrentTab();
    };
    document.getElementById('h-reset').onclick = () => {
      st.user = st.status = st.from = st.to = '';
      st.page = 1;
      refreshCurrentTab();
    };
    document.getElementById('h-export').onclick = () => {
      const q = historyQuery();
      if (!isCal) { if (st.from) q.set('from', st.from); if (st.to) q.set('to', st.to); }
      fetch('/api/admin/history.csv?' + q.toString(), { headers: { Authorization: `Bearer ${API.token()}` } })
        .then(async (r) => {
          if (!r.ok) throw new Error('Ошибка экспорта');
          const url = URL.createObjectURL(await r.blob());
          const a = document.createElement('a');
          a.href = url; a.download = 'history.csv'; a.click();
          URL.revokeObjectURL(url);
        }).catch(err => toast(err.message, 'error'));
    };
    document.getElementById('h-archive-past').onclick = async () => {
      if (!confirm('Перенести в архив все записи с прошедшими датами?')) return;
      try {
        const r = await API.request('/api/admin/archive/past', { method: 'POST', auth: true });
        toast(`Заархивировано: ${r.archived}`, 'success');
        refreshCurrentTab();
      } catch (err) { toast(err.message, 'error'); }
    };

    const data = isCal ? await renderHistoryCalendar() : await renderHistoryList();
    const s = data.stats || {};
    document.getElementById('h-stats').innerHTML = `
      <div class="stat"><b>${data.total}</b><span>всего</span></div>
      <div class="stat status-active"><b>${s.active || 0}</b><span>запланировано</span></div>
      <div class="stat status-done"><b>${s.done || 0}</b><span>прошло</span></div>
      <div class="stat status-cancelled"><b>${s.cancelled || 0}</b><span>отменено</span></div>
    `;
  }

  async function renderHistoryCalendar() {
    const st = historyState;
    const { days, lead } = U.monthDays(st.year, st.month);

    const body = document.getElementById('h-body');
    body.innerHTML = `
      <div class="calendar-header">${U.monthNavHtml(st.year, st.month, 'h')}</div>
      <div class="weekdays"><div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div></div>
      <div class="grid" id="h-grid"></div>
      <div class="legend">
        <span class="status-badge status-active">Запланировано</span>
        <span class="status-badge status-done">Прошло</span>
        <span class="status-badge status-cancelled">Отменено</span>
      </div>
    `;
    bindMonthNav('h', st);

    const q = historyQuery({ from: days[0], to: days[days.length - 1], limit: '5000', dir: 'asc' });
    const data = await API.request('/api/admin/history?' + q.toString(), { auth: true });
    const byDate = {};
    for (const h of data.items) (byDate[h.date] = byDate[h.date] || []).push(h);

    const today = U.todayIso();
    const MAX_CHIPS = 4;
    fillMonthGrid(document.getElementById('h-grid'), lead, days, (cell, date) => {
      const d = new Date(date + 'T00:00:00');
      const items = byDate[date] || [];
      cell.className = 'day';
      if (d.getDay() === 0) cell.classList.add('sunday');
      if (date === today) cell.classList.add('today');
      cell.innerHTML = `<div class="day-head"><span class="day-num">${d.getDate()}</span>${items.length ? `<span class="day-count">${items.length}</span>` : ''}</div>`;

      items.slice(0, MAX_CHIPS).forEach(h => {
        const chip = document.createElement('div');
        chip.className = `slot-mini history-chip status-${h.status}`;
        chip.textContent = `${h.time_slot} @${h.username || '—'}`;
        chip.title = `${STATUS_LABEL[h.status]} · ${h.telegram}`;
        chip.onclick = (ev) => { ev.stopPropagation(); renderHistoryItemModal(h); };
        cell.appendChild(chip);
      });
      if (items.length > MAX_CHIPS) {
        cell.insertAdjacentHTML('beforeend', `<div class="more-chip">+ ещё ${items.length - MAX_CHIPS}</div>`);
      }
      if (items.length) {
        cell.classList.add('clickable');
        cell.onclick = () => renderHistoryDayModal(date, items);
      }
    });
    return data;
  }

  async function renderHistoryList() {
    const st = historyState;
    const q = historyQuery({ page: String(st.page), limit: String(st.limit), dir: 'desc' });
    if (st.from) q.set('from', st.from);
    if (st.to) q.set('to', st.to);
    const data = await API.request('/api/admin/history?' + q.toString(), { auth: true });
    const e = U.esc;

    const body = document.getElementById('h-body');
    body.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Дата</th><th>Время</th><th>Ученик</th><th>Telegram</th><th>Телефон</th>
          <th>Абонемент</th><th>Статус</th><th>Создана</th><th>Архив</th>
        </tr></thead>
        <tbody>
          ${data.items.length ? data.items.map((h, i) => `
            <tr class="clickable" data-i="${i}">
              <td>${U.formatDateRu(h.date)}</td><td>${e(h.time_slot)}</td>
              <td>@${e(h.username || '—')}</td><td>${e(h.telegram)}</td><td>${e(h.phone)}</td>
              <td>${h.sub_type ? `${e(h.sub_type)} зан.` : '—'}</td>
              <td>${statusBadge(h.status)}</td>
              <td>${e(h.created_at)}</td>
              <td>${h.archived_at ? `${e(h.archived_at)}<br><small>${e(REASON_LABEL[h.archive_reason] || h.archive_reason)}</small>` : '—'}</td>
            </tr>`).join('') : '<tr><td colspan="9" class="empty">Записей нет</td></tr>'}
        </tbody>
      </table></div>
      <div class="pagination" id="h-pagination"></div>
    `;
    body.querySelectorAll('tr[data-i]').forEach(tr => {
      tr.onclick = () => renderHistoryItemModal(data.items[Number(tr.dataset.i)]);
    });

    const totalPages = Math.max(1, Math.ceil(data.total / st.limit));
    document.getElementById('h-pagination').innerHTML = `
      <button class="btn" id="hp-prev" ${st.page <= 1 ? 'disabled' : ''}>←</button>
      <span class="page-info">Стр. ${st.page} из ${totalPages} · всего ${data.total}</span>
      <button class="btn" id="hp-next" ${st.page >= totalPages ? 'disabled' : ''}>→</button>
    `;
    document.getElementById('hp-prev').onclick = () => { st.page--; refreshCurrentTab(); };
    document.getElementById('hp-next').onclick = () => { st.page++; refreshCurrentTab(); };
    return data;
  }

  // --- вкладка Ученики ---
  const SUB_TYPES = [['4', '4 занятия в месяц'], ['8', '8 занятий в месяц'], ['12', '12 занятий в месяц']];
  const smallBtn = 'style="padding:6px 10px;font-size:12px"';

  function subSummary(s) {
    if (!s) return '<span class="muted">нет</span>';
    const expired = s.expires_at < U.todayIso();
    const left = s.lessons_total - s.lessons_used;
    return `<b>${s.type}</b> · осталось ${left}/${s.lessons_total}<br><small class="${expired ? 'text-danger' : 'muted'}">до ${U.formatDateRu(s.expires_at)}${expired ? ' — истёк' : ''}</small>`;
  }

  async function renderUsersTab() {
    const data = await API.request('/api/admin/users', { auth: true });
    const e = U.esc;
    main.innerHTML = `
      <div class="card">
        <h2 class="page-title">Ученики</h2>
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>ID</th><th>Логин</th><th>Роль</th><th>Регистрация</th>
            <th>Абонемент</th><th>Активных записей</th><th>Действия</th>
          </tr></thead>
          <tbody id="users-tbody"></tbody>
        </table></div>
      </div>
    `;
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = data.users.map(u => {
      const sub = u.active_sub_id ? {
        type: u.active_sub_type, lessons_total: u.active_sub_total,
        lessons_used: u.active_sub_used, expires_at: u.active_sub_expires
      } : null;
      return `
        <tr>
          <td>${u.id}</td><td>@${e(u.username)}</td><td>${u.role === 'admin' ? 'админ' : 'ученик'}</td><td>${e(u.created_at)}</td>
          <td>${subSummary(sub)}</td><td>${u.bookings_count}</td>
          <td class="actions">
            <button class="btn btn-primary" data-assign="${u.id}" ${smallBtn}>Назначить абонемент</button>
            ${u.active_sub_id ? `<button class="btn" data-edit-sub="${u.active_sub_id}" ${smallBtn}>Изменить</button>` : ''}
            <button class="btn btn-ghost" data-history="${e(u.username)}" ${smallBtn}>История</button>
          </td>
        </tr>
      `;
    }).join('');
    tbody.querySelectorAll('[data-assign]').forEach(btn => {
      btn.onclick = () => openAssignModal(Number(btn.dataset.assign), renderUsersTab);
    });
    tbody.querySelectorAll('[data-edit-sub]').forEach(btn => {
      btn.onclick = () => openEditSubModal(Number(btn.dataset.editSub), renderUsersTab);
    });
    tbody.querySelectorAll('[data-history]').forEach(btn => {
      btn.onclick = () => {
        Object.assign(historyState, { view: 'list', user: btn.dataset.history, status: '', from: '', to: '', page: 1 });
        switchTab('audit');
      };
    });
  }

  // Назначение абонемента. userId = null → выбор ученика в форме.
  async function openAssignModal(userId, onDone) {
    const { users } = await API.request('/api/admin/users', { auth: true });
    const students = users.filter(u => u.role !== 'admin');
    const today = U.todayIso();
    modalBody.innerHTML = `
      <h3>Назначить абонемент</h3>
      <form id="assign-form">
        <div class="field"><label>Ученик</label>
          <select class="input" id="sub-user" ${userId ? 'disabled' : ''}>
            ${(userId ? users : students).map(u => `<option value="${u.id}" ${u.id === userId ? 'selected' : ''}>@${U.esc(u.username)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Абонемент</label>
          <div class="sub-picker">
            ${SUB_TYPES.map(([v, label]) => `
              <label class="sub-option"><input type="radio" name="sub-type" value="${v}" ${v === '8' ? 'checked' : ''} />
                <span><b>${v}</b>${label.replace(v, '')}</span></label>`).join('')}
          </div>
        </div>
        <div class="field"><label>Дата начала</label>
          <input class="input" type="date" id="sub-start" value="${today}" required />
        </div>
        <p class="hint">Абонемент действует 1 месяц. Предыдущий активный абонемент ученика будет закрыт.</p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="assign-cancel">Отмена</button>
          <button type="submit" class="btn btn-primary">Назначить</button>
        </div>
      </form>
    `;
    document.getElementById('assign-cancel').onclick = closeModal;
    document.getElementById('assign-form').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await API.request('/api/admin/subscriptions', {
          method: 'POST', auth: true,
          body: {
            user_id: Number(document.getElementById('sub-user').value),
            type: modalBody.querySelector('input[name="sub-type"]:checked').value,
            starts_at: document.getElementById('sub-start').value
          }
        });
        toast('Абонемент назначен', 'success');
        closeModal();
        onDone();
      } catch (err) { toast(err.message, 'error'); }
    };
    modal.classList.add('show');
  }

  // Ручная правка абонемента: всего/использовано занятий, срок, активность
  async function openEditSubModal(subId, onDone) {
    const { subscriptions } = await API.request('/api/admin/subscriptions', { auth: true });
    const s = subscriptions.find(x => x.id === subId);
    if (!s) { toast('Абонемент не найден', 'error'); return; }
    modalBody.innerHTML = `
      <h3>Абонемент #${s.id} · @${U.esc(s.username)}</h3>
      <form id="edit-sub-form">
        <div class="field"><label>Всего занятий</label>
          <input class="input" type="number" min="1" max="100" id="es-total" value="${s.lessons_total}" required />
        </div>
        <div class="field"><label>Использовано занятий</label>
          <input class="input" type="number" min="0" max="100" id="es-used" value="${s.lessons_used}" required />
        </div>
        <div class="field"><label>Действует до (включительно)</label>
          <input class="input" type="date" id="es-expires" value="${s.expires_at}" required />
        </div>
        <div class="field"><label><input type="checkbox" id="es-active" ${s.is_active ? 'checked' : ''} /> Активен</label></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="es-cancel">Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>
    `;
    document.getElementById('es-cancel').onclick = closeModal;
    document.getElementById('edit-sub-form').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await API.request(`/api/admin/subscriptions/${s.id}`, {
          method: 'PATCH', auth: true,
          body: {
            lessons_total: Number(document.getElementById('es-total').value),
            lessons_used: Number(document.getElementById('es-used').value),
            expires_at: document.getElementById('es-expires').value,
            is_active: document.getElementById('es-active').checked
          }
        });
        toast('Абонемент обновлён', 'success');
        closeModal();
        onDone();
      } catch (err) { toast(err.message, 'error'); }
    };
    modal.classList.add('show');
  }

  // --- вкладка Абонементы ---
  async function renderSubsTab() {
    main.innerHTML = `
      <div class="card">
        <div class="calendar-header">
          <h2 class="page-title" style="margin:0">Абонементы</h2>
          <button class="btn btn-primary" id="subs-new">+ Назначить абонемент</button>
        </div>
        <p class="hint">Типы: 4, 8 или 12 занятий в месяц. Ученик может записываться, только пока абонемент активен, не истёк и остались занятия.</p>
        <div class="admin-filters">
          <div class="field"><label>Статус</label>
            <select class="input" id="subs-status">
              <option value="">Все</option><option value="active">Активные</option><option value="inactive">Неактивные</option>
            </select>
          </div>
          <div class="field"><label>Тип</label>
            <select class="input" id="subs-type">
              <option value="">Все</option><option value="4">4</option><option value="8">8</option><option value="12">12</option>
            </select>
          </div>
          <button class="btn btn-primary" id="subs-apply">Фильтр</button>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>ID</th><th>Ученик</th><th>Тип</th><th>Использовано</th>
            <th>Начало</th><th>Конец</th><th>Статус</th><th>Действия</th>
          </tr></thead>
          <tbody id="subs-tbody"></tbody>
        </table></div>
      </div>
    `;
    const load = async () => {
      const qs = new URLSearchParams();
      const st = document.getElementById('subs-status').value;
      const ty = document.getElementById('subs-type').value;
      if (st) qs.set('status', st);
      if (ty) qs.set('type', ty);
      const data = await API.request('/api/admin/subscriptions?' + qs.toString(), { auth: true });
      const tbody = document.getElementById('subs-tbody');
      const today = U.todayIso();
      tbody.innerHTML = data.subscriptions.length ? data.subscriptions.map(s => {
        const state = !s.is_active ? '<span class="status-badge status-cancelled">закрыт</span>'
          : s.expires_at < today ? '<span class="status-badge status-done">истёк</span>'
          : '<span class="status-badge status-active">активен</span>';
        return `
          <tr>
            <td>${s.id}</td><td>@${U.esc(s.username)}</td><td>${s.type} зан./мес</td>
            <td>${s.lessons_used}/${s.lessons_total}</td>
            <td>${U.formatDateRu(s.starts_at)}</td><td>${U.formatDateRu(s.expires_at)}</td><td>${state}</td>
            <td class="actions">
              <button class="btn" data-edit-sub="${s.id}" ${smallBtn}>Изменить</button>
              ${s.is_active ? `<button class="btn btn-danger" data-deact="${s.id}" ${smallBtn}>Закрыть</button>` : ''}
            </td>
          </tr>
        `;
      }).join('') : `<tr><td colspan="8" class="empty">Нет данных</td></tr>`;
      tbody.querySelectorAll('[data-edit-sub]').forEach(btn => {
        btn.onclick = () => openEditSubModal(Number(btn.dataset.editSub), load);
      });
      tbody.querySelectorAll('[data-deact]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Закрыть (деактивировать) абонемент?')) return;
          try {
            await API.request(`/api/admin/subscriptions/${btn.dataset.deact}`, { method: 'DELETE', auth: true });
            toast('Абонемент закрыт', 'success');
            load();
          } catch (e) { toast(e.message, 'error'); }
        };
      });
    };
    document.getElementById('subs-new').onclick = () => openAssignModal(null, load);
    document.getElementById('subs-apply').onclick = load;
    await load();
  }

  // --- вкладка Слоты (глобальные) ---
  async function renderSlotsTab() {
    const data = await API.request('/api/admin/slots', { auth: true });
    main.innerHTML = `
      <div class="card">
        <h2 class="page-title">Стандартное расписание</h2>
        <p class="hint">
          Стандарт — занятия каждый час, он действует на <b>все дни</b>. Здесь только целые часы.
          Нестандартное время (например, 14:30) добавляйте на нужный день через ⚙ в календаре.
          Удаление часа не ломает уже созданные брони.
        </p>
        <div class="admin-filters">
          <div class="field"><label>Добавить час</label>
            <select class="input" id="new-slot-time">
              ${Array.from({ length: 24 }, (_, h) => U.pad(h) + ':00')
                .filter(t => !data.slots.some(s => s.time === t))
                .map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" id="add-slot-btn">Добавить час</button>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>ID</th><th>Время</th><th>Активен</th><th>Действия</th>
          </tr></thead>
          <tbody id="slots-tbody"></tbody>
        </table></div>
      </div>
    `;
    const tbody = document.getElementById('slots-tbody');
    tbody.innerHTML = data.slots.map(s => `
      <tr>
        <td>${s.id}</td>
        <td><input class="input" type="time" step="3600" style="width:120px;padding:6px 8px" value="${s.time}" data-edit="${s.id}" /></td>
        <td>${s.is_active ? '✅' : '—'}</td>
        <td>
          <button class="btn btn-primary" data-save="${s.id}" style="padding:4px 10px;font-size:12px">Сохранить</button>
          <button class="btn btn-ghost" data-toggle="${s.id}" data-active="${s.is_active}" style="padding:4px 10px;font-size:12px">${s.is_active ? 'Отключить' : 'Включить'}</button>
          <button class="btn btn-danger" data-del="${s.id}" style="padding:4px 10px;font-size:12px">Удалить</button>
        </td>
      </tr>
    `).join('');

    document.getElementById('add-slot-btn').onclick = async () => {
      const time = document.getElementById('new-slot-time').value.trim();
      try {
        await API.request('/api/admin/slots', { method: 'POST', auth: true, body: { time } });
        toast('Слот добавлен', 'success');
        renderSlotsTab();
      } catch (e) { toast(e.message, 'error'); }
    };

    tbody.querySelectorAll('[data-save]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.save;
        const input = tbody.querySelector(`[data-edit="${id}"]`);
        try {
          await API.request(`/api/admin/slots/${id}`, { method: 'PATCH', auth: true, body: { time: input.value.trim() } });
          toast('Слот обновлён', 'success');
          renderSlotsTab();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
    tbody.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.toggle;
        const active = btn.dataset.active === '1';
        try {
          await API.request(`/api/admin/slots/${id}`, { method: 'PATCH', auth: true, body: { is_active: !active } });
          toast(active ? 'Слот отключён' : 'Слот включён', 'success');
          renderSlotsTab();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
    tbody.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Удалить слот? Существующие брони не пострадают.')) return;
        try {
          await API.request(`/api/admin/slots/${btn.dataset.del}`, { method: 'DELETE', auth: true });
          toast('Слот удалён', 'success');
          renderSlotsTab();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  }

  // --- переключение вкладок ---
  const tabRenderers = {
    calendar: renderCalendarTab,
    bookings: renderBookingsTab,
    audit: renderAuditTab,
    users: renderUsersTab,
    subs: renderSubsTab,
    slots: renderSlotsTab
  };
  let currentTab = 'calendar';
  function refreshCurrentTab() { run(tabRenderers[currentTab]); }

  function switchTab(tab) {
    currentTab = tab;
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    refreshCurrentTab();
  }

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });

  run(renderCalendarTab);
})();