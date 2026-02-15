import type { PolicyConfig } from "../types.js";

export interface SanitizationResult {
  sanitized: string;
  redactions: string[];
  promptInjectionFlags: string[];
}

export function sanitizeToolResult(input: string, config: PolicyConfig): SanitizationResult {
  let sanitized = input;
  const redactions: string[] = [];

  for (const pattern of config.redactionPatterns) {
    const regex = new RegExp(pattern, "gi");
    if (regex.test(sanitized)) {
      redactions.push(pattern);
      sanitized = sanitized.replace(regex, "[REDACTED]");
    }
  }

  const lower = sanitized.toLowerCase();
  const promptInjectionFlags = config.promptInjectionPatterns.filter((pattern) =>
    lower.includes(pattern.toLowerCase()),
  );

  return {
    sanitized,
    redactions,
    promptInjectionFlags,
  };
}

export function checkOutboundMessage(message: string, config: PolicyConfig): {
  allowed: boolean;
  sanitized: string;
  deniedPattern?: string;
  redactions: string[];
} {
  const result = sanitizeToolResult(message, config);
  const lower = result.sanitized.toLowerCase();
  const deniedPattern = config.denyOutboundPatterns.find((pattern) => lower.includes(pattern.toLowerCase()));

  if (deniedPattern) {
    return {
      allowed: false,
      sanitized: result.sanitized,
      deniedPattern,
      redactions: result.redactions,
    };
  }

  return {
    allowed: true,
    sanitized: result.sanitized,
    redactions: result.redactions,
  };
}
