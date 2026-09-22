const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'defaultdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS applications (
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS driver_profiles (
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS identity_records (
        user_id BIGINT UNSIGNED NOT NULL,
        id_type ENUM('national_id', 'passport', 'driver_license', 'aadhaar', 'other') NOT NULL,
        id_number VARCHAR(100) NOT NULL,
        issuing_country VARCHAR(100) NULL,
        expiry_date DATE NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        actor_user_id BIGINT UNSIGNED NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50) NULL,
        target_id BIGINT UNSIGNED NULL,
        details TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      )
    `);

    console.log("==============================================");
    console.log("✅ DATABASE TABLES INITIALIZED CORRECTLY");
    console.log("==============================================");
  } catch (error) {
    console.error('❌ DATABASE INITIALIZATION FAILED:', error.message);
    throw error;
  }
}

async function assertDbConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log('✅ MySQL database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  initDb,
  assertDbConnection
};
