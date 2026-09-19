const express = require('express');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload, UPLOAD_DIR } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth, requireRole('driver'));

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

async function ensureEditable(userId, res) {
  const [rows] = await pool.query('SELECT status FROM applications WHERE user_id = ?', [userId]);
  const status = rows[0]?.status;
  if (status === 'submitted' || status === 'under_review' || status === 'approved') {
    res.status(409).json({ error: `Application is ${status} and can no longer be edited.` });
    return false;
  }
  return true;
}

/**
 * PUT /api/onboarding/personal
 * Personal & contact details.
 */
router.put(
  '/personal',
  [
    body('dateOfBirth').optional({ checkFalsy: true }).isISO8601().withMessage('Enter a valid date of birth.'),
    body('gender').optional({ checkFalsy: true }).isIn(['male', 'female', 'other', 'prefer_not_to_say']),
    body('addressLine1').trim().isLength({ min: 3, max: 200 }).withMessage('Address is required.'),
    body('city').trim().isLength({ min: 1, max: 100 }).withMessage('City is required.'),
    body('state').trim().isLength({ min: 1, max: 100 }).withMessage('State/province is required.'),
    body('postalCode').trim().isLength({ min: 1, max: 20 }).withMessage('Postal code is required.'),
    body('emergencyContactName').optional({ checkFalsy: true }).trim().isLength({ max: 150 }),
    body('emergencyContactPhone').optional({ checkFalsy: true }).matches(/^\+[1-9]\d{7,14}$/).withMessage('Emergency contact phone must be in E.164 format.')
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    if (!(await ensureEditable(req.user.id, res))) return;

    const {
      dateOfBirth, gender, addressLine1, addressLine2, city, state,
      postalCode, country, emergencyContactName, emergencyContactPhone, yearsOfExperience
    } = req.body;

    try {
      await pool.query(
        `INSERT INTO driver_profiles
           (user_id, date_of_birth, gender, address_line1, address_line2, city, state, postal_code, country,
            emergency_contact_name, emergency_contact_phone, years_of_experience)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           date_of_birth = VALUES(date_of_birth), gender = VALUES(gender),
           address_line1 = VALUES(address_line1), address_line2 = VALUES(address_line2),
           city = VALUES(city), state = VALUES(state), postal_code = VALUES(postal_code),
           country = VALUES(country), emergency_contact_name = VALUES(emergency_contact_name),
           emergency_contact_phone = VALUES(emergency_contact_phone), years_of_experience = VALUES(years_of_experience)`,
        [req.user.id, dateOfBirth || null, gender || null, addressLine1, addressLine2 || null, city, state,
          postalCode, country || 'India', emergencyContactName || null, emergencyContactPhone || null,
          yearsOfExperience || null]
      );
      res.json({ message: 'Personal details saved.' });
    } catch (err) {
      console.error('personal details error:', err.message);
      res.status(500).json({ error: 'Could not save personal details.' });
    }
  }
);

/**
 * PUT /api/onboarding/identity
 * Identity verification details (document metadata; files uploaded separately).
 */
router.put(
  '/identity',
  [
    body('idType').isIn(['national_id', 'passport', 'driver_license', 'aadhaar', 'other']).withMessage('Select an ID type.'),
    body('idNumber').trim().isLength({ min: 3, max: 100 }).withMessage('ID number is required.'),
    body('issuingCountry').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
    body('expiryDate').optional({ checkFalsy: true }).isISO8601().withMessage('Enter a valid expiry date.')
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    if (!(await ensureEditable(req.user.id, res))) return;

    const { idType, idNumber, issuingCountry, expiryDate } = req.body;
    try {
      await pool.query(
        `INSERT INTO identity_records (user_id, id_type, id_number, issuing_country, expiry_date)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           id_type = VALUES(id_type), id_number = VALUES(id_number),
           issuing_country = VALUES(issuing_country), expiry_date = VALUES(expiry_date)`,
        [req.user.id, idType, idNumber, issuingCountry || null, expiryDate || null]
      );
      res.json({ message: 'Identity details saved.' });
    } catch (err) {
      console.error('identity error:', err.message);
      res.status(500).json({ error: 'Could not save identity details.' });
    }
  }
);

/**
 * PUT /api/onboarding/vehicle
 * Vehicle details.
 */
