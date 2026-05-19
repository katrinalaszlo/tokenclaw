export type ModelPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

// Prices per 1M tokens
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-sonnet-4-5-20250514": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },

  // OpenAI
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
  o3: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
  "o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
  "o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },

  // Google Gemini
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10,
    cacheRead: 0.315,
    cacheWrite: 0,
  },
  "gemini-2.5-flash": {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.0375,
    cacheWrite: 0,
  },
  "gemini-2.0-flash": {
    input: 0.1,
    output: 0.4,
    cacheRead: 0.025,
    cacheWrite: 0,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

export function getPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Anthropic fuzzy match
  if (model.includes("opus")) return MODEL_PRICING["claude-opus-4-6"]!;
  if (model.includes("sonnet")) return MODEL_PRICING["claude-sonnet-4-6"]!;
  if (model.includes("haiku"))
    return MODEL_PRICING["claude-haiku-4-5-20251001"]!;
  // OpenAI fuzzy match
  if (model.includes("gpt-4o-mini")) return MODEL_PRICING["gpt-4o-mini"]!;
  if (model.includes("gpt-4o")) return MODEL_PRICING["gpt-4o"]!;
  if (model.includes("gpt-4.1-mini")) return MODEL_PRICING["gpt-4.1-mini"]!;
  if (model.includes("gpt-4.1-nano")) return MODEL_PRICING["gpt-4.1-nano"]!;
  if (model.includes("gpt-4.1")) return MODEL_PRICING["gpt-4.1"]!;
  if (model.startsWith("o3-mini")) return MODEL_PRICING["o3-mini"]!;
  if (model.startsWith("o4-mini")) return MODEL_PRICING["o4-mini"]!;
  if (model.startsWith("o3")) return MODEL_PRICING["o3"]!;
  // Gemini fuzzy match
  if (model.includes("gemini-2.5-pro")) return MODEL_PRICING["gemini-2.5-pro"]!;
  if (model.includes("gemini-2.5-flash"))
    return MODEL_PRICING["gemini-2.5-flash"]!;
  if (model.includes("gemini-2.0-flash"))
    return MODEL_PRICING["gemini-2.0-flash"]!;
  return DEFAULT_PRICING;
}

export function estimateCost(
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const p = getPricing(model);
  return (
    (input * p.input +
      output * p.output +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000
  );
}
