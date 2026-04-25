const fs = require('fs');
const path = require('path');
const multer = require('multer');

function resolveStorageBaseDir() {
  const raw = process.env.UPLOAD_BASE_DIR;
  if (!raw) return path.join(__dirname, '..', 'assets');
  return path.isAbsolute(raw) ? raw : path.join(__dirname, '..', raw);
}

const STORAGE_BASE_DIR = resolveStorageBaseDir();

// Add new upload folders here when new image upload features are introduced.
const UPLOAD_FOLDERS = Object.freeze({
  attendanceProof: {
    subDir: 'buktiabsen',
    publicPath: '/storage/buktiabsen'
  },
  doctorNote: {
    subDir: 'suratketerangan',
    publicPath: '/storage/suratketerangan'
  },
  linenAttachment: {
    subDir: 'linenreport',
    publicPath: '/storage/linenreport'
  },
});

function resolveUploadTarget(key) {
  const target = UPLOAD_FOLDERS[key];
  if (!target) throw new Error(`Unknown upload target: ${key}`);
  return {
    ...target,
    absoluteDir: path.join(STORAGE_BASE_DIR, target.subDir)
  };
}

const attendanceUploadTarget = resolveUploadTarget('attendanceProof');
const ATTENDANCE_UPLOAD_DIR = attendanceUploadTarget.absoluteDir;
const ATTENDANCE_UPLOAD_PUBLIC_PATH = attendanceUploadTarget.publicPath;

const leaveUploadTarget = resolveUploadTarget('doctorNote');
const LEAVE_UPLOAD_DIR = leaveUploadTarget.absoluteDir;
const LEAVE_UPLOAD_PUBLIC_PATH = leaveUploadTarget.publicPath;

const linenUploadTarget = resolveUploadTarget('linenAttachment');
const LINEN_UPLOAD_DIR = linenUploadTarget.absoluteDir;
const LINEN_UPLOAD_PUBLIC_PATH = linenUploadTarget.publicPath;

/* ── Employee files ──────────────────────────────────────────────────────────
   Dev  → simpan ke disk lokal (STORAGE_BASE_DIR/avatars & /documents)
   Prod → di-proxy ke Waschen API
────────────────────────────────────────────────────────────────────────────── */
const isProd = process.env.NODE_ENV === 'production';

const EMPLOYEE_AVATAR_LOCAL_DIR = path.join(STORAGE_BASE_DIR, 'avatars');
const EMPLOYEE_DOC_LOCAL_DIR = path.join(STORAGE_BASE_DIR, 'documents');

const EMPLOYEE_AVATAR_UPLOAD_PUBLIC_PATH = isProd
  ? (process.env.WASCHEN_AVATAR_PUBLIC_PATH || 'https://api.waschenalora.com/storage/assets/avatars')
  : '/storage/avatars';

const EMPLOYEE_DOC_UPLOAD_PUBLIC_PATH = isProd
  ? (process.env.WASCHEN_DOC_PUBLIC_PATH || 'https://api.waschenalora.com/storage/assets/documents')
  : '/storage/documents';

async function forwardFileToWaschen(file, docType) {
  if (!isProd) {
    const dir = docType === 'profile' ? EMPLOYEE_AVATAR_LOCAL_DIR : EMPLOYEE_DOC_LOCAL_DIR;
    ensureDir(dir);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const fileName = `${docType}_${Date.now()}${ext}`;
    fs.writeFileSync(path.join(dir, fileName), file.buffer);
    return { file_name: fileName };
  }

  const baseUrl = process.env.WASCHEN_API_URL || 'https://api.waschenalora.com';
  const url = `${baseUrl}/internal/upload/${docType}`;

  const formData = new FormData();
  formData.append('doc', new Blob([file.buffer], { type: file.mimetype }), file.originalname);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-internal-key': process.env.WASCHEN_INTERNAL_KEY || '' },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`Waschen upload gagal (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.data; // expects { file_name: '...' }
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

ensureDir(ATTENDANCE_UPLOAD_DIR);
ensureDir(LEAVE_UPLOAD_DIR);
ensureDir(LINEN_UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDir(ATTENDANCE_UPLOAD_DIR);
    cb(null, ATTENDANCE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const employeeId = safe(req.user?.employee_id || req.body?.employee_id || 'unknown');
    const shiftType = safe(req.body?.shift_type || 'shift');
    const punchType = safe(req.body?.punch_type || 'punch');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `selfie_${employeeId}_${shiftType}_${punchType}_${ts}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype || '');
  if (!ok) return cb(new Error('File harus berupa gambar (jpeg/png/webp).'));
  cb(null, true);
};

const uploadSelfie = multer({
  storage,
  fileFilter,
  limits: { fileSize: 6 * 1024 * 1024 } // 6MB
});

/* ── Doctor note upload (leave/permit) ──────────────────────────── */
const leaveStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDir(LEAVE_UPLOAD_DIR);
    cb(null, LEAVE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const employeeId = safe(req.user?.employee_id || 'unknown');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `surat_${employeeId}_${ts}${ext}`);
  }
});

const uploadDoctorNote = multer({
  storage: leaveStorage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

/* ── Linen report attachment upload ──────────────────────────────── */
const linenStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDir(LINEN_UPLOAD_DIR);
    cb(null, LINEN_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const employeeId = safe(req.user?.employee_id || 'unknown');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `linen_${employeeId}_${ts}${ext}`);
  }
});

const uploadLinenAttachment = multer({
  storage: linenStorage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

/* ── Employee avatar + document upload ──────────────────────────────
   File disimpan di buffer (memory), lalu di-forward ke Waschen API.
────────────────────────────────────────────────────────────────────── */
const employeeUploadStorage = multer.memoryStorage();

const employeeDocFileFilter = (req, file, cb) => {
  const isProfile = req.params?.docType === 'profile';
  const ok = isProfile
    ? /^image\/(jpeg|png|webp)$/.test(file.mimetype || '')
    : /^image\/(jpeg|png|webp)$|^application\/pdf$/.test(file.mimetype || '');
  if (!ok) {
    const msg = isProfile
      ? 'Foto profil harus berupa gambar (jpeg/png/webp).'
      : 'File harus berupa gambar (jpeg/png/webp) atau PDF.';
    return cb(new Error(msg));
  }
  cb(null, true);
};

const uploadEmployeeDoc = multer({
  storage: employeeUploadStorage,
  fileFilter: employeeDocFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

module.exports = {
  STORAGE_BASE_DIR,
  UPLOAD_FOLDERS,
  ATTENDANCE_UPLOAD_DIR,
  ATTENDANCE_UPLOAD_PUBLIC_PATH,
  LEAVE_UPLOAD_DIR,
  LEAVE_UPLOAD_PUBLIC_PATH,
  LINEN_UPLOAD_DIR,
  LINEN_UPLOAD_PUBLIC_PATH,
  EMPLOYEE_AVATAR_LOCAL_DIR,
  EMPLOYEE_DOC_LOCAL_DIR,
  EMPLOYEE_AVATAR_UPLOAD_PUBLIC_PATH,
  EMPLOYEE_DOC_UPLOAD_PUBLIC_PATH,
  forwardFileToWaschen,
  uploadSelfie,
  uploadDoctorNote,
  uploadLinenAttachment,
  uploadEmployeeDoc
};
