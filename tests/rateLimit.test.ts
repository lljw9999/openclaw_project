import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";
import type { AppConfig } from "../src/types.js";

function createTestConfig(tempDir: string): AppConfig {
  return {
    server: { host: "127.0.0.1", port: 0 },
    auth: { required: false, apiKeyEnv: "CONTROL_PLANE_API_KEY", headerName: "x-api-key" },
    approvals: { ttlMs: 60000, persistPath: path.join(tempDir, "approvals.json") },
    audit: { persistPath: path.join(tempDir, "audit.log"), maxInMemoryEvents: 500 },
    policy: {
      defaultDecision: "allow",
      rules: [],
      redactionPatterns: [],
      denyOutboundPatterns: [],
      promptInjectionPatterns: [],
    },
    routing: {
      local: { model: "llama3.1:8b", maxPromptChars: 1400, heartbeatKeywords: ["heartbeat"] },
      cheap: { model: "gpt-4.1-mini" },
      premium: { model: "gpt-5" },
      providers: {
        local: { baseUrl: "http://127.0.0.1:65530/v1" },
        cheap: { baseUrl: "http://127.0.0.1:65530/v1" },
        premium: { baseUrl: "http://127.0.0.1:65530/v1" },
        requestTimeoutMs: 2000,
      },
      complexity: { premiumPromptChars: 4500, premiumKeywords: [], cheapKeywords: [] },
    },
    rateLimit: { windowMs: 60000, maxRequests: 3 },
  };
}

test("rate limiter returns 429 after exceeding maxRequests", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rate-limit-test-"));
  const app = createApp(createTestConfig(tempDir));
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Unexpected address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/v1/metrics/summary`);
      assert.equal(res.status, 200, `Request ${i + 1} should succeed`);
    }

    const blocked = await fetch(`${baseUrl}/v1/metrics/summary`);
    assert.equal(blocked.status, 429);
    const body = (await blocked.json()) as { error: string };
    assert.equal(body.error, "Too many requests");
    assert.ok(blocked.headers.get("retry-after"));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
