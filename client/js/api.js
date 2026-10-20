// Обёртка fetch: JWT, 401 → login, 403 → toast, единый парсинг
const API = {
  token() { return localStorage.getItem('token'); },
  user() {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
  },
  setSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
  async request(url, { method = 'GET', body, auth = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const t = this.token();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* пусто */ }

    if (res.status === 401 && auth) {
      this.clearSession();
      location.href = '/login';
      throw new Error('Требуется авторизация');
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Ошибка ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
};

function toast(message, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

function requireAuthPage() {
  if (!API.token()) { location.href = '/login'; return false; }
  return true;
}

function requireAdminPage() {
  if (!requireAuthPage()) return false;
  const u = API.user();
  if (!u || u.role !== 'admin') { location.href = '/'; return false; }
  return true;
}

// Общий рендер шапки
function renderHeader(options = {}) {
  const { showAdmin, active } = options;
  const user = API.user();
  const host = document.getElementById('header-host');
  if (!host || !user) return;
  const link = (href, label, key) => {
    const cls = key === active ? 'btn btn-primary' : 'btn btn-ghost';
    return `<a href="${href}" class="${cls}">${label}</a>`;
  };
  host.innerHTML = `
    <header class="navbar">
      <div class="brand">Book<span>Cal</span></div>
      <nav class="nav-links">
        <span class="user-chip">@${user.username}${user.role === 'admin' ? ' · админ' : ''}</span>
        ${link('/', 'Календарь', 'calendar')}
        ${link('/my-bookings', 'Мои брони', 'bookings')}
        ${showAdmin ? link('/admin', 'Админ-панель', 'admin') : ''}
        <button class="btn btn-ghost" id="logout-btn">Выйти</button>
      </nav>
    </header>
  `;
  document.getElementById('logout-btn').addEventListener('click', () => {
    API.clearSession();
    location.href = '/login';
  });
}