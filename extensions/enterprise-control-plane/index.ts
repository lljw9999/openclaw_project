import { registerPluginHooksFromDir } from "openclaw/plugin-sdk";

interface PluginConfig {
  baseUrl?: string;
  apiKey?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  strict?: boolean;
}

interface PluginApiLike {
  config?: Record<string, unknown>;
  registerCommand?: (command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: (ctx: Record<string, unknown>) => Promise<{ text: string }> | { text: string };
  }) => void;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function readPluginConfig(api: PluginApiLike): PluginConfig {
  const root = asObject(api.config);
  const plugins = asObject(root?.plugins);
  const entries = asObject(plugins?.entries);
  const thisPlugin = asObject(entries?.["enterprise-control-plane"]);
  const config = asObject(thisPlugin?.config);

  return {
    baseUrl: asString(config?.baseUrl),
    apiKey: asString(config?.apiKey),
    pollIntervalMs: asNumber(config?.pollIntervalMs),
    pollTimeoutMs: asNumber(config?.pollTimeoutMs),
    strict: asBoolean(config?.strict),
  };
}

function configureEnvironment(api: PluginApiLike): void {
  const cfg = readPluginConfig(api);

  process.env.OPENCLAW_CP_BASE_URL =
    cfg.baseUrl ?? process.env.CONTROL_PLANE_BASE_URL ?? process.env.OPENCLAW_CP_BASE_URL ?? "http://127.0.0.1:3000";

  const apiKey = cfg.apiKey ?? process.env.CONTROL_PLANE_API_KEY ?? process.env.OPENCLAW_CP_API_KEY;
  if (apiKey) {
    process.env.OPENCLAW_CP_API_KEY = apiKey;
  }

  const pollInterval = cfg.pollIntervalMs ?? Number(process.env.OPENCLAW_CP_POLL_INTERVAL_MS ?? "1000");
  process.env.OPENCLAW_CP_POLL_INTERVAL_MS = Number.isFinite(pollInterval) ? String(Math.max(50, pollInterval)) : "1000";

  const pollTimeout = cfg.pollTimeoutMs ?? Number(process.env.OPENCLAW_CP_POLL_TIMEOUT_MS ?? "120000");
  process.env.OPENCLAW_CP_POLL_TIMEOUT_MS = Number.isFinite(pollTimeout) ? String(Math.max(1000, pollTimeout)) : "120000";

  if (typeof cfg.strict === "boolean") {
    process.env.OPENCLAW_CP_STRICT = cfg.strict ? "1" : "0";
  } else if (!process.env.OPENCLAW_CP_STRICT) {
    process.env.OPENCLAW_CP_STRICT = "0";
  }
}

function registerDebugCommand(api: PluginApiLike): void {
  if (typeof api.registerCommand !== "function") {
    return;
  }

  api.registerCommand({
    name: "cpstatus",
    description: "Check Enterprise Control Plane health endpoint",
    requireAuth: true,
    handler: async () => {
      const baseUrl = process.env.OPENCLAW_CP_BASE_URL ?? "http://127.0.0.1:3000";
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (!response.ok) {
          return { text: `Control plane unhealthy (status ${response.status})` };
        }
        return { text: `Control plane OK at ${baseUrl}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        return { text: `Control plane unreachable: ${message}` };
      }
    },
  });
}

const plugin = {
  id: "enterprise-control-plane",
  name: "Enterprise Control Plane",
  register(api: PluginApiLike): void {
    configureEnvironment(api);
    registerDebugCommand(api);
    registerPluginHooksFromDir(api, "./hooks");
  },
};

export default plugin;
