const { poolIkm: pool } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');

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
const OFFICE_LAT = -6.3983239;
const OFFICE_LNG = 106.8997063;
const OFFICE_LAT_2 = -6.3848079;
const OFFICE_LNG_2 = 106.8997077;
const MAX_DIST_M = 200;

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

/* ── Shift time windows (minutes from midnight) ─────────────────── */
const SHIFT_WINDOWS = {
  pagi:   { in: [240,  710],  out: [711,  760]  },
  siang:  { in: [761,  1010], out: [1011, 1100] },
  sore:   { in: [1101, 1290], out: [1291, 1323] },
  lembur: { in: [1324, 1350], out: 'midnight'   },
};

function isInShiftWindow(shiftType, punchType) {
  const now      = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  const win      = SHIFT_WINDOWS[shiftType];
  if (!win) return false;
  if (punchType === 'in') return totalMin >= win.in[0] && totalMin <= win.in[1];
  if (win.out === 'midnight') return totalMin >= 1351 || totalMin <= 239;
  return totalMin >= win.out[0] && totalMin <= win.out[1];
}

const SHIFT_LABELS = { pagi: 'Pagi', siang: 'Siang', sore: 'Sore', lembur: 'Lembur' };

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
       WHERE employee_id = ? AND work_date = ?`,
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
    const validShifts = ['pagi', 'siang', 'sore', 'lembur'];
    const validPunch  = ['in', 'out'];
    if (!validShifts.includes(shift_type) || !validPunch.includes(punch_type))
      return errorResponse(res, 'Parameter tidak valid', 400);

    /* Location validation */
    if (lat == null || lng == null)
      return errorResponse(res, 'Lokasi tidak tersedia. Aktifkan GPS dan izinkan akses lokasi.', 400);

    const dist1 = haversineMeters(parseFloat(lat), parseFloat(lng), OFFICE_LAT, OFFICE_LNG);
    const dist2 = haversineMeters(parseFloat(lat), parseFloat(lng), OFFICE_LAT_2, OFFICE_LNG_2);
    const dist = Math.min(dist1, dist2);
    if (dist > MAX_DIST_M)
      return errorResponse(res,
        `Anda berada ${Math.round(dist)} meter dari lokasi absensi. Maksimal ${MAX_DIST_M} meter.`, 400);

    /* Time-window validation */
    if (!isInShiftWindow(shift_type, punch_type)) {
      const label = SHIFT_LABELS[shift_type];
      const act   = punch_type === 'in' ? 'masuk' : 'keluar';
      return errorResponse(res, `Bukan waktu absen ${label} ${act} saat ini.`, 400);
    }

    const workDate = getWorkDate();

    const [rows] = await pool.query(
      `SELECT * FROM tr_attendance_shift_ikm
       WHERE employee_id = ? AND work_date = ? AND shift_type = ? LIMIT 1`,
      [employeeId, workDate, shift_type]
    );

    if (punch_type === 'in') {
      if (rows.length > 0 && rows[0].check_in_time)
        return errorResponse(res, `Anda sudah absen masuk shift ${SHIFT_LABELS[shift_type]}.`, 400);

      const canInPhotoPath = await hasColumn('tr_attendance_shift_ikm', 'check_in_photo_path');
      const canInPhotoName = await hasColumn('tr_attendance_shift_ikm', 'check_in_photo_name');
      if (rows.length === 0) {
        if (canInPhotoPath && canInPhotoName) {
          await pool.query(
            `INSERT INTO tr_attendance_shift_ikm
             (user_id, employee_id, work_date, shift_type, check_in_time, check_in_lat, check_in_lng, check_in_photo_path, check_in_photo_name)
             VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
            [userId, employeeId, workDate, shift_type, lat, lng, photo_path || null, photo_name || null]
          );
        } else {
          await pool.query(
            `INSERT INTO tr_attendance_shift_ikm
             (user_id, employee_id, work_date, shift_type, check_in_time, check_in_lat, check_in_lng)
             VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
            [userId, employeeId, workDate, shift_type, lat, lng]
          );
        }
      } else {
        if (canInPhotoPath && canInPhotoName) {
          await pool.query(
            `UPDATE tr_attendance_shift_ikm
             SET user_id=?, check_in_time=NOW(), check_in_lat=?, check_in_lng=?, check_in_photo_path=?, check_in_photo_name=?
             WHERE employee_id=? AND work_date=? AND shift_type=?`,
            [userId, lat, lng, photo_path || null, photo_name || null, employeeId, workDate, shift_type]
          );
        } else {
          await pool.query(
            `UPDATE tr_attendance_shift_ikm
             SET user_id=?, check_in_time=NOW(), check_in_lat=?, check_in_lng=?
             WHERE employee_id=? AND work_date=? AND shift_type=?`,
            [userId, lat, lng, employeeId, workDate, shift_type]
          );
        }
      }
      return successResponse(res, `Absen masuk shift ${SHIFT_LABELS[shift_type]} berhasil`);

    } else {
      if (rows.length === 0 || !rows[0].check_in_time)
        return errorResponse(res, `Anda belum absen masuk shift ${SHIFT_LABELS[shift_type]}.`, 400);
      if (rows[0].check_out_time)
        return errorResponse(res, `Anda sudah absen keluar shift ${SHIFT_LABELS[shift_type]}.`, 400);

      const canOutPhotoPath = await hasColumn('tr_attendance_shift_ikm', 'check_out_photo_path');
      const canOutPhotoName = await hasColumn('tr_attendance_shift_ikm', 'check_out_photo_name');
      if (canOutPhotoPath && canOutPhotoName) {
        await pool.query(
          `UPDATE tr_attendance_shift_ikm
           SET check_out_time=NOW(), check_out_lat=?, check_out_lng=?, check_out_photo_path=?, check_out_photo_name=?
           WHERE employee_id=? AND work_date=? AND shift_type=?`,
          [lat, lng, photo_path || null, photo_name || null, employeeId, workDate, shift_type]
        );
      } else {
        await pool.query(
          `UPDATE tr_attendance_shift_ikm
           SET check_out_time=NOW(), check_out_lat=?, check_out_lng=?
           WHERE employee_id=? AND work_date=? AND shift_type=?`,
          [lat, lng, employeeId, workDate, shift_type]
        );
      }
      return successResponse(res, `Absen keluar shift ${SHIFT_LABELS[shift_type]} berhasil`);
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

    const photo_path = '/storage/buktiabsen';
    const photo_name = req.file.filename;
    req.body = { ...req.body, photo_path, photo_name };
    return shiftPunch(req, res, next);
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   GET /attendance/history
   Returns one row per work_date (earliest check-in, latest check-out)
   so HistoryPage calendar continues to work without changes.
══════════════════════════════════════════════════════════════════ */
const history = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;

    const [rows] = await pool.query(
      `SELECT
         work_date AS attendance_date,
         MAX(CASE WHEN shift_type='pagi'   THEN check_in_time  END) AS pagi_in,
         MAX(CASE WHEN shift_type='pagi'   THEN check_out_time END) AS pagi_out,
         MAX(CASE WHEN shift_type='siang'  THEN check_in_time  END) AS siang_in,
         MAX(CASE WHEN shift_type='siang'  THEN check_out_time END) AS siang_out,
         MAX(CASE WHEN shift_type='sore'   THEN check_in_time  END) AS sore_in,
         MAX(CASE WHEN shift_type='sore'   THEN check_out_time END) AS sore_out,
         MAX(CASE WHEN shift_type='lembur' THEN check_in_time  END) AS lembur_in,
         MAX(CASE WHEN shift_type='lembur' THEN check_out_time END) AS lembur_out,
         MIN(check_in_time)  AS check_in_time,
         MAX(check_out_time) AS check_out_time
       FROM tr_attendance_shift_ikm
       WHERE employee_id = ?
       GROUP BY work_date
       ORDER BY work_date DESC
       LIMIT 90`,
      [employeeId]
    );

    return successResponse(res, 'Riwayat absensi berhasil diambil', rows);
  } catch (error) { next(error); }
};

module.exports = { getTodayShifts, shiftPunch, shiftPunchSelfie, history };