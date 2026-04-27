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
      `SELECT employee_id, full_name FROM mst_employee WHERE company_id = 2 ORDER BY full_name ASC`
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
