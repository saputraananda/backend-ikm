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

    // Check if report already exists for this hospital in the current 8 AM to 8 AM session
    const [existingReport] = await connection.query(
      `SELECT id FROM tr_rewash
       WHERE hospital_id = ?
         AND created_at >= CASE
           WHEN HOUR(NOW()) >= 8 THEN CONCAT(CURDATE(), ' 08:00:00')
           ELSE CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 08:00:00')
         END
         AND created_at < CASE
           WHEN HOUR(NOW()) >= 8 THEN CONCAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), ' 08:00:00')
           ELSE CONCAT(CURDATE(), ' 08:00:00')
         END
       LIMIT 1`,
      [Number(hospital_id)]
    );

    if (existingReport.length > 0) {
      await connection.rollback();
      return errorResponse(res, 'Rumah sakit ini telah memiliki laporan untuk sesi hari ini. Silakan lengkapi/edit laporan yang sudah ada.', 400);
    }

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

    // Audit CREATE
    const afterState = await getReportState(connection, rewashId);
    await logAudit(connection, rewashId, 'CREATE', employeeId, req.user?.full_name, null, afterState);

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

    const { startDate, endDate, reportedBy, hospitalId } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

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
    if (hospitalId) {
      where += ' AND r.hospital_id = ?';
      params.push(Number(hospitalId));
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

  // Verify existence
  const [existing] = await poolIkm.query(
    `SELECT id FROM tr_rewash WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  if (!existing.length) {
    return errorResponse(res, 'Laporan tidak ditemukan', 404);
  }

  const connection = await poolIkm.getConnection();
  try {
    await connection.beginTransaction();

    // Fetch state before update
    const beforeState = await getReportState(connection, Number(id));

    // 1. Update header
    await connection.query(
      `UPDATE tr_rewash
       SET reporter_name = ?, report_date = ?, hospital_id = ?, notes = ?
       WHERE id = ?`,
      [reporter_name.trim(), report_date, Number(hospital_id), notes || null, Number(id)]
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

    // Fetch state after update and log audit
    const afterState = await getReportState(connection, Number(id));
    await logAudit(connection, Number(id), 'UPDATE', employeeId, req.user?.full_name, beforeState, afterState);

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

  const connection = await poolIkm.getConnection();
  try {
    await connection.beginTransaction();

    const beforeState = await getReportState(connection, Number(id));
    if (!beforeState) {
      await connection.rollback();
      return errorResponse(res, 'Laporan tidak ditemukan', 404);
    }

    await logAudit(connection, Number(id), 'DELETE', employeeId, req.user?.full_name, beforeState, null);

    await connection.query(
      `DELETE FROM tr_rewash WHERE id = ?`,
      [Number(id)]
    );

    await connection.commit();
    return successResponse(res, 'Laporan rewash berhasil dihapus');
  } catch (err) {
    await connection.rollback();
    console.error('[rewashController] deleteReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  } finally {
    connection.release();
  }
};

/**
 * Helper: get report state for auditing
 */
async function getReportState(connection, rewashId) {
  const [headerRows] = await connection.query(
    `SELECT id, reporter_name, report_date, hospital_id, notes, reported_by, created_at, updated_at
     FROM tr_rewash WHERE id = ?`,
    [rewashId]
  );
  if (!headerRows.length) return null;

  const [detailRows] = await connection.query(
    `SELECT id, hospital_linen_id, qty FROM tr_rewash_detail WHERE rewash_id = ?`,
    [rewashId]
  );

  return {
    header: headerRows[0],
    items: detailRows
  };
}

/**
 * Helper: log audit entry
 */
async function logAudit(connection, rewashId, action, employeeId, fullName, beforeData, afterData) {
  await connection.query(
    `INSERT INTO tr_rewash_audit (rewash_id, action, changed_by, changed_by_name, before_data, after_data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      rewashId,
      action,
      employeeId,
      fullName || '',
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null
    ]
  );
}

/**
 * GET /api/rewash/check-hospital-report
 */
exports.checkHospitalReport = async (req, res) => {
  try {
    const { hospital_id } = req.query;
    if (!hospital_id) {
      return errorResponse(res, 'hospital_id wajib diisi', 400);
    }

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
       WHERE r.hospital_id = ?
         AND r.created_at >= CASE
           WHEN HOUR(NOW()) >= 8 THEN CONCAT(CURDATE(), ' 08:00:00')
           ELSE CONCAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), ' 08:00:00')
         END
         AND r.created_at < CASE
           WHEN HOUR(NOW()) >= 8 THEN CONCAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), ' 08:00:00')
           ELSE CONCAT(CURDATE(), ' 08:00:00')
         END
       ORDER BY rd.id ASC`,
      [Number(hospital_id)]
    );

    if (rows.length === 0) {
      return successResponse(res, 'OK', { exists: false });
    }

    const report = {
      id: rows[0].id,
      reporter_name: rows[0].reporter_name,
      report_date: rows[0].report_date,
      hospital_id: rows[0].hospital_id,
      notes: rows[0].notes,
      reported_by: rows[0].reported_by,
      created_at: rows[0].created_at,
      created_at_str: rows[0].created_at_str,
      hospital_name: rows[0].hospital_name,
      items: []
    };

    for (const row of rows) {
      if (row.qty > 0) {
        const parts = [row.linen_name, row.size_name, row.color_name, row.material_name].filter(Boolean);
        report.items.push({
          id: row.detail_id,
          hospital_linen_id: row.hospital_linen_id,
          hospital_linen_name: row.hospital_linen_name,
          ownership_type: row.ownership_type,
          linen_name: parts.join(' '),
          qty: row.qty
        });
      }
    }

    return successResponse(res, 'OK', { exists: true, report });
  } catch (err) {
    console.error('[rewashController] checkHospitalReport', err);
    return errorResponse(res, 'Terjadi kesalahan server', 500);
  }
};
