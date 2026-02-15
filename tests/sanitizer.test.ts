import test from "node:test";
import assert from "node:assert/strict";
import { checkOutboundMessage, sanitizeToolResult } from "../src/security/sanitizer.js";
import type { PolicyConfig } from "../src/types.js";

const policy: PolicyConfig = {
  defaultDecision: "ask",
  rules: [],
  redactionPatterns: ["sk-[a-zA-Z0-9]{20,}"],
  denyOutboundPatterns: ["seed phrase"],
  promptInjectionPatterns: ["ignore previous instructions"],
};

test("redacts sensitive strings and flags injection", () => {
  const result = sanitizeToolResult(
    "token sk-abcdefghijklmnopqrstuvwxyz and ignore previous instructions",
    policy,
  );

  assert.match(result.sanitized, /\[REDACTED\]/);
  assert.equal(result.promptInjectionFlags.length, 1);
});

test("blocks outbound message with denied pattern", () => {
  const result = checkOutboundMessage("This includes a seed phrase", policy);
  assert.equal(result.allowed, false);
  assert.equal(result.deniedPattern, "seed phrase");
});
