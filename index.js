process.env.TZ = 'Asia/Jakarta';

const path = require('path');
const fs = require('fs');
const envPaths = [
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '../..', '.env'),
  path.join(__dirname, '../../..', '.env'),
  path.join(__dirname, '../../../..', '.env')
];
let envLoaded = false;
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    envLoaded = true;
    console.log(`[ENV] Loaded from: ${p}`);
    break;
  }
}
if (!envLoaded) {
  require('dotenv').config(); // Fallback default
  console.log('[ENV] No .env file found — using process.env directly (Hostinger panel vars)');
}
console.log('[ENV] JWT_SECRET loaded:', !!process.env.JWT_SECRET);
console.log('[ENV] DB_HOST_IKM loaded:', !!process.env.DB_HOST_IKM);

// Catch-all agar Node tidak mati karena unhandled error
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException — server tetap jalan:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection — server tetap jalan:', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/authRoutes');
const locationRoutes = require('./routes/locationRoutes');
const shiftRoutes = require('./routes/shiftRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const valetRoutes = require('./routes/valetRoutes');
const historyRoutes = require('./routes/historyRoutes');
const leaveRoutes = require('./routes/leaveRoutes');
const linenReportRoutes = require('./routes/linenReportRoutes');
const dailyReportRoutes = require('./routes/dailyReportLeaderRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const managementAttendanceRoutes = require('./routes/managementAttendanceRoutes');
const kasbonRoutes = require('./routes/kasbonRoutes');
const rewashRoutes = require('./routes/rewashRoutes');
const errorMiddleware = require('./middleware/errorMiddleware');
const {
  ATTENDANCE_UPLOAD_DIR, ATTENDANCE_UPLOAD_PUBLIC_PATH,
  LEAVE_UPLOAD_DIR, LEAVE_UPLOAD_PUBLIC_PATH,
  LINEN_UPLOAD_DIR, LINEN_UPLOAD_PUBLIC_PATH,
  DAILY_REPORT_UPLOAD_DIR, DAILY_REPORT_UPLOAD_PUBLIC_PATH,
  EMPLOYEE_AVATAR_DIR, EMPLOYEE_AVATAR_PUBLIC_PATH,
  EMPLOYEE_DOC_DIR, EMPLOYEE_DOC_PUBLIC_PATH,
  KASBON_UPLOAD_DIR, KASBON_UPLOAD_PUBLIC_PATH,
  PAYSLIP_UPLOAD_DIR, PAYSLIP_UPLOAD_PUBLIC_PATH, PAYSLIP_IS_REMOTE,
} = require('./middleware/upload');

const app = express();

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'unsafe-none' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
    xFrameOptions: false
  })
);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request gagal (4xx/5xx) → hapus file yang sudah ditulis multer agar tidak nyangkut di server
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400 && req.file?.path) fs.unlink(req.file.path, () => {});
  });
  next();
});

// Expose uploaded selfie proofs (for both local/prod base dir)
app.use(ATTENDANCE_UPLOAD_PUBLIC_PATH, express.static(ATTENDANCE_UPLOAD_DIR));
app.use(LEAVE_UPLOAD_PUBLIC_PATH, express.static(LEAVE_UPLOAD_DIR));
app.use(LINEN_UPLOAD_PUBLIC_PATH, express.static(LINEN_UPLOAD_DIR));
app.use(DAILY_REPORT_UPLOAD_PUBLIC_PATH, express.static(DAILY_REPORT_UPLOAD_DIR));
app.use(KASBON_UPLOAD_PUBLIC_PATH, express.static(KASBON_UPLOAD_DIR));
// Payslip: hanya di-serve secara statis jika dev (path lokal); prod pakai URL publik langsung
if (!PAYSLIP_IS_REMOTE && PAYSLIP_UPLOAD_DIR) {
  app.use(PAYSLIP_UPLOAD_PUBLIC_PATH, express.static(PAYSLIP_UPLOAD_DIR));
}

// Dev only — di prod file karyawan ada di waschen, tidak perlu di-serve di sini
app.use(EMPLOYEE_AVATAR_PUBLIC_PATH, express.static(EMPLOYEE_AVATAR_DIR));
app.use(EMPLOYEE_DOC_PUBLIC_PATH, express.static(EMPLOYEE_DOC_DIR));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'OK LANJOTT' });
});

app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/valet', valetRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/linen-report', linenReportRoutes);
app.use('/api/daily-report', dailyReportRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/management-attendance', managementAttendanceRoutes);
app.use('/api/kasbon', kasbonRoutes);
app.use('/api/rewash', rewashRoutes);
app.use('/api/payslips', require('./routes/payslipRoutes'));

// SPA fallback — serve index.html for non-API, non-storage routes
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const FRONTEND_INDEX = path.join(FRONTEND_DIST, 'index.html');
const hasFrontend = fs.existsSync(FRONTEND_INDEX);
if (hasFrontend) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api\/|\/storage\/).*/, (req, res) => {
    res.sendFile(FRONTEND_INDEX);
  });
} else {
  console.warn('[WARN] Frontend dist tidak ditemukan di:', FRONTEND_DIST);
}

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not Found' });
});

app.use(errorMiddleware);

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${port}`);
});