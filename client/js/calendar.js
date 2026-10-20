// Календарь пользователя: только текущая неделя пн–сб, слоты на каждый день
(function () {
  if (!requireAuthPage()) return;

  const user = API.user();
  renderHeader({ showAdmin: user.role === 'admin', active: 'calendar' });

  const state = {
    week: U.currentWeek(),
    // { 'YYYY-MM-DD': { slots: ['09:00', ...], taken: [{...}] } }
    dayData: {},
    subscription: null
  };

  const grid = document.getElementById('calendar-grid');
  const title = document.getElementById('calendar-title');
  const controls = document.getElementById('calendar-controls');
  const loading = document.getElementById('loading');
  const subBanner = document.getElementById('sub-banner');

  controls.innerHTML = `<button class="btn" id="refresh-btn">Обновить</button>`;
  document.getElementById('refresh-btn').addEventListener('click', () => loadAll());

  async function loadSubscription() {
    try {
      const data = await API.request('/api/my-subscription', { auth: true });
      state.subscription = data.subscription;
      const b = U.subBanner(data);
      subBanner.className = b.cls;
      subBanner.innerHTML = b.html;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadDate(date) {
    const data = await API.request(`/api/bookings?date=${date}`, { auth: true });
    state.dayData[date] = { slots: data.slots, taken: data.taken };
  }

  async function loadAll() {
    loading.classList.add('show');
    try {
      await loadSubscription();
      // Воскресенье — выходной, слотов нет: не запрашиваем
      await Promise.all(state.week.filter(d => !d.isSunday).map(d => loadDate(d.date)));
      render();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      loading.classList.remove('show');
    }
  }

  function render() {
    const today = U.todayIso();
    const [monDate, , , , , satDate] = state.week;
    title.textContent = `Расписание на неделю: ${U.formatDateRu(monDate.date)} — ${U.formatDateRu(satDate.date)}`;

    grid.innerHTML = '';
    for (const day of state.week) {
      const cell = document.createElement('div');
      cell.className = 'day';
      if (day.date === today) cell.classList.add('today');
      if (day.isSunday) cell.classList.add('sunday');
      const isPast = day.date < today;
      if (isPast) cell.classList.add('past');

      const num = document.createElement('div');
      num.className = 'day-num';
      num.textContent = day.dayNum;
      cell.appendChild(num);

      if (day.isSunday) {
        const note = document.createElement('div');
        note.className = 'sunday-note';
        note.textContent = 'Выходной';
        cell.appendChild(note);
      } else {
        const { slots = [], taken = [] } = state.dayData[day.date] || {};
        if (!slots.length) {
          const note = document.createElement('div');
          note.className = 'sunday-note';
          note.textContent = 'Нет окон';
          cell.appendChild(note);
        } else {
          slots.forEach(slot => {
            const t = taken.find(x => x.time_slot === slot);
            const chip = document.createElement('div');
            chip.className = 'slot-mini ' + (t ? ('taken' + (t.own ? ' own' : '')) : (isPast ? 'disabled' : 'free'));
            chip.textContent = t && t.own ? `${slot} · вы` : slot;
            // Прошедший день: свободные окна недоступны, занятые можно только посмотреть
            if (t || !isPast) chip.addEventListener('click', () => openSlot(day.date, slot));
            cell.appendChild(chip);
          });
        }
      }
      grid.appendChild(cell);
    }
  }

  // --- модалка слота ---
  const modal = document.getElementById('slot-modal');
  const modalBody = document.getElementById('slot-modal-body');
  function closeModal() { modal.classList.remove('show'); }
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  function openSlot(date, slot) {
    const { taken = [] } = state.dayData[date] || {};
    const t = taken.find(x => x.time_slot === slot);

    if (t) {
      modalBody.innerHTML = `
        <h3>Слот занят</h3>
        <div class="modal-info">
          <span>Дата и время</span><b>${U.formatDateRu(date)} · ${slot}</b>
          <span>Telegram</span><b>${t.telegram}</b>
          <span>Телефон</span><b>${t.own ? t.phone : U.maskPhone(t.phone)}</b>
          <span>Пользователь</span><b>@${t.username}${t.own ? ' (вы)' : ''}</b>
        </div>
        <div class="form-actions"><button class="btn" id="close-modal">Закрыть</button></div>
      `;
      document.getElementById('close-modal').onclick = closeModal;
      modal.classList.add('show');
      return;
    }

    modalBody.innerHTML = `
      <h3>Бронирование</h3>
      <form id="booking-form">
        <div class="field"><label>Дата и время</label>
          <input class="input readonly" id="slot-display" type="text" readonly value="${U.formatDateRu(date)} · ${slot}" />
        </div>
        <div class="field"><label>Telegram (с @ или без)</label>
          <input class="input" id="telegram" type="text" placeholder="@nickname" required />
        </div>
        <div class="field"><label>Номер телефона</label>
          <input class="input" id="phone" type="tel" placeholder="+7 (___) ___-__-__" required />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancel-btn">Отмена</button>
          <button type="submit" class="btn btn-primary" id="submit-btn">Забронировать</button>
        </div>
      </form>
    `;
    document.getElementById('cancel-btn').onclick = closeModal;
    const phoneInput = document.getElementById('phone');
    phoneInput.addEventListener('input', () => {
      let digits = phoneInput.value.replace(/\D/g, '');
      if (digits.startsWith('8')) digits = '7' + digits.slice(1);
      if (!digits.startsWith('7')) digits = '7' + digits;
      digits = digits.slice(0, 11);
      let out = '+7';
      if (digits.length > 1) out += ` (${digits.slice(1, 4)}`;
      if (digits.length >= 4) out += `) ${digits.slice(4, 7)}`;
      if (digits.length >= 7) out += `-${digits.slice(7, 9)}`;
      if (digits.length >= 9) out += `-${digits.slice(9, 11)}`;
      phoneInput.value = out;
    });

    document.getElementById('booking-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('submit-btn');
      submitBtn.disabled = true;
      loading.classList.add('show');
      try {
        await API.request('/api/bookings', {
          method: 'POST', auth: true,
          body: {
            date, time_slot: slot,
            telegram: document.getElementById('telegram').value.trim(),
            phone: phoneInput.value.trim()
          }
        });
        toast('Бронь создана', 'success');
        closeModal();
        delete state.dayData[date];
        await loadAll();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        loading.classList.remove('show');
      }
    });

    modal.classList.add('show');
  }

  loadAll();
})();