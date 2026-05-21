import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODEL_PRICING, getPricing, estimateCost } from "../src/pricing.js";

// ── Table-driven cost for every model in MODEL_PRICING ──

describe("estimateCost table-driven", () => {
  // Fixed token counts for all rows
  const INPUT = 1000;
  const OUTPUT = 500;

  // Hand-calculated expected USD per model: (INPUT * p.input + OUTPUT * p.output) / 1e6
  const expected: Record<string, number> = {
    "claude-opus-4-6": 0.0525,
    "claude-opus-4-7": 0.0525,
    "claude-sonnet-4-6": 0.0105,
    "claude-sonnet-4-5-20250514": 0.0105,
    "claude-haiku-4-5-20251001": 0.0028,
    "gpt-4o": 0.0075,
    "gpt-4o-mini": 0.00045,
    "gpt-4.1": 0.006,
    "gpt-4.1-mini": 0.0012,
    "gpt-4.1-nano": 0.0003,
    o3: 0.006,
    "o3-mini": 0.0033,
    "o4-mini": 0.0033,
    "gemini-2.5-pro": 0.00625,
    "gemini-2.5-flash": 0.00045,
    "gemini-2.0-flash": 0.0003,
  };

  for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
    it(`${model} → $${expected[model]}`, () => {
      const cost = estimateCost(model, INPUT, OUTPUT, 0, 0);
      assert.ok(
        Math.abs(cost - expected[model]!) < 1e-9,
        `${model}: got ${cost}, expected ${expected[model]}`,
      );
    });
  }
});

// ── Fuzzy match coverage ──

describe("getPricing fuzzy match", () => {
  it("claude-opus-4-5-20240620 → opus pricing (input: 15)", () => {
    const p = getPricing("claude-opus-4-5-20240620");
    assert.equal(p.input, 15);
    assert.equal(p.output, 75);
  });

  it("gpt-4o-2024-08-06 → gpt-4o pricing (input: 2.5)", () => {
    // Contains "gpt-4o" but NOT "gpt-4o-mini", so falls to gpt-4o match
    const p = getPricing("gpt-4o-2024-08-06");
    assert.equal(p.input, 2.5);
    assert.equal(p.output, 10);
  });

  it("claude-sonnet-4-5-20250101 → sonnet pricing", () => {
    const p = getPricing("claude-sonnet-4-5-20250101");
    assert.equal(p.input, 3);
  });

  it("claude-haiku-4-5-20260101 → haiku pricing", () => {
    const p = getPricing("claude-haiku-4-5-20260101");
    assert.equal(p.input, 0.8);
  });

  it("o3-2025-01-01 → o3 pricing (not o3-mini)", () => {
    const p = getPricing("o3-2025-01-01");
    assert.equal(p.input, 2);
    assert.equal(p.output, 8);
  });

  it("gpt-4.1-mini-2025 → gpt-4.1-mini pricing", () => {
    const p = getPricing("gpt-4.1-mini-2025");
    assert.equal(p.input, 0.4);
  });

  it("gpt-4.1-nano-2025 → gpt-4.1-nano pricing", () => {
    const p = getPricing("gpt-4.1-nano-2025");
    assert.equal(p.input, 0.1);
  });

  it("gemini-2.5-pro-preview → gemini-2.5-pro pricing", () => {
    const p = getPricing("gemini-2.5-pro-preview");
    assert.equal(p.input, 1.25);
  });

  it("gemini-2.5-flash-preview → gemini-2.5-flash pricing", () => {
    const p = getPricing("gemini-2.5-flash-preview");
    assert.equal(p.input, 0.15);
    assert.equal(p.output, 0.6);
  });

  it("gemini-2.0-flash-lite → gemini-2.0-flash pricing", () => {
    const p = getPricing("gemini-2.0-flash-lite");
    assert.equal(p.input, 0.1);
  });
});

// ── Ordering: gpt-4o-mini must match before gpt-4o ──

describe("getPricing ordering", () => {
  it("gpt-4o-mini-2024-07-18 → mini pricing (0.15), not gpt-4o (2.5)", () => {
    const p = getPricing("gpt-4o-mini-2024-07-18");
    assert.equal(p.input, 0.15, "should be mini pricing");
    assert.notEqual(p.input, 2.5, "must not be gpt-4o pricing");
  });

  it("o3-mini-2025 → o3-mini pricing (1.1), not o3 (2)", () => {
    const p = getPricing("o3-mini-2025");
    assert.equal(p.input, 1.1);
  });

  it("o4-mini-2025 → o4-mini pricing", () => {
    const p = getPricing("o4-mini-2025");
    assert.equal(p.input, 1.1);
  });
});

// ── Edge cases ──

describe("estimateCost edge cases", () => {
  it("zero tokens → $0", () => {
    assert.equal(estimateCost("claude-sonnet-4-6", 0, 0, 0, 0), 0);
  });

  it("all-cache (input=0, output=0, cacheRead=1000, cacheWrite=500)", () => {
    const cost = estimateCost("claude-sonnet-4-6", 0, 0, 1000, 500);
    // (0 + 0 + 1000*0.3 + 500*3.75) / 1e6 = (300 + 1875) / 1e6 = 0.002175
    assert.ok(Math.abs(cost - 0.002175) < 1e-9);
  });

  it("unknown model → default pricing (same as sonnet)", () => {
    const cost = estimateCost("totally-unknown-model-v9", 1000, 500, 0, 0);
    // Default: input=3, output=15 → same as sonnet
    assert.ok(Math.abs(cost - 0.0105) < 1e-9);
  });

  it("unknown model getPricing returns default values", () => {
    const p = getPricing("nonexistent-model");
    assert.equal(p.input, 3);
    assert.equal(p.output, 15);
    assert.equal(p.cacheRead, 0.3);
    assert.equal(p.cacheWrite, 3.75);
  });
});
