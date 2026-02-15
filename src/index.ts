import { loadConfig } from "./config.js";
import { createApp } from "./server.js";

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.server.port, config.server.host, () => {
  process.stdout.write(
    `OpenClaw Enterprise Control Plane listening on http://${config.server.host}:${config.server.port}\n`,
  );
});

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal} received, shutting down gracefully...\n`);
  server.close(() => {
    process.stdout.write("Server closed.\n");
    process.exit(0);
  });
  setTimeout(() => {
    process.stderr.write("Forced shutdown after timeout.\n");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
