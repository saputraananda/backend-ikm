const { pool } = require('../db/pool');
const { successResponse, errorResponse } = require('../utils/response');
const { EMPLOYEE_AVATAR_UPLOAD_PUBLIC_PATH, EMPLOYEE_DOC_UPLOAD_PUBLIC_PATH } = require('../middleware/upload');

/* ── Allowed text fields (whitelist, protects against mass-assignment) ── */
const ALLOWED_TEXT_FIELDS = [
  'join_date', 'contract_end_date', 'school_name', 'religion_id',
  'marital_status', 'bank_id', 'bank_account_number',
  'gender', 'birth_place', 'birth_date', 'address', 'ktp_number',
  'phone_number',
];

/* ── Doc types with their DB path/name column pairs ── */
const DOC_COLUMNS = {
  ktp:       { path: 'ktp_path',       name: 'ktp_name' },
  kk:        { path: 'kk_path',        name: 'kk_name' },
  npwp:      { path: 'npwp_path',      name: 'npwp_name' },
  bpjs:      { path: 'bpjs_path',      name: 'bpjs_name' },
  bpjs_tk:   { path: 'bpjs_tk_path',   name: 'bpjs_tk_name' },
  ijazah:    { path: 'ijazah_path',     name: 'ijazah_name' },
  sertifikat:{ path: 'sertifikat_path', name: 'sertifikat_name' },
  rekomkerja:{ path: 'rekomkerja_path', name: 'rekomkerja_name' },
  profile:   { path: 'profile_path',   name: 'profile_name' },
};

/* ══════════════════════════════════════════════════════════════════
   GET /employee/profile-detail
   Returns full mst_employee row for the logged-in user.
══════════════════════════════════════════════════════════════════ */
const getProfileDetail = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;

    const [rows] = await pool.query(
      `SELECT
         me.employee_id, me.employee_code, me.full_name, me.gender,
         me.birth_place, me.birth_date, me.address, me.ktp_number,
         me.phone_number, me.school_name, me.religion_id,
         me.marital_status, me.bank_id, me.bank_account_number,
         me.join_date, me.contract_end_date,
         me.ktp_path, me.ktp_name,
         me.kk_path, me.kk_name,
         me.npwp_path, me.npwp_name,
         me.bpjs_path, me.bpjs_name,
         me.bpjs_tk_path, me.bpjs_tk_name,
         me.ijazah_path, me.ijazah_name,
         me.sertifikat_path, me.sertifikat_name,
         me.rekomkerja_path, me.rekomkerja_name,
         me.profile_path, me.profile_name
       FROM mst_employee me
       WHERE me.employee_id = ?
       LIMIT 1`,
      [employeeId]
    );

    if (rows.length === 0) return errorResponse(res, 'Data karyawan tidak ditemukan', 404);

    const row = rows[0];

    /* Build public URLs for each document */
    const buildUrl = (reqObj, docPath, docName) => {
      if (!docPath || !docName) return null;
      const norm = docPath.startsWith('/') ? docPath : `/${docPath}`;
      return `${reqObj.protocol}://${reqObj.get('host')}${norm}/${encodeURIComponent(docName)}`;
    };

    const docs = {};
    for (const [key, cols] of Object.entries(DOC_COLUMNS)) {
      docs[`${key}_url`] = buildUrl(req, row[cols.path], row[cols.name]);
    }

    return successResponse(res, 'Data profil berhasil diambil', { ...row, ...docs });
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   PUT /employee/update-profile
   Body (JSON): any subset of ALLOWED_TEXT_FIELDS
══════════════════════════════════════════════════════════════════ */
const updateProfile = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const body = req.body || {};

    const sets = [];
    const vals = [];

    for (const field of ALLOWED_TEXT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        sets.push(`${field} = ?`);
        /* Empty string → NULL for date/numeric columns */
        vals.push(body[field] === '' ? null : body[field]);
      }
    }

    if (sets.length === 0)
      return errorResponse(res, 'Tidak ada data yang diubah.', 400);

    sets.push('updated_at = NOW()');
    vals.push(employeeId);

    await pool.query(
      `UPDATE mst_employee SET ${sets.join(', ')} WHERE employee_id = ?`,
      vals
    );

    return successResponse(res, 'Profil berhasil diperbarui.');
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   POST /employee/upload-doc/:docType
   Multipart: file field = "doc"
   :docType must be a key of DOC_COLUMNS
══════════════════════════════════════════════════════════════════ */
const uploadDoc = async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const { docType } = req.params;

    if (!DOC_COLUMNS[docType])
      return errorResponse(res, 'Tipe dokumen tidak valid.', 400);

    if (!req.file)
      return errorResponse(res, 'File dokumen wajib disertakan.', 400);

    const { path: pathCol, name: nameCol } = DOC_COLUMNS[docType];
    const publicPath = docType === 'profile'
      ? EMPLOYEE_AVATAR_UPLOAD_PUBLIC_PATH
      : EMPLOYEE_DOC_UPLOAD_PUBLIC_PATH;
    const fileName   = req.file.filename;

    await pool.query(
      `UPDATE mst_employee SET ${pathCol} = ?, ${nameCol} = ?, updated_at = NOW()
       WHERE employee_id = ?`,
      [publicPath, fileName, employeeId]
    );

    const fileUrl = `${req.protocol}://${req.get('host')}${publicPath}/${encodeURIComponent(fileName)}`;

    return successResponse(res, 'Dokumen berhasil diunggah.', {
      doc_type: docType,
      file_name: fileName,
      url: fileUrl,
    });
  } catch (error) { next(error); }
};

/* ══════════════════════════════════════════════════════════════════
   GET /employee/banks
   Returns active bank list for dropdown
══════════════════════════════════════════════════════════════════ */
const getBanks = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT bank_id, bank_name FROM mst_bank WHERE is_active = 1 ORDER BY bank_name`
    );
    return successResponse(res, 'Data bank berhasil diambil', rows);
  } catch (error) { next(error); }
};

module.exports = { getProfileDetail, updateProfile, uploadDoc, getBanks };
