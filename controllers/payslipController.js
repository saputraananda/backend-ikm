const { poolIkm } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');
const { PAYSLIP_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/**
 * GET /api/payslips
 * Get list of payslips for the logged-in employee
 * Query params: month (format YYYY-MM)
 */
exports.getPayslips = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) {
      return errorResponse(res, 'Unauthorized', 401);
    }

    const { month } = req.query;
    let sql = `
      SELECT id, employee_id, payslip_month, file_path, file_name, created_at
      FROM tr_payslip_ikm
      WHERE employee_id = ?
    `;
    const params = [employeeId];

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      sql += ' AND payslip_month = ?';
      params.push(month);
    }

    sql += ' ORDER BY payslip_month DESC, created_at DESC';

    const [rows] = await poolIkm.query(sql, params);

    // Map rows to include public file URL
    const data = rows.map(row => ({
      ...row,
      file_url: `${PAYSLIP_UPLOAD_PUBLIC_PATH}/${row.file_path}`
    }));

    return successResponse(res, 'Success', data);
  } catch (err) {
    console.error('[payslipController] getPayslips error:', err);
    return errorResponse(res, 'Terjadi kesalahan server saat mengambil slip gaji', 500);
  }
};

/**
 * GET /api/payslips/months
 * Get list of distinct months available for the logged-in employee's payslips
 */
exports.getPayslipMonths = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) {
      return errorResponse(res, 'Unauthorized', 401);
    }

    const sql = `
      SELECT DISTINCT payslip_month
      FROM tr_payslip_ikm
      WHERE employee_id = ?
      ORDER BY payslip_month DESC
    `;

    const [rows] = await poolIkm.query(sql, [employeeId]);
    const months = rows.map(row => row.payslip_month);

    return successResponse(res, 'Success', months);
  } catch (err) {
    console.error('[payslipController] getPayslipMonths error:', err);
    return errorResponse(res, 'Terjadi kesalahan server saat mengambil daftar bulan', 500);
  }
};
