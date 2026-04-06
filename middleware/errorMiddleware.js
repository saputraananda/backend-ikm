const { errorResponse } = require('../utils/response');

module.exports = (err, req, res, next) => {
  const status = err.statusCode || err.status || 500;

  // log supaya kelihatan error aslinya di console
  console.error(err);

  // Jangan ekspos pesan internal DB/system ke client
  const isDbError = err.code && (
    err.code.startsWith('ER_') ||
    ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ENOTFOUND'].includes(err.code)
  );

  const message = isDbError
    ? 'Terjadi kesalahan koneksi server. Coba lagi sebentar.'
    : (err.message || 'Internal Server Error');

  return errorResponse(res, message, status);
};