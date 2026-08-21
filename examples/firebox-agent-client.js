const axios = require('axios');

function createFireboxAgentClient({ baseUrl, secret, timeout = 15000 }) {
  if (!baseUrl || !secret) throw new Error('baseUrl and secret are required.');
  const client = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    timeout,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
  });

  return {
    health: () => axios.get(`${baseUrl.replace(/\/$/, '')}/health`, { timeout }),
    createProject: (projectId) => client.post('/api/projects', { projectId }),
    writeFile: (projectId, path, content) => client.post(`/api/projects/${encodeURIComponent(projectId)}/files/write`, { path, content }),
    readFile: (projectId, path) => client.post(`/api/projects/${encodeURIComponent(projectId)}/files/read`, { path }),
    listFiles: (projectId, path = '.') => client.get(`/api/projects/${encodeURIComponent(projectId)}/files/list`, { params: { path } }),
    build: (projectId, options = {}) => client.post(`/api/projects/${encodeURIComponent(projectId)}/build`, options),
    deploy: (projectId, options = {}) => client.post(`/api/projects/${encodeURIComponent(projectId)}/deploy`, options),
    job: (jobId) => client.get(`/api/jobs/${encodeURIComponent(jobId)}`),
    logs: (jobId) => client.get(`/api/jobs/${encodeURIComponent(jobId)}/logs`),
  };
}

module.exports = { createFireboxAgentClient };