router.put(
  '/vehicle',
  [
    body('vehicleType').isIn(['sedan', 'hatchback', 'suv', 'motorcycle', 'van', 'truck', 'other']).withMessage('Select a vehicle type.'),
    body('make').trim().isLength({ min: 1, max: 80 }).withMessage('Vehicle make is required.'),
    body('model').trim().isLength({ min: 1, max: 80 }).withMessage('Vehicle model is required.'),
    body('year').isInt({ min: 1980, max: new Date().getFullYear() + 1 }).withMessage('Enter a valid vehicle year.'),
    body('plateNumber').trim().isLength({ min: 2, max: 30 }).withMessage('Plate number is required.'),
    body('color').optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
    body('seatingCapacity').optional({ checkFalsy: true }).isInt({ min: 1, max: 60 })
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    if (!(await ensureEditable(req.user.id, res))) return;

    const { vehicleType, make, model, year, color, plateNumber, seatingCapacity } = req.body;
    try {
      await pool.query(
        `INSERT INTO vehicles (user_id, vehicle_type, make, model, year, color, plate_number, seating_capacity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           vehicle_type = VALUES(vehicle_type), make = VALUES(make), model = VALUES(model),
           year = VALUES(year), color = VALUES(color), plate_number = VALUES(plate_number),
           seating_capacity = VALUES(seating_capacity)`,
        [req.user.id, vehicleType, make, model, year, color || null, plateNumber, seatingCapacity || null]
      );
      res.json({ message: 'Vehicle details saved.' });
    } catch (err) {
      console.error('vehicle error:', err.message);
      res.status(500).json({ error: 'Could not save vehicle details.' });
    }
  }
);

/**
 * POST /api/onboarding/documents
 * Uploads a single document (identity or vehicle). Field name: "file".
 * Body: docCategory ('identity'|'vehicle'), docType (e.g. 'license', 'rc_book', 'selfie').
 */
router.post('/documents', upload.single('file'), async (req, res) => {
  if (!(await ensureEditable(req.user.id, res))) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return;
  }

  const { docCategory, docType } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!['identity', 'vehicle'].includes(docCategory)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'docCategory must be "identity" or "vehicle".' });
  }
  if (!docType || typeof docType !== 'string') {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'docType is required.' });
  }

  try {
    const relPath = path.relative(process.cwd(), req.file.path);
    const [result] = await pool.query(
      `INSERT INTO documents (user_id, doc_category, doc_type, original_name, stored_path, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, docCategory, docType, req.file.originalname, relPath, req.file.mimetype, req.file.size]
    );
    res.status(201).json({ message: 'Document uploaded.', documentId: result.insertId });
  } catch (err) {
    console.error('document upload error:', err.message);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Could not save document.' });
  }
});

/**
 * GET /api/onboarding/me
 * Returns everything the driver has filled in so far, plus application status.
 */
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;
    const [[profile], [identity], [vehicle], [documents], [application]] = await Promise.all([
      pool.query('SELECT * FROM driver_profiles WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM identity_records WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM vehicles WHERE user_id = ?', [userId]),
      pool.query('SELECT id, doc_category, doc_type, original_name, uploaded_at FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC', [userId]),
      pool.query('SELECT * FROM applications WHERE user_id = ?', [userId])
    ]);

    res.json({
      profile: profile[0] || null,
      identity: identity[0] || null,
      vehicle: vehicle[0] || null,
      documents,
      application: application[0] || null
    });
  } catch (err) {
    console.error('me error:', err.message);
    res.status(500).json({ error: 'Could not load your application.' });
  }
});

/**
 * POST /api/onboarding/submit
 * Final review/submission step. Requires all required pieces to be present.
 */
router.post('/submit', async (req, res) => {
  const userId = req.user.id;
  try {
    const [[profileRows], [identityRows], [vehicleRows], [docRows], [appRows]] = await Promise.all([
      pool.query('SELECT id FROM driver_profiles WHERE user_id = ?', [userId]),
      pool.query('SELECT id FROM identity_records WHERE user_id = ?', [userId]),
      pool.query('SELECT id FROM vehicles WHERE user_id = ?', [userId]),
      pool.query('SELECT doc_category FROM documents WHERE user_id = ?', [userId]),
      pool.query('SELECT status FROM applications WHERE user_id = ?', [userId])
    ]);

    if (appRows[0]?.status && appRows[0].status !== 'draft') {
      return res.status(409).json({ error: `Application already ${appRows[0].status}.` });
    }

    const missing = [];
    if (!profileRows.length) missing.push('personal & contact details');
    if (!identityRows.length) missing.push('identity verification details');
    if (!vehicleRows.length) missing.push('vehicle details');
    const hasIdentityDoc = docRows.some((d) => d.doc_category === 'identity');
    const hasVehicleDoc = docRows.some((d) => d.doc_category === 'vehicle');
    if (!hasIdentityDoc) missing.push('at least one identity document');
    if (!hasVehicleDoc) missing.push('at least one vehicle document');

    if (missing.length) {
      return res.status(400).json({ error: `Please complete: ${missing.join(', ')}.` });
    }

    await pool.query(
      `UPDATE applications SET status = 'submitted', submitted_at = NOW() WHERE user_id = ?`,
      [userId]
    );
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, details)
       VALUES (?, 'application_submitted', 'application', ?, NULL)`,
      [userId, userId]
    );

    res.json({ message: 'Application submitted for review.' });
  } catch (err) {
    console.error('submit error:', err.message);
    res.status(500).json({ error: 'Could not submit application.' });
  }
});

module.exports = router;
