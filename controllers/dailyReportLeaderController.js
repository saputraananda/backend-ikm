const fs = require('fs');
const { pool } = require('../db/pool');       // Waschen DB (employees)
const { poolIkm } = require('../db/pool');   // IKM DB (report tables)
const { successResponse, errorResponse } = require('../utils/response');
const { DAILY_REPORT_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/**
 * GET /api/daily-report/areas
 * Returns all active areas from ikm.mst_area
 */
exports.getAreas = async (req, res) => {
  try {
    const [rows] = await poolIkm.query(
      `SELECT id, area_name AS name FROM mst_area ORDER BY area_name ASC`
    );
    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[dailyReport] getAreas', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/daily-report/employees
 * Returns all employees from waschen.mst_employee
 */
exports.getEmployees = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT employee_id, full_name FROM mst_employee WHERE company_id = 2 AND exit_date IS NULL ORDER BY full_name ASC`
    );
    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[dailyReport] getEmployees', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/daily-report/check-today
 * Returns { submitted: true/false } for the logged-in user on today's date
 */
exports.checkTodayReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const [rows] = await poolIkm.query(
      `SELECT id FROM tr_daily_report_leader WHERE reported_by = ? AND report_date = CURDATE() LIMIT 1`,
      [employeeId]
    );
    return successResponse(res, 'OK', { submitted: rows.length > 0 });
  } catch (err) {
    console.error('[dailyReport] checkTodayReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * POST /api/daily-report
 * Submit a new daily leader report
 * Body (multipart/form-data):
 *   report_date, area_id, pic_name, role,
 *   present_count, production_start_time, is_late,
 *   area_cleanliness, constraint_notes,
 *   absent_members (JSON), late_members (JSON)
 * File: briefing_doc (optional image)
 */
exports.submitDailyReport = async (req, res) => {
  let conn;
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const {
      report_date, area_id, pic_name, role,
      present_count, production_start_time, is_late,
      area_cleanliness, constraint_notes,
      absent_members: absent_raw,
      late_members: late_raw,
    } = req.body;

    if (!report_date) return errorResponse(res, 'Tanggal wajib diisi', 400);
    if (!area_id) return errorResponse(res, 'Area wajib dipilih', 400);
    if (!pic_name?.trim()) return errorResponse(res, 'Nama penanggung jawab wajib diisi', 400);
    if (!['Leader', 'Deputi'].includes(role)) return errorResponse(res, 'Peran tidak valid', 400);
    if (!production_start_time) return errorResponse(res, 'Waktu mulai produksi wajib diisi', 400);
    if (!['Bersih', 'Kotor'].includes(area_cleanliness))
      return errorResponse(res, 'Kebersihan area tidak valid', 400);

    const isLateVal = is_late === '1' || is_late === 1;
    const presentCountVal = Math.max(0, parseInt(present_count) || 0);

    let absentMembers = [];
    let lateMembers = [];
    try {
      absentMembers = absent_raw ? JSON.parse(absent_raw) : [];
      lateMembers   = late_raw   ? JSON.parse(late_raw)   : [];
    } catch {
      return errorResponse(res, 'Format data anggota tidak valid', 400);
    }

    for (const m of absentMembers) {
      if (!m.employee_id || !['Izin', 'Sakit', 'Alfa'].includes(m.absence_reason))
        return errorResponse(res, 'Data anggota tidak hadir tidak valid', 400);
    }
    if (isLateVal) {
      for (const m of lateMembers) {
        if (!m.employee_id || !m.late_time)
          return errorResponse(res, 'Data anggota terlambat tidak valid', 400);
      }
    }

    const briefing_doc_path = req.file
      ? `${DAILY_REPORT_UPLOAD_PUBLIC_PATH}/${req.file.filename}`
      : null;

    conn = await poolIkm.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO tr_daily_report_leader
        (report_date, area_id, pic_name, role, present_count, production_start_time,
         is_late, area_cleanliness, constraint_notes, briefing_doc_path, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        report_date,
        Number(area_id),
        pic_name.trim(),
        role,
        presentCountVal,
        production_start_time,
        isLateVal ? 1 : 0,
        area_cleanliness,
        constraint_notes?.trim() || null,
        briefing_doc_path,
        employeeId,
      ]
    );

    const reportId = result.insertId;

    if (absentMembers.length > 0) {
      await conn.query(
        `INSERT INTO tr_daily_report_absent (report_id, employee_id, absence_reason) VALUES ?`,
        [absentMembers.map(m => [reportId, Number(m.employee_id), m.absence_reason])]
      );
    }

    if (isLateVal && lateMembers.length > 0) {
      await conn.query(
        `INSERT INTO tr_daily_report_late (report_id, employee_id, late_time) VALUES ?`,
        [lateMembers.map(m => [reportId, Number(m.employee_id), m.late_time])]
      );
    }

    await conn.commit();
    return successResponse(res, 'Laporan harian berhasil dikirim', null, 201);
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('[dailyReport] submitDailyReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  } finally {
    if (conn) conn.release();
  }
};

/**
 * GET /api/daily-report/my-reports
 * Returns all reports submitted by the logged-in user
 * Query: startDate, endDate
 */
exports.getMyReports = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { startDate, endDate } = req.query;

    let sql = `
      SELECT
        r.id, r.report_date, r.area_id, a.area_name,
        r.pic_name, r.role, r.present_count, r.production_start_time,
        r.is_late, r.area_cleanliness, r.constraint_notes,
        r.briefing_doc_path, r.created_at, r.updated_at,
        (SELECT COUNT(*) FROM tr_daily_report_absent WHERE report_id = r.id) AS absent_count,
        (SELECT COUNT(*) FROM tr_daily_report_late   WHERE report_id = r.id) AS late_count
      FROM tr_daily_report_leader r
      LEFT JOIN mst_area a ON a.id = r.area_id
      WHERE r.reported_by = ?
    `;
    const params = [employeeId];

    if (startDate) { sql += ' AND r.report_date >= ?'; params.push(startDate); }
    if (endDate)   { sql += ' AND r.report_date <= ?'; params.push(endDate); }

    sql += ' ORDER BY r.report_date DESC, r.created_at DESC';

    const [rows] = await poolIkm.query(sql, params);
    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[dailyReport] getMyReports', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/daily-report/:id
 * Returns a single report with absent and late member arrays (for editing)
 */
exports.getReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { id } = req.params;

    const [rows] = await poolIkm.query(
      `SELECT r.*, a.area_name
       FROM tr_daily_report_leader r
       LEFT JOIN mst_area a ON a.id = r.area_id
       WHERE r.id = ? AND r.reported_by = ? LIMIT 1`,
      [id, employeeId]
    );
    if (rows.length === 0) return errorResponse(res, 'Laporan tidak ditemukan', 404);

    const report = rows[0];

    const [absentRows] = await poolIkm.query(
      `SELECT employee_id, absence_reason FROM tr_daily_report_absent WHERE report_id = ?`,
      [id]
    );
    const [lateRows] = await poolIkm.query(
      `SELECT employee_id, late_time FROM tr_daily_report_late WHERE report_id = ?`,
      [id]
    );

    report.absent_members = absentRows;
    report.late_members   = lateRows;

    return successResponse(res, 'OK', report);
  } catch (err) {
    console.error('[dailyReport] getReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * PUT /api/daily-report/:id
 * Update an existing daily leader report (only by owner)
 */
exports.updateDailyReport = async (req, res) => {
  let conn;
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { id } = req.params;

    const [existing] = await poolIkm.query(
      `SELECT id, briefing_doc_path FROM tr_daily_report_leader WHERE id = ? AND reported_by = ? LIMIT 1`,
      [id, employeeId]
    );
    if (existing.length === 0) return errorResponse(res, 'Laporan tidak ditemukan', 404);

    const {
      report_date, area_id, pic_name, role,
      present_count, production_start_time, is_late,
      area_cleanliness, constraint_notes,
      absent_members: absent_raw,
      late_members: late_raw,
    } = req.body;

    if (!report_date) return errorResponse(res, 'Tanggal wajib diisi', 400);
    if (!area_id) return errorResponse(res, 'Area wajib dipilih', 400);
    if (!pic_name?.trim()) return errorResponse(res, 'Nama penanggung jawab wajib diisi', 400);
    if (!['Leader', 'Deputi'].includes(role)) return errorResponse(res, 'Peran tidak valid', 400);
    if (!production_start_time) return errorResponse(res, 'Waktu mulai produksi wajib diisi', 400);
    if (!['Bersih', 'Kotor'].includes(area_cleanliness))
      return errorResponse(res, 'Kebersihan area tidak valid', 400);

    const isLateVal      = is_late === '1' || is_late === 1;
    const presentCountVal = Math.max(0, parseInt(present_count) || 0);

    let absentMembers = [];
    let lateMembers   = [];
    try {
      absentMembers = absent_raw ? JSON.parse(absent_raw) : [];
      lateMembers   = late_raw   ? JSON.parse(late_raw)   : [];
    } catch {
      return errorResponse(res, 'Format data anggota tidak valid', 400);
    }

    for (const m of absentMembers) {
      if (!m.employee_id || !['Izin', 'Sakit', 'Alfa'].includes(m.absence_reason))
        return errorResponse(res, 'Data anggota tidak hadir tidak valid', 400);
    }
    if (isLateVal) {
      for (const m of lateMembers) {
        if (!m.employee_id || !m.late_time)
          return errorResponse(res, 'Data anggota terlambat tidak valid', 400);
      }
    }

    // Handle new file upload or explicit removal
    let briefing_doc_path = existing[0].briefing_doc_path;
    const removeBriefingDoc = req.body.remove_briefing_doc === '1';

    if (req.file) {
      // Replace existing with new upload
      if (briefing_doc_path) {
        const { DAILY_REPORT_UPLOAD_DIR } = require('../middleware/upload');
        const oldFile = require('path').join(DAILY_REPORT_UPLOAD_DIR, require('path').basename(briefing_doc_path));
        try { fs.unlinkSync(oldFile); } catch (_) {}
      }
      briefing_doc_path = `${DAILY_REPORT_UPLOAD_PUBLIC_PATH}/${req.file.filename}`;
    } else if (removeBriefingDoc && briefing_doc_path) {
      // User explicitly removed the image without uploading a new one
      const { DAILY_REPORT_UPLOAD_DIR } = require('../middleware/upload');
      const oldFile = require('path').join(DAILY_REPORT_UPLOAD_DIR, require('path').basename(briefing_doc_path));
      try { fs.unlinkSync(oldFile); } catch (_) {}
      briefing_doc_path = null;
    }

    conn = await poolIkm.getConnection();
    await conn.beginTransaction();

    await conn.query(
      `UPDATE tr_daily_report_leader SET
        report_date = ?, area_id = ?, pic_name = ?, role = ?, present_count = ?,
        production_start_time = ?, is_late = ?, area_cleanliness = ?,
        constraint_notes = ?, briefing_doc_path = ?
       WHERE id = ?`,
      [
        report_date,
        Number(area_id),
        pic_name.trim(),
        role,
        presentCountVal,
        production_start_time,
        isLateVal ? 1 : 0,
        area_cleanliness,
        constraint_notes?.trim() || null,
        briefing_doc_path,
        id,
      ]
    );

    await conn.query(`DELETE FROM tr_daily_report_absent WHERE report_id = ?`, [id]);
    if (absentMembers.length > 0) {
      await conn.query(
        `INSERT INTO tr_daily_report_absent (report_id, employee_id, absence_reason) VALUES ?`,
        [absentMembers.map(m => [id, Number(m.employee_id), m.absence_reason])]
      );
    }

    await conn.query(`DELETE FROM tr_daily_report_late WHERE report_id = ?`, [id]);
    if (isLateVal && lateMembers.length > 0) {
      await conn.query(
        `INSERT INTO tr_daily_report_late (report_id, employee_id, late_time) VALUES ?`,
        [lateMembers.map(m => [id, Number(m.employee_id), m.late_time])]
      );
    }

    await conn.commit();
    return successResponse(res, 'Laporan berhasil diperbarui', null);
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('[dailyReport] updateDailyReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  } finally {
    if (conn) conn.release();
  }
};

/**
 * DELETE /api/daily-report/:id
 * Delete a report (only by owner)
 */
exports.deleteReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { id } = req.params;

    const [existing] = await poolIkm.query(
      `SELECT id, briefing_doc_path FROM tr_daily_report_leader WHERE id = ? AND reported_by = ? LIMIT 1`,
      [id, employeeId]
    );
    if (existing.length === 0) return errorResponse(res, 'Laporan tidak ditemukan', 404);

    if (existing[0].briefing_doc_path) {
      const { DAILY_REPORT_UPLOAD_DIR } = require('../middleware/upload');
      const oldFile = require('path').join(DAILY_REPORT_UPLOAD_DIR, require('path').basename(existing[0].briefing_doc_path));
      try { fs.unlinkSync(oldFile); } catch (_) {}
    }

    await poolIkm.query(`DELETE FROM tr_daily_report_leader WHERE id = ?`, [id]);

    return successResponse(res, 'Laporan berhasil dihapus', null);
  } catch (err) {
    console.error('[dailyReport] deleteReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};
