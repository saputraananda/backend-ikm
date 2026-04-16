process.env.TZ = 'Asia/Jakarta';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const errorMiddleware = require('./middleware/errorMiddleware');
const { ATTENDANCE_UPLOAD_DIR, ATTENDANCE_UPLOAD_PUBLIC_PATH } = require('./middleware/upload');

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

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'OK LANJOTT' });
});

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not Found' });
});

app.use(errorMiddleware);

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${port}`);
});