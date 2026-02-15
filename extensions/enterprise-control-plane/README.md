# Enterprise Control Plane Plugin

OpenClaw plugin package that registers three plugin-managed hooks:

- `before_tool_call`
- `tool_result_persist`
- `message_sending`

This plugin forwards hook decisions to the control plane API and enforces allow/ask/deny policy.

## Config

Configure under `plugins.entries.enterprise-control-plane.config`:

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "apiKey": "optional-control-plane-api-key",
  "pollIntervalMs": 1000,
  "pollTimeoutMs": 120000,
  "strict": false
}
```

If config is omitted, env fallback is used:

- `CONTROL_PLANE_BASE_URL` or `OPENCLAW_CP_BASE_URL`
- `CONTROL_PLANE_API_KEY` or `OPENCLAW_CP_API_KEY`
