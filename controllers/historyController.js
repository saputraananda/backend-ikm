const { poolIkm: pool } = require('../db/pool');
const { successResponse } = require('../utils/response');

/* ── Shared helpers ─────────────────────────────────────────────── */
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
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/* ══════════════════════════════════════════════════════════════════
   GET /history/combined
   Returns combined attendance data (normal + valet) per work_date.
   Each row has:
     - attendance_date
     - Normal shift columns: pagi_in/out, siang_in/out, sore_in/out, lembur_in/out
     - Valet shift columns:  valet_pagi_in/out, valet_sore_in/out
     - has_normal, has_valet  (boolean flags)
     - Aggregated check_in_time / check_out_time for calendar dot
══════════════════════════════════════════════════════════════════ */
const combinedHistory = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;

    const [rows] = await pool.query(
      `SELECT
         work_date AS attendance_date,

         /* ── Normal shifts ── */
         MAX(CASE WHEN is_valet=0 AND shift_type='pagi'   THEN check_in_time  END) AS pagi_in,
         MAX(CASE WHEN is_valet=0 AND shift_type='pagi'   THEN check_out_time END) AS pagi_out,
         MAX(CASE WHEN is_valet=0 AND shift_type='siang'  THEN check_in_time  END) AS siang_in,
         MAX(CASE WHEN is_valet=0 AND shift_type='siang'  THEN check_out_time END) AS siang_out,
         MAX(CASE WHEN is_valet=0 AND shift_type='sore'   THEN check_in_time  END) AS sore_in,
         MAX(CASE WHEN is_valet=0 AND shift_type='sore'   THEN check_out_time END) AS sore_out,
         MAX(CASE WHEN is_valet=0 AND shift_type='lembur' THEN check_in_time  END) AS lembur_in,
         MAX(CASE WHEN is_valet=0 AND shift_type='lembur' THEN check_out_time END) AS lembur_out,

         /* ── Valet shifts ── */
         MAX(CASE WHEN is_valet=1 AND shift_type='pagi' THEN check_in_time  END) AS valet_pagi_in,
         MAX(CASE WHEN is_valet=1 AND shift_type='pagi' THEN check_out_time END) AS valet_pagi_out,
         MAX(CASE WHEN is_valet=1 AND shift_type='sore' THEN check_in_time  END) AS valet_sore_in,
         MAX(CASE WHEN is_valet=1 AND shift_type='sore' THEN check_out_time END) AS valet_sore_out,

         /* ── Flags ── */
         MAX(CASE WHEN is_valet=0 THEN 1 ELSE 0 END) AS has_normal,
         MAX(CASE WHEN is_valet=1 THEN 1 ELSE 0 END) AS has_valet,

         /* ── Aggregated first-in / last-out ── */
         MIN(check_in_time)  AS check_in_time,
         MAX(check_out_time) AS check_out_time

       FROM tr_attendance_shift_ikm
       WHERE employee_id = ?
       GROUP BY work_date
       ORDER BY work_date DESC
       LIMIT 120`,
      [employeeId]
    );

    return successResponse(res, 'Riwayat absensi gabungan', rows);
  } catch (error) { next(error); }
};

module.exports = { combinedHistory };
