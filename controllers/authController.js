const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const { sendPasswordResetEmail } = require('../utils/mailer');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

exports.signup = async (req, res) => {
  try {
    const { name, email, password, workspaceName, mode, inviteCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashedPassword]
    );

    const userId = result.insertId;

    if (mode === 'create' && workspaceName) {
      const [workspace] = await db.query(
        'INSERT INTO workspaces (name, owner_id) VALUES (?, ?)',
        [workspaceName, userId]
      );
      await db.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
        [workspace.insertId, userId, 'admin']
      );
    }

    if (mode === 'join' && inviteCode) {
      const [codes] = await db.query(
        'SELECT * FROM invite_codes WHERE code = ? AND used = 0',
        [inviteCode]
      );

      if (codes.length === 0) {
        return res.status(400).json({ message: 'Invalid or already used invite code' });
      }

      const invite = codes[0];

      await db.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
        [invite.workspace_id, userId, invite.role]
      );

      await db.query('UPDATE invite_codes SET used = 1 WHERE id = ?', [invite.id]);
    }

    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: { id: userId, name, email }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/auth/forgot-password
// Always responds with the same generic message whether or not the email
// exists in the DB — this prevents user enumeration (an attacker probing
// which emails are registered by watching for different responses).
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [email]);

    if (rows.length > 0) {
      const user = rows[0];

      // Generate a random token; store only its hash (like a password) so
      // that a DB leak alone can't be used to reset accounts. The raw
      // token is what goes in the emailed link.
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await db.query(
        'UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?',
        [tokenHash, expiresAt, user.id]
      );

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

      await sendPasswordResetEmail(email, resetUrl);
    }

    // Same response regardless of whether the account exists.
    res.status(200).json({
      message: 'If an account exists for that email, a reset link has been sent.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const [rows] = await db.query(
      'SELECT id, reset_token_expires FROM users WHERE reset_token_hash = ?',
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: 'This link is invalid or has expired.' });
    }

    const user = rows[0];
    if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ message: 'This link is invalid or has expired.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Clear the token on use so it can't be replayed.
    await db.query(
      'UPDATE users SET password = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};