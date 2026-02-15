import test from "node:test";
import assert from "node:assert/strict";
import { createOpenClawPlugin } from "../src/openclaw/pluginAdapter.js";
import { PolicyDeniedError } from "../src/openclaw/controlPlaneClient.js";

test("plugin adapter before_tool_call allows safe event", async () => {
  const plugin = createOpenClawPlugin({
    interceptToolCall: async () => ({ finalDecision: "allow", reason: "ok" }),
    sanitizeToolResult: async (output) => ({ sanitized: output }),
    checkOutboundMessage: async (message) => ({ allowed: true, sanitized: message }),
  });

  const event = {
    toolName: "web_fetch",
    params: { url: "https://example.com" },
    source: "slack",
  };

  const result = await plugin.hooks.before_tool_call(event);
  assert.deepEqual(result, event);
});

test("plugin adapter before_tool_call throws on deny", async () => {
  const plugin = createOpenClawPlugin({
    interceptToolCall: async () => ({ finalDecision: "deny", reason: "blocked" }),
    sanitizeToolResult: async (output) => ({ sanitized: output }),
    checkOutboundMessage: async (message) => ({ allowed: true, sanitized: message }),
  });

  await assert.rejects(
    () => plugin.hooks.before_tool_call({ toolName: "shell_exec", params: { command: "rm -rf /" } }),
    PolicyDeniedError,
  );
});

test("plugin adapter tool_result_persist sanitizes output", async () => {
  const plugin = createOpenClawPlugin({
    interceptToolCall: async () => ({ finalDecision: "allow", reason: "ok" }),
    sanitizeToolResult: async () => ({ sanitized: "[REDACTED]" }),
    checkOutboundMessage: async (message) => ({ allowed: true, sanitized: message }),
  });

  const result = (await plugin.hooks.tool_result_persist({
    output: "secret token",
  })) as Record<string, unknown>;

  assert.equal(result.output, "[REDACTED]");
});

test("plugin adapter message_sending blocks disallowed outbound messages", async () => {
  const plugin = createOpenClawPlugin({
    interceptToolCall: async () => ({ finalDecision: "allow", reason: "ok" }),
    sanitizeToolResult: async (output) => ({ sanitized: output }),
    checkOutboundMessage: async () => ({
      allowed: false,
      sanitized: "",
      deniedPattern: "seed phrase",
    }),
  });

  await assert.rejects(
    () => plugin.hooks.message_sending({ message: "my seed phrase is ..." }),
    PolicyDeniedError,
  );
});
