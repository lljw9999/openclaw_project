---
name: ecp-tool-result-persist
description: "Sanitize and redact tool outputs before persistence"
metadata:
  {"openclaw":{"emoji":"🧼","events":["tool_result_persist"],"requires":{"bins":["node"]}}}
---

# Enterprise Control Plane: tool_result_persist

Sanitizes tool results before they are written to conversation history.

- Redacts credentials and sensitive blobs
- Flags potential prompt-injection patterns in control-plane logs
