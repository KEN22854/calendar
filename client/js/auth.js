// Логика страниц входа/регистрации
(function () {
  if (API.token()) { location.href = '/'; return; }

  const loading = document.getElementById('loading');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(loginForm);
      const username = (fd.get('username') || '').trim();
      const password = fd.get('password') || '';
      loading.classList.add('show');
      try {
        const data = await API.request('/api/login', {
          method: 'POST', body: { username, password }
        });
        API.setSession(data.token, data.user);
        location.href = data.user.role === 'admin' ? '/admin' : '/';
      } catch (err) { toast(err.message, 'error'); }
      finally { loading.classList.remove('show'); }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(registerForm);
      const username = (fd.get('username') || '').trim();
      const password = fd.get('password') || '';
      const confirmPassword = fd.get('confirmPassword') || '';
      if (password !== confirmPassword) { toast('Пароли не совпадают', 'error'); return; }
      loading.classList.add('show');
      try {
        const data = await API.request('/api/register', {
          method: 'POST', body: { username, password, confirmPassword }
        });
        API.setSession(data.token, data.user);
        toast('Регистрация успешна', 'success');
        location.href = '/';
      } catch (err) { toast(err.message, 'error'); }
      finally { loading.classList.remove('show'); }
    });
  }
})();