export interface ToolCallContext {
  sessionId?: string;
  channel?: string;
  source?: string;
  userId?: string;
  message?: string;
}

export interface ToolCallPayload {
  toolName: string;
  params: Record<string, unknown>;
  context?: ToolCallContext;
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

export function isStrictMode(): boolean {
  return process.env.OPENCLAW_CP_STRICT === "1";
}

export function extractToolCall(event: unknown, strict = isStrictMode()): ToolCallPayload | null {
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

export function extractStringField(
  event: unknown,
  candidates: string[],
  strict = isStrictMode(),
  hookName = "hook",
): string | null {
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

export function assignStringField(event: unknown, candidates: string[], value: string): unknown {
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
