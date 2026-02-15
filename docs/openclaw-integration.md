# OpenClaw Integration Notes

This project exposes an HTTP control plane that can be called from OpenClaw plugin hooks.

## Hook mapping

- `before_tool_call` -> `POST /v1/tool-calls/intercept`
- `tool_result_persist` -> `POST /v1/tool-results/sanitize`
- `message_sending` -> `POST /v1/outbound/check`

Use the helper client in `/Users/yanzewu/openclaw_project/src/openclaw/controlPlaneClient.ts`.

You can also use the plugin adapter in `/Users/yanzewu/openclaw_project/src/openclaw/pluginAdapter.ts`
to expose all three hooks as one plugin object.

## Minimal integration sketch

```ts
import {
  ControlPlaneClient,
  createHookHandlers,
} from "./src/openclaw/controlPlaneClient.js";

const client = new ControlPlaneClient({
  baseUrl: "http://127.0.0.1:3000",
  pollIntervalMs: 1000,
  pollTimeoutMs: 120000,
});

const hooks = createHookHandlers(client);

// OpenClaw hook usage
await hooks.beforeToolCall({
  toolName: event.toolName,
  params: event.params,
  context: {
    sessionId: event.sessionId,
    channel: event.channel,
    source: event.source,
  },
});

const sanitized = await hooks.toolResultPersist(rawToolOutput);
const checkedMessage = await hooks.messageSending(outboundMessage);
```

## Plugin adapter sketch

```ts
import { createOpenClawPluginFromConfig } from \"./src/openclaw/pluginAdapter.js\";

export default createOpenClawPluginFromConfig({
  baseUrl: process.env.CONTROL_PLANE_BASE_URL ?? \"http://127.0.0.1:3000\",
  apiKey: process.env.CONTROL_PLANE_API_KEY,
  pollIntervalMs: 1000,
  pollTimeoutMs: 120000,
});
```

## Routed LLM proxy option

For drop-in compatibility with OpenAI-like clients, point chat completion requests to:

- `POST /v1/chat/completions`

The control plane routes each request by complexity and forwards it to the configured provider tier.

Portkey profile is included at:

- `/Users/yanzewu/openclaw_project/config/portkey.opus.json`

Live smoke test command:

```bash
export PREMIUM_LLM_API_KEY='<your-portkey-api-key>'
npm run smoke:portkey
```

## API auth

If `auth.required=true` in config, `/v1/*` endpoints require the header configured by:

- `auth.headerName` (default: `x-api-key`)
- env var named by `auth.apiKeyEnv` (default: `CONTROL_PLANE_API_KEY`)
