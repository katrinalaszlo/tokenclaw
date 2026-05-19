import type { KeyBudget, BudgetPeriod } from "../config.js";

export type Provider = "anthropic" | "openai";

export interface ParsedUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function detectProvider(path: string): Provider {
  if (path.startsWith("/v1/messages")) return "anthropic";
  return "openai";
}

export const UPSTREAM_HOSTS: Record<Provider, string> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
};

export function extractApiKey(
  headers: Record<string, string | string[] | undefined>,
  provider: Provider,
): string | null {
  if (provider === "anthropic") {
    const key = headers["x-api-key"];
    return typeof key === "string" ? key : null;
  }
  // OpenAI: Authorization: Bearer sk-...
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

export function truncateKey(key: string): string {
  return key.slice(0, 20);
}

// Longest-prefix-wins: if user registers "sk-ant-proj" and "sk-ant-proj-research",
// a key starting with "sk-ant-proj-research-abc" matches the longer prefix.
export function matchKeyPrefix(
  fullKey: string,
  budgets: Record<string, KeyBudget>,
): { prefix: string; budget: KeyBudget } | null {
  const prefixes = Object.keys(budgets).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (fullKey.startsWith(prefix)) {
      return { prefix, budget: budgets[prefix]! };
    }
  }
  return null;
}

export function getBudgetWindowStart(period: BudgetPeriod): string {
  const now = new Date();
  switch (period) {
    case "day": {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      return d.toISOString();
    }
    case "week": {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const dayOfWeek = d.getUTCDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      d.setUTCDate(d.getUTCDate() - mondayOffset);
      return d.toISOString();
    }
    case "month": {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return d.toISOString();
    }
  }
}

// ── Anthropic parsers ──

export function parseAnthropicSSE(buffer: string): ParsedUsage {
  const result: ParsedUsage = {
    model: "unknown",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  const events = buffer.split("\n\n");
  for (const event of events) {
    const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataLine.slice(6));
    } catch {
      continue;
    }

    if (parsed.type === "message_start") {
      const msg = parsed.message as Record<string, unknown> | undefined;
      if (msg?.model) result.model = String(msg.model);
      const usage = msg?.usage as Record<string, number> | undefined;
      if (usage) {
        result.inputTokens = usage.input_tokens ?? 0;
        result.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
        result.cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
      }
    }

    if (parsed.type === "message_delta") {
      const usage = parsed.usage as Record<string, number> | undefined;
      if (usage?.output_tokens) {
        result.outputTokens = usage.output_tokens;
      }
    }
  }

  return result;
}

export function parseAnthropicJson(body: string): ParsedUsage {
  const result: ParsedUsage = {
    model: "unknown",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.model) result.model = String(parsed.model);
    const usage = parsed.usage as Record<string, number> | undefined;
    if (usage) {
      result.inputTokens = usage.input_tokens ?? 0;
      result.outputTokens = usage.output_tokens ?? 0;
      result.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      result.cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
    }
  } catch {
    // fail-open on counting
  }

  return result;
}

// ── OpenAI parsers ──

export function parseOpenAISSE(buffer: string): ParsedUsage {
  const result: ParsedUsage = {
    model: "unknown",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  const events = buffer.split("\n\n");
  for (const event of events) {
    const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    const raw = dataLine.slice(6).trim();
    if (raw === "[DONE]") continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    if (parsed.model) result.model = String(parsed.model);

    // OpenAI includes usage in the final chunk (when stream_options.include_usage is true)
    const usage = parsed.usage as Record<string, unknown> | undefined;
    if (usage) {
      result.inputTokens = Number(usage.prompt_tokens) || 0;
      result.outputTokens = Number(usage.completion_tokens) || 0;
      const details = usage.prompt_tokens_details as
        | Record<string, number>
        | undefined;
      if (details?.cached_tokens) {
        result.cacheReadTokens = details.cached_tokens;
      }
    }
  }

  return result;
}

export function parseOpenAIJson(body: string): ParsedUsage {
  const result: ParsedUsage = {
    model: "unknown",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.model) result.model = String(parsed.model);
    const usage = parsed.usage as Record<string, unknown> | undefined;
    if (usage) {
      result.inputTokens = Number(usage.prompt_tokens) || 0;
      result.outputTokens = Number(usage.completion_tokens) || 0;
      const details = usage.prompt_tokens_details as
        | Record<string, number>
        | undefined;
      if (details?.cached_tokens) {
        result.cacheReadTokens = details.cached_tokens;
      }
    }
  } catch {
    // fail-open on counting
  }

  return result;
}

// ── Dispatch by provider ──

export function parseSSEUsage(buffer: string, provider: Provider): ParsedUsage {
  return provider === "anthropic"
    ? parseAnthropicSSE(buffer)
    : parseOpenAISSE(buffer);
}

export function parseJsonUsage(body: string, provider: Provider): ParsedUsage {
  return provider === "anthropic"
    ? parseAnthropicJson(body)
    : parseOpenAIJson(body);
}

// ── OpenAI stream_options injection ──
// OpenAI only includes usage in SSE if the request has stream_options.include_usage = true.
// We inject it so we can always count tokens.
export function injectStreamUsage(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.stream === true) {
      parsed.stream_options = { include_usage: true };
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON or not parseable — pass through
  }
  return body;
}
