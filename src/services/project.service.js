const fs = require('fs');
const path = require('path');
const { projectDirectory, projectFile, assertProjectId, assertNoSymlinkEscape } = require('./safe-path.service');

async function ensureProject(projectId) {
  const id = assertProjectId(projectId);
  const directory = projectDirectory(id);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o750 });
  return { projectId: id, directory };
}

async function listFiles(projectId, relativePath = '.') {
  const { directory } = await ensureProject(projectId);
  const target = relativePath === '.' ? directory : projectFile(projectId, relativePath);
  await assertNoSymlinkEscape(directory, target);
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  return entries.filter((entry) => !entry.isSymbolicLink()).map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
  }));
}

async function readFile(projectId, relativePath) {
  const { directory } = await ensureProject(projectId);
  const target = projectFile(projectId, relativePath);
  await assertNoSymlinkEscape(directory, target);
  const stat = await fs.promises.lstat(target);
  if (!stat.isFile()) {
    const error = new Error('Requested path is not a regular file.');
    error.statusCode = 400;
    throw error;
  }
  if (stat.size > 5 * 1024 * 1024) {
    const error = new Error('File exceeds the 5 MB read limit.');
    error.statusCode = 413;
    throw error;
  }
  return fs.promises.readFile(target, 'utf8');
}

async function writeFile(projectId, relativePath, content) {
  const { directory } = await ensureProject(projectId);
  const target = projectFile(projectId, relativePath);
  await assertNoSymlinkEscape(directory, target);
  const value = String(content ?? '');
  if (Buffer.byteLength(value, 'utf8') > 5 * 1024 * 1024) {
    const error = new Error('File exceeds the 5 MB write limit.');
    error.statusCode = 413;
    throw error;
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
  await fs.promises.writeFile(target, value, { encoding: 'utf8', mode: 0o640 });
  return { path: relativePath, bytes: Buffer.byteLength(value, 'utf8') };
}

async function makeDirectory(projectId, relativePath) {
  const { directory } = await ensureProject(projectId);
  const target = projectFile(projectId, relativePath);
  await assertNoSymlinkEscape(directory, target);
  await fs.promises.mkdir(target, { recursive: true, mode: 0o750 });
  return { path: relativePath };
}

module.exports = { ensureProject, listFiles, readFile, writeFile, makeDirectory };
