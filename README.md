# Firebox Azure Agent

Firebox Azure Agent is a separate, controlled execution service intended to run on the Azure VM that hosts Firebox workloads. It is not another FireboxDeploy backend and does not modify or replace the existing FireboxDeploy application. FireboxDeploy remains responsible for users, authentication, projects, orchestration, and the user interface. This agent is responsible only for validated Azure-side workspace and deployment operations.

## Architecture

```text
User
  ↓
FireboxDeploy on Railway
  ↓ authenticated HTTPS
Firebox Azure Agent on Azure VM
  ↓ controlled local operations
Project workspaces, approved builds, Docker services, job logs
```

Railway communicates with the agent over HTTPS on port 443. The agent process listens on localhost and is placed behind Caddy or Nginx. This avoids requiring Railway to connect directly to Azure SSH port 22.

## Current scope

The current implementation provides a health endpoint, bearer authentication, restricted CORS, security headers, request IDs, rate limiting, structured request logging, project workspace isolation, safe file operations, bounded job records, sanitized logs, package-manager build jobs, and fixed-argument Dockerfile build/deploy jobs.

Node projects can be prepared with the build endpoint. Docker deployment is the only enabled deployment runtime in this first version because starting an arbitrary long-lived Node process safely requires a configured process supervisor or a generated systemd unit. The API returns a clear validation error rather than executing an unrestricted command.

## API

`GET /health` is public and returns a minimal service status response.

All `/api/*` routes require:

```http
Authorization: Bearer <FIREBOX_AGENT_SECRET>
```

The available authenticated operations are:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/projects` | Create or ensure a project workspace. Body: `{ "projectId": "my-app" }`. |
| `GET` | `/api/projects/:projectId/files/list?path=.` | List files or directories inside the project workspace. |
| `POST` | `/api/projects/:projectId/files/read` | Read a file. Body: `{ "path": "src/index.js" }`. |
| `POST` | `/api/projects/:projectId/files/write` | Write a file. Body: `{ "path": "src/index.js", "content": "..." }`. |
| `POST` | `/api/projects/:projectId/files/mkdir` | Create a directory. Body: `{ "path": "src" }`. |
| `POST` | `/api/projects/:projectId/build` | Start an allowlisted package-manager or Docker build job. |
| `POST` | `/api/projects/:projectId/deploy` | Start a fixed-argument Dockerfile deployment job. |
| `GET` | `/api/jobs/:jobId` | Retrieve job status and bounded logs. |
| `GET` | `/api/jobs/:jobId/logs` | Retrieve job logs. |

Build options are intentionally limited to values such as:

```json
{
  "runtime": "node",
  "packageManager": "npm"
}
```

Dockerfile deployments require a `Dockerfile` in the project workspace and accept:

```json
{
  "runtime": "docker"
}
```

A build or deploy request returns immediately with a job record:

```json
{
  "success": true,
  "jobId": "job_123",
  "projectId": "my-app",
  "type": "deploy",
  "status": "queued"
}
```

FireboxDeploy can poll `/api/jobs/:jobId` until `status` becomes `succeeded` or `failed`.

## Security model

The agent does not expose an arbitrary shell endpoint. Commands are selected internally from a fixed allowlist. The build service uses only `npm`, `pnpm`, `yarn`, and Docker Compose with fixed argument patterns. No user-provided command string is passed to a shell.

Every project is stored below:

```text
/opt/firebox/projects/<projectId>/
```

Project IDs are restricted to letters, numbers, hyphens, and underscores. File paths must be relative, are resolved with `path.resolve`, and are rejected if they escape the project root. Symlink components are rejected. File reads and writes are capped at 5 MB, and job logs are bounded and sanitized for common token, password, authorization, and private-key patterns.

The agent uses Helmet, restricted configurable CORS, rate limiting, request IDs, structured logs, sanitized client errors, and a production requirement for a 32-character `FIREBOX_AGENT_SECRET`. Secrets are never included in API responses or committed to this repository.

## Environment variables

Copy `.env.example` to a protected environment file. Never commit `.env`.

| Variable | Required | Description |
|---|---:|---|
| `NODE_ENV` | Yes | Use `production` on Azure. |
| `PORT` | Yes | Local listening port, normally `8080`. |
| `FIREBOX_AGENT_SECRET` | Yes | Long random shared secret used by FireboxDeploy. Production requires at least 32 characters. |
| `ALLOWED_ORIGINS` | Yes | Comma-separated HTTPS origins allowed to call the API. |
| `FIREBOX_PROJECT_ROOT` | Yes | Workspace root, normally `/opt/firebox/projects`. |
| `MAX_JOB_LOG_LINES` | No | Maximum retained log lines, default `500`. |
| `JOB_RETENTION_MS` | No | In-memory job retention, default 24 hours. |

Generate a secret with:

```bash
openssl rand -hex 32
```

## Local setup

```bash
cp .env.example .env
# Edit .env and set a development secret.
npm install
npm test
npm run lint
npm start
```

Health check:

```bash
curl http://127.0.0.1:8080/health
```

Authenticated example:

```bash
curl -X POST http://127.0.0.1:8080/api/projects \
  -H "Authorization: Bearer $FIREBOX_AGENT_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"demo-app"}'
