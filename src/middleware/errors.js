const { randomUUID } = require('crypto');

function requestId(req, res, next) {
  const id = req.get('x-request-id') || randomUUID();
  req.requestId = String(id).slice(0, 100);
  res.setHeader('x-request-id', req.requestId);
  next();
}

function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Route not found.', requestId: req.requestId });
}

function errorHandler(err, req, res, next) {
  if (!res) {
    console.error(JSON.stringify({ level: 'error', message: err?.message || String(err) }));
    return;
  }
  if (res.headersSent) return next(err);
  const status = Number(err.statusCode || err.status || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  if (safeStatus >= 500) console.error(JSON.stringify({ level: 'error', requestId: req.requestId, message: err.message }));
  res.status(safeStatus).json({
    success: false,
    error: safeStatus >= 500 ? 'Internal server error.' : String(err.message || 'Request failed.'),
    requestId: req.requestId,
  });
}

module.exports = { requestId, notFound, errorHandler };
