import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ApprovalStore } from "../src/approvals/store.js";

test("ApprovalStore persists approvals across instances", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "approval-store-test-"));
  const persistPath = path.join(tempDir, "approvals.json");

  const store1 = new ApprovalStore(60000, persistPath);
  const created = store1.create(
    {
      toolName: "shell_exec",
      params: { command: "ls -la" },
    },
    "requires approval",
  );

  const reopened = new ApprovalStore(60000, persistPath);
  const loaded = reopened.get(created.id);
  assert.ok(loaded);
  assert.equal(loaded?.status, "pending");

  reopened.decide(created.id, {
    decision: "approved",
    actor: "admin@example.com",
  });

  const reopenedAgain = new ApprovalStore(60000, persistPath);
  const decided = reopenedAgain.get(created.id);
  assert.ok(decided);
  assert.equal(decided?.status, "approved");
  assert.equal(decided?.decidedBy, "admin@example.com");

  fs.rmSync(tempDir, { recursive: true, force: true });
});
