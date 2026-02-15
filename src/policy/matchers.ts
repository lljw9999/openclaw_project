import path from "node:path";
import type { PolicyMatchCriteria, ToolCallRequest } from "../types.js";

function normalizePath(value: string): string {
  if (value.startsWith("~/")) {
    return path.posix.normalize(`/home/user/${value.slice(2)}`);
  }
  return path.posix.normalize(value);
}

function extractPathCandidates(params: Record<string, unknown>): string[] {
  const candidates = new Set<string>();
  const maybePath = params.path;
  if (typeof maybePath === "string") {
    candidates.add(maybePath);
  }

  const maybePaths = params.paths;
  if (Array.isArray(maybePaths)) {
    for (const p of maybePaths) {
      if (typeof p === "string") {
        candidates.add(p);
      }
    }
  }

  const maybeCommand = params.command;
  if (typeof maybeCommand === "string") {
    const pathRegex = /(?:\s|^)(~?\/?[\w./-]+\/?)(?=\s|$)/g;
    let match: RegExpExecArray | null = null;
    while ((match = pathRegex.exec(maybeCommand)) !== null) {
      const token = match[1];
      if (token.includes("/")) {
        candidates.add(token);
      }
    }
  }

  return [...candidates].map((c) => normalizePath(c));
}

function extractHost(params: Record<string, unknown>): string | null {
  const direct = params.host;
  if (typeof direct === "string") {
    return direct.toLowerCase();
  }

  const maybeUrl = params.url;
  if (typeof maybeUrl === "string") {
    try {
      return new URL(maybeUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

export function matchesCriteria(criteria: PolicyMatchCriteria, call: ToolCallRequest): boolean {
  if (criteria.toolNames?.length && !criteria.toolNames.includes(call.toolName)) {
    return false;
  }

  if (criteria.sources?.length) {
    const source = call.context?.source ?? "";
    if (!criteria.sources.includes(source)) {
      return false;
    }
  }

  if (criteria.channels?.length) {
    const channel = call.context?.channel ?? "";
    if (!criteria.channels.includes(channel)) {
      return false;
    }
  }

  if (criteria.commandRegex?.length) {
    const command = String(call.params.command ?? call.context?.message ?? "");
    const matched = criteria.commandRegex.some((pattern) => {
      const regex = new RegExp(pattern, "i");
      return regex.test(command);
    });
    if (!matched) {
      return false;
    }
  }

  if (criteria.pathPrefixes?.length) {
    const normalizedPrefixes = criteria.pathPrefixes.map((prefix) => normalizePath(prefix));
    const candidates = extractPathCandidates(call.params);
    const hasMatch = candidates.some((candidate) =>
      normalizedPrefixes.some((prefix) => candidate.startsWith(prefix)),
    );
    if (!hasMatch) {
      return false;
    }
  }

  const host = extractHost(call.params);
  if (criteria.hostAllowlist?.length) {
    if (!host || !criteria.hostAllowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      return false;
    }
  }

  if (criteria.hostDenylist?.length) {
    if (host && criteria.hostDenylist.some((denied) => host === denied || host.endsWith(`.${denied}`))) {
      return true;
    }
    return false;
  }

  return true;
}
