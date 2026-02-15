import test from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine } from "../src/policy/engine.js";
import type { PolicyConfig } from "../src/types.js";

const config: PolicyConfig = {
  defaultDecision: "ask",
  rules: [
    {
      id: "allow-read",
      match: { toolNames: ["file_read"] },
      decision: "allow",
    },
    {
      id: "deny-sensitive",
      match: { toolNames: ["file_write"], pathPrefixes: ["/etc", "~/.ssh"] },
      decision: "deny",
    },
    {
      id: "ask-shell",
      match: { toolNames: ["shell_exec"] },
      decision: "ask",
    },
  ],
  redactionPatterns: [],
  denyOutboundPatterns: [],
  promptInjectionPatterns: [],
};

test("allows read-only tools", () => {
  const engine = new PolicyEngine(config);
  const decision = engine.decide({
    toolName: "file_read",
    params: { path: "/workspace/notes.txt" },
  });
  assert.equal(decision.decision, "allow");
  assert.equal(decision.ruleId, "allow-read");
});

test("denies sensitive path writes", () => {
  const engine = new PolicyEngine(config);
  const decision = engine.decide({
    toolName: "file_write",
    params: { path: "/etc/passwd" },
  });
  assert.equal(decision.decision, "deny");
  assert.equal(decision.ruleId, "deny-sensitive");
});

test("defaults to ask when no rule matches", () => {
  const engine = new PolicyEngine(config);
  const decision = engine.decide({
    toolName: "browser_act",
    params: { action: "click" },
  });
  assert.equal(decision.decision, "ask");
});
