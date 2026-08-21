const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const PROJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function assertProjectId(projectId) {
  const value = String(projectId || '');
  if (!PROJECT_ID_RE.test(value)) {
    const error = new Error('Invalid project ID. Use 1–64 letters, numbers, hyphens, or underscores.');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function assertInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('Path is outside the project workspace.');
    error.statusCode = 400;
    throw error;
  }
}

function projectDirectory(projectId) {
  const id = assertProjectId(projectId);
  const root = path.resolve(config.projectRoot);
  const directory = path.resolve(root, id);
  assertInside(root, directory);
  return directory;
}

function projectFile(projectId, relativePath) {
  const directory = projectDirectory(projectId);
  const value = String(relativePath || '');
  if (!value || path.isAbsolute(value) || value.includes('\0')) {
    const error = new Error('A relative file path is required.');
    error.statusCode = 400;
    throw error;
  }
  const candidate = path.resolve(directory, value);
  assertInside(directory, candidate);
  return candidate;
}

async function assertNoSymlinkEscape(directory, candidate) {
  await fs.promises.mkdir(directory, { recursive: true });
  const relative = path.relative(directory, candidate);
  const parts = relative ? relative.split(path.sep) : [];
  let current = directory;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink()) {
        const error = new Error('Symlink paths are not allowed.');
        error.statusCode = 400;
        throw error;
      }
    } catch (err) {
      if (err.code === 'ENOENT') break;
      throw err;
    }
  }
}

module.exports = { assertProjectId, projectDirectory, projectFile, assertNoSymlinkEscape };
