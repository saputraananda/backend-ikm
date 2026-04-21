const path = require('path');
const fs = require('fs');
const { poolIkm: pool } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');
const { LEAVE_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/* ── helpers ── */
const getTodayDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * GET /api/leave/today
 * Returns the active leave entry (status = pengajuan | disetujui) for today
 * so AbsensiPage / ValetPage can check whether to lock itself.
 */
exports.getTodayLeave = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    const today = getTodayDate();

    const [rows] = await pool.query(
      `SELECT id, leave_type, duration_type, start_date, end_date, reason, status, doctor_note_path
       FROM tr_employee_leaves
       WHERE employee_id = ?
         AND start_date <= ?
         AND end_date   >= ?
         AND status IN ('pengajuan', 'disetujui')
       ORDER BY created_at DESC
       LIMIT 1`,
      [employeeId, today, today]
    );

    return successResponse(res, 'OK', rows[0] || null);
  } catch (err) {
    console.error('[leave] getTodayLeave', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/leave/list?page=1&limit=10
 * Returns the leave history for the logged-in employee, newest first.
 */
exports.getLeaveList = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const offset = (page - 1) * limit;

    // Period filter: company period = 26th prev month to 25th current month
    const month = parseInt(req.query.month || '0', 10);
    const year  = parseInt(req.query.year  || '0', 10);
    let periodWhere = '';
    const periodParams = [];
    if (month >= 1 && month <= 12 && year >= 2000) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear  = month === 1 ? year - 1 : year;
      const periodStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-26`;
      const periodEnd   = `${year}-${String(month).padStart(2, '0')}-25`;
      periodWhere = ' AND start_date <= ? AND end_date >= ?';
      periodParams.push(periodEnd, periodStart);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM tr_employee_leaves WHERE employee_id = ?${periodWhere}`,
      [employeeId, ...periodParams]
    );

    const [rows] = await pool.query(
      `SELECT id, leave_type, duration_type, start_date, end_date, reason,
              status, rejection_note, doctor_note_path, created_at, updated_at
       FROM tr_employee_leaves
       WHERE employee_id = ?${periodWhere}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [employeeId, ...periodParams, limit, offset]
    );

    return successResponse(res, 'OK', { total, page, limit, items: rows });
  } catch (err) {
    console.error('[leave] getLeaveList', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * POST /api/leave
 * Submit a new leave request.
 * Body (multipart/form-data):
 *   leave_type       : 'izin' | 'sakit' | 'cuti'
 *   duration_type    : 'full_day' | 'half_day_morning' | 'half_day_afternoon'
 *   start_date       : YYYY-MM-DD
 *   end_date         : YYYY-MM-DD
 *   reason           : string (required)
 *   doctor_note      : file (required when leave_type = 'sakit')
 */
exports.submitLeave = async (req, res) => {
  // If a file was uploaded but validation fails later, clean it up.
  const uploadedFilePath = req.file ? req.file.path : null;
  const cleanupFile = () => {
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath, () => {});
    }
  };

  try {
    const employeeId = req.user?.employee_id;
    const { leave_type, duration_type = 'full_day', start_date, end_date, reason } = req.body;

    /* ── validation ── */
    if (!['izin', 'sakit', 'cuti'].includes(leave_type)) {
      cleanupFile();
      return errorResponse(res, 'leave_type tidak valid', 422);
    }
    if (!['full_day', 'half_day_morning', 'half_day_afternoon'].includes(duration_type)) {
      cleanupFile();
      return errorResponse(res, 'duration_type tidak valid', 422);
    }
    if (!start_date || !end_date) {
      cleanupFile();
      return errorResponse(res, 'start_date dan end_date wajib diisi', 422);
    }
    if (start_date > end_date) {
      cleanupFile();
      return errorResponse(res, 'end_date tidak boleh sebelum start_date', 422);
    }
    if (!reason || reason.trim().length < 5) {
      cleanupFile();
      return errorResponse(res, 'Keterangan wajib diisi minimal 5 karakter', 422);
    }
    if (leave_type === 'sakit' && !req.file) {
      cleanupFile();
      return errorResponse(res, 'Foto surat dokter wajib dilampirkan untuk izin sakit', 422);
    }

    // Half-day only makes sense for single-day requests
    if (duration_type !== 'full_day' && start_date !== end_date) {
      cleanupFile();
      return errorResponse(res, 'Izin setengah hari hanya berlaku untuk 1 hari', 422);
    }

    /* ── check for overlapping active leaves ── */
    const [overlap] = await pool.query(
      `SELECT id FROM tr_employee_leaves
       WHERE employee_id = ?
         AND status IN ('pengajuan', 'disetujui')
         AND start_date <= ? AND end_date >= ?`,
      [employeeId, end_date, start_date]
    );
    if (overlap.length > 0) {
      cleanupFile();
      return errorResponse(res, 'Anda sudah memiliki pengajuan izin aktif pada rentang tanggal tersebut', 409);
    }

    const doctorNotePath = req.file
      ? `${LEAVE_UPLOAD_PUBLIC_PATH}/${req.file.filename}`
      : null;

    const [result] = await pool.query(
      `INSERT INTO tr_employee_leaves
         (employee_id, leave_type, duration_type, start_date, end_date, reason, doctor_note_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pengajuan')`,
      [employeeId, leave_type, duration_type, start_date, end_date, reason.trim(), doctorNotePath]
    );

    const [inserted] = await pool.query(
      'SELECT * FROM tr_employee_leaves WHERE id = ?',
      [result.insertId]
    );

    return successResponse(res, 'Pengajuan izin berhasil dikirim', inserted[0], 201);
  } catch (err) {
    cleanupFile();
    console.error('[leave] submitLeave', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * PUT /api/leave/:id
 * Edit a leave request. Only allowed if status = 'pengajuan'.
 */
exports.updateLeave = async (req, res) => {
  const uploadedFilePath = req.file ? req.file.path : null;
  const cleanupFile = () => {
    if (uploadedFilePath) fs.unlink(uploadedFilePath, () => {});
  };

  try {
    const employeeId = req.user?.employee_id;
    const { id } = req.params;
    const { leave_type, duration_type, start_date, end_date, reason } = req.body;

    const [[existing]] = await pool.query(
      'SELECT * FROM tr_employee_leaves WHERE id = ? AND employee_id = ?',
      [id, employeeId]
    );
    if (!existing) {
      cleanupFile();
      return errorResponse(res, 'Pengajuan tidak ditemukan', 404);
    }
    if (existing.status !== 'pengajuan') {
      cleanupFile();
      return errorResponse(res, 'Pengajuan yang sudah diproses tidak dapat diubah', 403);
    }

    const newLeaveType    = leave_type    || existing.leave_type;
    const newDurationType = duration_type || existing.duration_type;
    const newStartDate    = start_date    || existing.start_date;
    const newEndDate      = end_date      || existing.end_date;
    const newReason       = reason        ? reason.trim() : existing.reason;

    if (!['izin', 'sakit', 'cuti'].includes(newLeaveType)) {
      cleanupFile();
      return errorResponse(res, 'leave_type tidak valid', 422);
    }
    if (!['full_day', 'half_day_morning', 'half_day_afternoon'].includes(newDurationType)) {
      cleanupFile();
      return errorResponse(res, 'duration_type tidak valid', 422);
    }
    if (newStartDate > newEndDate) {
      cleanupFile();
      return errorResponse(res, 'end_date tidak boleh sebelum start_date', 422);
    }
    if (!newReason || newReason.length < 5) {
      cleanupFile();
      return errorResponse(res, 'Keterangan wajib diisi minimal 5 karakter', 422);
    }
    if (newDurationType !== 'full_day' && newStartDate !== newEndDate) {
      cleanupFile();
      return errorResponse(res, 'Izin setengah hari hanya berlaku untuk 1 hari', 422);
    }

    // If type changed to sakit and no file uploaded and no existing doctor note → reject
    if (newLeaveType === 'sakit' && !req.file && !existing.doctor_note_path) {
      cleanupFile();
      return errorResponse(res, 'Foto surat dokter wajib dilampirkan untuk izin sakit', 422);
    }

    /* overlap check (exclude self) */
    const [overlap] = await pool.query(
      `SELECT id FROM tr_employee_leaves
       WHERE employee_id = ? AND id <> ?
         AND status IN ('pengajuan', 'disetujui')
         AND start_date <= ? AND end_date >= ?`,
      [employeeId, id, newEndDate, newStartDate]
    );
    if (overlap.length > 0) {
      cleanupFile();
      return errorResponse(res, 'Terdapat pengajuan izin aktif lain pada rentang tanggal tersebut', 409);
    }

    let newDoctorNotePath = existing.doctor_note_path;
    if (req.file) {
      // Remove old file
      if (existing.doctor_note_path) {
        const { STORAGE_BASE_DIR } = require('../middleware/upload');
        const oldAbs = path.join(STORAGE_BASE_DIR, existing.doctor_note_path.replace(/^\/storage\//, ''));
        fs.unlink(oldAbs, () => {});
      }
      newDoctorNotePath = `${LEAVE_UPLOAD_PUBLIC_PATH}/${req.file.filename}`;
    } else if (newLeaveType !== 'sakit') {
      // Type changed away from sakit → remove doctor note
      newDoctorNotePath = null;
    }

    await pool.query(
      `UPDATE tr_employee_leaves
       SET leave_type = ?, duration_type = ?, start_date = ?, end_date = ?,
           reason = ?, doctor_note_path = ?, updated_at = NOW()
       WHERE id = ?`,
      [newLeaveType, newDurationType, newStartDate, newEndDate, newReason, newDoctorNotePath, id]
    );

    const [[updated]] = await pool.query('SELECT * FROM tr_employee_leaves WHERE id = ?', [id]);
    return successResponse(res, 'Pengajuan berhasil diperbarui', updated);
  } catch (err) {
    cleanupFile();
    console.error('[leave] updateLeave', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/leave/years
 * Returns distinct years that have leave records for the employee.
 * Always includes the current year.
 */
exports.getLeaveYears = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    const [rows] = await pool.query(
      `SELECT DISTINCT YEAR(start_date) AS yr
       FROM tr_employee_leaves
       WHERE employee_id = ?
       ORDER BY yr DESC`,
      [employeeId]
    );
    const currentYear = new Date().getFullYear();
    const years = rows.map(r => Number(r.yr));
    if (!years.includes(currentYear)) years.unshift(currentYear);
    return successResponse(res, 'OK', years);
  } catch (err) {
    console.error('[leave] getLeaveYears', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/leave/stats?month=4&year=2026
 * Returns count per leave_type for the given company period.
 * Period: 26th of (month-1) to 25th of month.
 */
exports.getLeaveStats = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    const month = parseInt(req.query.month || '0', 10);
    const year  = parseInt(req.query.year  || '0', 10);

    let whereClause = 'WHERE employee_id = ?';
    const params = [employeeId];

    if (month >= 1 && month <= 12 && year >= 2000) {
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear  = month === 1 ? year - 1 : year;
      const periodStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-26`;
      const periodEnd   = `${year}-${String(month).padStart(2, '0')}-25`;
      whereClause += ' AND start_date <= ? AND end_date >= ?';
      params.push(periodEnd, periodStart);
    }

    const [rows] = await pool.query(
      `SELECT leave_type, COUNT(*) AS cnt FROM tr_employee_leaves ${whereClause} GROUP BY leave_type`,
      params
    );

    const stats = { izin: 0, sakit: 0, cuti: 0 };
    rows.forEach(r => { stats[r.leave_type] = Number(r.cnt); });
    return successResponse(res, 'OK', stats);
  } catch (err) {
    console.error('[leave] getLeaveStats', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * DELETE /api/leave/:id
 * Cancel / delete a leave request. Only allowed if status = 'pengajuan'.
 */
exports.cancelLeave = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    const { id } = req.params;

    const [[existing]] = await pool.query(
      'SELECT * FROM tr_employee_leaves WHERE id = ? AND employee_id = ?',
      [id, employeeId]
    );
    if (!existing) return errorResponse(res, 'Pengajuan tidak ditemukan', 404);
    if (existing.status !== 'pengajuan') {
      return errorResponse(res, 'Hanya pengajuan dengan status "pengajuan" yang dapat dibatalkan', 403);
    }

    // Remove doctor note file if exists
    if (existing.doctor_note_path) {
      const { STORAGE_BASE_DIR } = require('../middleware/upload');
      const absPath = path.join(STORAGE_BASE_DIR, existing.doctor_note_path.replace(/^\/storage\//, ''));
      fs.unlink(absPath, () => {});
    }

    await pool.query('DELETE FROM tr_employee_leaves WHERE id = ?', [id]);
    return successResponse(res, 'Pengajuan berhasil dibatalkan', null);
  } catch (err) {
    console.error('[leave] cancelLeave', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};
