const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requestOtp, verifyOtp } = require('../utils/otp');

const router = express.Router();

// Tight limiter specifically for OTP + login endpoints to blunt brute force / SMS abuse.
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, phone: user.phone, fullName: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/**
 * POST /api/auth/signup
 * Creates an unverified driver account (phone not yet verified).
 */
router.post(
  '/signup',
  [
    body('fullName').trim().isLength({ min: 2, max: 150 }).withMessage('Full name is required.'),
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('phone').matches(/^\+[1-9]\d{7,14}$/).withMessage('Phone must be in E.164 format, e.g. +14155550123.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { fullName, email, phone, password } = req.body;

    try {
      const [dupe] = await pool.query('SELECT id FROM users WHERE email = ? OR phone = ?', [email, phone]);
      if (dupe.length) {
        return res.status(409).json({ error: 'An account with this email or phone already exists.' });
      }

      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role, phone_verified)
         VALUES (?, ?, ?, ?, 'driver', 0)`,
        [fullName, email, phone, hash]
      );

      await pool.query(`INSERT INTO applications (user_id, status) VALUES (?, 'draft')`, [result.insertId]);

      res.status(201).json({ message: 'Account created. Verify your phone to continue.', userId: result.insertId, phone });
    } catch (err) {
      console.error('signup error:', err.message);
      res.status(500).json({ error: 'Could not create account. Please try again.' });
    }
  }
);

/**
 * POST /api/auth/otp/request
 * Sends (or simulates, in test mode) an OTP to the given phone.
 */
router.post(
  '/otp/request',
  otpLimiter,
  [
    body('phone').matches(/^\+[1-9]\d{7,14}$/).withMessage('A valid phone number is required.'),
    body('purpose').optional().isIn(['signup', 'login'])
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { phone, purpose = 'signup' } = req.body;

    try {
      const [users] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
      if (!users.length) {
        return res.status(404).json({ error: 'No account found with this phone number.' });
      }

      const result = await requestOtp({ phone, purpose });
      // testCode is only ever included when OTP_MODE=test, purely to support the demo.
      res.json({
        message: result.provider === 'twilio' ? 'Verification code sent via SMS.' : 'Test verification code generated.',
        provider: result.provider,
        ...(result.testCode ? { testCode: result.testCode } : {})
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('otp/request error:', err.message);
      res.status(status).json({ error: err.status ? err.message : 'Could not send verification code.' });
    }
  }
);

/**
 * POST /api/auth/otp/verify
 * Verifies the OTP. On purpose=signup, marks phone_verified and returns a session token.
 */
router.post(
  '/otp/verify',
  otpLimiter,
  [
    body('phone').matches(/^\+[1-9]\d{7,14}$/).withMessage('A valid phone number is required.'),
    body('code').trim().isLength({ min: 4, max: 10 }).withMessage('Enter the verification code.'),
    body('purpose').optional().isIn(['signup', 'login'])
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { phone, code, purpose = 'signup' } = req.body;

    try {
      const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
      if (!users.length) return res.status(404).json({ error: 'No account found with this phone number.' });
      const user = users[0];

      const result = await verifyOtp({ phone, code, purpose });
      if (!result.verified) {
        return res.status(400).json({ error: result.reason || 'Verification failed.' });
      }

      if (!user.phone_verified) {
        await pool.query('UPDATE users SET phone_verified = 1 WHERE id = ?', [user.id]);
      }

      const token = signToken({ ...user, phone_verified: 1 });
      res.json({
        message: 'Phone verified.',
        token,
        user: { id: user.id, fullName: user.full_name, email: user.email, phone: user.phone, role: user.role }
      });
    } catch (err) {
      console.error('otp/verify error:', err.message);
      res.status(500).json({ error: 'Could not verify code. Please try again.' });
    }
  }
);

/**
 * POST /api/auth/login
 * Standard email + password login. Locks the account briefly after repeated failures.
 */
router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.')
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const { email, password } = req.body;

    try {
      const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      // Same generic error whether the email exists or not — avoids account enumeration.
      const genericError = () => res.status(401).json({ error: 'Invalid email or password.' });

      if (!rows.length) return genericError();
      const user = rows[0];

      if (!user.is_active) {
        return res.status(403).json({ error: 'This account has been deactivated.' });
      }
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(423).json({ error: 'Account temporarily locked due to repeated failed attempts. Try again later.' });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        const failed = user.failed_logins + 1;
        const lockUntil = failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await pool.query('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [failed, lockUntil, user.id]);
        return genericError();
      }

      await pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [user.id]);

      if (user.role === 'driver' && !user.phone_verified) {
        return res.status(403).json({ error: 'Phone not verified yet.', requiresOtp: true, phone: user.phone });
      }

      const token = signToken(user);
      res.json({
        message: 'Signed in.',
        token,
        user: { id: user.id, fullName: user.full_name, email: user.email, phone: user.phone, role: user.role }
      });
    } catch (err) {
      console.error('login error:', err.message);
      res.status(500).json({ error: 'Could not sign in. Please try again.' });
    }
  }
);

module.exports = router;
