import fs from "node:fs";
import path from "node:path";
import type { PolicyConfig, PolicyDecision, PolicyRule, ToolCallRequest } from "../types.js";
import { matchesCriteria } from "./matchers.js";

export class PolicyEngine {
  private config: PolicyConfig;
  private overridesPath: string | undefined;

  constructor(config: PolicyConfig, overridesPath?: string) {
    this.config = config;
    this.overridesPath = overridesPath;
    if (overridesPath) {
      this.loadOverrides();
    }
  }

  decide(call: ToolCallRequest): PolicyDecision {
    for (const rule of this.config.rules) {
      if (matchesCriteria(rule.match, call)) {
        return {
          decision: rule.decision,
          ruleId: rule.id,
          reason: rule.reason ?? rule.description ?? `Matched rule ${rule.id}`,
        };
      }
    }

    return {
      decision: this.config.defaultDecision,
      reason: "No rule matched; default decision applied",
    };
  }

  getRules(): PolicyRule[] {
    return [...this.config.rules];
  }

  addRule(rule: PolicyRule): void {
    const existing = this.config.rules.find((r) => r.id === rule.id);
    if (existing) {
      throw new Error(`Rule with id '${rule.id}' already exists`);
    }
    this.config.rules.push(rule);
    this.persistOverrides();
  }

  updateRule(id: string, updates: Partial<Omit<PolicyRule, "id">>): PolicyRule {
    const idx = this.config.rules.findIndex((r) => r.id === id);
    if (idx === -1) {
      throw new Error(`Rule '${id}' not found`);
    }
    const rule = this.config.rules[idx];
    if (updates.match !== undefined) rule.match = updates.match;
    if (updates.decision !== undefined) rule.decision = updates.decision;
    if (updates.description !== undefined) rule.description = updates.description;
    if (updates.reason !== undefined) rule.reason = updates.reason;
    this.persistOverrides();
    return { ...rule };
  }

  deleteRule(id: string): void {
    const idx = this.config.rules.findIndex((r) => r.id === id);
    if (idx === -1) {
      throw new Error(`Rule '${id}' not found`);
    }
    this.config.rules.splice(idx, 1);
    this.persistOverrides();
  }

  private loadOverrides(): void {
    if (!this.overridesPath || !fs.existsSync(this.overridesPath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.overridesPath, "utf8");
      const overrides = JSON.parse(raw) as PolicyRule[];
      if (Array.isArray(overrides)) {
        this.config.rules = overrides;
      }
    } catch {
      // If parsing fails, keep current rules.
    }
  }

  private persistOverrides(): void {
    if (!this.overridesPath) {
      return;
    }
    const dir = path.dirname(this.overridesPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.overridesPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(this.config.rules, null, 2), "utf8");
    fs.renameSync(tmpPath, this.overridesPath);
  }
}
