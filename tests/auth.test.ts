import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import type { AppConfig } from "../src/types.js";

const config: AppConfig = {
  server: { host: "127.0.0.1", port: 0 },
  auth: {
    required: true,
    apiKeyEnv: "CONTROL_PLANE_API_KEY",
    headerName: "x-api-key",
  },
  approvals: {
    ttlMs: 300000,
    persistPath: "data/test-auth-approvals.json",
  },
  audit: {
    persistPath: "data/test-auth-audit.log",
    maxInMemoryEvents: 200,
  },
  policy: {
    defaultDecision: "ask",
    rules: [],
    redactionPatterns: [],
    denyOutboundPatterns: [],
    promptInjectionPatterns: [],
  },
  routing: {
    local: {
      model: "llama3.1:8b",
      maxPromptChars: 1400,
      heartbeatKeywords: ["heartbeat"],
    },
    cheap: {
      model: "gpt-4.1-mini",
    },
    premium: {
      model: "gpt-5",
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
      requestTimeoutMs: 3000,
    },
    complexity: {
      premiumPromptChars: 4500,
      premiumKeywords: ["architecture"],
      cheapKeywords: ["summarize"],
    },
  },
};

test("API key middleware blocks unauthorized /v1 calls", async () => {
  const prev = process.env.CONTROL_PLANE_API_KEY;
  process.env.CONTROL_PLANE_API_KEY = "test-key";

  const app = createApp(config);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Unexpected server address");
    }

    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const unauthorized = await fetch(`${baseUrl}/v1/approvals`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/v1/approvals`, {
      headers: {
        "x-api-key": "test-key",
      },
    });
    assert.equal(authorized.status, 200);
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

    if (prev === undefined) {
      delete process.env.CONTROL_PLANE_API_KEY;
    } else {
      process.env.CONTROL_PLANE_API_KEY = prev;
    }
  }
});
