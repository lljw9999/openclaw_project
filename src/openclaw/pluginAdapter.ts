import type { ToolCallRequest } from "../types.js";
import {
  ControlPlaneClient,
  PolicyDeniedError,
  type InterceptOutcome,
} from "./controlPlaneClient.js";

export interface ControlPlaneHookClient {
  interceptToolCall: (toolCall: ToolCallRequest) => Promise<InterceptOutcome>;
  sanitizeToolResult: (output: string) => Promise<{ sanitized: string }>;
  checkOutboundMessage: (message: string) => Promise<{
    allowed: boolean;
    sanitized: string;
    deniedPattern?: string;
  }>;
}

export interface PluginAdapterOptions {
  strict?: boolean;
}

export interface OpenClawPluginLike {
  name: string;
  version: string;
  hooks: {
    before_tool_call: (event: unknown) => Promise<unknown>;
    tool_result_persist: (event: unknown) => Promise<unknown>;
    message_sending: (event: unknown) => Promise<unknown>;
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function pickString(source: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }

  return undefined;
}

function pickRecord(source: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return null;
}

function extractToolCall(event: unknown, strict: boolean): ToolCallRequest | null {
  const root = asObject(event);
  const tool = pickRecord(root, ["tool", "call"]);

  const toolName =
    pickString(root, ["toolName", "tool_name", "name"]) ?? pickString(tool, ["name", "toolName", "tool_name"]);

  const params =
    pickRecord(root, ["params", "arguments", "args", "input"]) ??
    pickRecord(tool, ["params", "arguments", "args", "input"]) ??
    {};

  if (!toolName) {
    if (strict) {
      throw new Error("before_tool_call event missing tool name");
    }
    return null;
  }

  const contextSource = pickRecord(root, ["context", "meta"]);

  return {
    toolName,
    params,
    context: {
      sessionId:
        pickString(root, ["sessionId", "session_id"]) ??
        pickString(contextSource, ["sessionId", "session_id"]) ??
        undefined,
      channel: pickString(root, ["channel"]) ?? pickString(contextSource, ["channel"]) ?? undefined,
      source: pickString(root, ["source"]) ?? pickString(contextSource, ["source"]) ?? undefined,
      userId:
        pickString(root, ["userId", "user_id", "actorId"]) ??
        pickString(contextSource, ["userId", "user_id", "actorId"]) ??
        undefined,
      message:
        pickString(root, ["message", "text", "prompt"]) ??
        pickString(contextSource, ["message", "text", "prompt"]) ??
        undefined,
    },
  };
}

function extractStringField(event: unknown, candidates: string[], strict: boolean, hookName: string): string | null {
  if (typeof event === "string") {
    return event;
  }

  const root = asObject(event);
  const value = pickString(root, candidates);
  if (value) {
    return value;
  }

  if (strict) {
    throw new Error(`${hookName} event missing required string field: ${candidates.join(", ")}`);
  }

  return null;
}

function assignStringField(event: unknown, candidates: string[], value: string): unknown {
  if (typeof event === "string") {
    return value;
  }

  const root = asObject(event);
  if (!root) {
    return event;
  }

  for (const key of candidates) {
    if (key in root && typeof root[key] === "string") {
      root[key] = value;
      return root;
    }
  }

  root[candidates[0]] = value;
  return root;
}

export function createOpenClawPlugin(
  client: ControlPlaneHookClient,
  options: PluginAdapterOptions = {},
): OpenClawPluginLike {
  const strict = options.strict ?? false;

  return {
    name: "openclaw-enterprise-control-plane",
    version: "0.1.0",
    hooks: {
      async before_tool_call(event: unknown): Promise<unknown> {
        const toolCall = extractToolCall(event, strict);
        if (!toolCall) {
          return event;
        }

        const outcome = await client.interceptToolCall(toolCall);
        if (outcome.finalDecision === "deny") {
          throw new PolicyDeniedError(outcome.reason, outcome.approvalId);
        }

        return event;
      },

      async tool_result_persist(event: unknown): Promise<unknown> {
        const output = extractStringField(event, ["output", "result", "text"], strict, "tool_result_persist");
        if (output === null) {
          return event;
        }

        const sanitized = await client.sanitizeToolResult(output);
        return assignStringField(event, ["output", "result", "text"], sanitized.sanitized);
      },

      async message_sending(event: unknown): Promise<unknown> {
        const message = extractStringField(event, ["message", "text", "content"], strict, "message_sending");
        if (message === null) {
          return event;
        }

        const checked = await client.checkOutboundMessage(message);
        if (!checked.allowed) {
          throw new PolicyDeniedError(`Outbound message blocked: ${checked.deniedPattern ?? "policy"}`);
        }

        return assignStringField(event, ["message", "text", "content"], checked.sanitized);
      },
    },
  };
}

export function createOpenClawPluginFromConfig(options: {
  baseUrl: string;
  apiKey?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  strict?: boolean;
}): OpenClawPluginLike {
  const client = new ControlPlaneClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
  });

  return createOpenClawPlugin(client, {
    strict: options.strict,
  });
}
