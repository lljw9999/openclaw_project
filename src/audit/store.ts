import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AuditEvent,
  MetricsSummary,
  MetricsTimeseries,
  MetricsTimeseriesBucket,
} from "../types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseIsoOrFallback(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

interface EventCounters {
  intercepted: number;
  allow: number;
  ask: number;
  deny: number;
  created: number;
  decided: number;
  redactionEvents: number;
  redactionsTotal: number;
  promptInjectionFlagsTotal: number;
  outboundBlocked: number;
  routedTotal: number;
  routeLocal: number;
  routeCheap: number;
  routePremium: number;
  promptLengthTotal: number;
  promptLengthCount: number;
  estimatedCost: number;
  estimatedPremiumBaseline: number;
}

function createCounters(): EventCounters {
  return {
    intercepted: 0,
    allow: 0,
    ask: 0,
    deny: 0,
    created: 0,
    decided: 0,
    redactionEvents: 0,
    redactionsTotal: 0,
    promptInjectionFlagsTotal: 0,
    outboundBlocked: 0,
    routedTotal: 0,
    routeLocal: 0,
    routeCheap: 0,
    routePremium: 0,
    promptLengthTotal: 0,
    promptLengthCount: 0,
    estimatedCost: 0,
    estimatedPremiumBaseline: 0,
  };
}

function applyEventToCounters(counters: EventCounters, event: AuditEvent): void {
  if (event.type === "tool_call_intercepted") {
    counters.intercepted += 1;
  }

  if (event.type === "tool_call_decision") {
    const decision = asString(event.payload.decision);
    if (decision === "allow") {
      counters.allow += 1;
    } else if (decision === "deny") {
      counters.deny += 1;
    } else if (decision === "ask") {
      counters.ask += 1;
    }
  }

  if (event.type === "approval_created") {
    counters.created += 1;
  }

  if (event.type === "approval_decided") {
    counters.decided += 1;
  }

  if (event.type === "tool_result_sanitized") {
    const redactions = asStringArray(event.payload.redactions);
    const injectionFlags = asStringArray(event.payload.promptInjectionFlags);
    if (redactions.length > 0) {
      counters.redactionEvents += 1;
    }
    counters.redactionsTotal += redactions.length;
    counters.promptInjectionFlagsTotal += injectionFlags.length;
  }

  if (event.type === "outbound_message_checked") {
    const allowed = event.payload.allowed;
    if (allowed === false) {
      counters.outboundBlocked += 1;
    }
  }

  if (event.type === "model_routed") {
    counters.routedTotal += 1;
    const tier = asString(event.payload.tier);
    if (tier === "local") {
      counters.routeLocal += 1;
    } else if (tier === "cheap") {
      counters.routeCheap += 1;
    } else if (tier === "premium") {
      counters.routePremium += 1;
    }

    const promptLength = asNumber(event.payload.promptLength);
    if (promptLength !== null) {
      counters.promptLengthTotal += promptLength;
      counters.promptLengthCount += 1;
    }

    const estimatedTokens = asNumber(event.payload.estimatedTokens);
    const tierCostPerMillion = asNumber(event.payload.tierCostPerMillion);
    const premiumCostPerMillion = asNumber(event.payload.premiumCostPerMillion);
    if (estimatedTokens !== null && tierCostPerMillion !== null) {
      counters.estimatedCost += (estimatedTokens / 1_000_000) * tierCostPerMillion;
    }
    if (estimatedTokens !== null && premiumCostPerMillion !== null) {
      counters.estimatedPremiumBaseline += (estimatedTokens / 1_000_000) * premiumCostPerMillion;
    }
  }
}

export class AuditStore {
  private readonly events: AuditEvent[] = [];
  private readonly maxFileSizeBytes: number | undefined;
  private readonly retentionDays: number | undefined;

  constructor(
    private readonly persistPath: string,
    private readonly maxInMemoryEvents: number,
    retention?: { maxFileSizeBytes?: number; retentionDays?: number },
  ) {
    this.maxFileSizeBytes = retention?.maxFileSizeBytes;
    this.retentionDays = retention?.retentionDays;
    const dir = path.dirname(persistPath);
    fs.mkdirSync(dir, { recursive: true });
    this.pruneOnStartup();
    this.loadExisting();
  }

