import type { RouteDecision, RouteRequest, RoutingConfig } from "../types.js";

export class ModelRouter {
  constructor(private readonly config: RoutingConfig) {}

  route(request: RouteRequest): RouteDecision {
    const prompt = request.prompt ?? "";
    const lower = prompt.toLowerCase();

    if (
      request.metadata?.isHeartbeat ||
      this.config.local.heartbeatKeywords.some((keyword) => lower.includes(keyword.toLowerCase())) ||
      request.metadata?.taskType === "heartbeat"
    ) {
      return {
        tier: "local",
        model: this.config.local.model,
        reason: "Heartbeat or routine status prompt routed to local model",
      };
    }

    if (
      prompt.length >= this.config.complexity.premiumPromptChars ||
      this.config.complexity.premiumKeywords.some((keyword) => lower.includes(keyword.toLowerCase()))
    ) {
      return {
        tier: "premium",
        model: request.requestedModel ?? this.config.premium.model,
        reason: "High-complexity prompt routed to premium model",
      };
    }

    if (this.config.complexity.cheapKeywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      return {
        tier: "cheap",
        model: this.config.cheap.model,
        reason: "Routine prompt routed to low-cost cloud model",
      };
    }

    return {
      tier: "cheap",
      model: this.config.cheap.model,
      reason: "Default cloud route",
    };
  }
}
