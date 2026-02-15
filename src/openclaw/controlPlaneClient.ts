import type { Decision, RouteDecision, RouteRequest, ToolCallRequest } from "../types.js";

type FetchLike = typeof fetch;

interface InterceptResponse {
  decision: Decision;
  reason: string;
  ruleId?: string;
  approvalId?: string;
  expiresAt?: string;
}

interface ApprovalResponse {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  reason: string;
  decidedBy?: string;
  decidedAt?: string;
}

interface SanitizeResponse {
  sanitized: string;
  redactions: string[];
  promptInjectionFlags: string[];
}

interface OutboundResponse {
  allowed: boolean;
  sanitized: string;
  deniedPattern?: string;
  redactions: string[];
}

export interface ControlPlaneClientOptions {
  baseUrl: string;
  apiKey?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface InterceptOutcome {
  finalDecision: "allow" | "deny";
  reason: string;
  approvalId?: string;
  ruleId?: string;
}

export class PolicyDeniedError extends Error {
  constructor(message: string, readonly approvalId?: string) {
    super(message);
    this.name = "PolicyDeniedError";
  }
}

export class ApprovalTimeoutError extends Error {
  constructor(readonly approvalId: string, timeoutMs: number) {
    super(`Approval request ${approvalId} timed out after ${timeoutMs}ms`);
    this.name = "ApprovalTimeoutError";
  }
}

export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: ControlPlaneClientOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.apiKey = options.apiKey;
    this.pollIntervalMs = options.pollIntervalMs ?? 1500;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 120000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
      "content-type": "application/json",
    };

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      const message = body && typeof body === "object" && "error" in body ? body.error : response.statusText;
      throw new Error(`Control plane request failed (${response.status}): ${String(message)}`);
    }

    return body;
  }

  async interceptToolCall(toolCall: ToolCallRequest): Promise<InterceptOutcome> {
    const response = await this.request<InterceptResponse>("/v1/tool-calls/intercept", {
      method: "POST",
      body: JSON.stringify(toolCall),
    });

    if (response.decision === "allow") {
      return {
        finalDecision: "allow",
        reason: response.reason,
        ruleId: response.ruleId,
      };
    }

    if (response.decision === "deny") {
      return {
        finalDecision: "deny",
        reason: response.reason,
        ruleId: response.ruleId,
      };
    }

    if (!response.approvalId) {
      return {
        finalDecision: "deny",
        reason: "Approval required but approval id missing",
      };
    }

    const approval = await this.waitForApproval(response.approvalId);
    if (approval.status === "approved") {
      return {
        finalDecision: "allow",
        reason: `Approved by ${approval.decidedBy ?? "human"}`,
        approvalId: response.approvalId,
        ruleId: response.ruleId,
      };
    }

    return {
      finalDecision: "deny",
      reason: approval.status === "expired" ? "Approval expired" : "Rejected by approver",
      approvalId: response.approvalId,
      ruleId: response.ruleId,
    };
  }

  async waitForApproval(approvalId: string): Promise<ApprovalResponse> {
    const started = Date.now();

    while (Date.now() - started < this.pollTimeoutMs) {
      const approval = await this.request<ApprovalResponse>(`/v1/approvals/${approvalId}`, {
        method: "GET",
      });

      if (approval.status !== "pending") {
        return approval;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, this.pollIntervalMs);
      });
    }

    throw new ApprovalTimeoutError(approvalId, this.pollTimeoutMs);
  }

  async sanitizeToolResult(output: string): Promise<SanitizeResponse> {
    return this.request<SanitizeResponse>("/v1/tool-results/sanitize", {
      method: "POST",
      body: JSON.stringify({ output }),
    });
  }

  async checkOutboundMessage(message: string): Promise<OutboundResponse> {
    return this.request<OutboundResponse>("/v1/outbound/check", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  async routeModel(request: RouteRequest): Promise<RouteDecision> {
    return this.request<RouteDecision>("/v1/model-router/route", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }
}

export interface HookHandlers {
  beforeToolCall: (event: ToolCallRequest) => Promise<void>;
  toolResultPersist: (output: string) => Promise<string>;
  messageSending: (message: string) => Promise<string>;
}

export function createHookHandlers(client: ControlPlaneClient): HookHandlers {
  return {
    async beforeToolCall(event: ToolCallRequest): Promise<void> {
      const outcome = await client.interceptToolCall(event);
      if (outcome.finalDecision === "deny") {
        throw new PolicyDeniedError(outcome.reason, outcome.approvalId);
      }
    },

    async toolResultPersist(output: string): Promise<string> {
      const result = await client.sanitizeToolResult(output);
      return result.sanitized;
    },

    async messageSending(message: string): Promise<string> {
      const result = await client.checkOutboundMessage(message);
      if (!result.allowed) {
        throw new PolicyDeniedError(`Outbound message blocked: ${result.deniedPattern ?? "policy"}`);
      }
      return result.sanitized;
    },
  };
}
