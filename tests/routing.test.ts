import test from "node:test";
import assert from "node:assert/strict";
import { ModelRouter } from "../src/routing/modelRouter.js";
import type { RoutingConfig } from "../src/types.js";

const config: RoutingConfig = {
  local: {
    model: "llama3.1:8b",
    maxPromptChars: 1400,
    heartbeatKeywords: ["heartbeat", "status check"],
  },
  cheap: {
    model: "gpt-4.1-mini",
  },
  premium: {
    model: "gpt-5",
  },
  complexity: {
    premiumPromptChars: 4500,
    premiumKeywords: ["architecture", "threat model"],
    cheapKeywords: ["summarize", "brief"],
  },
};

test("routes heartbeat to local", () => {
  const router = new ModelRouter(config);
  const decision = router.route({
    prompt: "heartbeat check for pending tasks",
    metadata: { isHeartbeat: true },
  });
  assert.equal(decision.tier, "local");
  assert.equal(decision.model, "llama3.1:8b");
});

test("routes long complex prompt to premium", () => {
  const router = new ModelRouter(config);
  const decision = router.route({
    prompt: "Please produce a full threat model and architecture review for this distributed system.",
  });
  assert.equal(decision.tier, "premium");
  assert.equal(decision.model, "gpt-5");
});

test("routes routine prompt to cheap", () => {
  const router = new ModelRouter(config);
  const decision = router.route({
    prompt: "summarize these meeting notes",
  });
  assert.equal(decision.tier, "cheap");
  assert.equal(decision.model, "gpt-4.1-mini");
});