  private pruneOnStartup(): void {
    if (!fs.existsSync(this.persistPath)) {
      return;
    }

    let changed = false;

    if (this.retentionDays !== undefined && this.retentionDays > 0) {
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60_000;
      try {
        const raw = fs.readFileSync(this.persistPath, "utf8");
        const lines = raw.split("\n").filter(Boolean);
        const kept: string[] = [];
        for (const line of lines) {
          try {
            const evt = JSON.parse(line) as { timestamp?: string };
            if (evt.timestamp && parseIsoOrFallback(evt.timestamp) >= cutoff) {
              kept.push(line);
            } else {
              changed = true;
            }
          } catch {
            // Drop malformed lines during pruning.
            changed = true;
          }
        }
        if (changed) {
          fs.writeFileSync(this.persistPath, kept.join("\n") + (kept.length > 0 ? "\n" : ""), "utf8");
        }
      } catch {
        // If file reading fails, skip pruning.
      }
    }

    this.rotateIfNeeded();
  }

  private rotateIfNeeded(): void {
    if (this.maxFileSizeBytes === undefined) {
      return;
    }
    try {
      const stat = fs.statSync(this.persistPath);
      if (stat.size > this.maxFileSizeBytes) {
        const rotatedPath = this.persistPath + ".1";
        fs.renameSync(this.persistPath, rotatedPath);
        fs.writeFileSync(this.persistPath, "", "utf8");
      }
    } catch {
      // Ignore rotation errors.
    }
  }

  private loadExisting(): void {
    if (!fs.existsSync(this.persistPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.persistPath, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      const parsed: AuditEvent[] = [];
      for (const line of lines) {
        try {
          const candidate = JSON.parse(line) as AuditEvent;
          if (
            candidate &&
            typeof candidate.id === "string" &&
            typeof candidate.timestamp === "string" &&
            typeof candidate.type === "string" &&
            typeof candidate.payload === "object" &&
            candidate.payload !== null
          ) {
            parsed.push(candidate);
          }
        } catch {
          // Ignore malformed line.
        }
      }
      const tail = parsed.slice(-this.maxInMemoryEvents);
      this.events.push(...tail);
    } catch {
      // If log parsing fails, continue with empty memory store.
    }
  }

  append(type: AuditEvent["type"], payload: Record<string, unknown>): AuditEvent {
    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      payload,
    };

    this.events.push(event);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    fs.appendFileSync(this.persistPath, `${JSON.stringify(event)}\n`, "utf8");
    this.rotateIfNeeded();
    return event;
  }

  list(params?: { type?: AuditEvent["type"]; limit?: number }): AuditEvent[] {
    const limit = Math.max(1, Math.min(params?.limit ?? 100, this.maxInMemoryEvents));
    let filtered = this.events;
    if (params?.type) {
      filtered = filtered.filter((event) => event.type === params.type);
    }
    return filtered.slice(-limit).reverse();
  }

  summary(params?: { windowMinutes?: number }): MetricsSummary {
    const windowMinutes = clamp(Math.trunc(params?.windowMinutes ?? 60), 1, 7 * 24 * 60);
    const now = Date.now();
    const fromMs = now - windowMinutes * 60_000;
    const inWindow = this.events.filter((event) => parseIsoOrFallback(event.timestamp) >= fromMs);

    const counters = createCounters();

    for (const event of inWindow) {
      applyEventToCounters(counters, event);
    }

    return {
      window: {
        from: new Date(fromMs).toISOString(),
        to: new Date(now).toISOString(),
        minutes: windowMinutes,
      },
      totals: {
        events: inWindow.length,
      },
      approvals: {
        pending: 0,
        approved: 0,
        rejected: 0,
        expired: 0,
        createdInWindow: counters.created,
        decidedInWindow: counters.decided,
      },
      policy: {
        intercepted: counters.intercepted,
        allow: counters.allow,
        ask: counters.ask,
        deny: counters.deny,
      },
      security: {
        redactionEvents: counters.redactionEvents,
        redactionsTotal: counters.redactionsTotal,
        promptInjectionFlagsTotal: counters.promptInjectionFlagsTotal,
        outboundBlocked: counters.outboundBlocked,
      },
      routing: {
        total: counters.routedTotal,
        byTier: {
          local: counters.routeLocal,
          cheap: counters.routeCheap,
          premium: counters.routePremium,
        },
        averagePromptLength:
          counters.promptLengthCount > 0
            ? Number((counters.promptLengthTotal / counters.promptLengthCount).toFixed(2))
            : 0,
        estimatedCost: Number(counters.estimatedCost.toFixed(6)),
        estimatedSavings: Number((counters.estimatedPremiumBaseline - counters.estimatedCost).toFixed(6)),
        savingsPercentage:
          counters.estimatedPremiumBaseline > 0
            ? Number(
                (
                  ((counters.estimatedPremiumBaseline - counters.estimatedCost) /
                    counters.estimatedPremiumBaseline) *
                  100
                ).toFixed(1),
              )
            : 0,
      },
    };
  }

