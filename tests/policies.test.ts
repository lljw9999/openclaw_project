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
      defaultDecision: "deny",
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

test("policy CRUD lifecycle", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "policies-test-"));
  const app = createApp(createTestConfig(tempDir));
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Unexpected address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // Create a rule
    const createRes = await postJson(`${baseUrl}/v1/policies`, {
      id: "test-allow-fetch",
      match: { toolNames: ["web_fetch"] },
      decision: "allow",
      description: "Allow web_fetch",
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string };
    assert.equal(created.id, "test-allow-fetch");

    // List rules
    const listRes = await fetch(`${baseUrl}/v1/policies`);
    assert.equal(listRes.status, 200);
    const listed = (await listRes.json()) as { items: Array<{ id: string }> };
    assert.ok(listed.items.some((r) => r.id === "test-allow-fetch"));

    // Update rule
    const updateRes = await fetch(`${baseUrl}/v1/policies/test-allow-fetch`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "deny" }),
    });
    assert.equal(updateRes.status, 200);
    const updated = (await updateRes.json()) as { decision: string };
    assert.equal(updated.decision, "deny");

    // Verify the updated rule affects intercept
    const interceptRes = await postJson(`${baseUrl}/v1/tool-calls/intercept`, {
      toolName: "web_fetch",
      params: { url: "https://example.com" },
    });
    assert.equal(interceptRes.status, 200);
    const interceptBody = (await interceptRes.json()) as { decision: string };
    assert.equal(interceptBody.decision, "deny");

    // Delete rule
    const deleteRes = await fetch(`${baseUrl}/v1/policies/test-allow-fetch`, { method: "DELETE" });
    assert.equal(deleteRes.status, 200);

    // Verify list is empty
    const listAfterDelete = await fetch(`${baseUrl}/v1/policies`);
    const afterDelete = (await listAfterDelete.json()) as { items: Array<{ id: string }> };
    assert.ok(!afterDelete.items.some((r) => r.id === "test-allow-fetch"));

    // Duplicate ID returns 400
    await postJson(`${baseUrl}/v1/policies`, {
      id: "dup-rule",
      match: { toolNames: ["test"] },
      decision: "allow",
    });
    const dupRes = await postJson(`${baseUrl}/v1/policies`, {
      id: "dup-rule",
      match: { toolNames: ["test"] },
      decision: "allow",
    });
    assert.equal(dupRes.status, 400);

    // Nonexistent ID returns 404
    const notFoundRes = await fetch(`${baseUrl}/v1/policies/nonexistent`, { method: "DELETE" });
    assert.equal(notFoundRes.status, 404);

    const notFoundUpdate = await fetch(`${baseUrl}/v1/policies/nonexistent`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "allow" }),
    });
    assert.equal(notFoundUpdate.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
