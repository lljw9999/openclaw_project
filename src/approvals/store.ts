import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ApprovalRequest, ToolCallRequest } from "../types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export class ApprovalStore {
  private readonly byId = new Map<string, ApprovalRequest>();
  private readonly persistPath: string;

  constructor(private readonly ttlMs: number, persistPath: string) {
    this.persistPath = persistPath;
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.persistPath)) {
        return;
      }
      const raw = fs.readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as ApprovalRequest[];
      for (const item of parsed) {
        this.byId.set(item.id, item);
      }
    } catch {
      // If persistence is corrupted, continue with empty in-memory store.
    }
  }

  private persist(): void {
    const dir = path.dirname(this.persistPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.persistPath}.tmp`;
    const payload = JSON.stringify([...this.byId.values()], null, 2);
    fs.writeFileSync(tmpPath, payload, "utf8");
    fs.renameSync(tmpPath, this.persistPath);
  }

  create(toolCall: ToolCallRequest, reason: string): ApprovalRequest {
    const now = new Date();
    const approval: ApprovalRequest = {
      id: crypto.randomUUID(),
      toolCall,
      reason,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: addMs(now, this.ttlMs).toISOString(),
    };
    this.byId.set(approval.id, approval);
    this.persist();
    return approval;
  }

  get(id: string): ApprovalRequest | null {
    const existing = this.byId.get(id);
    if (!existing) {
      return null;
    }
    if (existing.status === "pending" && new Date(existing.expiresAt).getTime() < Date.now()) {
      existing.status = "expired";
    }
    return existing;
  }

  list(status?: ApprovalRequest["status"]): ApprovalRequest[] {
    const values = [...this.byId.values()].map((item) => this.get(item.id) ?? item);
    if (!status) {
      return values;
    }
    return values.filter((item) => item.status === status);
  }

  decide(id: string, payload: { decision: "approved" | "rejected"; actor: string; note?: string }): ApprovalRequest | null {
    const request = this.get(id);
    if (!request) {
      return null;
    }
    if (request.status !== "pending") {
      return request;
    }

    request.status = payload.decision;
    request.decidedBy = payload.actor;
    request.note = payload.note;
    request.decidedAt = nowIso();
    this.persist();
    return request;
  }
}
