import type { ToolCallPayload } from "./event-shape";

type Decision = "allow" | "ask" | "deny";

interface InterceptResponse {
  decision: Decision;
  reason: string;
  ruleId?: string;
  approvalId?: string;
}

interface ApprovalResponse {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedBy?: string;
}

interface SanitizeResponse {
  sanitized: string;
}

interface OutboundResponse {
  allowed: boolean;
  sanitized: string;
  deniedPattern?: string;
}

function getBaseUrl(): string {
  return process.env.OPENCLAW_CP_BASE_URL ?? process.env.CONTROL_PLANE_BASE_URL ?? "http://127.0.0.1:3000";
}

function getApiKey(): string | undefined {
  const key = process.env.OPENCLAW_CP_API_KEY ?? process.env.CONTROL_PLANE_API_KEY;
  return key && key.trim() ? key : undefined;
}

function getPollIntervalMs(): number {
  const value = Number(process.env.OPENCLAW_CP_POLL_INTERVAL_MS ?? "1000");
  if (!Number.isFinite(value)) {
    return 1000;
  }
  return Math.max(50, value);
}

function getPollTimeoutMs(): number {
  const value = Number(process.env.OPENCLAW_CP_POLL_TIMEOUT_MS ?? "120000");
  if (!Number.isFinite(value)) {
    return 120000;
  }
  return Math.max(1000, value);
}

async function request<T>(path: string, payload?: unknown, method = "POST"): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const apiKey = getApiKey();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(`Control plane request failed (${response.status}): ${data.error ?? response.statusText}`);
  }

  return data;
}

async function waitForApproval(approvalId: string): Promise<ApprovalResponse> {
  const started = Date.now();
  const timeoutMs = getPollTimeoutMs();

  while (Date.now() - started < timeoutMs) {
    const approval = await request<ApprovalResponse>(`/v1/approvals/${approvalId}`, undefined, "GET");
    if (approval.status !== "pending") {
      return approval;
    }
    await new Promise((resolve) => setTimeout(resolve, getPollIntervalMs()));
  }

  throw new Error(`Approval ${approvalId} timed out after ${timeoutMs}ms`);
}

export async function enforceToolCallPolicy(toolCall: ToolCallPayload): Promise<void> {
  const intercept = await request<InterceptResponse>("/v1/tool-calls/intercept", toolCall);

  if (intercept.decision === "allow") {
    return;
  }

  if (intercept.decision === "deny") {
    throw new Error(`Tool call denied: ${intercept.reason}`);
  }

  if (!intercept.approvalId) {
    throw new Error("Tool call requires approval but no approval id returned");
  }

  const approval = await waitForApproval(intercept.approvalId);
  if (approval.status !== "approved") {
    throw new Error(`Tool call not approved: ${approval.status}`);
  }
}

export async function sanitizeToolOutput(output: string): Promise<string> {
  const response = await request<SanitizeResponse>("/v1/tool-results/sanitize", { output });
  return response.sanitized;
}

export async function validateOutboundMessage(message: string): Promise<string> {
  const response = await request<OutboundResponse>("/v1/outbound/check", { message });
  if (!response.allowed) {
    throw new Error(`Outbound message blocked: ${response.deniedPattern ?? "policy"}`);
  }
  return response.sanitized;
}