```

## Azure deployment

Create a dedicated service account and workspace on the Azure VM:

```bash
sudo useradd --system --home /opt/firebox-azure-agent --shell /usr/sbin/nologin firebox-agent
sudo mkdir -p /opt/firebox-azure-agent /opt/firebox/projects
sudo chown -R firebox-agent:firebox-agent /opt/firebox-azure-agent /opt/firebox/projects
```

Install Node.js, copy this repository to `/opt/firebox-azure-agent`, and install production dependencies:

```bash
cd /opt/firebox-azure-agent
sudo -u firebox-agent npm ci --omit=dev
```

Create `/etc/firebox-azure-agent.env` with the production values, then protect it:

```bash
sudo chown root:firebox-agent /etc/firebox-azure-agent.env
sudo chmod 640 /etc/firebox-azure-agent.env
```

Install the systemd unit:

```bash
sudo cp deploy/firebox-azure-agent.service /etc/systemd/system/firebox-azure-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now firebox-azure-agent
sudo systemctl status firebox-azure-agent
```

Install Caddy or Nginx and configure the hostname in `deploy/Caddyfile.example` to reverse proxy to `127.0.0.1:8080`. Point a DNS `A` record such as `agent.example.com` at the Azure public IP. Allow TCP 443 in the Azure NSG and keep port 8080 private. Verify:

```bash
curl https://agent.example.com/health
```

Monitor the service with:

```bash
sudo journalctl -u firebox-azure-agent -f
```

## FireboxDeploy integration

The existing FireboxDeploy code should communicate with this project through two environment variables, configured separately in its Railway environment:

```text
FIREBOX_AZURE_AGENT_URL=https://agent.example.com
FIREBOX_AZURE_AGENT_SECRET=<same secret as the Azure agent>
```

The sample client in `examples/firebox-agent-client.js` demonstrates the contract. It is intentionally not imported into or copied into the existing FireboxDeploy repository.

Example integration flow:

```js
const { createFireboxAgentClient } = require('./firebox-agent-client');
const agent = createFireboxAgentClient({
  baseUrl: process.env.FIREBOX_AZURE_AGENT_URL,
  secret: process.env.FIREBOX_AZURE_AGENT_SECRET,
});

await agent.createProject('my-app');
await agent.writeFile('my-app', 'Dockerfile', dockerfileContent);
const deployment = await agent.deploy('my-app', { runtime: 'docker' });
const status = await agent.job(deployment.data.jobId);
```

The FireboxDeploy integration should treat the agent as an untrusted remote dependency: use request timeouts, retry only safe idempotent reads, persist the returned job ID, poll status, and never put secrets into file contents or log messages.

## Operations and rollback

Deploy a new agent version into a separate release directory, install dependencies there, and switch a stable symlink such as `/opt/firebox-azure-agent/current` before restarting systemd. Keep the previous release directory until health and job checks pass. If the new release fails, switch the symlink back and restart the service. Do not replace the workspace root or remove project data during an application rollback.

## Important boundary

This repository is independent. It must not be merged into, copied into, or used to modify FireboxDeploy. The two applications communicate only through the authenticated HTTPS API described above.
