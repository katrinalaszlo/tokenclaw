import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSSEUsage,
  parseJsonUsage,
  matchKeyPrefix,
  truncateKey,
  getBudgetWindowStart,
  detectProvider,
  extractApiKey,
  injectStreamUsage,
} from "../src/proxy/parse.js";
import { parseBudgetString } from "../src/config.js";
import { estimateCost } from "../src/pricing.js";

// ── Provider detection ──

describe("detectProvider", () => {
  it("detects Anthropic from /v1/messages", () => {
    assert.equal(detectProvider("/v1/messages"), "anthropic");
  });

  it("detects OpenAI from /v1/chat/completions", () => {
    assert.equal(detectProvider("/v1/chat/completions"), "openai");
  });

  it("defaults to OpenAI for unknown paths", () => {
    assert.equal(detectProvider("/v1/something-else"), "openai");
  });
});

// ── API key extraction ──

describe("extractApiKey", () => {
  it("extracts Anthropic key from x-api-key", () => {
    const key = extractApiKey({ "x-api-key": "sk-ant-test123" }, "anthropic");
    assert.equal(key, "sk-ant-test123");
  });

  it("extracts OpenAI key from Authorization Bearer", () => {
    const key = extractApiKey(
      { authorization: "Bearer sk-proj-abc123" },
      "openai",
    );
    assert.equal(key, "sk-proj-abc123");
  });

  it("returns null for missing Anthropic key", () => {
    assert.equal(extractApiKey({}, "anthropic"), null);
  });

  it("returns null for missing OpenAI key", () => {
    assert.equal(extractApiKey({}, "openai"), null);
  });

  it("returns null for malformed Authorization header", () => {
    assert.equal(
      extractApiKey({ authorization: "Token sk-abc" }, "openai"),
      null,
    );
  });
});

// ── Anthropic SSE ──

describe("parseSSEUsage (anthropic)", () => {
  it("parses a realistic streaming response", () => {
    const fixture = [
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_01XFDUDYJgAACzvnptvVoYEL","type":"message","role":"assistant","content":[],"model":"claude-haiku-4-5-20251001","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":25,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}}`,
      ``,
      `event: content_block_start`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
      ``,
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":12}}`,
      ``,
      `event: message_stop`,
      `data: {"type":"message_stop"}`,
      ``,
    ].join("\n");

    const usage = parseSSEUsage(fixture, "anthropic");
    assert.equal(usage.model, "claude-haiku-4-5-20251001");
    assert.equal(usage.inputTokens, 25);
    assert.equal(usage.outputTokens, 12);
    assert.equal(usage.cacheReadTokens, 0);
  });

  it("parses response with cache tokens", () => {
    const fixture = [
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_cache","type":"message","role":"assistant","model":"claude-sonnet-4-6","usage":{"input_tokens":100,"cache_creation_input_tokens":5000,"cache_read_input_tokens":20000,"output_tokens":0}}}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":350}}`,
      ``,
    ].join("\n");

    const usage = parseSSEUsage(fixture, "anthropic");
    assert.equal(usage.model, "claude-sonnet-4-6");
    assert.equal(usage.inputTokens, 100);
    assert.equal(usage.outputTokens, 350);
    assert.equal(usage.cacheReadTokens, 20000);
    assert.equal(usage.cacheCreationTokens, 5000);
  });

  it("returns zeros on empty buffer", () => {
    const usage = parseSSEUsage("", "anthropic");
    assert.equal(usage.model, "unknown");
    assert.equal(usage.inputTokens, 0);
  });

  it("handles malformed JSON gracefully", () => {
    const fixture = `event: message_start\ndata: {invalid json}\n\n`;
    const usage = parseSSEUsage(fixture, "anthropic");
    assert.equal(usage.model, "unknown");
  });
});

// ── OpenAI SSE ──

describe("parseSSEUsage (openai)", () => {
  it("parses OpenAI streaming response with usage", () => {
    const fixture = [
      `data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
      ``,
      `data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hi!"},"finish_reason":null}]}`,
      ``,
      `data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":3,"total_tokens":18,"prompt_tokens_details":{"cached_tokens":0}}}`,
      ``,
      `data: [DONE]`,
      ``,
    ].join("\n");

    const usage = parseSSEUsage(fixture, "openai");
    assert.equal(usage.model, "gpt-4o");
    assert.equal(usage.inputTokens, 15);
    assert.equal(usage.outputTokens, 3);
    assert.equal(usage.cacheReadTokens, 0);
  });

  it("parses OpenAI response with cached tokens (subtracts from prompt_tokens)", () => {
    const fixture = [
      `data: {"id":"chatcmpl-xyz","model":"gpt-4.1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":80}}}`,
      ``,
      `data: [DONE]`,
      ``,
    ].join("\n");

    const usage = parseSSEUsage(fixture, "openai");
    assert.equal(usage.model, "gpt-4.1");
    // prompt_tokens=100 includes cached_tokens=80, so inputTokens = 100 - 80
    assert.equal(usage.inputTokens, 20);
    assert.equal(usage.outputTokens, 50);
    assert.equal(usage.cacheReadTokens, 80);
  });

  it("handles [DONE] marker", () => {
    const fixture = `data: [DONE]\n\n`;
    const usage = parseSSEUsage(fixture, "openai");
    assert.equal(usage.inputTokens, 0);
  });
});

