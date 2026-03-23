const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return errorResponse(res, 'Email dan password wajib diisi', 400);
    }

    const [rows] = await pool.query(
      `SELECT 
        u.id,
        u.name,
        u.email,
        u.username,
        u.password_hash,
        u.role,
        me.employee_id,
        me.employee_code,
        me.full_name,
        me.company_id,
        me.department_id,
        me.position_id,
        me.phone_number,
        me.is_deleted
      FROM users u
      LEFT JOIN mst_employee me ON me.employee_id = u.id
      WHERE u.email = ?
      LIMIT 1`,
      [email]
    );

    if (rows.length === 0) {
      return errorResponse(res, 'Email atau password salah', 401);
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return errorResponse(res, 'Email atau password salah', 401);
    }

    if (!user.employee_id) {
      return errorResponse(res, 'Data employee tidak ditemukan', 403);
    }

    if (user.is_deleted === 1) {
      return errorResponse(res, 'Data employee sudah nonaktif', 403);
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        employee_id: user.employee_id,
        email: user.email,
        role: user.role,
        full_name: user.full_name
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return successResponse(res, 'Login berhasil', {
      token,
      user: {
        user_id: user.id,
        employee_id: user.employee_id,
        name: user.name,
        full_name: user.full_name,
        email: user.email,
        username: user.username,
        role: user.role,
        employee_code: user.employee_code,
        company_id: user.company_id,
        department_id: user.department_id,
        position_id: user.position_id,
        phone_number: user.phone_number
      }
    });
  } catch (error) {
    next(error);
  }
};

const profile = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        u.id AS user_id,
        u.name,
        u.email,
        u.username,
        u.role,
        me.employee_id,
        me.employee_code,
        me.full_name,
        me.gender,
        me.birth_place,
        me.birth_date,
        me.address,
        me.phone_number,
        me.company_id,
        me.department_id,
        me.position_id,
        me.join_date,
        me.profile_path
      FROM users u
      LEFT JOIN mst_employee me ON me.employee_id = u.id
      WHERE u.id = ?
      LIMIT 1`,
      [req.user.user_id]
    );

    if (rows.length === 0) {
      return errorResponse(res, 'User tidak ditemukan', 404);
    }

    return successResponse(res, 'Profile berhasil diambil', rows[0]);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  profile
};