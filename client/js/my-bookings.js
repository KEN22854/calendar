// Мои брони + блок абонемента, отмена с возвратом занятия
(function () {
  if (!requireAuthPage()) return;
  const user = API.user();
  renderHeader({ showAdmin: user.role === 'admin', active: 'bookings' });

  const list = document.getElementById('bookings-list');
  const loading = document.getElementById('loading');
  const subBanner = document.getElementById('sub-banner');

  async function loadSubscription() {
    try {
      const data = await API.request('/api/my-subscription', { auth: true });
      const b = U.subBanner(data);
      subBanner.className = b.cls;
      subBanner.innerHTML = b.html;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function load() {
    loading.classList.add('show');
    try {
      await loadSubscription();
      const data = await API.request('/api/my-bookings', { auth: true });
      if (!data.bookings.length) {
        list.innerHTML = '<div class="empty">У вас пока нет записей на занятия. Выберите время в <a href="/">расписании</a>.</div>';
        return;
      }
      list.innerHTML = '';
      for (const b of data.bookings) {
        const item = document.createElement('div');
        item.className = 'booking-item';
        item.innerHTML = `
          <div class="meta">
            <b>${U.formatDateRu(b.date)} · ${b.time_slot}</b>
            <span>Telegram: ${b.telegram} · Телефон: ${b.phone}</span>
          </div>
          <button class="btn btn-danger" data-id="${b.id}">Отменить</button>
        `;
        item.querySelector('button').addEventListener('click', () => cancel(b.id));
        list.appendChild(item);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      loading.classList.remove('show');
    }
  }

  async function cancel(id) {
    if (!confirm('Отменить эту запись? Занятие вернётся в абонемент.')) return;
    loading.classList.add('show');
    try {
      await API.request(`/api/bookings/${id}`, { method: 'DELETE', auth: true });
      toast('Бронь отменена, занятие возвращено', 'success');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      loading.classList.remove('show');
    }
  }

  load();
})();