// ── OpenAI JSON ──

describe("parseJsonUsage (openai)", () => {
  it("parses non-streaming OpenAI response", () => {
    const body = JSON.stringify({
      id: "chatcmpl-abc",
      model: "gpt-4o-mini",
      choices: [{ message: { content: "Hello!" } }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 5,
        total_tokens: 25,
      },
    });

    const usage = parseJsonUsage(body, "openai");
    assert.equal(usage.model, "gpt-4o-mini");
    assert.equal(usage.inputTokens, 20);
    assert.equal(usage.outputTokens, 5);
  });

  it("subtracts cached_tokens from prompt_tokens in JSON response", () => {
    const body = JSON.stringify({
      id: "chatcmpl-cache",
      model: "gpt-4o",
      choices: [{ message: { content: "Hi" } }],
      usage: {
        prompt_tokens: 1136,
        completion_tokens: 200,
        total_tokens: 1336,
        prompt_tokens_details: { cached_tokens: 1024 },
      },
    });

    const usage = parseJsonUsage(body, "openai");
    assert.equal(usage.inputTokens, 112); // 1136 - 1024
    assert.equal(usage.outputTokens, 200);
    assert.equal(usage.cacheReadTokens, 1024);
  });
});

// ── Anthropic JSON ──

describe("parseJsonUsage (anthropic)", () => {
  it("parses non-streaming Anthropic response", () => {
    const body = JSON.stringify({
      id: "msg_test",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 50,
        output_tokens: 8,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
      },
    });

    const usage = parseJsonUsage(body, "anthropic");
    assert.equal(usage.model, "claude-sonnet-4-6");
    assert.equal(usage.inputTokens, 50);
    assert.equal(usage.outputTokens, 8);
    assert.equal(usage.cacheReadTokens, 1000);
  });

  it("returns zeros on invalid JSON", () => {
    const usage = parseJsonUsage("not json", "anthropic");
    assert.equal(usage.inputTokens, 0);
  });
});

// ── Stream options injection ──

describe("injectStreamUsage", () => {
  it("injects stream_options for streaming requests", () => {
    const body = JSON.stringify({
      model: "gpt-4o",
      stream: true,
      messages: [],
    });
    const result = JSON.parse(injectStreamUsage(body));
    assert.deepEqual(result.stream_options, { include_usage: true });
    assert.equal(result.stream, true);
  });

  it("leaves non-streaming requests unchanged", () => {
    const body = JSON.stringify({ model: "gpt-4o", messages: [] });
    const result = JSON.parse(injectStreamUsage(body));
    assert.equal(result.stream_options, undefined);
  });

  it("leaves non-JSON unchanged", () => {
    assert.equal(injectStreamUsage("not json"), "not json");
  });
});

// ── Key matching ──

describe("matchKeyPrefix", () => {
  const budgets = {
    "sk-ant-proj": { budget: 50, period: "day" as const },
    "sk-ant-proj-research": { budget: 10, period: "day" as const },
    "sk-proj-deploy": { budget: 100, period: "week" as const },
  };

  it("matches exact prefix", () => {
    const result = matchKeyPrefix("sk-proj-deploy-key123", budgets);
    assert.equal(result?.prefix, "sk-proj-deploy");
    assert.equal(result?.budget.budget, 100);
  });

  it("longest-prefix-wins", () => {
    const result = matchKeyPrefix("sk-ant-proj-research-abc123", budgets);
    assert.equal(result?.prefix, "sk-ant-proj-research");
    assert.equal(result?.budget.budget, 10);
  });

  it("falls back to shorter prefix", () => {
    const result = matchKeyPrefix("sk-ant-proj-other-key", budgets);
    assert.equal(result?.prefix, "sk-ant-proj");
  });

  it("returns null for unregistered key", () => {
    assert.equal(matchKeyPrefix("sk-unknown", budgets), null);
  });

  it("returns null for empty budgets", () => {
    assert.equal(matchKeyPrefix("sk-ant-proj-key", {}), null);
  });
});

