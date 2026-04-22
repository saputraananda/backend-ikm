const { poolIkm: pool } = require('../db/pool');
const { successResponse } = require('../utils/response');

const getShiftsNormal = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, shift_name, check_in_start, check_in_end, check_out_start, check_out_end, is_overnight FROM mst_shift_normal ORDER BY id'
    );
    return successResponse(res, 'Data shift normal', rows);
  } catch (error) { next(error); }
};

const getShiftsValet = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, shift_name, check_in_start, check_in_end, check_out_start, check_out_end, is_overnight FROM mst_shift_valet ORDER BY id'
    );
    return successResponse(res, 'Data shift valet', rows);
  } catch (error) { next(error); }
};

module.exports = { getShiftsNormal, getShiftsValet };
