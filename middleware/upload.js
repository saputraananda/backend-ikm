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
  }
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

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // ignore mkdir race
  }
}

ensureDir(ATTENDANCE_UPLOAD_DIR);

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

module.exports = {
  STORAGE_BASE_DIR,
  UPLOAD_FOLDERS,
  ATTENDANCE_UPLOAD_DIR,
  ATTENDANCE_UPLOAD_PUBLIC_PATH,
  uploadSelfie
};

