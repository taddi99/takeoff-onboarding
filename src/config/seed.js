// One-off script to create the first admin/reviewer account.
// Usage: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function seed() {
  const email = process.env.ADMIN_EMAIL || 'admin@takeoff.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const phone = process.env.ADMIN_PHONE || '+10000000000';
  const fullName = 'TakeOFF Admin';

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? OR phone = ?', [email, phone]);
  if (existing.length) {
    console.log(`Admin already exists (id=${existing[0].id}). Nothing to do.`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash, role, phone_verified, is_active)
     VALUES (?, ?, ?, ?, 'admin', 1, 1)`,
    [fullName, email, phone, hash]
  );

  console.log('Admin user created:');
  console.log(`  id:       ${result.insertId}`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('Change this password after first login in a real deployment.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
