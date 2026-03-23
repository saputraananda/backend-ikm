const { errorResponse } = require('../utils/response');

module.exports = (err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  // log supaya kelihatan error aslinya di console
  console.error(err);

  return errorResponse(res, message, status);
};