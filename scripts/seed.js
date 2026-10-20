// Ручной seed админа: `npm run seed`
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../server/db');

(async () => {
  const login = (process.env.ADMIN_LOGIN || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD || 'admin12345';
  const hash = await bcrypt.hash(password, 10);
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(login);
  if (exists) {
    db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?").run(hash, exists.id);
    console.log(`Пользователь ${login} повышен до администратора (пароль обновлён)`);
  } else {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run(login, hash);
    console.log(`Администратор ${login} создан`);
  }
  process.exit(0);
})();