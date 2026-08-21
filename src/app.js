const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { config } = require('./config');
const { requireAgentAuth } = require('./middleware/auth');
const { requestId, notFound, errorHandler } = require('./middleware/errors');
const projectsRoutes = require('./routes/projects.routes');
const jobsRoutes = require('./routes/jobs.routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      if (config.nodeEnv !== 'production' && !config.allowedOrigins.length) return callback(null, true);
      return callback(new Error('Origin not allowed.'));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }));
  app.use(morgan((tokens, req, res) => JSON.stringify({
    level: 'info',
    requestId: req.requestId,
    method: tokens.method(req),
    path: tokens.url(req),
    status: Number(tokens.status(req, res)),
    responseMs: Number(tokens['response-time'](req, res)),
  })));
  app.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/health', (req, res) => res.json({ success: true, service: 'firebox-azure-agent', status: 'healthy', version: process.env.AGENT_BUILD_VERSION || 'unknown', runtimes: ['docker', 'node'] }));
  app.use('/api', requireAgentAuth);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/jobs', jobsRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
