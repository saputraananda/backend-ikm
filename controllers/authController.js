const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, poolIkm } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');

const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return errorResponse(res, 'Username dan password wajib diisi', 400);
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
      LEFT JOIN mst_employee me ON me.email = u.email
      WHERE u.username = ?
      LIMIT 1`,
      [username]
    );

    if (rows.length === 0) {
      return errorResponse(res, 'Username atau password salah', 401);
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return errorResponse(res, 'Username atau password salah', 401);
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
        me.profile_path,
        me.profile_name
      FROM users u
      LEFT JOIN mst_employee me ON me.email = u.email
      WHERE u.id = ?
      LIMIT 1`,
      [req.user.user_id]
    );

    if (rows.length === 0) {
      return errorResponse(res, 'User tidak ditemukan', 404);
    }

    const row = rows[0];
    let profile_url = null;
    if (row.profile_path && row.profile_name) {
      const norm = row.profile_path.startsWith('/') ? row.profile_path : `/${row.profile_path}`;
      profile_url = `${req.protocol}://${req.get('host')}${norm}/${encodeURIComponent(row.profile_name)}`;
    }

    return successResponse(res, 'Profile berhasil diambil', { ...row, profile_url });
  } catch (error) {
    next(error);
  }
};

const leaderRole = async (req, res, next) => {
  try {
    const employeeId = req.user?.employee_id;
    if (!employeeId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const [rows] = await poolIkm.query(
      `SELECT role FROM mst_leader WHERE employee_id = ? LIMIT 1`,
      [employeeId]
    );

    if (rows.length === 0) {
      return res.status(200).json({ success: true, data: { is_leader: false, role: null } });
    }

    return res.status(200).json({ success: true, data: { is_leader: true, role: rows[0].role } });
  } catch (err) {
    next(err);
  }
};

/* ══════════════════════════════════════════════════════════════════
   POST /auth/register
   Admin-only. Buat akun user baru dengan password bcrypt-hashed.
   Body: { name, email, username, password, role?, employee_id? }
   Jika employee_id disertakan, update mst_employee agar match.
══════════════════════════════════════════════════════════════════ */
const register = async (req, res, next) => {
  try {
    const caller = req.user;
    if (caller.role !== 'admin' && caller.role !== 'superadmin') {
      return errorResponse(res, 'Hanya admin yang dapat mendaftarkan akun.', 403);
    }

    const { name, email, username, password, role = 'employee', employee_id } = req.body;

    if (!name || !email || !username || !password) {
      return errorResponse(res, 'name, email, username, dan password wajib diisi.', 400);
    }

    if (password.length < 6) {
      return errorResponse(res, 'Password minimal 6 karakter.', 400);
    }

    /* Cek duplikat username / email */
    const [dup] = await pool.query(
      `SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1`,
      [username, email]
    );
    if (dup.length > 0) {
      return errorResponse(res, 'Username atau email sudah digunakan.', 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await pool.query(
      `INSERT INTO users (name, email, username, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
      [name, email, username, passwordHash, role]
    );

    const newUserId = result.insertId;

    /* Jika employee_id diberikan, pastikan mst_employee.employee_id sinkron */
    if (employee_id) {
      await pool.query(
        `UPDATE mst_employee SET employee_id = ? WHERE employee_id = ?`,
        [newUserId, employee_id]
      );
    } else {
      /* Jika belum ada row mst_employee, buat minimal row agar login tidak error */
      const [emp] = await pool.query(
        `SELECT employee_id FROM mst_employee WHERE employee_id = ? LIMIT 1`,
        [newUserId]
      );
      if (emp.length === 0) {
        await pool.query(
          `INSERT INTO mst_employee (employee_id, full_name, is_deleted) VALUES (?, ?, 0)`,
          [newUserId, name]
        );
      }
    }

    return successResponse(res, 'Akun berhasil dibuat.', { user_id: newUserId, username });
  } catch (error) {
    next(error);
  }
};

/* ══════════════════════════════════════════════════════════════════
   PUT /auth/reset-password
   Admin-only. Hash ulang password (fix akun yang tersimpan plain text).
   Body: { username, new_password }
══════════════════════════════════════════════════════════════════ */
const resetPassword = async (req, res, next) => {
  try {
    const caller = req.user;
    if (caller.role !== 'admin' && caller.role !== 'superadmin') {
      return errorResponse(res, 'Hanya admin yang dapat mereset password.', 403);
    }

    const { username, new_password } = req.body;
    if (!username || !new_password) {
      return errorResponse(res, 'username dan new_password wajib diisi.', 400);
    }
    if (new_password.length < 6) {
      return errorResponse(res, 'Password minimal 6 karakter.', 400);
    }

    const [rows] = await pool.query(
      `SELECT id FROM users WHERE username = ? LIMIT 1`,
      [username]
    );
    if (rows.length === 0) {
      return errorResponse(res, 'Username tidak ditemukan.', 404);
    }

    const passwordHash = await bcrypt.hash(new_password, 12);
    await pool.query(
      `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE username = ?`,
      [passwordHash, username]
    );

    return successResponse(res, `Password untuk "${username}" berhasil direset.`);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  profile,
  leaderRole,
  register,
  resetPassword,
};