const path = require('path');
require('dotenv').config();

function csv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  agentSecret: String(process.env.FIREBOX_AGENT_SECRET || ''),
  allowedOrigins: csv(process.env.ALLOWED_ORIGINS),
  projectRoot: path.resolve(process.env.FIREBOX_PROJECT_ROOT || '/opt/firebox/projects'),
  maxJobLogLines: Math.min(Math.max(Number(process.env.MAX_JOB_LOG_LINES || 500), 50), 5000),
  jobRetentionMs: Math.max(Number(process.env.JOB_RETENTION_MS || 86400000), 3600000),
};

function validateConfig() {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  if (config.nodeEnv === 'production' && config.agentSecret.length < 32) {
    throw new Error('FIREBOX_AGENT_SECRET must be at least 32 characters in production.');
  }
  if (!config.allowedOrigins.length && config.nodeEnv === 'production') {
    throw new Error('ALLOWED_ORIGINS must be configured in production.');
  }
}

module.exports = { config, validateConfig };
