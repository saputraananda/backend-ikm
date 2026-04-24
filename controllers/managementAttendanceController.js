const { poolIkm: pool } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');
const { ATTENDANCE_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/* ── Shared helpers ─────────────────────────────────────────────── */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const getWibNow = () => new Date(Date.now() + WIB_OFFSET_MS);

/* Work-date: if 00:00–03:59 the record still belongs to the previous calendar day */
const getWorkDate = () => {
  const wib      = getWibNow();
  const totalMin = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  if (totalMin < 240) {
    return new Date(wib.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return wib.toISOString().slice(0, 10);
};

const buildPhotoUrl = (req, photoPath, photoName) => {
  if (!photoPath || !photoName) return null;
  const normalizedPath = photoPath.startsWith('/') ? photoPath : `/${photoPath}`;
  return `${req.protocol}://${req.get('host')}${normalizedPath}/${encodeURIComponent(photoName)}`;
};

/* ── Role guard: only management employees may use these endpoints ── */
async function isManagement(employeeId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM mst_leader WHERE employee_id = ? AND role = 'management' LIMIT 1`,
    [employeeId]
  );
  return rows.length > 0;
}

/* ══════════════════════════════════════════════════════════════════
   GET /management-attendance/today
   Returns today's check-in / check-out record for the employee.
══════════════════════════════════════════════════════════════════ */
const getTodayAttendance = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;

    if (!(await isManagement(employeeId)))
      return errorResponse(res, 'Akses ditolak. Hanya tim manajemen yang dapat mengakses fitur ini.', 403);

    const workDate = getWorkDate();

    const [rows] = await pool.query(
      `SELECT check_in_time, check_out_time,
              check_in_lat, check_in_lng,
              check_out_lat, check_out_lng,
              check_in_photo_path, check_in_photo_name,
              check_out_photo_path, check_out_photo_name
       FROM tr_attendance_management_ikm
       WHERE employee_id = ? AND work_date = ? LIMIT 1`,
      [employeeId, workDate]
    );

    if (rows.length === 0) return successResponse(res, 'Data absensi hari ini', null);

    const row = rows[0];
    row.check_in_photo_url  = buildPhotoUrl(req, row.check_in_photo_path,  row.check_in_photo_name);
    row.check_out_photo_url = buildPhotoUrl(req, row.check_out_photo_path, row.check_out_photo_name);

    return successResponse(res, 'Data absensi hari ini', row);
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   POST /management-attendance/punch
   Body: { punch_type: 'in'|'out', photo_path, photo_name }
   No GPS restriction — management may punch from anywhere.
   No time-window restriction — management may punch freely.
══════════════════════════════════════════════════════════════════ */
const punch = async (req, res, next) => {
  try {
    const userId     = req.user.user_id;
    const employeeId = req.user.employee_id;
    const { punch_type, photo_path, photo_name } = req.body;

    if (!['in', 'out'].includes(punch_type))
      return errorResponse(res, 'Parameter tidak valid', 400);

    if (!(await isManagement(employeeId)))
      return errorResponse(res, 'Akses ditolak. Hanya tim manajemen yang dapat mengakses fitur ini.', 403);

    const workDate = getWorkDate();

    const [rows] = await pool.query(
      `SELECT * FROM tr_attendance_management_ikm WHERE employee_id = ? AND work_date = ? LIMIT 1`,
      [employeeId, workDate]
    );

    if (punch_type === 'in') {
      if (rows.length > 0 && rows[0].check_in_time)
        return errorResponse(res, 'Anda sudah absen masuk hari ini.', 400);

      if (rows.length === 0) {
        await pool.query(
          `INSERT INTO tr_attendance_management_ikm
           (user_id, employee_id, work_date, check_in_time, check_in_photo_path, check_in_photo_name)
           VALUES (?, ?, ?, NOW(), ?, ?)`,
          [userId, employeeId, workDate, photo_path || null, photo_name || null]
        );
      } else {
        await pool.query(
          `UPDATE tr_attendance_management_ikm
           SET user_id=?, check_in_time=NOW(), check_in_photo_path=?, check_in_photo_name=?
           WHERE employee_id=? AND work_date=?`,
          [userId, photo_path || null, photo_name || null, employeeId, workDate]
        );
      }
      return successResponse(res, 'Absen masuk berhasil dicatat.');

    } else {
      if (rows.length === 0 || !rows[0].check_in_time)
        return errorResponse(res, 'Anda belum absen masuk hari ini.', 400);
      if (rows[0].check_out_time)
        return errorResponse(res, 'Anda sudah absen keluar hari ini.', 400);

      await pool.query(
        `UPDATE tr_attendance_management_ikm
         SET check_out_time=NOW(), check_out_photo_path=?, check_out_photo_name=?
         WHERE employee_id=? AND work_date=?`,
        [photo_path || null, photo_name || null, employeeId, workDate]
      );
      return successResponse(res, 'Absen keluar berhasil dicatat.');
    }
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   POST /management-attendance/punch-selfie (multipart/form-data)
   Fields: punch_type, selfie(file)
══════════════════════════════════════════════════════════════════ */
const punchSelfie = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 'Foto selfie wajib diambil dari kamera.', 400);

    const photo_path = ATTENDANCE_UPLOAD_PUBLIC_PATH;
    const photo_name = req.file.filename;
    req.body = { ...req.body, photo_path, photo_name };
    return punch(req, res, next);
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   POST /management-attendance/delete-punch
   Body: { punch_type: 'in'|'out' }
   Clears check_in or check_out so the employee can re-punch.
══════════════════════════════════════════════════════════════════ */
const deletePunch = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const { punch_type } = req.body;

    if (!['in', 'out'].includes(punch_type))
      return errorResponse(res, 'Parameter tidak valid', 400);

    if (!(await isManagement(employeeId)))
      return errorResponse(res, 'Akses ditolak. Hanya tim manajemen yang dapat mengakses fitur ini.', 403);

    const workDate = getWorkDate();

    if (punch_type === 'in') {
      /* Prevent deleting check-in when check-out already exists */
      const [existing] = await pool.query(
        `SELECT check_out_time FROM tr_attendance_management_ikm
         WHERE employee_id = ? AND work_date = ? LIMIT 1`,
        [employeeId, workDate]
      );
      if (existing.length > 0 && existing[0].check_out_time)
        return errorResponse(res, 'Tidak dapat menghapus absen masuk karena absen keluar sudah tercatat.', 400);

      await pool.query(
        `UPDATE tr_attendance_management_ikm
         SET check_in_time=NULL, check_in_lat=NULL, check_in_lng=NULL,
             check_in_photo_path=NULL, check_in_photo_name=NULL
         WHERE employee_id=? AND work_date=?`,
        [employeeId, workDate]
      );
      /* Remove empty record */
      await pool.query(
        `DELETE FROM tr_attendance_management_ikm
         WHERE employee_id=? AND work_date=? AND check_in_time IS NULL AND check_out_time IS NULL`,
        [employeeId, workDate]
      );
    } else {
      await pool.query(
        `UPDATE tr_attendance_management_ikm
         SET check_out_time=NULL, check_out_lat=NULL, check_out_lng=NULL,
             check_out_photo_path=NULL, check_out_photo_name=NULL
         WHERE employee_id=? AND work_date=?`,
        [employeeId, workDate]
      );
    }

    return successResponse(res, 'Absensi berhasil dihapus, silakan absen ulang.');
  } catch (error) { next(error); }
};

module.exports = { getTodayAttendance, punch, punchSelfie, deletePunch };
