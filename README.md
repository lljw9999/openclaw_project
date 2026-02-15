# OpenClaw Enterprise Control Plane (MVP)

Phase 1 implementation for an OpenClaw enterprise wrapper focused on:

- Policy interception (`allow/ask/deny`) for tool calls
- Human-in-the-loop approvals
- Immutable-style audit log (append-only JSONL)
- Tool result sanitization and outbound DLP checks
- Cost-aware model routing (local vs cheap cloud vs premium cloud)
- Routed model proxy endpoint (`/v1/chat/completions`)
- Lightweight approvals dashboard (`/ui/approvals.html`)

## Quick start

```bash
npm install
npm run dev
```

Server defaults to `http://127.0.0.1:3000`.

## Core endpoints

- `POST /v1/tool-calls/intercept`
- `GET /v1/approvals`
- `POST /v1/approvals/:id/decision`
- `POST /v1/tool-results/sanitize`
- `POST /v1/outbound/check`
- `POST /v1/model-router/route`
- `POST /v1/chat/completions`
- `GET /v1/audit/events`
- `GET /v1/metrics/summary`
- `GET /v1/metrics/timeseries`

Dashboard:

- `GET /ui/approvals.html`
- `GET /ui/metrics.html`

Both dashboards support authenticated mode by setting API key in the page (stored in browser `localStorage` and sent as `x-api-key`).

## Example flow

1. Intercept a tool call:

```bash
curl -s http://127.0.0.1:3000/v1/tool-calls/intercept \
  -H 'content-type: application/json' \
  -d '{
    "toolName":"shell_exec",
    "params":{"command":"ls -la"},
    "context":{"source":"slack","sessionId":"sess-1"}
  }'
```

2. Approve it:

```bash
curl -s http://127.0.0.1:3000/v1/approvals/<approval-id>/decision \
  -H 'content-type: application/json' \
  -d '{"decision":"approved","actor":"admin@company.com"}'
```

3. Route an LLM request:

```bash
curl -s http://127.0.0.1:3000/v1/model-router/route \
  -H 'content-type: application/json' \
  -d '{"prompt":"heartbeat status check","metadata":{"isHeartbeat":true}}'
```

4. Proxy a chat completion through the router:

```bash
curl -s http://127.0.0.1:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "messages":[{"role":"user","content":"summarize these notes"}],
    "metadata":{"taskType":"summary"},
    "temperature":0.2
  }'
```

5. Get governance metrics summary:

```bash
curl -s 'http://127.0.0.1:3000/v1/metrics/summary?windowMinutes=60'
```

6. Get governance metrics timeseries:

```bash
curl -s 'http://127.0.0.1:3000/v1/metrics/timeseries?windowMinutes=180&bucketMinutes=5'
```

## Configuration

Set `CONFIG_PATH` to override config file location:

```bash
CONFIG_PATH=./config/default.json npm run dev
```

Portkey/Claude Opus profile:

```bash
export PREMIUM_LLM_API_KEY='<your-portkey-api-key>'
CONFIG_PATH=./config/portkey.opus.json npm run dev
```

Portkey smoke test:

```bash
export PREMIUM_LLM_API_KEY='<your-portkey-api-key>'
npm run smoke:portkey
```

Plugin hook smoke test (runs real plugin hook handlers against local control plane):

```bash
npm run smoke:plugin
```

Control-plane auth:

- `auth.required` controls whether `/v1/*` endpoints require API key auth.
- `auth.headerName` sets the required header name (default `x-api-key`).
- `auth.apiKeyEnv` sets which env var contains the expected key (default `CONTROL_PLANE_API_KEY`).

Approvals persistence:

- Pending/decided approvals are stored at `approvals.persistPath` (default `data/approvals.json`).
- Audit events are append-only JSONL at `audit.persistPath` (default `data/audit.log`).

Provider keys are read from env vars defined in config (default):

- `CHEAP_LLM_API_KEY`
- `PREMIUM_LLM_API_KEY`

## OpenClaw hook adapter

Use the helper client in `/src/openclaw/controlPlaneClient.ts` to wire OpenClaw hooks:

- `before_tool_call` -> `client.interceptToolCall(...)`
- `tool_result_persist` -> `client.sanitizeToolResult(...)`
- `message_sending` -> `client.checkOutboundMessage(...)`

Or use the prebuilt plugin adapter:

- `/Users/yanzewu/openclaw_project/src/openclaw/pluginAdapter.ts`
- Example plugin entrypoint:
  `/Users/yanzewu/openclaw_project/examples/openclaw-plugin-entry.ts`

Integration notes: `/Users/yanzewu/openclaw_project/docs/openclaw-integration.md`

## OpenClaw Plugin Package

Installable plugin package is included at:

- `/Users/yanzewu/openclaw_project/extensions/enterprise-control-plane`

Pack plugin archive:

```bash
npm run pack:openclaw-plugin
```

Install guide:

- `/Users/yanzewu/openclaw_project/docs/openclaw-plugin-install.md`

## Tests

```bash
npm test
npm run lint
```