// ── Other utilities ──

describe("truncateKey", () => {
  it("truncates to 20 chars", () => {
    const key = "sk-ant-proj-research-abc123-def456";
    assert.equal(truncateKey(key).length, 20);
  });

  it("leaves short keys unchanged", () => {
    assert.equal(truncateKey("sk-short"), "sk-short");
  });
});

describe("getBudgetWindowStart", () => {
  it("returns start of today UTC for day period", () => {
    const parsed = new Date(getBudgetWindowStart("day"));
    assert.equal(parsed.getUTCHours(), 0);
    assert.equal(parsed.getUTCMinutes(), 0);
  });

  it("returns a Monday for week period", () => {
    const parsed = new Date(getBudgetWindowStart("week"));
    assert.equal(parsed.getUTCDay(), 1);
  });

  it("returns 1st of month for month period", () => {
    const parsed = new Date(getBudgetWindowStart("month"));
    assert.equal(parsed.getUTCDate(), 1);
  });
});

describe("parseBudgetString", () => {
  it("parses day budget", () => {
    const b = parseBudgetString("10/day");
    assert.equal(b.budget, 10);
    assert.equal(b.period, "day");
  });

  it("parses week budget", () => {
    const b = parseBudgetString("500/week");
    assert.equal(b.budget, 500);
    assert.equal(b.period, "week");
  });

  it("parses month budget with decimals", () => {
    const b = parseBudgetString("2000.50/month");
    assert.equal(b.budget, 2000.5);
    assert.equal(b.period, "month");
  });

  it("rejects invalid format", () => {
    assert.throws(() => parseBudgetString("10/year"));
    assert.throws(() => parseBudgetString("abc"));
    assert.throws(() => parseBudgetString(""));
  });
});

describe("Anthropic input_tokens excludes cache (no subtraction needed)", () => {
  it("SSE: inputTokens unchanged when cache_read_input_tokens present", () => {
    const fixture = [
      `event: message_start`,
      `data: {"type":"message_start","message":{"id":"msg_ant","type":"message","role":"assistant","model":"claude-sonnet-4-6","usage":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":5000,"output_tokens":0}}}`,
      ``,
      `event: message_delta`,
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}`,
      ``,
    ].join("\n");

    const usage = parseSSEUsage(fixture, "anthropic");
    // Anthropic's input_tokens already excludes cache — should stay 100
    assert.equal(usage.inputTokens, 100);
    assert.equal(usage.cacheReadTokens, 5000);
    assert.equal(usage.outputTokens, 50);
  });
});

describe("OpenAI cost with cache fix", () => {
  it("charges cached tokens at cacheRead rate, not double-counted", () => {
    // gpt-4o: input=2.5, output=10, cacheRead=1.25 per 1M tokens
    // After fix: 100 prompt_tokens with 80 cached → inputTokens=20, cacheReadTokens=80
    // Cost = (20 * 2.5 + 0 * 10 + 80 * 1.25) / 1_000_000
    //      = (50 + 100) / 1_000_000 = 0.000150
    const cost = estimateCost("gpt-4o", 20, 0, 80, 0);
    assert.ok(
      Math.abs(cost - 0.00015) < 0.000001,
      `expected ~0.000150, got ${cost}`,
    );
  });
});

describe("estimateCost", () => {
  it("calculates Anthropic cost", () => {
    const cost = estimateCost("claude-sonnet-4-6", 1000, 500, 0, 0);
    assert.ok(Math.abs(cost - 0.0105) < 0.0001);
  });

  it("calculates OpenAI cost", () => {
    const cost = estimateCost("gpt-4o", 1000, 500, 0, 0);
    // (1000 * 2.5 + 500 * 10) / 1_000_000 = 7500 / 1_000_000 = 0.0075
    assert.ok(Math.abs(cost - 0.0075) < 0.0001);
  });

  it("calculates Gemini cost", () => {
    const cost = estimateCost("gemini-2.5-flash", 1000, 500, 0, 0);
    // (1000 * 0.15 + 500 * 0.6) / 1_000_000 = 450 / 1_000_000 = 0.00045
    assert.ok(Math.abs(cost - 0.00045) < 0.00001);
  });

  it("calculates cost with cache tokens", () => {
    const cost = estimateCost("claude-sonnet-4-6", 100, 50, 10000, 500);
    assert.ok(Math.abs(cost - 0.005925) < 0.0001);
  });

  it("falls back to default pricing for unknown models", () => {
    const cost = estimateCost("unknown-model", 1000, 500, 0, 0);
    assert.ok(Math.abs(cost - 0.0105) < 0.0001);
  });
});
