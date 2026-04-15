const fs = require('fs');
const path = require('path');
const multer = require('multer');

function resolveUploadBaseDir() {
  // Read from env so path doesn't get published in code.
  // - production: set absolute path in .env / env vars
  // - development: can be relative (resolved from backend root)
  const raw = process.env.UPLOAD_BASE_DIR;
  if (!raw) return path.join(__dirname, '..', 'assets', 'buktiabsen');
  return path.isAbsolute(raw) ? raw : path.join(__dirname, '..', raw);
}

const UPLOAD_BASE_DIR = resolveUploadBaseDir();

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // ignore mkdir race
  }
}

ensureDir(UPLOAD_BASE_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDir(UPLOAD_BASE_DIR);
    cb(null, UPLOAD_BASE_DIR);
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

module.exports = { UPLOAD_BASE_DIR, uploadSelfie };

