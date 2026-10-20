// Регистрация/вход. Роль всегда 'user' при регистрации (админ — через seed)
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken } = require('../auth');

const router = express.Router();
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

router.post('/register', async (req, res) => {
  try {
    const { username, password, confirmPassword } = req.body || {};
    if (!username || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Логин: 3–32 символа (латиница, цифры, . _ -)' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Пароли не совпадают' });

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ error: 'Пользователь уже существует' });

    const hash = await bcrypt.hash(password, 10);
    // ВАЖНО: роль жёстко 'user', даже если в теле передан role
    const info = db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')"
    ).run(username, hash);

    const user = { id: Number(info.lastInsertRowid), username, role: 'user' };
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

    res.json({
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;