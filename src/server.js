require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { assertDbConnection } = require('./config/db');
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Security middleware ----
app.use(helmet({contentSecurityPolicy: false}));

app.use(cors({ origin: process.env.APP_BASE_URL || true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Global rate limit as a baseline defence-in-depth (routes add tighter limits where it matters).
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

// ---- API routes ----
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback 404 for unknown API routes (kept after static so real files still resolve).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Centralized error handler (e.g. multer file-size/type errors bubble up here).
app.use((err, req, res, next) => {
  if (err) {
    console.error('Unhandled error:', err.message);
    return res.status(err.status || 400).json({ error: err.message || 'Something went wrong.' });
  }
  next();
});

async function start() {
  try {
    await assertDbConnection();
    console.log('MySQL connection OK.');
  } catch (err) {
    console.error('Could not connect to MySQL. Check your .env DB_* values and that MySQL is running.');
    console.error(err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`TakeOFF Driver Onboarding running on http://localhost:${PORT}`);
    console.log(`OTP mode: ${(process.env.OTP_MODE || 'test').toUpperCase()}`);
  });
}

start();
