import test from "node:test";
import assert from "node:assert/strict";
import { ControlPlaneClient } from "../src/openclaw/controlPlaneClient.js";

test("ControlPlaneClient waits for approval and allows when approved", async () => {
  let approvalChecks = 0;

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.endsWith("/v1/tool-calls/intercept") && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          decision: "ask",
          reason: "Needs approval",
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
          reason: "Needs approval",
          decidedBy: status === "approved" ? "admin" : undefined,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new ControlPlaneClient({
    baseUrl: "http://localhost:3000",
    pollIntervalMs: 5,
    pollTimeoutMs: 1000,
    fetchImpl: fakeFetch,
  });

  const result = await client.interceptToolCall({
    toolName: "shell_exec",
    params: { command: "ls -la" },
  });

  assert.equal(result.finalDecision, "allow");
  assert.equal(result.approvalId, "appr-1");
  assert.equal(approvalChecks, 2);
});
