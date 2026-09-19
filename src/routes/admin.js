const express = require('express');
const path = require('path');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { UPLOAD_DIR } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

/**
 * GET /api/admin/applications?status=submitted
 * Lists applications, optionally filtered by status, newest first.
 */
router.get('/applications', async (req, res) => {
  const { status } = req.query;
  const validStatuses = ['draft', 'submitted', 'under_review', 'approved', 'rejected'];
  try {
    let sql = `
      SELECT a.id AS application_id, a.status, a.submitted_at, a.reviewed_at, a.review_notes,
             u.id AS user_id, u.full_name, u.email, u.phone
      FROM applications a
      JOIN users u ON u.id = a.user_id
      WHERE u.role = 'driver'`;
    const params = [];
    if (status && validStatuses.includes(status)) {
      sql += ' AND a.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY COALESCE(a.submitted_at, a.created_at) DESC';

    const [rows] = await pool.query(sql, params);
    res.json({ applications: rows });
  } catch (err) {
    console.error('list applications error:', err.message);
    res.status(500).json({ error: 'Could not load applications.' });
  }
});

/**
 * GET /api/admin/applications/:userId
 * Full detail of one driver's application for review.
 */
router.get('/applications/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id.' });

  try {
    const [[userRows], [profile], [identity], [vehicle], [documents], [application]] = await Promise.all([
      pool.query('SELECT id, full_name, email, phone, phone_verified, created_at FROM users WHERE id = ? AND role = "driver"', [userId]),
      pool.query('SELECT * FROM driver_profiles WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM identity_records WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM vehicles WHERE user_id = ?', [userId]),
      pool.query('SELECT id, doc_category, doc_type, original_name, mime_type, size_bytes, uploaded_at FROM documents WHERE user_id = ? ORDER BY doc_category', [userId]),
      pool.query('SELECT * FROM applications WHERE user_id = ?', [userId])
    ]);

    if (!userRows.length) return res.status(404).json({ error: 'Driver not found.' });

    res.json({
      driver: userRows[0],
      profile: profile[0] || null,
      identity: identity[0] || null,
      vehicle: vehicle[0] || null,
      documents,
      application: application[0] || null
    });
  } catch (err) {
    console.error('application detail error:', err.message);
    res.status(500).json({ error: 'Could not load application.' });
  }
});

/**
 * GET /api/admin/documents/:documentId/file
 * Streams a document file to an authenticated admin only (never publicly served).
 */
router.get('/documents/:documentId/file', async (req, res) => {
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId)) return res.status(400).json({ error: 'Invalid document id.' });

  try {
    const [rows] = await pool.query('SELECT * FROM documents WHERE id = ?', [documentId]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found.' });

    const doc = rows[0];
    const absolutePath = path.resolve(process.cwd(), doc.stored_path);
    // Guard against path traversal: resolved path must stay inside the upload dir.
    if (!absolutePath.startsWith(path.resolve(UPLOAD_DIR))) {
      return res.status(400).json({ error: 'Invalid document path.' });
    }
    res.setHeader('Content-Disposition', `inline; filename="${doc.original_name.replace(/"/g, '')}"`);
    res.sendFile(absolutePath);
  } catch (err) {
    console.error('document file error:', err.message);
    res.status(500).json({ error: 'Could not load document.' });
  }
});

/**
 * POST /api/admin/applications/:userId/decision
 * Approve or reject a submitted/under_review application.
 */
router.post(
  '/applications/:userId/decision',
  [
    body('decision').isIn(['approved', 'rejected']).withMessage('Decision must be "approved" or "rejected".'),
    body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 2000 })
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id.' });

    const { decision, notes } = req.body;

    try {
      const [rows] = await pool.query('SELECT status FROM applications WHERE user_id = ?', [userId]);
      if (!rows.length) return res.status(404).json({ error: 'Application not found.' });
      if (!['submitted', 'under_review'].includes(rows[0].status)) {
        return res.status(409).json({ error: `Cannot decide on an application with status "${rows[0].status}".` });
      }

      await pool.query(
        `UPDATE applications
         SET status = ?, reviewed_at = NOW(), reviewed_by = ?, review_notes = ?
         WHERE user_id = ?`,
        [decision, req.user.id, notes || null, userId]
      );
      await pool.query(
        `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, details)
         VALUES (?, ?, 'application', ?, ?)`,
        [req.user.id, `application_${decision}`, userId, notes || null]
      );

      res.json({ message: `Application ${decision}.` });
    } catch (err) {
      console.error('decision error:', err.message);
      res.status(500).json({ error: 'Could not record decision.' });
    }
  }
);

/**
 * POST /api/admin/applications/:userId/mark-review
 * Moves a submitted application into "under_review" (optional workflow step).
 */
router.post('/applications/:userId/mark-review', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id.' });

  try {
    const [result] = await pool.query(
      `UPDATE applications SET status = 'under_review' WHERE user_id = ? AND status = 'submitted'`,
      [userId]
    );
    if (!result.affectedRows) {
      return res.status(409).json({ error: 'Application is not in a submitted state.' });
    }
    res.json({ message: 'Marked as under review.' });
  } catch (err) {
    console.error('mark-review error:', err.message);
    res.status(500).json({ error: 'Could not update application.' });
  }
});

module.exports = router;
