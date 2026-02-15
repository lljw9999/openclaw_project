import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AppConfig,
  AuditEvent,
  ChatCompletionsRequest,
  Decision,
  PolicyRule,
  RouteRequest,
  RoutingConfig,
  ToolCallRequest,
} from "./types.js";
import { PolicyEngine } from "./policy/engine.js";
import { ApprovalStore } from "./approvals/store.js";
import { AuditStore } from "./audit/store.js";
import { ModelRouter } from "./routing/modelRouter.js";
import { extractPromptFromChatRequest, TieredModelProxy } from "./routing/proxy.js";
import { checkOutboundMessage, sanitizeToolResult } from "./security/sanitizer.js";
import { createRateLimiter } from "./middleware/rateLimit.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseToolCall(body: unknown): ToolCallRequest {
  if (!isObject(body)) {
    throw new Error("Request body must be an object");
  }
  if (typeof body.toolName !== "string" || !body.toolName) {
    throw new Error("toolName is required");
  }
  if (!isObject(body.params)) {
    throw new Error("params must be an object");
  }

  const context = isObject(body.context) ? body.context : undefined;

  return {
    toolName: body.toolName,
    params: body.params,
    context: context
      ? {
          sessionId: typeof context.sessionId === "string" ? context.sessionId : undefined,
          channel: typeof context.channel === "string" ? context.channel : undefined,
          source: typeof context.source === "string" ? context.source : undefined,
          userId: typeof context.userId === "string" ? context.userId : undefined,
          message: typeof context.message === "string" ? context.message : undefined,
        }
      : undefined,
  };
}

function parseRouteRequest(body: unknown): RouteRequest {
  if (!isObject(body) || typeof body.prompt !== "string") {
    throw new Error("prompt is required");
  }

  const metadata = isObject(body.metadata)
    ? {
        isHeartbeat: Boolean(body.metadata.isHeartbeat),
        taskType: typeof body.metadata.taskType === "string" ? body.metadata.taskType : undefined,
      }
    : undefined;

  return {
    prompt: body.prompt,
    metadata,
    requestedModel: typeof body.requestedModel === "string" ? body.requestedModel : undefined,
  };
}

function parseChatCompletionsRequest(body: unknown): ChatCompletionsRequest {
  if (!isObject(body)) {
    throw new Error("Chat completion request body must be an object");
  }
  return body as ChatCompletionsRequest;
}

function secureEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function computeCostPayload(
  promptLength: number,
  tier: "local" | "cheap" | "premium",
  routing: RoutingConfig,
): { estimatedTokens: number; tierCostPerMillion: number; premiumCostPerMillion: number } {
  const estimatedTokens = Math.ceil(promptLength / 4);
  const tierCostPerMillion = routing[tier]?.costPerMillionTokens ?? 0;
  const premiumCostPerMillion = routing.premium?.costPerMillionTokens ?? 0;
  return { estimatedTokens, tierCostPerMillion, premiumCostPerMillion };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(config: AppConfig) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization");
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const policyEngine = new PolicyEngine(config.policy, config.policyOverridesPath);
  const approvals = new ApprovalStore(config.approvals.ttlMs, config.approvals.persistPath);
  const audit = new AuditStore(config.audit.persistPath, config.audit.maxInMemoryEvents, {
    maxFileSizeBytes: config.audit.maxFileSizeBytes,
    retentionDays: config.audit.retentionDays,
  });
  const router = new ModelRouter(config.routing);
  const proxy = new TieredModelProxy(config.routing);

  app.use("/ui", express.static(path.resolve(__dirname, "../public")));

  app.use("/v1", (req, res, next) => {
    if (!config.auth.required) {
      next();
      return;
    }

    const expectedApiKey = process.env[config.auth.apiKeyEnv];
    if (!expectedApiKey) {
      res.status(500).json({ error: `Missing required API key env: ${config.auth.apiKeyEnv}` });
      return;
    }

    const provided = req.header(config.auth.headerName) ?? "";
    if (!provided || !secureEquals(provided, expectedApiKey)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    next();
  });

  if (config.rateLimit) {
    app.use("/v1", createRateLimiter(config.rateLimit.windowMs, config.rateLimit.maxRequests));
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/", (_req, res) => {
    res.redirect("/ui/approvals.html");
  });

  app.post("/v1/tool-calls/intercept", (req, res) => {
    try {
      const call = parseToolCall(req.body);
      audit.append("tool_call_intercepted", { toolName: call.toolName, context: call.context ?? null });

      const decision = policyEngine.decide(call);
      if (decision.decision === "ask") {
        audit.append("tool_call_decision", {
          toolName: call.toolName,
          decision: "ask",
          ruleId: decision.ruleId ?? null,
          reason: decision.reason,
        });

        const approval = approvals.create(call, decision.reason);
        audit.append("approval_created", {
          approvalId: approval.id,
          toolName: call.toolName,
          ruleId: decision.ruleId ?? null,
          reason: decision.reason,
        });

        return res.json({
          decision: "ask",
          approvalId: approval.id,
          reason: decision.reason,
          expiresAt: approval.expiresAt,
          ruleId: decision.ruleId,
        });
      }

      audit.append("tool_call_decision", {
        toolName: call.toolName,
        decision: decision.decision,
        ruleId: decision.ruleId ?? null,
        reason: decision.reason,
      });

      return res.json(decision);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return res.status(400).json({ error: message });
    }
  });

  app.get("/v1/approvals", (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !["pending", "approved", "rejected", "expired"].includes(status)) {
      return res.status(400).json({ error: "invalid status" });
    }
    return res.json({ items: approvals.list(status as never) });
  });

  app.get("/v1/approvals/:id", (req, res) => {
    const approval = approvals.get(req.params.id);
    if (!approval) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json(approval);
  });

  app.post("/v1/approvals/:id/decision", (req, res) => {
    const decision = isObject(req.body) ? req.body.decision : undefined;
    const actor = isObject(req.body) ? req.body.actor : undefined;
    const note = isObject(req.body) && typeof req.body.note === "string" ? req.body.note : undefined;

    if ((decision !== "approved" && decision !== "rejected") || typeof actor !== "string" || !actor) {
      return res.status(400).json({ error: "decision and actor are required" });
    }

    const approval = approvals.decide(req.params.id, {
      decision,
      actor,
      note,
    });

    if (!approval) {
      return res.status(404).json({ error: "not found" });
    }

    audit.append("approval_decided", {
      approvalId: approval.id,
      decision: approval.status,
      actor,
      note: note ?? null,
    });

    return res.json(approval);
  });

  app.post("/v1/tool-results/sanitize", (req, res) => {
    const output = isObject(req.body) ? req.body.output : undefined;
    if (typeof output !== "string") {
      return res.status(400).json({ error: "output is required" });
    }

    const result = sanitizeToolResult(output, config.policy);
    audit.append("tool_result_sanitized", {
      redactions: result.redactions,
      promptInjectionFlags: result.promptInjectionFlags,
      outputLength: output.length,
    });
    return res.json(result);
  });

  app.post("/v1/outbound/check", (req, res) => {
    const message = isObject(req.body) ? req.body.message : undefined;
    if (typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const result = checkOutboundMessage(message, config.policy);
    audit.append("outbound_message_checked", {
      allowed: result.allowed,
      deniedPattern: result.deniedPattern ?? null,
      redactions: result.redactions,
      messageLength: message.length,
    });

    return res.json(result);
  });

  app.post("/v1/model-router/route", (req, res) => {
    try {
      const routeRequest = parseRouteRequest(req.body);
      const routeDecision = router.route(routeRequest);

      const costInfo = computeCostPayload(routeRequest.prompt.length, routeDecision.tier, config.routing);
      audit.append("model_routed", {
        tier: routeDecision.tier,
        model: routeDecision.model,
        reason: routeDecision.reason,
        promptLength: routeRequest.prompt.length,
        ...costInfo,
      });

      return res.json(routeDecision);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid route request";
      return res.status(400).json({ error: message });
    }
  });

  app.post("/v1/chat/completions", async (req, res) => {
    try {
      const payload = parseChatCompletionsRequest(req.body);
      const prompt = extractPromptFromChatRequest(payload);
      if (!prompt) {
        return res.status(400).json({ error: "prompt or messages content is required" });
      }

      const routeDecision = router.route({
        prompt,
        metadata: payload.metadata,
        requestedModel: typeof payload.requestedModel === "string" ? payload.requestedModel : undefined,
      });

      const forwarded = await proxy.forwardChatCompletions(payload, routeDecision);
      const chatCostInfo = computeCostPayload(prompt.length, forwarded.route.tier, config.routing);
      audit.append("model_routed", {
        endpoint: "/v1/chat/completions",
        tier: forwarded.route.tier,
        model: forwarded.route.model,
        reason: forwarded.route.reason,
        providerUrl: forwarded.providerUrl,
        promptLength: prompt.length,
        ...chatCostInfo,
      });

      res.setHeader("x-route-tier", forwarded.route.tier);
      res.setHeader("x-route-model", forwarded.route.model);
      res.setHeader("x-route-reason", forwarded.route.reason);
      return res.status(forwarded.status).json(forwarded.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy forwarding failed";
      return res.status(502).json({ error: message });
    }
  });

  app.get("/v1/policies", (_req, res) => {
    return res.json({ items: policyEngine.getRules() });
  });

  app.post("/v1/policies", (req, res) => {
    try {
      const body = req.body;
      if (!isObject(body) || typeof body.id !== "string" || !body.id || !isObject(body.match)) {
        return res.status(400).json({ error: "id, match, and decision are required" });
      }
      const decision = body.decision;
      if (decision !== "allow" && decision !== "ask" && decision !== "deny") {
        return res.status(400).json({ error: "decision must be allow, ask, or deny" });
      }
      const rule: PolicyRule = {
        id: body.id as string,
        description: typeof body.description === "string" ? body.description : undefined,
        match: body.match as PolicyRule["match"],
        decision: decision as Decision,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      };
      policyEngine.addRule(rule);
      audit.append("policy_changed", { action: "create", ruleId: rule.id });
      return res.status(201).json(rule);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      if (message.includes("already exists")) {
        return res.status(400).json({ error: message });
      }
      return res.status(400).json({ error: message });
    }
  });

  app.put("/v1/policies/:id", (req, res) => {
    try {
      const updates = req.body;
      if (!isObject(updates)) {
        return res.status(400).json({ error: "Request body must be an object" });
      }
      const updated = policyEngine.updateRule(req.params.id, updates);
      audit.append("policy_changed", { action: "update", ruleId: req.params.id });
      return res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      if (message.includes("not found")) {
        return res.status(404).json({ error: message });
      }
      return res.status(400).json({ error: message });
    }
  });

  app.delete("/v1/policies/:id", (req, res) => {
    try {
      policyEngine.deleteRule(req.params.id);
      audit.append("policy_changed", { action: "delete", ruleId: req.params.id });
      return res.json({ deleted: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      if (message.includes("not found")) {
        return res.status(404).json({ error: message });
      }
      return res.status(400).json({ error: message });
    }
  });

  app.get("/v1/audit/events", (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;

    if (type) {
      const allowedTypes: AuditEvent["type"][] = [
        "tool_call_intercepted",
        "tool_call_decision",
        "approval_created",
        "approval_decided",
        "tool_result_sanitized",
        "outbound_message_checked",
        "model_routed",
        "policy_changed",
      ];
      if (!allowedTypes.includes(type as AuditEvent["type"])) {
        return res.status(400).json({ error: "invalid audit type" });
      }
    }

    return res.json({
      items: audit.list({
        type: type as AuditEvent["type"] | undefined,
        limit,
      }),
    });
  });

  app.get("/v1/metrics/summary", (req, res) => {
    const windowMinutesRaw = typeof req.query.windowMinutes === "string" ? req.query.windowMinutes : undefined;
    const windowMinutes = windowMinutesRaw ? Number.parseInt(windowMinutesRaw, 10) : undefined;

    if (windowMinutesRaw && Number.isNaN(windowMinutes as number)) {
      return res.status(400).json({ error: "windowMinutes must be an integer" });
    }

    const summary = audit.summary({
      windowMinutes,
    });

    const statuses = approvals.list().reduce(
      (acc, item) => {
        acc[item.status] += 1;
        return acc;
      },
      {
        pending: 0,
        approved: 0,
        rejected: 0,
        expired: 0,
      },
    );

    summary.approvals.pending = statuses.pending;
    summary.approvals.approved = statuses.approved;
    summary.approvals.rejected = statuses.rejected;
    summary.approvals.expired = statuses.expired;

    return res.json(summary);
  });

  app.get("/v1/metrics/timeseries", (req, res) => {
    const windowMinutesRaw = typeof req.query.windowMinutes === "string" ? req.query.windowMinutes : undefined;
    const bucketMinutesRaw = typeof req.query.bucketMinutes === "string" ? req.query.bucketMinutes : undefined;
    const windowMinutes = windowMinutesRaw ? Number.parseInt(windowMinutesRaw, 10) : undefined;
    const bucketMinutes = bucketMinutesRaw ? Number.parseInt(bucketMinutesRaw, 10) : undefined;

    if (windowMinutesRaw && Number.isNaN(windowMinutes as number)) {
      return res.status(400).json({ error: "windowMinutes must be an integer" });
    }

    if (bucketMinutesRaw && Number.isNaN(bucketMinutes as number)) {
      return res.status(400).json({ error: "bucketMinutes must be an integer" });
    }

    return res.json(
      audit.timeseries({
        windowMinutes,
        bucketMinutes,
      }),
    );
  });

  return app;
}
