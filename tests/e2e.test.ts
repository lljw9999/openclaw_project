import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";
import type { AppConfig, MetricsSummary } from "../src/types.js";

function createTestConfig(tempDir: string): AppConfig {
  return {
    server: { host: "127.0.0.1", port: 0 },
    auth: { required: false, apiKeyEnv: "CONTROL_PLANE_API_KEY", headerName: "x-api-key" },
    approvals: { ttlMs: 60000, persistPath: path.join(tempDir, "approvals.json") },
    audit: { persistPath: path.join(tempDir, "audit.log"), maxInMemoryEvents: 500 },
    policy: {
      defaultDecision: "deny",
      rules: [
        { id: "allow-web-fetch", match: { toolNames: ["web_fetch"] }, decision: "allow" },
        { id: "ask-shell", match: { toolNames: ["shell_exec"] }, decision: "ask" },
      ],
      redactionPatterns: ["sk-[a-zA-Z0-9]{20,}"],
      denyOutboundPatterns: ["seed phrase"],
      promptInjectionPatterns: ["ignore previous instructions"],
    },
    routing: {
      local: {
        model: "llama3.1:8b",
        maxPromptChars: 1400,
        heartbeatKeywords: ["heartbeat"],
        costPerMillionTokens: 0,
      },
      cheap: { model: "gpt-4.1-mini", costPerMillionTokens: 0.40 },
      premium: { model: "gpt-5", costPerMillionTokens: 15.00 },
      providers: {
        local: { baseUrl: "http://127.0.0.1:65530/v1" },
        cheap: { baseUrl: "http://127.0.0.1:65530/v1" },
        premium: { baseUrl: "http://127.0.0.1:65530/v1" },
        requestTimeoutMs: 2000,
      },
      complexity: {
        premiumPromptChars: 4500,
        premiumKeywords: ["architecture", "threat model"],
        cheapKeywords: ["summarize"],
      },
    },
    policyOverridesPath: path.join(tempDir, "policy-overrides.json"),
  };
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function asJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${String(body.error ?? "unknown error")}`);
  }
  return body;
}

test("e2e: full flow covers all major features", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-test-"));
  const app = createApp(createTestConfig(tempDir));
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Unexpected address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // 1. Intercept allowed tool call
    const allowResult = await asJson(
      await postJson(`${baseUrl}/v1/tool-calls/intercept`, {
        toolName: "web_fetch",
        params: { url: "https://example.com" },
      }),
    );
    assert.equal(allowResult.decision, "allow");

    // 2. Intercept ask tool call -> get approvalId
    const askResult = await asJson(
      await postJson(`${baseUrl}/v1/tool-calls/intercept`, {
        toolName: "shell_exec",
        params: { command: "echo hi" },
      }),
    );
    assert.equal(askResult.decision, "ask");
    const approvalId = askResult.approvalId as string;
    assert.equal(typeof approvalId, "string");

    // 3. Approve it
    const approveResult = await asJson(
      await postJson(`${baseUrl}/v1/approvals/${approvalId}/decision`, {
        decision: "approved",
        actor: "admin@example.com",
      }),
    );
    assert.equal(approveResult.status, "approved");

    // 4. Route heartbeat -> local tier
    const routeResult = await asJson(
      await postJson(`${baseUrl}/v1/model-router/route`, {
        prompt: "heartbeat status check",
        metadata: { isHeartbeat: true },
      }),
    );
    assert.equal(routeResult.tier, "local");

    // 5. Sanitize output with secrets
    const sanitizeResult = await asJson(
      await postJson(`${baseUrl}/v1/tool-results/sanitize`, {
        output: "secret sk-abcdefghijklmnopqrstuvwxyz123456 data",
      }),
    );
    assert.ok(String(sanitizeResult.sanitized).includes("[REDACTED]"));

    // 6. Outbound check with denied pattern
    const outboundResult = await asJson(
      await postJson(`${baseUrl}/v1/outbound/check`, {
        message: "contains seed phrase here",
      }),
    );
    assert.equal(outboundResult.allowed, false);

    // 7. Query audit events -> verify all event types present
    const eventsRes = await asJson(await fetch(`${baseUrl}/v1/audit/events?limit=100`));
    const events = eventsRes.items as Array<{ type: string }>;
    const eventTypes = new Set(events.map((e) => e.type));
    assert.ok(eventTypes.has("tool_call_intercepted"), "missing tool_call_intercepted");
    assert.ok(eventTypes.has("tool_call_decision"), "missing tool_call_decision");
    assert.ok(eventTypes.has("approval_created"), "missing approval_created");
    assert.ok(eventTypes.has("approval_decided"), "missing approval_decided");
    assert.ok(eventTypes.has("tool_result_sanitized"), "missing tool_result_sanitized");
    assert.ok(eventTypes.has("outbound_message_checked"), "missing outbound_message_checked");
    assert.ok(eventTypes.has("model_routed"), "missing model_routed");

    // 8. Query metrics summary
    const summary = (await asJson(
      await fetch(`${baseUrl}/v1/metrics/summary?windowMinutes=60`),
    )) as unknown as MetricsSummary;
    assert.ok(summary.totals.events >= 9);
    assert.ok(summary.policy.intercepted >= 2);
    assert.ok(summary.policy.allow >= 1);
    assert.ok(summary.policy.ask >= 1);
    assert.ok(summary.approvals.approved >= 1);
    assert.ok(summary.security.redactionEvents >= 1);
    assert.ok(summary.security.outboundBlocked >= 1);
    assert.ok(summary.routing.total >= 1);
    assert.ok(summary.routing.byTier.local >= 1);
    assert.ok(typeof summary.routing.estimatedCost === "number");
    assert.ok(typeof summary.routing.estimatedSavings === "number");

    // 9. CRUD a policy rule -> verify intercept behavior changes
    // By default, "file_write" matches no rule and gets "deny" (default decision)
    const denyResult = await asJson(
      await postJson(`${baseUrl}/v1/tool-calls/intercept`, {
        toolName: "file_write",
        params: { path: "/tmp/test" },
      }),
    );
    assert.equal(denyResult.decision, "deny");

    // Create a rule to allow file_write
    const createPolicyRes = await postJson(`${baseUrl}/v1/policies`, {
      id: "allow-file-write",
      match: { toolNames: ["file_write"] },
      decision: "allow",
    });
    assert.equal(createPolicyRes.status, 201);

    // Now file_write should be allowed
    const allowedAfterPolicy = await asJson(
      await postJson(`${baseUrl}/v1/tool-calls/intercept`, {
        toolName: "file_write",
        params: { path: "/tmp/test" },
      }),
    );
    assert.equal(allowedAfterPolicy.decision, "allow");

    // Delete the rule
    const deleteRes = await fetch(`${baseUrl}/v1/policies/allow-file-write`, { method: "DELETE" });
    assert.equal(deleteRes.status, 200);

    // file_write should be denied again
    const deniedAgain = await asJson(
      await postJson(`${baseUrl}/v1/tool-calls/intercept`, {
        toolName: "file_write",
        params: { path: "/tmp/test" },
      }),
    );
    assert.equal(deniedAgain.decision, "deny");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
