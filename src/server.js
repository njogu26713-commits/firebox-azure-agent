const http = require('http');
const { createApp } = require('./app');
const { config, validateConfig } = require('./config');

validateConfig();
const app = createApp();
const server = http.createServer(app);

server.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', service: 'firebox-azure-agent', port: config.port, environment: config.nodeEnv }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', message: `Received ${signal}; shutting down.` }));
  server.close((err) => {
    if (err) {
      console.error(JSON.stringify({ level: 'error', message: err.message }));
      process.exitCode = 1;
    }
    process.exit();
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error(JSON.stringify({ level: 'error', message: err?.message || String(err) })));
process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({ level: 'error', message: err.message }));
  process.exit(1);
});

module.exports = { app, server };
