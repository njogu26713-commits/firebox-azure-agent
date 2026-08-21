const express = require('express');
const { getJob, publicJob } = require('../services/job.service');

const router = express.Router();

router.get('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  res.json({ success: true, job: publicJob(job) });
});

router.get('/:jobId/logs', (req, res) => {
  const job = getJob(req.params.jobId);
  res.json({ success: true, jobId: job.jobId, status: job.status, logs: job.logs });
});

module.exports = router;
