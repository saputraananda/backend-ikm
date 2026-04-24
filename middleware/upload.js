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

/* ── Employee-specific dirs — overridable via individual env vars ── */
function resolveEmployeeDir(envVar, localSubDir) {
  const raw = process.env[envVar];
  if (!raw) return path.join(STORAGE_BASE_DIR, localSubDir);
  return path.isAbsolute(raw) ? raw : path.join(__dirname, '..', raw);
}

const EMPLOYEE_AVATAR_UPLOAD_DIR         = resolveEmployeeDir('EMPLOYEE_AVATAR_UPLOAD_DIR', 'avatars');
const EMPLOYEE_AVATAR_UPLOAD_PUBLIC_PATH = process.env.EMPLOYEE_AVATAR_PUBLIC_PATH || '/storage/assets/avatars';

const EMPLOYEE_DOC_UPLOAD_DIR            = resolveEmployeeDir('EMPLOYEE_DOC_UPLOAD_DIR', 'documents');
const EMPLOYEE_DOC_UPLOAD_PUBLIC_PATH    = process.env.EMPLOYEE_DOC_PUBLIC_PATH    || '/storage/assets/documents';

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // ignore mkdir race
  }
}

ensureDir(ATTENDANCE_UPLOAD_DIR);
ensureDir(LEAVE_UPLOAD_DIR);
ensureDir(LINEN_UPLOAD_DIR);
ensureDir(EMPLOYEE_AVATAR_UPLOAD_DIR);
ensureDir(EMPLOYEE_DOC_UPLOAD_DIR);

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
   profile  → EMPLOYEE_AVATAR_UPLOAD_DIR  (images only)
   ktp/kk/… → EMPLOYEE_DOC_UPLOAD_DIR    (images + PDF)
────────────────────────────────────────────────────────────────────── */
const employeeUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = req.params?.docType === 'profile'
      ? EMPLOYEE_AVATAR_UPLOAD_DIR
      : EMPLOYEE_DOC_UPLOAD_DIR;
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const employeeId = safe(req.user?.employee_id || 'unknown');
    const docType = safe(req.params?.docType || req.body?.doc_type || 'doc');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${docType}_${employeeId}_${ts}${ext}`);
  }
});

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
  EMPLOYEE_AVATAR_UPLOAD_DIR,
  EMPLOYEE_AVATAR_UPLOAD_PUBLIC_PATH,
  EMPLOYEE_DOC_UPLOAD_DIR,
  EMPLOYEE_DOC_UPLOAD_PUBLIC_PATH,
  uploadSelfie,
  uploadDoctorNote,
  uploadLinenAttachment,
  uploadEmployeeDoc
};
