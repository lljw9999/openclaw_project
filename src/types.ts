export type Decision = "allow" | "ask" | "deny";

export interface ToolCallContext {
  sessionId?: string;
  channel?: string;
  source?: string;
  userId?: string;
  message?: string;
}

export interface ToolCallRequest {
  toolName: string;
  params: Record<string, unknown>;
  context?: ToolCallContext;
}

export interface PolicyMatchCriteria {
  toolNames?: string[];
  sources?: string[];
  channels?: string[];
  commandRegex?: string[];
  pathPrefixes?: string[];
  hostAllowlist?: string[];
  hostDenylist?: string[];
}

export interface PolicyRule {
  id: string;
  description?: string;
  match: PolicyMatchCriteria;
  decision: Decision;
  reason?: string;
}

export interface PolicyConfig {
  defaultDecision: Decision;
  rules: PolicyRule[];
  redactionPatterns: string[];
  denyOutboundPatterns: string[];
  promptInjectionPatterns: string[];
}

export interface PolicyDecision {
  decision: Decision;
  ruleId?: string;
  reason: string;
}

export interface ApprovalRequest {
  id: string;
  toolCall: ToolCallRequest;
  reason: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  type:
    | "tool_call_intercepted"
    | "tool_call_decision"
    | "approval_created"
    | "approval_decided"
    | "tool_result_sanitized"
    | "outbound_message_checked"
    | "model_routed"
    | "policy_changed";
  payload: Record<string, unknown>;
}

export interface MetricsSummary {
  window: {
    from: string;
    to: string;
    minutes: number;
  };
  totals: {
    events: number;
  };
  approvals: {
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    createdInWindow: number;
    decidedInWindow: number;
  };
  policy: {
    intercepted: number;
    allow: number;
    ask: number;
    deny: number;
  };
  security: {
    redactionEvents: number;
    redactionsTotal: number;
    promptInjectionFlagsTotal: number;
    outboundBlocked: number;
  };
  routing: {
    total: number;
    byTier: {
      local: number;
      cheap: number;
      premium: number;
    };
    averagePromptLength: number;
    estimatedCost: number;
    estimatedSavings: number;
    savingsPercentage: number;
  };
}

export interface MetricsTimeseriesBucket {
  start: string;
  end: string;
  totals: {
    events: number;
  };
  policy: {
    intercepted: number;
    allow: number;
    ask: number;
    deny: number;
  };
  approvals: {
    created: number;
    decided: number;
  };
  security: {
    redactionEvents: number;
    outboundBlocked: number;
  };
  routing: {
    total: number;
    local: number;
    cheap: number;
    premium: number;
    estimatedCost: number;
    estimatedSavings: number;
  };
}

export interface MetricsTimeseries {
  window: {
    from: string;
    to: string;
    minutes: number;
    bucketMinutes: number;
  };
  buckets: MetricsTimeseriesBucket[];
}

export interface RoutingConfig {
  local: {
    model: string;
    maxPromptChars: number;
    heartbeatKeywords: string[];
    costPerMillionTokens?: number;
  };
  cheap: {
    model: string;
    costPerMillionTokens?: number;
  };
  premium: {
    model: string;
    costPerMillionTokens?: number;
  };
  providers: {
    local: ProviderConfig;
    cheap: ProviderConfig;
    premium: ProviderConfig;
    requestTimeoutMs: number;
  };
  complexity: {
    premiumPromptChars: number;
    premiumKeywords: string[];
    cheapKeywords: string[];
  };
}

export interface ProviderConfig {
  baseUrl: string;
  chatCompletionsPath?: string;
  apiKeyEnv?: string;
  staticHeaders?: Record<string, string>;
}

export interface RouteRequest {
  prompt: string;
  metadata?: {
    isHeartbeat?: boolean;
    taskType?: string;
  };
  requestedModel?: string;
}

export interface RouteDecision {
  tier: "local" | "cheap" | "premium";
  model: string;
  reason: string;
}

export interface ChatCompletionsRequest {
  model?: string;
  messages?: unknown[];
  prompt?: string;
  metadata?: {
    isHeartbeat?: boolean;
    taskType?: string;
  };
  requestedModel?: string;
  [key: string]: unknown;
}

export interface AppConfig {
  server: {
    host: string;
    port: number;
  };
  auth: {
    required: boolean;
    apiKeyEnv: string;
    headerName: string;
  };
  approvals: {
    ttlMs: number;
    persistPath: string;
  };
  audit: {
    persistPath: string;
    maxInMemoryEvents: number;
    maxFileSizeBytes?: number;
    retentionDays?: number;
  };
  policy: PolicyConfig;
  routing: RoutingConfig;
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
  };
  policyOverridesPath?: string;
}
