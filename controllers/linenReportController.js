const path = require('path');
const fs = require('fs');
const { poolIkm } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');
const { LINEN_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/**
 * GET /api/linen-report/areas
 * Returns all active areas from ikm.mst_area
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
 * Returns all hospitals from ikm.mst_hospital
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
 * POST /api/linen-report
 * Submit a new linen finding report
 * Body (multipart/form-data):
 *   reporter_name, report_date, area_id, hospital_id,
 *   linen_type, finding_type, finding_qty
 * File: attachment (optional image)
 */
exports.submitLinenReport = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { reporter_name, report_date, area_id, hospital_id, linen_type, finding_type, finding_qty } = req.body;

    if (!reporter_name?.trim()) return errorResponse(res, 'Nama penemu wajib diisi', 400);
    if (!report_date) return errorResponse(res, 'Tanggal temuan wajib diisi', 400);
    if (!area_id) return errorResponse(res, 'Divisi wajib dipilih', 400);
    if (!hospital_id) return errorResponse(res, 'Rumah sakit wajib dipilih', 400);
    if (!linen_type?.trim()) return errorResponse(res, 'Jenis linen wajib diisi', 400);
    if (!finding_type?.trim()) return errorResponse(res, 'Jenis temuan wajib dipilih', 400);
    if (!finding_qty || isNaN(Number(finding_qty)) || Number(finding_qty) < 1)
      return errorResponse(res, 'Jumlah linen bermasalah minimal 1', 400);

    const attachment_path = req.file
      ? `${LINEN_UPLOAD_PUBLIC_PATH}/${req.file.filename}`
      : null;

    await poolIkm.query(
      `INSERT INTO tr_linen_report
        (reporter_name, report_date, area_id, hospital_id, linen_type, finding_type, finding_qty, attachment_path, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reporter_name.trim(),
        report_date,
        Number(area_id),
        Number(hospital_id),
        linen_type.trim(),
        finding_type.trim(),
        Number(finding_qty),
        attachment_path,
        employeeId,
      ]
    );

    return successResponse(res, 'Laporan temuan berhasil dikirim', null, 201);
  } catch (err) {
    // cleanup uploaded file on error
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    console.error('[linenReport] submitLinenReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};
