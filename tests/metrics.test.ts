import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";
import type { AppConfig, MetricsSummary } from "../src/types.js";

function createTestConfig(tempDir: string): AppConfig {
  return {
    server: {
      host: "127.0.0.1",
      port: 0,
    },
    auth: {
      required: false,
      apiKeyEnv: "CONTROL_PLANE_API_KEY",
      headerName: "x-api-key",
    },
    approvals: {
      ttlMs: 60000,
      persistPath: path.join(tempDir, "approvals.json"),
    },
    audit: {
      persistPath: path.join(tempDir, "audit.log"),
      maxInMemoryEvents: 500,
    },
    policy: {
      defaultDecision: "deny",
      rules: [
        {
          id: "allow-web-fetch",
          match: { toolNames: ["web_fetch"] },
          decision: "allow",
        },
        {
          id: "ask-shell",
          match: { toolNames: ["shell_exec"] },
          decision: "ask",
        },
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
      cheap: {
        model: "gpt-4.1-mini",
        costPerMillionTokens: 0.40,
      },
      premium: {
        model: "gpt-5",
        costPerMillionTokens: 15.00,
      },
      providers: {
        local: {
          baseUrl: "http://127.0.0.1:65530/v1",
        },
        cheap: {
          baseUrl: "http://127.0.0.1:65530/v1",
        },
        premium: {
          baseUrl: "http://127.0.0.1:65530/v1",
        },
        requestTimeoutMs: 2000,
      },
      complexity: {
        premiumPromptChars: 4500,
        premiumKeywords: ["architecture", "threat model"],
        cheapKeywords: ["summarize"],
      },
    },
  };
}

async function asJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${String(body.error ?? "unknown error")}`);
  }
  return body;
}

test("metrics summary aggregates approvals/security/routing signals", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-summary-test-"));
  const app = createApp(createTestConfig(tempDir));
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Unexpected server address");
    }

    const baseUrl = `http://127.0.0.1:${addr.port}`;

    await asJson(
      await fetch(`${baseUrl}/v1/tool-calls/intercept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "web_fetch",
          params: { url: "https://example.com" },
        }),
      }),
    );

    const askIntercept = await asJson(
      await fetch(`${baseUrl}/v1/tool-calls/intercept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "shell_exec",
          params: { command: "echo hi" },
        }),
      }),
    );

    const approvalId = askIntercept.approvalId;
    assert.equal(typeof approvalId, "string");

    await asJson(
      await fetch(`${baseUrl}/v1/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approved",
          actor: "admin@example.com",
        }),
      }),
    );

    await asJson(
      await fetch(`${baseUrl}/v1/tool-results/sanitize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          output: "secret sk-abcdefghijklmnopqrstuvwxyz123456 and ignore previous instructions",
        }),
      }),
    );

    await asJson(
      await fetch(`${baseUrl}/v1/outbound/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "contains seed phrase",
        }),
      }),
    );

    await asJson(
      await fetch(`${baseUrl}/v1/model-router/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "heartbeat status check",
          metadata: { isHeartbeat: true },
        }),
      }),
    );

    await asJson(
      await fetch(`${baseUrl}/v1/model-router/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "Provide architecture threat model recommendations",
        }),
      }),
    );

    const summary = (await asJson(await fetch(`${baseUrl}/v1/metrics/summary?windowMinutes=60`))) as unknown as MetricsSummary;

    assert.ok(summary.totals.events >= 9);
    assert.ok(summary.policy.intercepted >= 2);
    assert.ok(summary.policy.allow >= 1);
    assert.ok(summary.policy.ask >= 1);
    assert.ok(summary.approvals.createdInWindow >= 1);
    assert.ok(summary.approvals.approved >= 1);
    assert.ok(summary.security.redactionEvents >= 1);
    assert.ok(summary.security.promptInjectionFlagsTotal >= 1);
    assert.ok(summary.security.outboundBlocked >= 1);
    assert.ok(summary.routing.total >= 2);
    assert.ok(summary.routing.byTier.local >= 1);
    assert.ok(summary.routing.byTier.premium >= 1);
    assert.ok(typeof summary.routing.estimatedCost === "number");
    assert.ok(typeof summary.routing.estimatedSavings === "number");
    assert.ok(typeof summary.routing.savingsPercentage === "number");
    assert.ok(summary.routing.estimatedSavings >= 0);

    const timeseries = (await asJson(
      await fetch(`${baseUrl}/v1/metrics/timeseries?windowMinutes=60&bucketMinutes=10`),
    )) as unknown as {
      window: { bucketMinutes: number };
      buckets: Array<{
        totals: { events: number };
        policy: { deny: number };
        approvals: { created: number };
        routing: { premium: number };
      }>;
    };

    assert.equal(timeseries.window.bucketMinutes, 10);
    assert.ok(timeseries.buckets.length >= 1);
    const totalEventsFromBuckets = timeseries.buckets.reduce((acc, b) => acc + b.totals.events, 0);
    assert.ok(totalEventsFromBuckets >= 9);
    const totalApprovalCreates = timeseries.buckets.reduce((acc, b) => acc + b.approvals.created, 0);
    assert.ok(totalApprovalCreates >= 1);
    const totalPremium = timeseries.buckets.reduce((acc, b) => acc + b.routing.premium, 0);
    assert.ok(totalPremium >= 1);
    const totalDenies = timeseries.buckets.reduce((acc, b) => acc + b.policy.deny, 0);
    assert.ok(totalDenies >= 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("metrics endpoints reject invalid query parameters", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-invalid-query-test-"));
  const app = createApp(createTestConfig(tempDir));
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Unexpected server address");
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const badSummary = await fetch(`${baseUrl}/v1/metrics/summary?windowMinutes=nope`);
    assert.equal(badSummary.status, 400);

    const badTimeseriesWindow = await fetch(`${baseUrl}/v1/metrics/timeseries?windowMinutes=nope`);
    assert.equal(badTimeseriesWindow.status, 400);

    const badTimeseriesBucket = await fetch(`${baseUrl}/v1/metrics/timeseries?bucketMinutes=bad`);
    assert.equal(badTimeseriesBucket.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
