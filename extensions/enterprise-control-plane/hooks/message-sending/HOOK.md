---
name: ecp-message-sending
description: "Inspect outbound messages for DLP and policy violations"
metadata:
  {"openclaw":{"emoji":"📤","events":["message_sending"],"requires":{"bins":["node"]}}}
---

# Enterprise Control Plane: message_sending

Checks outbound messages before delivery.

- Blocks known secret patterns and prohibited phrases
- Returns sanitized content when redaction is needed
