const { pool, poolIkm } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');

/**
 * GET /api/rewash/hospitals
 */
exports.getHospitals = async (req, res) => {
  try {
    const [rows] = await poolIkm.query(
      `SELECT id, hospital_name AS name FROM mst_hospital ORDER BY hospital_name ASC`
    );
    return successResponse(res, 'OK', rows);
  } catch (err) {
    console.error('[rewashController] getHospitals', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/rewash/employees
 */
exports.getEmployees = async (req, res) => {
  try {
    const [employees] = await pool.query(
      `SELECT employee_id, full_name
       FROM mst_employee
       WHERE company_id = 2 AND exit_date IS NULL
       ORDER BY full_name ASC`
    );
    return successResponse(res, 'OK', employees);
  } catch (err) {
    console.error('[rewashController] getEmployees', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/rewash/linens
 * Query: ?hospital_id=X&ownership_type=Y
 */
exports.getLinens = async (req, res) => {
  try {
    const { hospital_id, ownership_type } = req.query;
    if (!hospital_id) {
      return errorResponse(res, 'Rumah sakit wajib dipilih', 400);
    }

    let whereExtra = '';
    const queryParams = [Number(hospital_id)];
    if (ownership_type && ['MILIK_RS', 'SEWA'].includes(ownership_type)) {
      whereExtra = ' AND hl.ownership_type = ?';
      queryParams.push(ownership_type);
    }

    const [rows] = await poolIkm.query(
      `SELECT
         hl.id AS hospital_linen_id,
         hl.hospital_linen_name,
         hl.ownership_type,
         l.linen_name,
         sz.size_name,
         c.color_name,
         m.material_name
       FROM mst_hospital_linen hl
       JOIN mst_linen l ON hl.linen_id = l.id
       LEFT JOIN mst_size sz ON l.size_id = sz.id
       LEFT JOIN mst_color c ON l.color_id = c.id
       LEFT JOIN mst_material m ON l.material_id = m.id
       WHERE hl.hospital_id = ? AND hl.is_active = 1 ${whereExtra}
       ORDER BY hl.hospital_linen_name ASC`,
      queryParams
    );

    const processedLinens = rows.map(row => {
      const parts = [row.linen_name, row.size_name, row.color_name, row.material_name].filter(Boolean);
      return {
        hospital_linen_id: row.hospital_linen_id,
        hospital_linen_name: row.hospital_linen_name,
        ownership_type: row.ownership_type,
        linen_name: parts.join(' ')
      };
    });

    processedLinens.sort((a, b) => {
      const nameA = (a.hospital_linen_name?.trim() || a.linen_name).toLowerCase();
      const nameB = (b.hospital_linen_name?.trim() || b.linen_name).toLowerCase();
      return nameA.localeCompare(nameB, 'id');
    });

    return successResponse(res, 'OK', processedLinens);
  } catch (err) {
    console.error('[rewashController] getLinens', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * POST /api/rewash
 * Submit rewash report (header + detail items)
 * Body: { reporter_name, report_date, hospital_id, notes?, items: [{hospital_linen_id, qty}] }
 */
exports.submitRewash = async (req, res) => {
  const employeeId = req.user?.employee_id;
  if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

  const { reporter_name, report_date, hospital_id, notes, items } = req.body;

  if (!reporter_name?.trim()) return errorResponse(res, 'Nama pelapor wajib diisi', 400);
  if (!report_date) return errorResponse(res, 'Tanggal temuan wajib diisi', 400);
  if (!hospital_id) return errorResponse(res, 'Rumah sakit wajib dipilih', 400);
  if (!items || !Array.isArray(items) || items.length === 0) {
    return errorResponse(res, 'Data linen rewash wajib diisi', 400);
  }

  const validItems = items.filter(item => item.qty && Number(item.qty) > 0);
  if (validItems.length === 0) {
    return errorResponse(res, 'Jumlah linen rewash minimal 1 untuk salah satu item', 400);
  }

  const connection = await poolIkm.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Insert header
    const [headerResult] = await connection.query(
      `INSERT INTO tr_rewash (reporter_name, report_date, hospital_id, notes, reported_by)
       VALUES (?, ?, ?, ?, ?)`,
      [reporter_name.trim(), report_date, Number(hospital_id), notes || null, employeeId]
    );
    const rewashId = headerResult.insertId;

    // 2. Insert detail items
    const detailValues = validItems.map(item => [
      rewashId,
      Number(item.hospital_linen_id),
      Number(item.qty)
    ]);
    await connection.query(
      `INSERT INTO tr_rewash_detail (rewash_id, hospital_linen_id, qty) VALUES ?`,
      [detailValues]
    );

    await connection.commit();
    return successResponse(res, 'Data rewash berhasil disimpan', { id: rewashId }, 201);
  } catch (err) {
    await connection.rollback();
    console.error('[rewashController] submitRewash', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  } finally {
    connection.release();
  }
};

/**
 * GET /api/rewash/my-reports
 * Riwayat laporan milik user sendiri
 */
exports.getMyReports = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { startDate, endDate } = req.query;
    let where = 'WHERE r.reported_by = ?';
    const params = [employeeId];

    if (startDate) {
      where += ' AND r.report_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      where += ' AND r.report_date <= ?';
      params.push(endDate);
    }
    // Tambahkan filter qty > 0 di getMyReports dan getAllReports
    where += ' AND rd.qty > 0';

    const [rows] = await poolIkm.query(
      `SELECT
         r.id, r.reporter_name, r.report_date, r.hospital_id, r.notes, r.reported_by, r.created_at,
         DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_str,
         h.hospital_name,
         rd.id AS detail_id,
         rd.hospital_linen_id,
         rd.qty,
         hl.hospital_linen_name,
         hl.ownership_type,
         l.linen_name,
         sz.size_name,
         c.color_name,
         m.material_name
       FROM tr_rewash r
       JOIN mst_hospital h ON r.hospital_id = h.id
       JOIN tr_rewash_detail rd ON rd.rewash_id = r.id
       JOIN mst_hospital_linen hl ON rd.hospital_linen_id = hl.id
       JOIN mst_linen l ON hl.linen_id = l.id
       LEFT JOIN mst_size sz ON l.size_id = sz.id
       LEFT JOIN mst_color c ON l.color_id = c.id
       LEFT JOIN mst_material m ON l.material_id = m.id
       ${where}
       ORDER BY r.created_at DESC, rd.id ASC`,
      params
    );

    // Group items under each header
    const groupedMap = new Map();
    for (const row of rows) {
      if (!groupedMap.has(row.id)) {
        groupedMap.set(row.id, {
          id: row.id,
          reporter_name: row.reporter_name,
          report_date: row.report_date,
          hospital_id: row.hospital_id,
          notes: row.notes,
          reported_by: row.reported_by,
          created_at: row.created_at,
          created_at_str: row.created_at_str,
          hospital_name: row.hospital_name,
          items: []
        });
      }

      const parts = [row.linen_name, row.size_name, row.color_name, row.material_name].filter(Boolean);
      groupedMap.get(row.id).items.push({
        id: row.detail_id,
        hospital_linen_id: row.hospital_linen_id,
        hospital_linen_name: row.hospital_linen_name,
        ownership_type: row.ownership_type,
        linen_name: parts.join(' '),
        qty: row.qty
      });
    }

    return successResponse(res, 'OK', Array.from(groupedMap.values()));
  } catch (err) {
    console.error('[rewashController] getMyReports', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * GET /api/rewash/all-reports
 * Riwayat laporan semua user di floor yang sama
 */
exports.getAllReports = async (req, res) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

    const { startDate, endDate, reportedBy } = req.query;

    let where = `
      WHERE r.reported_by IN (
        SELECT f1.employee_id
        FROM mst_floor f1
        JOIN mst_floor f2 ON f1.floor = f2.floor
        WHERE f2.employee_id = ?
      )
    `;
    const params = [employeeId];

    if (reportedBy) {
      where += ' AND r.reported_by = ?';
      params.push(Number(reportedBy));
    }
    if (startDate) {
      where += ' AND r.report_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      where += ' AND r.report_date <= ?';
      params.push(endDate);
    }
    where += ' AND rd.qty > 0';

    const [rows] = await poolIkm.query(
      `SELECT
         r.id, r.reporter_name, r.report_date, r.hospital_id, r.notes, r.reported_by, r.created_at,
         DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_str,
         h.hospital_name,
         rd.id AS detail_id,
         rd.hospital_linen_id,
         rd.qty,
         hl.hospital_linen_name,
         hl.ownership_type,
         l.linen_name,
         sz.size_name,
         c.color_name,
         m.material_name
       FROM tr_rewash r
       JOIN mst_hospital h ON r.hospital_id = h.id
       JOIN tr_rewash_detail rd ON rd.rewash_id = r.id
       JOIN mst_hospital_linen hl ON rd.hospital_linen_id = hl.id
       JOIN mst_linen l ON hl.linen_id = l.id
       LEFT JOIN mst_size sz ON l.size_id = sz.id
       LEFT JOIN mst_color c ON l.color_id = c.id
       LEFT JOIN mst_material m ON l.material_id = m.id
       ${where}
       ORDER BY r.created_at DESC, rd.id ASC`,
      params
    );

    const groupedMap = new Map();
    for (const row of rows) {
      if (!groupedMap.has(row.id)) {
        groupedMap.set(row.id, {
          id: row.id,
          reporter_name: row.reporter_name,
          report_date: row.report_date,
          hospital_id: row.hospital_id,
          notes: row.notes,
          reported_by: row.reported_by,
          created_at: row.created_at,
          created_at_str: row.created_at_str,
          hospital_name: row.hospital_name,
          items: []
        });
      }

      const parts = [row.linen_name, row.size_name, row.color_name, row.material_name].filter(Boolean);
      groupedMap.get(row.id).items.push({
        id: row.detail_id,
        hospital_linen_id: row.hospital_linen_id,
        hospital_linen_name: row.hospital_linen_name,
        ownership_type: row.ownership_type,
        linen_name: parts.join(' '),
        qty: row.qty
      });
    }

    return successResponse(res, 'OK', Array.from(groupedMap.values()));
  } catch (err) {
    console.error('[rewashController] getAllReports', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};

/**
 * PUT /api/rewash/:id
 * Patch rewash report — hanya update/insert detail, TIDAK PERNAH hapus
 * Body: { reporter_name, report_date, hospital_id, notes?, items: [{id?, hospital_linen_id, qty}] }
 * Item dengan id → update qty. Item tanpa id & qty>0 → insert baru.
 * Item tidak dikirim di payload → tidak tersentuh.
 */
exports.updateReport = async (req, res) => {
  const employeeId = req.user?.employee_id;
  if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

  const { id } = req.params;
  const { reporter_name, report_date, hospital_id, notes, items } = req.body;

  if (!reporter_name?.trim()) return errorResponse(res, 'Nama pelapor wajib diisi', 400);
  if (!report_date) return errorResponse(res, 'Tanggal temuan wajib diisi', 400);
  if (!hospital_id) return errorResponse(res, 'Rumah sakit wajib dipilih', 400);
  if (!items || !Array.isArray(items)) {
    return errorResponse(res, 'Data linen rewash wajib diisi', 400);
  }

  // Verify ownership
  const [existing] = await poolIkm.query(
    `SELECT id FROM tr_rewash WHERE id = ? AND reported_by = ? LIMIT 1`,
    [Number(id), employeeId]
  );
  if (!existing.length) {
    return errorResponse(res, 'Laporan tidak ditemukan atau Anda tidak berwenang', 404);
  }

  const connection = await poolIkm.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Update header
    await connection.query(
      `UPDATE tr_rewash
       SET reporter_name = ?, report_date = ?, hospital_id = ?, notes = ?
       WHERE id = ? AND reported_by = ?`,
      [reporter_name.trim(), report_date, Number(hospital_id), notes || null, Number(id), employeeId]
    );

    // 2. Upsert detail items — NEVER DELETE
    for (const item of items) {
      if (item.id) {
        // Update existing detail (qty=0 is allowed — sets to 0)
        await connection.query(
          `UPDATE tr_rewash_detail SET hospital_linen_id = ?, qty = ? WHERE id = ? AND rewash_id = ?`,
          [Number(item.hospital_linen_id), Number(item.qty), Number(item.id), Number(id)]
        );
      } else if (Number(item.qty) > 0) {
        // Insert new detail
        await connection.query(
          `INSERT INTO tr_rewash_detail (rewash_id, hospital_linen_id, qty) VALUES (?, ?, ?)`,
          [Number(id), Number(item.hospital_linen_id), Number(item.qty)]
        );
      }
    }

    await connection.commit();
    return successResponse(res, 'Laporan rewash berhasil diperbarui');
  } catch (err) {
    await connection.rollback();
    console.error('[rewashController] updateReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  } finally {
    connection.release();
  }
};

/**
 * DELETE /api/rewash/:id
 * Delete entire rewash report (CASCADE will remove details)
 */
exports.deleteReport = async (req, res) => {
  const employeeId = req.user?.employee_id;
  if (!employeeId) return errorResponse(res, 'Unauthorized', 401);

  const { id } = req.params;

  const [existing] = await poolIkm.query(
    `SELECT id FROM tr_rewash WHERE id = ? AND reported_by = ? LIMIT 1`,
    [Number(id), employeeId]
  );
  if (!existing.length) {
    return errorResponse(res, 'Laporan tidak ditemukan atau Anda tidak berwenang', 404);
  }

  try {
    await poolIkm.query(
      `DELETE FROM tr_rewash WHERE id = ? AND reported_by = ?`,
      [Number(id), employeeId]
    );
    return successResponse(res, 'Laporan rewash berhasil dihapus');
  } catch (err) {
    console.error('[rewashController] deleteReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};
