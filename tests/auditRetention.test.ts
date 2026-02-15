import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AuditStore } from "../src/audit/store.js";

test("prunes old events on startup with retentionDays", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-retention-test-"));
  const logPath = path.join(tempDir, "audit.log");

  try {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString(); // 10 days ago
    const recentDate = new Date().toISOString();

    const oldEvent = JSON.stringify({
      id: crypto.randomUUID(),
      timestamp: oldDate,
      type: "tool_call_intercepted",
      payload: { toolName: "old_tool" },
    });
    const recentEvent = JSON.stringify({
      id: crypto.randomUUID(),
      timestamp: recentDate,
      type: "tool_call_intercepted",
      payload: { toolName: "recent_tool" },
    });

    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(logPath, oldEvent + "\n" + recentEvent + "\n", "utf8");

    const store = new AuditStore(logPath, 500, { retentionDays: 7 });
    const events = store.list({ limit: 100 });

    assert.equal(events.length, 1);
    assert.equal((events[0].payload as { toolName: string }).toolName, "recent_tool");

    // Verify old event was removed from file
    const fileContent = fs.readFileSync(logPath, "utf8");
    assert.ok(!fileContent.includes("old_tool"));
    assert.ok(fileContent.includes("recent_tool"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rotates file when maxFileSizeBytes exceeded", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-rotation-test-"));
  const logPath = path.join(tempDir, "audit.log");

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(logPath, "", "utf8");

    // Use a very small size limit so writes trigger rotation
    const store = new AuditStore(logPath, 500, { maxFileSizeBytes: 200 });

    // Write several events to exceed the size limit
    for (let i = 0; i < 5; i++) {
      store.append("tool_call_intercepted", { toolName: `tool_${i}`, data: "x".repeat(50) });
    }

    // The rotated file should exist
    const rotatedPath = logPath + ".1";
    assert.ok(fs.existsSync(rotatedPath), "Rotated file should exist");

    // The current log should be smaller than the rotated one or at least exist
    assert.ok(fs.existsSync(logPath), "Current log should still exist");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
