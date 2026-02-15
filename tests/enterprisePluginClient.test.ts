import test from "node:test";
import assert from "node:assert/strict";
import {
  enforceToolCallPolicy,
  sanitizeToolOutput,
  validateOutboundMessage,
} from "../extensions/enterprise-control-plane/hooks/_lib/client.ts";

test("enterprise plugin client waits for approval and allows", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.OPENCLAW_CP_BASE_URL;
  const originalInterval = process.env.OPENCLAW_CP_POLL_INTERVAL_MS;
  const originalTimeout = process.env.OPENCLAW_CP_POLL_TIMEOUT_MS;

  process.env.OPENCLAW_CP_BASE_URL = "http://cp.local";
  process.env.OPENCLAW_CP_POLL_INTERVAL_MS = "1";
  process.env.OPENCLAW_CP_POLL_TIMEOUT_MS = "1000";

  let approvalChecks = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/v1/tool-calls/intercept") && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          decision: "ask",
          reason: "approval required",
          approvalId: "appr-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.endsWith("/v1/approvals/appr-1") && init?.method === "GET") {
      approvalChecks += 1;
      const status = approvalChecks > 1 ? "approved" : "pending";
      return new Response(
        JSON.stringify({
          id: "appr-1",
          status,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;

  try {
    await enforceToolCallPolicy({
      toolName: "shell_exec",
      params: { command: "ls -la" },
    });
    assert.equal(approvalChecks, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) {
      delete process.env.OPENCLAW_CP_BASE_URL;
    } else {
      process.env.OPENCLAW_CP_BASE_URL = originalBase;
    }

    if (originalInterval === undefined) {
      delete process.env.OPENCLAW_CP_POLL_INTERVAL_MS;
    } else {
      process.env.OPENCLAW_CP_POLL_INTERVAL_MS = originalInterval;
    }

    if (originalTimeout === undefined) {
      delete process.env.OPENCLAW_CP_POLL_TIMEOUT_MS;
    } else {
      process.env.OPENCLAW_CP_POLL_TIMEOUT_MS = originalTimeout;
    }
  }
});

test("enterprise plugin client throws on denied outbound", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.OPENCLAW_CP_BASE_URL;

  process.env.OPENCLAW_CP_BASE_URL = "http://cp.local";

  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/outbound/check")) {
      return new Response(
        JSON.stringify({
          allowed: false,
          sanitized: "",
          deniedPattern: "seed phrase",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;

  try {
    await assert.rejects(() => validateOutboundMessage("my seed phrase..."));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) {
      delete process.env.OPENCLAW_CP_BASE_URL;
    } else {
      process.env.OPENCLAW_CP_BASE_URL = originalBase;
    }
  }
});

test("enterprise plugin client sanitizes tool output", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.OPENCLAW_CP_BASE_URL;

  process.env.OPENCLAW_CP_BASE_URL = "http://cp.local";

  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/tool-results/sanitize")) {
      return new Response(
        JSON.stringify({
          sanitized: "safe",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;

  try {
    const output = await sanitizeToolOutput("unsafe");
    assert.equal(output, "safe");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) {
      delete process.env.OPENCLAW_CP_BASE_URL;
    } else {
      process.env.OPENCLAW_CP_BASE_URL = originalBase;
    }
  }
});
