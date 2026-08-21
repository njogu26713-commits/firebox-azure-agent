const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const { projectDirectory } = require('./safe-path.service');

const jobs = new Map();

function sanitize(value) {
  return String(value || '')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(password|token|secret|private[_-]?key)\s*[=:]\s*[^\s]+/gi, '$1=[REDACTED]');
}

function appendLog(job, level, message) {
  const entry = { timestamp: new Date().toISOString(), level, message: sanitize(message).slice(0, 4000) };
  job.logs.push(entry);
  if (job.logs.length > config.maxJobLogLines) job.logs.splice(0, job.logs.length - config.maxJobLogLines);
  console.log(JSON.stringify({ level, jobId: job.jobId, projectId: job.projectId, message: entry.message }));
}

function getJob(jobId) {
  const job = jobs.get(String(jobId));
  if (!job) {
    const error = new Error('Job not found.');
    error.statusCode = 404;
    throw error;
  }
  return job;
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    type: job.type,
    status: job.status,
    stage: job.stage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    logs: job.logs,
  };
}

function runCommand(job, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    appendLog(job, 'info', `$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...(options.env || {}) }, shell: false });
    let output = '';
    child.stdout.on('data', (chunk) => { const text = chunk.toString(); output += text; text.split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(job, 'info', line)); });
    child.stderr.on('data', (chunk) => { const text = chunk.toString(); output += text; text.split(/\r?\n/).filter(Boolean).forEach((line) => appendLog(job, 'warn', line)); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0 || options.allowFailure) return resolve({ output, code });
      const error = new Error(`Approved command failed with exit code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`);
      error.statusCode = 422;
      reject(error);
    });
  });
}

function allowedBuildSteps(runtime, packageManager, projectId, options = {}) {
  if (runtime === 'docker') return [{ command: 'docker', args: ['build', '-t', `firebox-${projectId}:latest`, '.'] }];
  const manager = ['npm', 'pnpm', 'yarn'].includes(packageManager) ? packageManager : 'npm';
  const lockfile = manager === 'npm' ? fs.existsSync(`${projectDirectory(projectId)}/package-lock.json`) : manager === 'pnpm' ? fs.existsSync(`${projectDirectory(projectId)}/pnpm-lock.yaml`) : fs.existsSync(`${projectDirectory(projectId)}/yarn.lock`);
  const installArgs = manager === 'npm' ? (lockfile ? ['ci'] : ['install']) : ['install', '--frozen-lockfile'];
  const steps = [{ command: manager, args: installArgs }];
  if (options.hasBuildScript) steps.push({ command: manager, args: ['run', 'build'] });
  return steps;
}

function validPort(value) {
  const port = Number(value || 3000);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

async function waitForHealth(port, healthPath = '/') {
  const safePath = String(healthPath || '/').startsWith('/') && !/[\s\r\n]/.test(String(healthPath || '/')) ? String(healthPath || '/') : '/';
  let lastError;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${safePath}`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
      lastError = new Error(`Health check returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const error = new Error(`Application health check failed on port ${port}${safePath}: ${lastError?.message || 'no response'}`);
  error.statusCode = 422;
  throw error;
}

async function executeBuild(job, options = {}) {
  const directory = projectDirectory(job.projectId);
  if (!fs.existsSync(directory)) {
    const error = new Error('Project workspace does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const steps = allowedBuildSteps(options.runtime, options.packageManager, job.projectId, options);
  for (const step of steps) {
    job.stage = step.args.includes('build') || step.args.includes('--build') ? 'building' : 'preparing';
    await runCommand(job, step.command, step.args, { cwd: directory });
  }
  if (options.runtime === 'docker' && options.deploy) {
    const container = `firebox-${job.projectId}`;
    const port = Number(options.port || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      const error = new Error('Docker deployment port must be an integer between 1 and 65535.');
      error.statusCode = 400;
      throw error;
    }
    await runCommand(job, 'docker', ['rm', '-f', container], { cwd: directory, allowFailure: true });
    await runCommand(job, 'docker', ['run', '-d', '--restart', 'unless-stopped', '--name', container, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-p', `127.0.0.1:${port}:${port}`, `firebox-${job.projectId}:latest`], { cwd: directory });
    job.stage = 'running';
  } else if (options.runtime === 'node' && options.deploy) {
    const port = validPort(options.port);
    if (!port) {
      const error = new Error('Node deployment port must be an integer between 1 and 65535.');
      error.statusCode = 400;
      throw error;
    }
    if (!options.hasStartScript) {
      const error = new Error('Node deployment requires a package.json start script.');
      error.statusCode = 422;
      throw error;
    }
    const processName = `firebox-${job.projectId}`;
    job.stage = 'starting';
    await runCommand(job, 'pm2', ['delete', processName], { cwd: directory, allowFailure: true });
    await runCommand(job, 'pm2', ['start', 'npm', '--name', processName, '--cwd', directory, '--', 'run', 'start'], { cwd: directory, env: { PORT: String(port), NODE_ENV: 'production' } });
    await runCommand(job, 'pm2', ['save', '--force'], { cwd: directory, allowFailure: true });
    await waitForHealth(port, options.healthPath || '/');
    job.stage = 'running';
  } else {
    job.stage = 'built';
  }
}

function startJob({ projectId, type, runner }) {
  const job = { jobId: `job_${randomUUID()}`, projectId: String(projectId), type, status: 'queued', stage: 'queued', logs: [], createdAt: new Date().toISOString() };
  jobs.set(job.jobId, job);
  Promise.resolve().then(async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    appendLog(job, 'info', `Job ${job.jobId} started.`);
    try {
      await runner(job);
      job.status = 'succeeded';
      job.stage = 'completed';
      appendLog(job, 'info', 'Job completed successfully.');
    } catch (err) {
      job.status = 'failed';
      job.stage = 'failed';
      job.error = sanitize(err.message || 'Job failed.');
      appendLog(job, 'error', job.error);
    } finally {
      job.completedAt = new Date().toISOString();
    }
  });
  return publicJob(job);
}

setInterval(() => {
  const cutoff = Date.now() - config.jobRetentionMs;
  for (const [id, job] of jobs) if (job.completedAt && Date.parse(job.completedAt) < cutoff) jobs.delete(id);
}, 60 * 60 * 1000).unref();

module.exports = { getJob, publicJob, startJob, executeBuild };
