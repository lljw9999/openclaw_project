import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveConfigPath(): string {
  const explicit = process.env.CONFIG_PATH;
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }
  return path.resolve(__dirname, "../config/default.json");
}

export function loadConfig(): AppConfig {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AppConfig>;
  if (!parsed.server?.port || !parsed.policy || !parsed.routing) {
    throw new Error(`Invalid config at ${configPath}`);
  }

  const auditRaw = parsed.audit ?? ({} as Partial<AppConfig["audit"]>);

  const normalized: AppConfig = {
    server: parsed.server,
    auth: {
      required: parsed.auth?.required ?? false,
      apiKeyEnv: parsed.auth?.apiKeyEnv ?? "CONTROL_PLANE_API_KEY",
      headerName: parsed.auth?.headerName ?? "x-api-key",
    },
    approvals: parsed.approvals ?? { ttlMs: 900000, persistPath: "data/approvals.json" },
    audit: {
      persistPath: auditRaw.persistPath ?? "data/audit.log",
      maxInMemoryEvents: auditRaw.maxInMemoryEvents ?? 5000,
      maxFileSizeBytes: auditRaw.maxFileSizeBytes,
      retentionDays: auditRaw.retentionDays,
    },
    policy: parsed.policy,
    routing: parsed.routing,
    rateLimit: parsed.rateLimit,
    policyOverridesPath: parsed.policyOverridesPath ?? "data/policy-overrides.json",
  };

  if (!normalized.approvals.persistPath) {
    normalized.approvals.persistPath = "data/approvals.json";
  }

  return normalized;
}