  timeseries(params?: { windowMinutes?: number; bucketMinutes?: number }): MetricsTimeseries {
    const windowMinutes = clamp(Math.trunc(params?.windowMinutes ?? 180), 1, 7 * 24 * 60);
    const bucketMinutes = clamp(Math.trunc(params?.bucketMinutes ?? 5), 1, 240);
    const now = Date.now();
    const fromMs = now - windowMinutes * 60_000;
    const bucketMs = bucketMinutes * 60_000;
    const bucketCount = Math.max(1, Math.ceil((windowMinutes * 60_000) / bucketMs));

    const buckets: MetricsTimeseriesBucket[] = [];
    const countersByBucket: EventCounters[] = [];

    for (let idx = 0; idx < bucketCount; idx += 1) {
      const startMs = fromMs + idx * bucketMs;
      const endMs = Math.min(now, startMs + bucketMs);
      buckets.push({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        totals: {
          events: 0,
        },
        policy: {
          intercepted: 0,
          allow: 0,
          ask: 0,
          deny: 0,
        },
        approvals: {
          created: 0,
          decided: 0,
        },
        security: {
          redactionEvents: 0,
          outboundBlocked: 0,
        },
        routing: {
          total: 0,
          local: 0,
          cheap: 0,
          premium: 0,
          estimatedCost: 0,
          estimatedSavings: 0,
        },
      });
      countersByBucket.push(createCounters());
    }

    for (const event of this.events) {
      const ts = parseIsoOrFallback(event.timestamp);
      if (ts < fromMs || ts > now) {
        continue;
      }
      const idx = Math.floor((ts - fromMs) / bucketMs);
      const bucketIndex = clamp(idx, 0, bucketCount - 1);
      const bucket = buckets[bucketIndex];
      const counters = countersByBucket[bucketIndex];
      bucket.totals.events += 1;
      applyEventToCounters(counters, event);
    }

    for (let idx = 0; idx < bucketCount; idx += 1) {
      const bucket = buckets[idx];
      const counters = countersByBucket[idx];
      bucket.policy.intercepted = counters.intercepted;
      bucket.policy.allow = counters.allow;
      bucket.policy.ask = counters.ask;
      bucket.policy.deny = counters.deny;
      bucket.approvals.created = counters.created;
      bucket.approvals.decided = counters.decided;
      bucket.security.redactionEvents = counters.redactionEvents;
      bucket.security.outboundBlocked = counters.outboundBlocked;
      bucket.routing.total = counters.routedTotal;
      bucket.routing.local = counters.routeLocal;
      bucket.routing.cheap = counters.routeCheap;
      bucket.routing.premium = counters.routePremium;
      bucket.routing.estimatedCost = Number(counters.estimatedCost.toFixed(6));
      bucket.routing.estimatedSavings = Number(
        (counters.estimatedPremiumBaseline - counters.estimatedCost).toFixed(6),
      );
    }

    return {
      window: {
        from: new Date(fromMs).toISOString(),
        to: new Date(now).toISOString(),
        minutes: windowMinutes,
        bucketMinutes,
      },
      buckets,
    };
  }
}
