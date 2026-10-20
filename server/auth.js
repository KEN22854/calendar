// JWT-хелперы + middleware requireAuth / requireAdmin
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'user' },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// Проверка роли: используется на всех /api/admin/*
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }
  next();
}

module.exports = { signToken, requireAuth, requireAdmin };