const path = require('path');
const fs = require('fs');
const { poolIkm } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');
const { LINEN_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/* ───────────────────────────────────────────
   Helper: delete attachment file from disk
─────────────────────────────────────────── */
const deleteAttachment = (relPath) => {
  if (!relPath) return;
  const fullPath = path.join(__dirname, '..', 'public', relPath);
  try {
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (_) {}
};

/**
 * GET /api/linen-report/areas
 */
exports.getAreas = async (req, res) => {
  try {
    const [rows] = await poolIkm.query(
      `SELECT id, area_name AS name FROM mst_area ORDER BY area_name ASC`
    );
    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[linenReport] getAreas', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/linen-report/hospitals
 */
exports.getHospitals = async (req, res) => {
  try {
    const [rows] = await poolIkm.query(
      `SELECT id, hospital_name AS name FROM mst_hospital ORDER BY hospital_name ASC`
    );
    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[linenReport] getHospitals', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/linen-report/check-today
 */
exports.checkTodayReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const [rows] = await poolIkm.query(
      `SELECT id FROM tr_linen_report WHERE reported_by = ? AND report_date = CURDATE() LIMIT 1`,
      [employeeId]
    );
    return successResponse(res, 'OK', { submitted: rows.length > 0 });
  } catch (err) {
    console.error('[linenReport] checkTodayReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * POST /api/linen-report
 * Submit a new linen finding report (status defaults to 'terkirim')
 */
exports.submitLinenReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const {
      reporter_name, report_date, area_id, hospital_id,
      finding_location, linen_type, finding_type, finding_qty, sending_note
    } = req.body;

    if (!reporter_name?.trim()) return errorResponse(res, 'Nama penemu wajib diisi', 400);
    if (!report_date) return errorResponse(res, 'Tanggal temuan wajib diisi', 400);
    if (!area_id) return errorResponse(res, 'Divisi wajib dipilih', 400);
    if (!hospital_id) return errorResponse(res, 'Rumah sakit wajib dipilih', 400);
    if (!finding_location || !['Rumah Sakit', 'IKM'].includes(finding_location))
      return errorResponse(res, 'Lokasi penemuan wajib dipilih', 400);
    if (!linen_type?.trim()) return errorResponse(res, 'Jenis linen wajib diisi', 400);
    if (!finding_type?.trim()) return errorResponse(res, 'Jenis temuan wajib dipilih', 400);
    if (!finding_qty || isNaN(Number(finding_qty)) || Number(finding_qty) < 1)
      return errorResponse(res, 'Jumlah linen bermasalah minimal 1', 400);

    const attachment_path = req.file
      ? `${LINEN_UPLOAD_PUBLIC_PATH}/${req.file.filename}`
      : null;

    const [result] = await poolIkm.query(
      `INSERT INTO tr_linen_report
        (reporter_name, report_date, area_id, hospital_id, finding_location,
         linen_type, finding_type, finding_qty, attachment_path,
         reported_by, status, sending_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reporter_name.trim(),
        report_date,
        Number(area_id),
        Number(hospital_id),
        finding_location,
        linen_type.trim(),
        finding_type.trim(),
        Number(finding_qty),
        attachment_path,
        employeeId,
        'terkirim',
        sending_note?.trim() || null,
      ]
    );

    return successResponse(res, 'Laporan temuan berhasil dikirim', { id: result.insertId }, 201);
  } catch (err) {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('[linenReport] submitLinenReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/linen-report/my-reports
 * Query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
exports.getMyReports = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { startDate, endDate } = req.query;
    let where = 'WHERE reported_by = ?';
    const params = [employeeId];

    if (startDate) {
      where += ' AND report_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      where += ' AND report_date <= ?';
      params.push(endDate);
    }

    const [rows] = await poolIkm.query(
      `SELECT
         id, reporter_name, report_date, area_id, hospital_id,
         finding_location, linen_type, finding_type, finding_qty,
         attachment_path, status, sending_note,
         process_by, process_by_name, process_note, process_at,
         completed_by, completed_by_name, completed_note, completed_at,
         created_at
       FROM tr_linen_report
       ${where}
       ORDER BY created_at DESC`,
      params
    );

    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[linenReport] getMyReports', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/linen-report/:id
 */
exports.getReportById = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const [rows] = await poolIkm.query(
      `SELECT
         id, reporter_name, report_date, area_id, hospital_id,
         finding_location, linen_type, finding_type, finding_qty,
         attachment_path, status, sending_note,
         process_by, process_by_name, process_note, process_at,
         completed_by, completed_by_name, completed_note, completed_at,
         created_at
       FROM tr_linen_report
       WHERE id = ? AND reported_by = ?
       LIMIT 1`,
      [req.params.id, employeeId]
    );

    if (!rows.length) return errorResponse(res, 'Laporan tidak ditemukan', 404);
    return successResponse(res, 'OK', rows[0]);
  } catch (err) {
    console.error('[linenReport] getReportById', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * PUT /api/linen-report/:id
 * Update own report. Status/progress fields are NOT changed here.
 */
exports.updateReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const reportId = req.params.id;
    const {
      reporter_name, report_date, area_id, hospital_id,
      finding_location, linen_type, finding_type, finding_qty, sending_note
    } = req.body;

    if (!reporter_name?.trim()) return errorResponse(res, 'Nama penemu wajib diisi', 400);
    if (!report_date) return errorResponse(res, 'Tanggal temuan wajib diisi', 400);
    if (!area_id) return errorResponse(res, 'Divisi wajib dipilih', 400);
    if (!hospital_id) return errorResponse(res, 'Rumah sakit wajib dipilih', 400);
    if (!finding_location || !['Rumah Sakit', 'IKM'].includes(finding_location))
      return errorResponse(res, 'Lokasi penemuan wajib dipilih', 400);
    if (!linen_type?.trim()) return errorResponse(res, 'Jenis linen wajib diisi', 400);
    if (!finding_type?.trim()) return errorResponse(res, 'Jenis temuan wajib dipilih', 400);
    if (!finding_qty || isNaN(Number(finding_qty)) || Number(finding_qty) < 1)
      return errorResponse(res, 'Jumlah linen bermasalah minimal 1', 400);

    /* Verify ownership */
    const [existing] = await poolIkm.query(
      `SELECT attachment_path FROM tr_linen_report WHERE id = ? AND reported_by = ? LIMIT 1`,
      [reportId, employeeId]
    );
    if (!existing.length) return errorResponse(res, 'Laporan tidak ditemukan', 404);

    /* Handle new attachment */
    let attachment_path = existing[0].attachment_path;
    if (req.file) {
      deleteAttachment(attachment_path);
      attachment_path = `${LINEN_UPLOAD_PUBLIC_PATH}/${req.file.filename}`;
    }

    await poolIkm.query(
      `UPDATE tr_linen_report SET
        reporter_name = ?, report_date = ?, area_id = ?, hospital_id = ?,
        finding_location = ?, linen_type = ?, finding_type = ?,
        finding_qty = ?, attachment_path = ?, sending_note = ?
       WHERE id = ? AND reported_by = ?`,
      [
        reporter_name.trim(), report_date, Number(area_id), Number(hospital_id),
        finding_location, linen_type.trim(), finding_type.trim(),
        Number(finding_qty), attachment_path, sending_note?.trim() || null,
        reportId, employeeId,
      ]
    );

    return successResponse(res, 'Laporan berhasil diperbarui');
  } catch (err) {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('[linenReport] updateReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * DELETE /api/linen-report/:id
 */
exports.deleteReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const reportId = req.params.id;

    const [existing] = await poolIkm.query(
      `SELECT attachment_path FROM tr_linen_report WHERE id = ? AND reported_by = ? LIMIT 1`,
      [reportId, employeeId]
    );
    if (!existing.length) return errorResponse(res, 'Laporan tidak ditemukan', 404);

    deleteAttachment(existing[0].attachment_path);

    await poolIkm.query(
      `DELETE FROM tr_linen_report WHERE id = ? AND reported_by = ?`,
      [reportId, employeeId]
    );

    return successResponse(res, 'Laporan berhasil dihapus');
  } catch (err) {
    console.error('[linenReport] deleteReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * PATCH /api/linen-report/:id/status
 * Body: { status: 'proses'|'selesai', note?: string }
 */
exports.updateStatus = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    const fullName = req.user?.full_name || '';
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const reportId = req.params.id;
    const { status, note } = req.body;

    if (!['proses', 'selesai'].includes(status)) {
      return errorResponse(res, "Status harus 'proses' atau 'selesai'", 400);
    }

    const [rows] = await poolIkm.query(
      `SELECT status FROM tr_linen_report WHERE id = ? LIMIT 1`,
      [reportId]
    );
    if (!rows.length) return errorResponse(res, 'Laporan tidak ditemukan', 404);

    const current = rows[0].status;

    /* Validate workflow: terkirim -> proses -> selesai */
    if (status === 'proses' && current !== 'terkirim') {
      return errorResponse(res, 'Laporan sudah diproses atau selesai', 400);
    }
    if (status === 'selesai' && current !== 'proses') {
      return errorResponse(res, 'Laporan harus diproses terlebih dahulu', 400);
    }

    if (status === 'proses') {
      await poolIkm.query(
        `UPDATE tr_linen_report SET
          status = 'proses',
          process_by = ?, process_by_name = ?, process_note = ?, process_at = NOW()
         WHERE id = ?`,
        [employeeId, fullName, note?.trim() || null, reportId]
      );
    } else {
      await poolIkm.query(
        `UPDATE tr_linen_report SET
          status = 'selesai',
          completed_by = ?, completed_by_name = ?, completed_note = ?, completed_at = NOW()
         WHERE id = ?`,
        [employeeId, fullName, note?.trim() || null, reportId]
      );
    }

    return successResponse(res, `Status laporan diperbarui ke ${status}`);
  } catch (err) {
    console.error('[linenReport] updateStatus', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};
