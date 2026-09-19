const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const MODE = (process.env.OTP_MODE || 'test').toLowerCase(); // 'test' | 'twilio'
const EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

let twilioClient = null;
function getTwilioClient() {
  if (!twilioClient) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

function generateNumericCode(length = 6) {
  const max = 10 ** length;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(length, '0');
}

/**
 * Requests a new OTP for a phone number.
 * - test mode: generates (or reuses OTP_TEST_CODE) a code, stores its hash,
 *   and returns it in the response so it can be entered without real SMS.
 * - twilio mode: asks Twilio Verify to send the SMS; we still keep a local
 *   row for rate-limiting/audit purposes but Twilio owns the actual code.
 */
async function requestOtp({ phone, purpose = 'signup' }) {
  // Basic rate limiting: block if a non-expired, non-consumed OTP was issued
  // for this phone in the last 60 seconds.
  const [recent] = await pool.query(
    `SELECT id, created_at FROM otp_codes
     WHERE phone = ? AND consumed = 0 AND created_at > (NOW() - INTERVAL 60 SECOND)
     ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  if (recent.length) {
    const err = new Error('Please wait before requesting another code.');
    err.status = 429;
    throw err;
  }

  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  if (MODE === 'twilio') {
    const client = getTwilioClient();
    await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: 'sms' });

    // Twilio holds the real code; we store a placeholder row for auditing/rate-limit only.
    await pool.query(
      `INSERT INTO otp_codes (phone, purpose, code_hash, provider, max_attempts, expires_at)
       VALUES (?, ?, 'TWILIO_MANAGED', 'twilio', ?, ?)`,
      [phone, purpose, MAX_ATTEMPTS, expiresAt]
    );
    return { provider: 'twilio', sent: true };
  }

  // ---- test mode ----
  const code = process.env.OTP_TEST_CODE || generateNumericCode(6);
  const codeHash = await bcrypt.hash(code, 10);

  await pool.query(
    `INSERT INTO otp_codes (phone, purpose, code_hash, provider, max_attempts, expires_at)
     VALUES (?, ?, ?, 'test', ?, ?)`,
    [phone, purpose, codeHash, MAX_ATTEMPTS, expiresAt]
  );

  // Log for the developer/demo — never do this with real user codes in production.
  console.log(`[OTP:test] phone=${phone} purpose=${purpose} code=${code} (expires in ${EXPIRY_MINUTES}m)`);

  return { provider: 'test', sent: true, testCode: code };
}

/**
 * Verifies a submitted OTP code for a phone number.
 */
async function verifyOtp({ phone, code, purpose = 'signup' }) {
  if (MODE === 'twilio') {
    const client = getTwilioClient();
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    if (check.status !== 'approved') {
      return { verified: false, reason: 'Incorrect or expired code.' };
    }

    await pool.query(
      `UPDATE otp_codes SET consumed = 1
       WHERE phone = ? AND purpose = ? AND consumed = 0
       ORDER BY id DESC LIMIT 1`,
      [phone, purpose]
    );
    return { verified: true };
  }

  // ---- test mode ----
  const [rows] = await pool.query(
    `SELECT * FROM otp_codes
     WHERE phone = ? AND purpose = ? AND consumed = 0
     ORDER BY id DESC LIMIT 1`,
    [phone, purpose]
  );

  if (!rows.length) return { verified: false, reason: 'No pending code. Request a new one.' };
  const row = rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { verified: false, reason: 'Code expired. Request a new one.' };
  }
  if (row.attempts >= row.max_attempts) {
    return { verified: false, reason: 'Too many attempts. Request a new code.' };
  }

  const match = await bcrypt.compare(code, row.code_hash);
  await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);

  if (!match) return { verified: false, reason: 'Incorrect code.' };

  await pool.query('UPDATE otp_codes SET consumed = 1 WHERE id = ?', [row.id]);
  return { verified: true };
}

module.exports = { requestOtp, verifyOtp, MODE };
