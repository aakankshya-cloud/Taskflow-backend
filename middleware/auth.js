const jwt = require('jsonwebtoken');
const db = require('../config/db');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Load the user fresh from the DB rather than trusting only the JWT
    // payload. This also means a deleted user's old token stops working.
    const [rows] = await db.query('SELECT id, name, email FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) return res.status(401).json({ message: 'Invalid token' });

    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};
