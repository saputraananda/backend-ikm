const { poolIkm: pool } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');
const { ATTENDANCE_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/* ── Shared helpers ─────────────────────────────────────────────── */
const getTodayDate = () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/* Work-date: if 00:00–03:59 the shift still belongs to the previous calendar day */
const getWorkDate = () => {
  const now      = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  if (totalMin < 240) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return getTodayDate();
};

/* ── Location constants ─────────────────────────────────────────── */
const MAX_DIST_M = 200;

/* ── Office locations from DB (cached 5 min) ───────────────────── */
let _officeLocations = null;
let _officeLocationsAt = 0;
const LOCATION_CACHE_MS = 5 * 60 * 1000;

async function getOfficeLocations() {
  const now = Date.now();
  if (_officeLocations && (now - _officeLocationsAt) < LOCATION_CACHE_MS) return _officeLocations;
  const [rows] = await pool.query(
    'SELECT location_id, location_name, latitude, longitude FROM mst_location_absen ORDER BY id'
  );
  _officeLocations = rows;
  _officeLocationsAt = now;
  return rows;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R     = 6371000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Shift definitions from DB (cached 5 min) ───────────────────── */
let _shiftNormal = null;
let _shiftNormalAt = 0;
const SHIFT_NORMAL_CACHE_MS = 5 * 60 * 1000;

async function getShiftNormal() {
  const now = Date.now();
  if (_shiftNormal && (now - _shiftNormalAt) < SHIFT_NORMAL_CACHE_MS) return _shiftNormal;
  const [rows] = await pool.query(
    'SELECT shift_name, check_in_start, check_in_end, check_out_start, check_out_end, is_overnight FROM mst_shift_normal ORDER BY id'
  );
  _shiftNormal = rows;
  _shiftNormalAt = now;
  return rows;
}

function timeToMin(timeStr) {
  const parts = String(timeStr).split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

const buildPhotoUrl = (req, photoPath, photoName) => {
  if (!photoPath || !photoName) return null;
  const normalizedPath = photoPath.startsWith('/') ? photoPath : `/${photoPath}`;
  return `${req.protocol}://${req.get('host')}${normalizedPath}/${encodeURIComponent(photoName)}`;
};

/* ── Optional photo columns (safe across DB variants) ────────────── */
const _colCache = new Map();
async function hasColumn(tableName, colName) {
  const key = `${tableName}.${colName}`;
  if (_colCache.has(key)) return _colCache.get(key);
  try {
    const [rows] = await pool.query(
      `SELECT 1 AS ok
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = ?
       LIMIT 1`,
      [tableName, colName]
    );
    const ok = rows.length > 0;
    _colCache.set(key, ok);
    return ok;
  } catch (_) {
    _colCache.set(key, false);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════
   GET /attendance/today-shifts
   Returns shift records for today keyed by shift_type.
══════════════════════════════════════════════════════════════════ */
const getTodayShifts = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const workDate   = getWorkDate();

    const canInPhotoPath = await hasColumn('tr_attendance_shift_ikm', 'check_in_photo_path');
    const canInPhotoName = await hasColumn('tr_attendance_shift_ikm', 'check_in_photo_name');
    const canOutPhotoPath = await hasColumn('tr_attendance_shift_ikm', 'check_out_photo_path');
    const canOutPhotoName = await hasColumn('tr_attendance_shift_ikm', 'check_out_photo_name');

    const selectCols = [
      'shift_type',
      'check_in_time',
      'check_out_time',
      'check_in_lat',
      'check_in_lng',
      'check_out_lat',
      'check_out_lng'
    ];

    if (canInPhotoPath) selectCols.push('check_in_photo_path');
    if (canInPhotoName) selectCols.push('check_in_photo_name');
    if (canOutPhotoPath) selectCols.push('check_out_photo_path');
    if (canOutPhotoName) selectCols.push('check_out_photo_name');

    const [rows] = await pool.query(
      `SELECT ${selectCols.join(', ')}
       FROM tr_attendance_shift_ikm
       WHERE employee_id = ? AND work_date = ? AND is_valet = 0`,
      [employeeId, workDate]
    );

    const result = {};
    for (const row of rows) {
      row.check_in_photo_url = buildPhotoUrl(req, row.check_in_photo_path, row.check_in_photo_name);
      row.check_out_photo_url = buildPhotoUrl(req, row.check_out_photo_path, row.check_out_photo_name);
      result[row.shift_type] = row;
    }
    return successResponse(res, 'Data shift hari ini', result);
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   POST /attendance/shift-punch
   Body: { shift_type, punch_type: 'in'|'out', lat, lng }
   Validates: location ≤ 10 m, time window, duplicate guards.
══════════════════════════════════════════════════════════════════ */
const shiftPunch = async (req, res, next) => {
  try {
    const userId     = req.user.user_id;
    const employeeId = req.user.employee_id;
    const { shift_type, punch_type, lat, lng, photo_path, photo_name } = req.body;

    /* Input validation */
    const validPunch = ['in', 'out'];
    if (!validPunch.includes(punch_type))
      return errorResponse(res, 'Parameter tidak valid', 400);
    const shiftRows = await getShiftNormal();
    const shiftRow  = shiftRows.find(s => s.shift_name.toLowerCase() === String(shift_type).toLowerCase());
    if (!shiftRow) return errorResponse(res, 'Parameter tidak valid', 400);

    /* Location validation */
    if (lat == null || lng == null)
      return errorResponse(res, 'Lokasi tidak tersedia. Aktifkan GPS dan izinkan akses lokasi.', 400);

    const locations = await getOfficeLocations();
    let dist = Infinity;
    for (const loc of locations) {
      const d = haversineMeters(parseFloat(lat), parseFloat(lng), parseFloat(loc.latitude), parseFloat(loc.longitude));
      if (d < dist) dist = d;
    }
    if (dist > MAX_DIST_M)
      return errorResponse(res,
        `Anda berada ${Math.round(dist)} meter dari lokasi absensi. Maksimal ${MAX_DIST_M} meter.`, 400);

    /* Time-window validation */
    const totalMin = new Date().getHours() * 60 + new Date().getMinutes();
    let inWindow;
    if (punch_type === 'in') {
      inWindow = totalMin >= timeToMin(shiftRow.check_in_start) && totalMin <= timeToMin(shiftRow.check_in_end);
    } else if (shiftRow.is_overnight) {
      inWindow = totalMin >= timeToMin(shiftRow.check_out_start) || totalMin <= 239;
    } else {
      inWindow = totalMin >= timeToMin(shiftRow.check_out_start) && totalMin <= timeToMin(shiftRow.check_out_end);
    }
    if (!inWindow) {
      const act = punch_type === 'in' ? 'masuk' : 'keluar';
      return errorResponse(res, `Bukan waktu absen ${shiftRow.shift_name} ${act} saat ini.`, 400);
    }

    const workDate = getWorkDate();

    const [rows] = await pool.query(
      `SELECT * FROM tr_attendance_shift_ikm
       WHERE employee_id = ? AND work_date = ? AND shift_type = ? AND is_valet = 0 LIMIT 1`,
      [employeeId, workDate, shift_type]
    );

    if (punch_type === 'in') {
      if (rows.length > 0 && rows[0].check_in_time)
        return errorResponse(res, `Anda sudah absen masuk shift ${shiftRow.shift_name}.`, 400);

      const canInPhotoPath = await hasColumn('tr_attendance_shift_ikm', 'check_in_photo_path');
      const canInPhotoName = await hasColumn('tr_attendance_shift_ikm', 'check_in_photo_name');
      if (rows.length === 0) {
        if (canInPhotoPath && canInPhotoName) {
          await pool.query(
            `INSERT INTO tr_attendance_shift_ikm
             (user_id, employee_id, work_date, shift_type, check_in_time, check_in_lat, check_in_lng, check_in_photo_path, check_in_photo_name, is_valet)
             VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, 0)`,
            [userId, employeeId, workDate, shift_type, lat, lng, photo_path || null, photo_name || null]
          );
        } else {
          await pool.query(
            `INSERT INTO tr_attendance_shift_ikm
             (user_id, employee_id, work_date, shift_type, check_in_time, check_in_lat, check_in_lng, is_valet)
             VALUES (?, ?, ?, ?, NOW(), ?, ?, 0)`,
            [userId, employeeId, workDate, shift_type, lat, lng]
          );
        }
      } else {
        if (canInPhotoPath && canInPhotoName) {
          await pool.query(
            `UPDATE tr_attendance_shift_ikm
             SET user_id=?, check_in_time=NOW(), check_in_lat=?, check_in_lng=?, check_in_photo_path=?, check_in_photo_name=?
             WHERE employee_id=? AND work_date=? AND shift_type=? AND is_valet=0`,
            [userId, lat, lng, photo_path || null, photo_name || null, employeeId, workDate, shift_type]
          );
        } else {
          await pool.query(
            `UPDATE tr_attendance_shift_ikm
             SET user_id=?, check_in_time=NOW(), check_in_lat=?, check_in_lng=?
             WHERE employee_id=? AND work_date=? AND shift_type=? AND is_valet=0`,
            [userId, lat, lng, employeeId, workDate, shift_type]
          );
        }
      }
      return successResponse(res, `Absen masuk shift ${shiftRow.shift_name} berhasil`);

    } else {
      if (rows.length === 0 || !rows[0].check_in_time)
        return errorResponse(res, `Anda belum absen masuk shift ${shiftRow.shift_name}.`, 400);
      if (rows[0].check_out_time)
        return errorResponse(res, `Anda sudah absen keluar shift ${shiftRow.shift_name}.`, 400);

      const canOutPhotoPath = await hasColumn('tr_attendance_shift_ikm', 'check_out_photo_path');
      const canOutPhotoName = await hasColumn('tr_attendance_shift_ikm', 'check_out_photo_name');
      if (canOutPhotoPath && canOutPhotoName) {
        await pool.query(
          `UPDATE tr_attendance_shift_ikm
           SET check_out_time=NOW(), check_out_lat=?, check_out_lng=?, check_out_photo_path=?, check_out_photo_name=?
           WHERE employee_id=? AND work_date=? AND shift_type=? AND is_valet=0`,
          [lat, lng, photo_path || null, photo_name || null, employeeId, workDate, shift_type]
        );
      } else {
        await pool.query(
          `UPDATE tr_attendance_shift_ikm
           SET check_out_time=NOW(), check_out_lat=?, check_out_lng=?
           WHERE employee_id=? AND work_date=? AND shift_type=? AND is_valet=0`,
          [lat, lng, employeeId, workDate, shift_type]
        );
      }
      return successResponse(res, `Absen keluar shift ${shiftRow.shift_name} berhasil`);
    }
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   POST /attendance/shift-punch-selfie (multipart/form-data)
   Fields: shift_type, punch_type, lat, lng, selfie(file)
══════════════════════════════════════════════════════════════════ */
const shiftPunchSelfie = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 'Foto selfie wajib diambil dari kamera.', 400);

    const photo_path = ATTENDANCE_UPLOAD_PUBLIC_PATH;
    const photo_name = req.file.filename;
    req.body = { ...req.body, photo_path, photo_name };
    return shiftPunch(req, res, next);
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   GET /attendance/check-cross
   Returns whether the employee already has normal/valet records today.
══════════════════════════════════════════════════════════════════ */
const checkCross = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const workDate   = getWorkDate();

    const [normalRows] = await pool.query(
      `SELECT 1 FROM tr_attendance_shift_ikm
       WHERE employee_id = ? AND work_date = ? AND is_valet = 0 LIMIT 1`,
      [employeeId, workDate]
    );

    const [valetRows] = await pool.query(
      `SELECT 1 FROM tr_attendance_shift_ikm
       WHERE employee_id = ? AND work_date = ? AND is_valet = 1 LIMIT 1`,
      [employeeId, workDate]
    );

    return successResponse(res, 'Cross check', {
      has_normal: normalRows.length > 0,
      has_valet: valetRows.length > 0
    });
  } catch (error) { next(error); }
};

module.exports = { getTodayShifts, shiftPunch, shiftPunchSelfie, checkCross };