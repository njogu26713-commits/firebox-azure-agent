process.env.NODE_ENV = 'test';
process.env.FIREBOX_PROJECT_ROOT = require('fs').mkdtempSync('/tmp/firebox-agent-test-');

const http = require('http');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let baseUrl;

before(async () => {
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test('health endpoint is public and does not expose secrets', async () => {
  const { response, body } = await request('/health');
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.service, 'firebox-azure-agent');
  assert.equal(body.status, 'healthy');
  assert.equal(body.version, 'unknown');
  assert.deepEqual(body.runtimes, ['docker', 'node']);
  assert.equal(JSON.stringify(body).includes(process.env.FIREBOX_AGENT_SECRET || 'super-secret'), false);
});

test('project creation and safe file operations work', async () => {
  const create = await request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'demo-project' }) });
  assert.equal(create.response.status, 201);
  const write = await request('/api/projects/demo-project/files/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'src/index.js', content: 'console.log("ok");' }) });
  assert.equal(write.response.status, 200);
  const read = await request('/api/projects/demo-project/files/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'src/index.js' }) });
  assert.equal(read.body.content, 'console.log("ok");');
});

test('path traversal is rejected', async () => {
  const result = await request('/api/projects/demo-project/files/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '../etc/passwd' }) });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /outside|relative/i);
});
