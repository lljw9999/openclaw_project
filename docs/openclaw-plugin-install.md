# OpenClaw Plugin Install Guide

This guide installs the enterprise control-plane plugin into an OpenClaw runtime.

Plugin path in this repo:

- `/Users/yanzewu/openclaw_project/extensions/enterprise-control-plane`

## 1. Build and run control plane

```bash
cd /Users/yanzewu/openclaw_project
export PREMIUM_LLM_API_KEY='<your-portkey-api-key>'
CONFIG_PATH=./config/portkey.opus.json npm run dev
```

## 2. Install plugin on OpenClaw host

If OpenClaw CLI is available:

```bash
openclaw plugins install -l /Users/yanzewu/openclaw_project/extensions/enterprise-control-plane
openclaw plugins enable enterprise-control-plane
```

If you need a distributable archive first:

```bash
cd /Users/yanzewu/openclaw_project
npm run pack:openclaw-plugin
# outputs dist/enterprise-control-plane-plugin.tgz
```

## 3. Configure plugin

Set plugin config in OpenClaw config under:

`plugins.entries.enterprise-control-plane`

Example:

```json
{
  "plugins": {
    "entries": {
      "enterprise-control-plane": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3000",
          "apiKey": "",
          "pollIntervalMs": 1000,
          "pollTimeoutMs": 120000,
          "strict": false
        }
      }
    }
  }
}
```

If you enabled control-plane auth, set `apiKey` to your control-plane key.

## 4. Verify behavior

- Verify plugin registration:

```bash
openclaw plugins info enterprise-control-plane
```

- Check control-plane health from OpenClaw command:

```text
/cpstatus
```

- Trigger a risky tool action and confirm approval is required in:

`http://127.0.0.1:3000/ui/approvals.html`

## Local hook harness (without OpenClaw CLI)

You can validate the hook pack directly from this repo:

```bash
cd /Users/yanzewu/openclaw_project
npm run smoke:plugin
```

This verifies:

- `before_tool_call` allow path
- `tool_result_persist` redaction path
- `message_sending` sanitize + block paths
