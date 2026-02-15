import type {
  ChatCompletionsRequest,
  ProviderConfig,
  RouteDecision,
  RoutingConfig,
} from "../types.js";

type FetchLike = typeof fetch;

const RESERVED_FIELDS = new Set(["prompt", "metadata", "requestedModel"]);

function normalizeFieldName(key: string): string {
  if (key === "MAX_TOKENS") {
    return "max_tokens";
  }
  return key;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalizedPath, base).toString();
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const chunks = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .filter(Boolean);
    return chunks.join(" ").trim();
  }

  return "";
}

export function extractPromptFromChatRequest(request: ChatCompletionsRequest): string {
  if (typeof request.prompt === "string" && request.prompt.trim()) {
    return request.prompt;
  }

  if (!Array.isArray(request.messages)) {
    return "";
  }

  const text = request.messages
    .map((message) => {
      if (typeof message !== "object" || message === null || !("content" in message)) {
        return "";
      }
      return contentToText(message.content);
    })
    .filter(Boolean)
    .join(" ")
    .trim();

  return text;
}

export function buildUpstreamChatRequest(
  request: ChatCompletionsRequest,
  routedModel: string,
): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(request)) {
    if (!RESERVED_FIELDS.has(key)) {
      forwarded[normalizeFieldName(key)] = value;
    }
  }

  forwarded.model = routedModel;

  if (!Array.isArray(forwarded.messages)) {
    const prompt = extractPromptFromChatRequest(request);
    forwarded.messages = [{ role: "user", content: prompt }];
  }

  return forwarded;
}

function resolveProviderApiKey(provider: ProviderConfig): string | null {
  if (!provider.apiKeyEnv) {
    return null;
  }
  const key = process.env[provider.apiKeyEnv];
  return key && key.trim() ? key : null;
}

function parseResponseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export interface ForwardChatResult {
  status: number;
  body: unknown;
  route: RouteDecision;
  providerUrl: string;
  responseContentType: string;
}

export class TieredModelProxy {
  constructor(
    private readonly config: RoutingConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async forwardChatCompletions(
    request: ChatCompletionsRequest,
    routeDecision: RouteDecision,
  ): Promise<ForwardChatResult> {
    const provider = this.config.providers[routeDecision.tier];
    const endpointPath = provider.chatCompletionsPath ?? "/chat/completions";
    const url = joinUrl(provider.baseUrl, endpointPath);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(provider.staticHeaders ?? {}),
    };

    const apiKey = resolveProviderApiKey(provider);
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    const body = buildUpstreamChatRequest(request, routeDecision.model);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.providers.requestTimeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawBody = await response.text();
      return {
        status: response.status,
        body: parseResponseBody(rawBody),
        route: routeDecision,
        providerUrl: url,
        responseContentType: response.headers.get("content-type") ?? "application/json",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
