const express = require('express');
const projectService = require('../services/project.service');
const jobService = require('../services/job.service');
const { assertProjectId } = require('../services/safe-path.service');

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.post('/', asyncRoute(async (req, res) => {
  const projectId = assertProjectId(req.body?.projectId);
  const project = await projectService.ensureProject(projectId);
  res.status(201).json({ success: true, projectId: project.projectId, status: 'ready' });
}));

router.get('/:projectId/files/list', asyncRoute(async (req, res) => {
  const files = await projectService.listFiles(req.params.projectId, req.query.path || '.');
  res.json({ success: true, projectId: req.params.projectId, files });
}));

router.post('/:projectId/files/read', asyncRoute(async (req, res) => {
  const content = await projectService.readFile(req.params.projectId, req.body?.path);
  res.json({ success: true, projectId: req.params.projectId, path: req.body.path, content });
}));

router.post('/:projectId/files/write', asyncRoute(async (req, res) => {
  const result = await projectService.writeFile(req.params.projectId, req.body?.path, req.body?.content);
  res.json({ success: true, projectId: req.params.projectId, ...result });
}));

router.post('/:projectId/files/mkdir', asyncRoute(async (req, res) => {
  const result = await projectService.makeDirectory(req.params.projectId, req.body?.path);
  res.json({ success: true, projectId: req.params.projectId, ...result });
}));

router.post('/:projectId/build', asyncRoute(async (req, res) => {
  const runtime = req.body?.runtime === 'docker' ? 'docker' : 'node';
  const packageManager = ['npm', 'pnpm', 'yarn'].includes(req.body?.packageManager) ? req.body.packageManager : 'npm';
  const job = jobService.startJob({
    projectId: req.params.projectId,
    type: 'build',
    runner: (job) => jobService.executeBuild(job, { runtime, packageManager }),
  });
  res.status(202).json({ success: true, ...job });
}));

router.post('/:projectId/deploy', asyncRoute(async (req, res) => {
  const runtime = req.body?.runtime === 'docker' ? 'docker' : req.body?.runtime === 'node' ? 'node' : '';
  if (!runtime) {
    const error = new Error('A supported deployment runtime is required: docker or node.');
    error.statusCode = 422;
    throw error;
  }
  const packageManager = ['npm', 'pnpm', 'yarn'].includes(req.body?.packageManager) ? req.body.packageManager : 'npm';
  const job = jobService.startJob({
    projectId: req.params.projectId,
    type: 'deploy',
    runner: (job) => jobService.executeBuild(job, {
      runtime,
      deploy: true,
      port: req.body?.port,
      healthPath: req.body?.healthPath,
      packageManager,
      hasBuildScript: req.body?.hasBuildScript === true,
      hasStartScript: req.body?.hasStartScript === true,
    }),
  });
  res.status(202).json({ success: true, ...job });
}));

module.exports = router;
