---
name: ecp-before-tool-call
description: "Enforce allow/ask/deny policy before any tool is executed"
metadata:
  {"openclaw":{"emoji":"🛡️","events":["before_tool_call"],"requires":{"bins":["node"]}}}
---

# Enterprise Control Plane: before_tool_call

Routes each tool invocation to the control plane policy engine.

- `allow` => tool executes immediately
- `ask` => waits for human approval via control plane
- `deny` => throws and blocks execution
