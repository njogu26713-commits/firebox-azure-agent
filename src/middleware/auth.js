const crypto = require('crypto');
const { config } = require('../config');

function unauthorized(res) {
  return res.status(401).json({ success: false, error: 'Unauthorized.' });
}

function requireAgentAuth(req, res, next) {
  if (config.nodeEnv !== 'production' && !config.agentSecret) return next();
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !config.agentSecret) return unauthorized(res);
  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(config.agentSecret);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return unauthorized(res);
  req.agentAuthenticated = true;
  next();
}

module.exports = { requireAgentAuth };
