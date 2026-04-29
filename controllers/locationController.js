const { poolIkm: pool } = require('../db/pool');
const { successResponse } = require('../utils/response');

/* ══════════════════════════════════════════════════════════════════
   GET /locations
   Returns all attendance locations from mst_location_absen.
══════════════════════════════════════════════════════════════════ */
const getLocations = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, location_id, location_name, latitude, longitude FROM mst_location_absen ORDER BY id'
    );
    return successResponse(res, 'Data lokasi absensi', rows);
  } catch (error) { next(error); }
};

module.exports = { getLocations };
