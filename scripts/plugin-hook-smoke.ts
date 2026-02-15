import assert from "node:assert/strict";
import beforeToolCallHandler from "../extensions/enterprise-control-plane/hooks/before-tool-call/handler.ts";
import toolResultPersistHandler from "../extensions/enterprise-control-plane/hooks/tool-result-persist/handler.ts";
import messageSendingHandler from "../extensions/enterprise-control-plane/hooks/message-sending/handler.ts";

interface Args {
  baseUrl: string;
}

function parseArgs(argv: string[]): Args {
  const baseUrlFlagIndex = argv.indexOf("--base-url");
  if (baseUrlFlagIndex !== -1 && argv[baseUrlFlagIndex + 1]) {
    return { baseUrl: argv[baseUrlFlagIndex + 1] };
  }

  return {
    baseUrl: process.env.OPENCLAW_CP_BASE_URL ?? "http://127.0.0.1:3014",
  };
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.env.OPENCLAW_CP_BASE_URL = args.baseUrl;
  process.env.OPENCLAW_CP_STRICT = process.env.OPENCLAW_CP_STRICT ?? "1";

  process.stdout.write(`[plugin-smoke] baseUrl=${args.baseUrl}\n`);

  const beforeEvent = {
    toolName: "web_fetch",
    params: { url: "https://example.com" },
    context: { source: "slack", sessionId: "smoke-1" },
  };
  const beforeResult = await beforeToolCallHandler(beforeEvent);
  assert.deepEqual(beforeResult, beforeEvent);
  process.stdout.write(`[plugin-smoke] before_tool_call OK -> ${preview(beforeResult)}\n`);

  const sanitizeEvent = {
    output: "debug token sk-abcdefghijklmnopqrstuvwxyz123456",
  };
  const sanitizeResult = (await toolResultPersistHandler(sanitizeEvent)) as Record<string, unknown>;
  assert.equal(typeof sanitizeResult.output, "string");
  assert.match(String(sanitizeResult.output), /\[REDACTED\]/);
  process.stdout.write(`[plugin-smoke] tool_result_persist OK -> ${preview(sanitizeResult)}\n`);

  const outboundAllowedEvent = {
    message: "Summary prepared. key snippet sk-abcdefghijklmnopqrstuvwxyz123456",
  };
  const outboundAllowedResult = (await messageSendingHandler(outboundAllowedEvent)) as Record<string, unknown>;
  assert.equal(typeof outboundAllowedResult.message, "string");
  assert.match(String(outboundAllowedResult.message), /\[REDACTED\]/);
  process.stdout.write(`[plugin-smoke] message_sending sanitize OK -> ${preview(outboundAllowedResult)}\n`);

  let blocked = false;
  try {
    await messageSendingHandler({ message: "my seed phrase is horse battery staple" });
  } catch (error) {
    blocked = true;
    const msg = error instanceof Error ? error.message : String(error);
    process.stdout.write(`[plugin-smoke] message_sending block OK -> ${msg}\n`);
  }

  assert.equal(blocked, true);
  process.stdout.write("[plugin-smoke] completed successfully\n");
}

run().catch((error) => {
  const msg = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[plugin-smoke] failed: ${msg}\n`);
  process.exitCode = 1;
});
