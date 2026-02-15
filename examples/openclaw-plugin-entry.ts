import { createOpenClawPluginFromConfig } from "../src/openclaw/pluginAdapter.js";

const plugin = createOpenClawPluginFromConfig({
  baseUrl: process.env.CONTROL_PLANE_BASE_URL ?? "http://127.0.0.1:3000",
  apiKey: process.env.CONTROL_PLANE_API_KEY,
  pollIntervalMs: 1000,
  pollTimeoutMs: 120000,
  strict: false,
});

export default plugin;
