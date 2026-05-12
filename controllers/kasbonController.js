const fs = require('fs');
const path = require('path');
const { pool } = require('../db/pool');       // Waschen DB (employees)
const { poolIkm } = require('../db/pool');   // IKM DB (kasbon tables)
const { successResponse, errorResponse } = require('../utils/response');
const { KASBON_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/**
 * POST /api/kasbon
 * Submit a new kasbon or pinjaman request
 */
exports.submitKasbon = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { type, submission_date, purpose, amount_requested, notes } = req.body;

    if (!['kasbon', 'pinjaman'].includes(type))
      return errorResponse(res, 'Jenis pengajuan tidak valid', 400);
    if (!submission_date)
      return errorResponse(res, 'Tanggal pengajuan wajib diisi', 400);
    if (!purpose?.trim())
      return errorResponse(res, 'Keperluan/tujuan wajib diisi', 400);
    const amount = parseFloat(amount_requested);
    if (!amount || amount <= 0)
      return errorResponse(res, 'Jumlah pengajuan harus lebih dari 0', 400);

    // Fetch employee name from Waschen DB
    const [empRows] = await pool.query(
      'SELECT full_name FROM mst_employee WHERE employee_id = ? LIMIT 1',
      [employeeId]
    );
    const employeeName = empRows[0]?.full_name || 'Unknown';

    const proof_path = req.file
      ? `${KASBON_UPLOAD_PUBLIC_PATH}/${req.file.filename}`
      : null;

    const [result] = await poolIkm.query(
      `INSERT INTO tr_kasbon
         (employee_id, employee_name, type, submission_date, amount_requested, purpose, notes, proof_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employeeId,
        employeeName,
        type,
        submission_date,
        amount,
        purpose.trim(),
        notes?.trim() || null,
        proof_path,
      ]
    );

    return successResponse(res, 'Pengajuan berhasil dikirim', { id: result.insertId }, 201);
  } catch (err) {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('[kasbon] submitKasbon', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/kasbon/my-submissions
 * Get all submissions by the logged-in employee, with payment aggregates
 * Query params: startDate, endDate
 */
exports.getMySubmissions = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { startDate, endDate } = req.query;

    let sql = `
      SELECT
        k.id, k.employee_id, k.employee_name, k.type,
        k.submission_date, k.amount_requested, k.amount_approved,
        k.purpose, k.notes, k.proof_path, k.status,
        k.process_note, k.process_by_name, k.process_at,
        k.approved_note, k.approved_by_name, k.approved_at,
        k.rejection_note, k.created_at, k.updated_at,
        COALESCE((SELECT SUM(p.amount) FROM tr_kasbon_payment p WHERE p.kasbon_id = k.id), 0) AS total_paid,
        (SELECT COUNT(*) FROM tr_kasbon_payment p WHERE p.kasbon_id = k.id) AS payment_count
      FROM tr_kasbon k
      WHERE k.employee_id = ?
    `;
    const params = [employeeId];

    if (startDate) { sql += ' AND k.submission_date >= ?'; params.push(startDate); }
    if (endDate)   { sql += ' AND k.submission_date <= ?'; params.push(endDate); }

    sql += ' ORDER BY k.created_at DESC';

    const [rows] = await poolIkm.query(sql, params);
    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[kasbon] getMySubmissions', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/kasbon/:id
 * Get a single submission with payment history (for pinjaman)
 */
exports.getSubmissionById = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { id } = req.params;

    const [rows] = await poolIkm.query(
      `SELECT * FROM tr_kasbon WHERE id = ? AND employee_id = ? LIMIT 1`,
      [id, employeeId]
    );
    if (rows.length === 0) return errorResponse(res, 'Pengajuan tidak ditemukan', 404);

    const submission = rows[0];

    const [payments] = await poolIkm.query(
      `SELECT id, payment_date, amount, payment_method, notes, recorded_by_name, created_at
       FROM tr_kasbon_payment
       WHERE kasbon_id = ?
       ORDER BY payment_date ASC, created_at ASC`,
      [id]
    );
    submission.payments = payments;

    return successResponse(res, 'OK', submission);
  } catch (err) {
    console.error('[kasbon] getSubmissionById', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * PUT /api/kasbon/:id
 * Update a submission — only allowed when status = 'pengajuan'
 */
exports.updateSubmission = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { id } = req.params;

    const [existing] = await poolIkm.query(
      `SELECT id, status, proof_path FROM tr_kasbon WHERE id = ? AND employee_id = ? LIMIT 1`,
      [id, employeeId]
    );
    if (existing.length === 0)
      return errorResponse(res, 'Pengajuan tidak ditemukan', 404);
    if (existing[0].status !== 'pengajuan')
      return errorResponse(res, 'Pengajuan tidak dapat diubah karena sudah diproses', 400);

    const { type, submission_date, purpose, amount_requested, notes, remove_proof } = req.body;

    if (!['kasbon', 'pinjaman'].includes(type))
      return errorResponse(res, 'Jenis pengajuan tidak valid', 400);
    if (!submission_date)
      return errorResponse(res, 'Tanggal pengajuan wajib diisi', 400);
    if (!purpose?.trim())
      return errorResponse(res, 'Keperluan/tujuan wajib diisi', 400);
    const amount = parseFloat(amount_requested);
    if (!amount || amount <= 0)
      return errorResponse(res, 'Jumlah pengajuan harus lebih dari 0', 400);

    let proof_path = existing[0].proof_path;

    if (req.file) {
      // Replace existing with new upload
      if (proof_path) {
        const { KASBON_UPLOAD_DIR } = require('../middleware/upload');
        const oldFile = path.join(KASBON_UPLOAD_DIR, path.basename(proof_path));
        try { fs.unlinkSync(oldFile); } catch (_) {}
      }
      proof_path = `${KASBON_UPLOAD_PUBLIC_PATH}/${req.file.filename}`;
    } else if (remove_proof === '1' && proof_path) {
      // Explicitly remove without replacement
      const { KASBON_UPLOAD_DIR } = require('../middleware/upload');
      const oldFile = path.join(KASBON_UPLOAD_DIR, path.basename(proof_path));
      try { fs.unlinkSync(oldFile); } catch (_) {}
      proof_path = null;
    }

    await poolIkm.query(
      `UPDATE tr_kasbon
       SET type = ?, submission_date = ?, amount_requested = ?, purpose = ?, notes = ?, proof_path = ?
       WHERE id = ?`,
      [type, submission_date, amount, purpose.trim(), notes?.trim() || null, proof_path, id]
    );

    return successResponse(res, 'Pengajuan berhasil diperbarui', null);
  } catch (err) {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('[kasbon] updateSubmission', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * DELETE /api/kasbon/:id
 * Delete a submission — only allowed when status = 'pengajuan'
 */
exports.deleteSubmission = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { id } = req.params;

    const [existing] = await poolIkm.query(
      `SELECT id, status, proof_path FROM tr_kasbon WHERE id = ? AND employee_id = ? LIMIT 1`,
      [id, employeeId]
    );
    if (existing.length === 0)
      return errorResponse(res, 'Pengajuan tidak ditemukan', 404);
    if (existing[0].status !== 'pengajuan')
      return errorResponse(res, 'Pengajuan tidak dapat dihapus karena sudah diproses', 400);

    if (existing[0].proof_path) {
      const { KASBON_UPLOAD_DIR } = require('../middleware/upload');
      const oldFile = path.join(KASBON_UPLOAD_DIR, path.basename(existing[0].proof_path));
      try { fs.unlinkSync(oldFile); } catch (_) {}
    }

    await poolIkm.query(`DELETE FROM tr_kasbon WHERE id = ?`, [id]);
    return successResponse(res, 'Pengajuan berhasil dihapus', null);
  } catch (err) {
    console.error('[kasbon] deleteSubmission', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};
