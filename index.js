process.env.TZ = 'Asia/Jakarta';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

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
const errorMiddleware = require('./middleware/errorMiddleware');
const {
  ATTENDANCE_UPLOAD_DIR, ATTENDANCE_UPLOAD_PUBLIC_PATH,
  LEAVE_UPLOAD_DIR, LEAVE_UPLOAD_PUBLIC_PATH,
  LINEN_UPLOAD_DIR, LINEN_UPLOAD_PUBLIC_PATH,
  DAILY_REPORT_UPLOAD_DIR, DAILY_REPORT_UPLOAD_PUBLIC_PATH,
  EMPLOYEE_AVATAR_DIR, EMPLOYEE_AVATAR_PUBLIC_PATH,
  EMPLOYEE_DOC_DIR, EMPLOYEE_DOC_PUBLIC_PATH,
} = require('./middleware/upload');

const app = express();

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'unsafe-none' },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Expose uploaded selfie proofs (for both local/prod base dir)
app.use(ATTENDANCE_UPLOAD_PUBLIC_PATH, express.static(ATTENDANCE_UPLOAD_DIR));
app.use(LEAVE_UPLOAD_PUBLIC_PATH, express.static(LEAVE_UPLOAD_DIR));
app.use(LINEN_UPLOAD_PUBLIC_PATH, express.static(LINEN_UPLOAD_DIR));
app.use(DAILY_REPORT_UPLOAD_PUBLIC_PATH, express.static(DAILY_REPORT_UPLOAD_DIR));

// Dev only — di prod file karyawan ada di waschen, tidak perlu di-serve di sini
app.use(EMPLOYEE_AVATAR_PUBLIC_PATH, express.static(EMPLOYEE_AVATAR_DIR));
app.use(EMPLOYEE_DOC_PUBLIC_PATH,    express.static(EMPLOYEE_DOC_DIR));

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

// SPA fallback — serve index.html for non-API, non-storage routes
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(FRONTEND_DIST));
app.get(/^(?!\/api\/|\/storage\/).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not Found' });
});

app.use(errorMiddleware);

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${port}`);
});