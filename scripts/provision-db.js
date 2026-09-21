require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function ensureTable(pool, tableName, ddl) {
  const [rows] = await pool.query(`SHOW TABLES LIKE '${tableName}'`);
  if (!rows.length) {
    await pool.query(ddl);
  }
}

async function ensureColumn(pool, tableName, columnName, definition) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
  if (!columns.some((column) => column.Field === columnName)) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function main() {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME || 'defaultdb';

  if (!host || !user || !password) {
    throw new Error('Missing MySQL environment variables: DB_HOST, DB_USER, DB_PASSWORD');
  }

  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    decimalNumbers: true
  });

  await ensureTable(pool, 'users', `CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('driver', 'admin') NOT NULL DEFAULT 'driver',
    phone_verified TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    failed_logins INT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_phone (phone)
  )`);

  await ensureTable(pool, 'otp_codes', `CREATE TABLE otp_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    phone VARCHAR(20) NOT NULL,
    purpose ENUM('signup', 'login') NOT NULL DEFAULT 'signup',
    code_hash VARCHAR(255) NOT NULL,
    provider ENUM('test', 'twilio') NOT NULL DEFAULT 'test',
    max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL,
    consumed TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_otp_phone (phone),
    KEY idx_otp_active (phone, purpose, consumed, created_at)
  )`);

  await ensureTable(pool, 'applications', `CREATE TABLE applications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    status ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME NULL,
    reviewed_at DATETIME NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    review_notes TEXT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_applications_user (user_id),
    KEY idx_applications_status (status)
  )`);

  await ensureTable(pool, 'driver_profiles', `CREATE TABLE driver_profiles (
    user_id BIGINT UNSIGNED NOT NULL,
    date_of_birth DATE NULL,
    gender ENUM('male', 'female', 'other', 'prefer_not_to_say') NULL,
    address_line1 VARCHAR(200) NULL,
    address_line2 VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    postal_code VARCHAR(20) NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'India',
    emergency_contact_name VARCHAR(150) NULL,
    emergency_contact_phone VARCHAR(20) NULL,
    years_of_experience INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
  )`);

  await ensureTable(pool, 'identity_records', `CREATE TABLE identity_records (
    user_id BIGINT UNSIGNED NOT NULL,
    id_type ENUM('national_id', 'passport', 'driver_license', 'aadhaar', 'other') NOT NULL,
    id_number VARCHAR(100) NOT NULL,
    issuing_country VARCHAR(100) NULL,
    expiry_date DATE NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
  )`);

  await ensureTable(pool, 'vehicles', `CREATE TABLE vehicles (
    user_id BIGINT UNSIGNED NOT NULL,
    vehicle_type ENUM('sedan', 'hatchback', 'suv', 'motorcycle', 'van', 'truck', 'other') NOT NULL,
    make VARCHAR(80) NOT NULL,
    model VARCHAR(80) NOT NULL,
    year SMALLINT UNSIGNED NOT NULL,
    color VARCHAR(40) NULL,
    plate_number VARCHAR(30) NOT NULL,
    seating_capacity INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
  )`);

  await ensureTable(pool, 'documents', `CREATE TABLE documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    doc_category ENUM('identity', 'vehicle') NOT NULL,
    doc_type VARCHAR(80) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )`);

  await ensureTable(pool, 'audit_log', `CREATE TABLE audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id BIGINT UNSIGNED NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NULL,
    target_id BIGINT UNSIGNED NULL,
    details TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )`);

  await ensureColumn(pool, 'users', 'full_name', "VARCHAR(150) NOT NULL DEFAULT ''");
  await ensureColumn(pool, 'users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn(pool, 'users', 'failed_logins', 'INT UNSIGNED NOT NULL DEFAULT 0');
  await ensureColumn(pool, 'users', 'locked_until', 'DATETIME NULL');
  await ensureColumn(pool, 'users', 'created_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(pool, 'users', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await ensureColumn(pool, 'applications', 'review_notes', 'TEXT NULL');
  await ensureColumn(pool, 'applications', 'reviewed_by', 'BIGINT UNSIGNED NULL');
  await ensureColumn(pool, 'applications', 'reviewed_at', 'DATETIME NULL');
  await ensureColumn(pool, 'applications', 'submitted_at', 'DATETIME NULL');

  const email = process.env.ADMIN_EMAIL || 'admin@takeoff.local';
  const phone = process.env.ADMIN_PHONE || '+10000000000';
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? OR phone = ?', [email, phone]);

  if (!existing.length) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@12345', 12);
    await pool.query(
      "INSERT INTO users (full_name, email, phone, password_hash, role, phone_verified, is_active) VALUES (?, ?, ?, ?, 'admin', 1, 1)",
      ['TakeOFF Admin', email, phone, hash]
    );
    console.log('Admin seeded successfully.');
  } else {
    console.log('Admin already exists.');
  }

  const [tables] = await pool.query('SHOW TABLES');
  const tableNames = tables.map((row) => Object.values(row)[0]);
  const required = ['users', 'otp_codes', 'applications', 'driver_profiles', 'identity_records', 'vehicles', 'documents', 'audit_log'];
  console.log('Database ready. Required tables present:', required.every((name) => tableNames.includes(name)));
  await pool.end();
}

main().catch((err) => {
  console.error('Database provisioning failed:');
  console.error(err.message);
  process.exit(1);
});
