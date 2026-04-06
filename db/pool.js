const mysql = require('mysql2/promise');
require('dotenv').config();

const RETRY_CODES = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wrapPoolWithRetry(rawPool) {
  const originalQuery = rawPool.query.bind(rawPool);
  const originalExecute = rawPool.execute.bind(rawPool);

  async function queryWithRetry(...args) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await originalQuery(...args);
      } catch (err) {
        lastError = err;
        if (RETRY_CODES.includes(err.code) && attempt < MAX_RETRIES) {
          console.warn(`[DB] query attempt ${attempt} failed (${err.code}), retrying in ${RETRY_DELAY_MS * attempt}ms...`);
          await sleep(RETRY_DELAY_MS * attempt);
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  }

  async function executeWithRetry(...args) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await originalExecute(...args);
      } catch (err) {
        lastError = err;
        if (RETRY_CODES.includes(err.code) && attempt < MAX_RETRIES) {
          console.warn(`[DB] execute attempt ${attempt} failed (${err.code}), retrying in ${RETRY_DELAY_MS * attempt}ms...`);
          await sleep(RETRY_DELAY_MS * attempt);
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  }

  rawPool.query = queryWithRetry;
  rawPool.execute = executeWithRetry;
  return rawPool;
}

const pool = wrapPoolWithRetry(mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  timezone: '+07:00',
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
}));

const poolIkm = wrapPoolWithRetry(mysql.createPool({
  host: process.env.DB_HOST_IKM,
  port: Number(process.env.DB_PORT_IKM),
  user: process.env.DB_USER_IKM,
  password: process.env.DB_PASS_IKM,
  database: process.env.DB_NAME_IKM,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  timezone: '+07:00',
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
}));

module.exports = { pool, poolIkm };