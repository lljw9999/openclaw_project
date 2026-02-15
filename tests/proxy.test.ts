import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUpstreamChatRequest,
  extractPromptFromChatRequest,
  TieredModelProxy,
} from "../src/routing/proxy.js";
import type { RouteDecision, RoutingConfig } from "../src/types.js";

test("extractPromptFromChatRequest prefers explicit prompt", () => {
  const prompt = extractPromptFromChatRequest({
    prompt: "explicit prompt",
    messages: [{ role: "user", content: "ignored" }],
  });
  assert.equal(prompt, "explicit prompt");
});

test("extractPromptFromChatRequest falls back to messages", () => {
  const prompt = extractPromptFromChatRequest({
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "there" }] },
    ],
  });
  assert.equal(prompt, "hello there");
});

test("buildUpstreamChatRequest removes control-plane-only fields", () => {
  const body = buildUpstreamChatRequest(
    {
      prompt: "test",
      metadata: { isHeartbeat: true },
      requestedModel: "custom",
      temperature: 0.3,
      MAX_TOKENS: 42,
    },
    "llama3.1:8b",
  );

  assert.equal(body.model, "llama3.1:8b");
  assert.equal(body.temperature, 0.3);
  assert.equal(body.max_tokens, 42);
  assert.equal("MAX_TOKENS" in body, false);
  assert.equal("metadata" in body, false);
  assert.equal("requestedModel" in body, false);
  assert.ok(Array.isArray(body.messages));
});

test("TieredModelProxy forwards to routed provider", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "chatcmpl-1", object: "chat.completion" }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  process.env.PREMIUM_TEST_API_KEY = "secret-token";

  const config: RoutingConfig = {
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
        baseUrl: "http://127.0.0.1:11434/v1",
      },
      cheap: {
        baseUrl: "https://cheap.example/v1",
      },
      premium: {
        baseUrl: "https://premium.example/v1",
        apiKeyEnv: "PREMIUM_TEST_API_KEY",
      },
      requestTimeoutMs: 5000,
    },
    complexity: {
      premiumPromptChars: 4500,
      premiumKeywords: ["architecture"],
      cheapKeywords: ["summarize"],
    },
  };

  const decision: RouteDecision = {
    tier: "premium",
    model: "gpt-5",
    reason: "High complexity",
  };

  const proxy = new TieredModelProxy(config, fakeFetch);
  const result = await proxy.forwardChatCompletions(
    {
      prompt: "run architecture analysis",
      temperature: 0.2,
    },
    decision,
  );

  assert.equal(result.status, 200);
  assert.equal(result.route.tier, "premium");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://premium.example/v1/chat/completions");

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer secret-token");
});
