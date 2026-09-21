const mysql = require('mysql2/promise');

/*
============================================================
AIVEN MYSQL CONNECTION POOL
============================================================
*/

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

  // SSL Connection (Required by Aiven in production)
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,

  // Helps maintain stable connections to Aiven
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

/*
============================================================
INITIALIZE DATABASE TABLES
============================================================
*/

async function initDb() {
  try {
    // 1. DRIVER PERSONAL & CONTACT DETAILS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS driver_profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        data JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_driver_user_id (user_id)
      )
    `);

    // 2. IDENTITY VERIFICATION
    await pool.query(`
      CREATE TABLE IF NOT EXISTS identity_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        verification_status VARCHAR(50) DEFAULT 'pending',
        data JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_identity_user_id (user_id),
        INDEX idx_identity_status (verification_status)
      )
    `);

    // 3. VEHICLE DETAILS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        plate_number VARCHAR(50) NULL,
        data JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_vehicle_user_id (user_id),
        INDEX idx_vehicle_plate (plate_number)
      )
    `);

    // 4. VEHICLE PROFILES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        data JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_vehicle_profile_user_id (user_id)
      )
    `);

    // 5. DRIVER & VEHICLE DOCUMENTS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        doc_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        data JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_documents_user_id (user_id),
        INDEX idx_documents_type (doc_type),
        INDEX idx_documents_status (status)
      )
    `);

    // 6. DRIVER APPLICATION
    await pool.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        current_step INT DEFAULT 1,
        status VARCHAR(50) DEFAULT 'draft',
        personal_complete BOOLEAN DEFAULT FALSE,
        contact_complete BOOLEAN DEFAULT FALSE,
        identity_complete BOOLEAN DEFAULT FALSE,
        vehicle_complete BOOLEAN DEFAULT FALSE,
        documents_complete BOOLEAN DEFAULT FALSE,
        reviewed_at DATETIME NULL,
        reviewed_by INT NULL,
        review_notes TEXT NULL,
        approved_at DATETIME NULL,
        approved_by INT NULL,
        rejected_at DATETIME NULL,
        rejected_by INT NULL,
        rejection_reason TEXT NULL,
        completed_at DATETIME NULL,
        data JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_application_user_id (user_id),
        INDEX idx_application_status (status),
        INDEX idx_application_step (current_step)
      )
    `);

    // 7. APPLICATION REVIEWS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS application_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        application_id INT NOT NULL,
        reviewer_id INT NULL,
        review_status VARCHAR(50) NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_review_application (application_id),
        INDEX idx_review_reviewer (reviewer_id),
        INDEX idx_review_status (review_status)
      )
    `);

    console.log("==============================================");
    console.log("✅ AIVEN DATABASE INITIALIZED SUCCESSFULLY");
    console.log("==============================================");
  } catch (error) {
    console.error('❌ DATABASE INITIALIZATION FAILED:', error.message);
    throw error;
  }
}

/*
============================================================
TEST AIVEN DATABASE CONNECTION
============================================================
*/

async function assertDbConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log('✅ Aiven MySQL database connected');
  } catch (error) {
    console.error('❌ Aiven database connection failed:', error.message);
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