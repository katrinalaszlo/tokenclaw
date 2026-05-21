import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePercentiles,
  isAnomaly,
  getSpendContext,
  type Baseline,
} from "../src/baselines.js";

// ── computePercentiles ──

describe("computePercentiles", () => {
  it("returns zeros for empty array", () => {
    const result = computePercentiles([]);
    assert.deepEqual(result, { median: 0, p75: 0, p95: 0 });
  });

  it("returns same value for single-element array", () => {
    const result = computePercentiles([42]);
    assert.deepEqual(result, { median: 42, p75: 42, p95: 42 });
  });

  it("computes correct percentiles for two values", () => {
    const result = computePercentiles([10, 20]);
    // sorted: [10, 20]
    // median: ceil(0.5 * 2) - 1 = 0 → 10
    // p75: ceil(0.75 * 2) - 1 = 1 → 20
    // p95: ceil(0.95 * 2) - 1 = 1 → 20
    assert.equal(result.median, 10);
    assert.equal(result.p75, 20);
    assert.equal(result.p95, 20);
  });

  it("computes correct percentiles for 10 values", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = computePercentiles(values);
    // median: ceil(0.5 * 10) - 1 = 4 → 50
    // p75: ceil(0.75 * 10) - 1 = 7 → 80
    // p95: ceil(0.95 * 10) - 1 = 9 → 100
    assert.equal(result.median, 50);
    assert.equal(result.p75, 80);
    assert.equal(result.p95, 100);
  });

  it("handles unsorted input", () => {
    const values = [100, 10, 50, 30, 80, 20, 90, 40, 70, 60];
    const result = computePercentiles(values);
    // Same as sorted [10,20,30,40,50,60,70,80,90,100]
    assert.equal(result.median, 50);
    assert.equal(result.p75, 80);
    assert.equal(result.p95, 100);
  });

  it("computes correct percentiles for 20 values", () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
    // [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]
    const result = computePercentiles(values);
    // median: ceil(0.5 * 20) - 1 = 9 → 50
    // p75: ceil(0.75 * 20) - 1 = 14 → 75
    // p95: ceil(0.95 * 20) - 1 = 18 → 95
    assert.equal(result.median, 50);
    assert.equal(result.p75, 75);
    assert.equal(result.p95, 95);
  });

  it("handles identical values", () => {
    const result = computePercentiles([25, 25, 25, 25, 25]);
    assert.equal(result.median, 25);
    assert.equal(result.p75, 25);
    assert.equal(result.p95, 25);
  });

  it("does not mutate the input array", () => {
    const values = [50, 10, 30];
    computePercentiles(values);
    assert.deepEqual(values, [50, 10, 30]);
  });

  it("handles very small fractional values", () => {
    const values = [0.001, 0.002, 0.003, 0.004, 0.005];
    const result = computePercentiles(values);
    assert.equal(result.median, 0.003);
    assert.equal(result.p95, 0.005);
  });
});

// ── isAnomaly ──

describe("isAnomaly", () => {
  const baseline: Baseline = { median: 50, p75: 75, p95: 100 };

  it("returns true when spend exceeds p95", () => {
    assert.equal(isAnomaly(150, baseline), true);
  });

  it("returns false when spend is below p95", () => {
    assert.equal(isAnomaly(80, baseline), false);
  });

  it("returns false when spend equals p95 exactly", () => {
    // isAnomaly uses > not >=
    assert.equal(isAnomaly(100, baseline), false);
  });

  it("returns false when baseline p95 is zero", () => {
    const zeroBaseline: Baseline = { median: 0, p75: 0, p95: 0 };
    assert.equal(isAnomaly(50, zeroBaseline), false);
  });

  it("returns false for zero spend", () => {
    assert.equal(isAnomaly(0, baseline), false);
  });
});

// ── getSpendContext ──

describe("getSpendContext", () => {
  it("reports percentage above median", () => {
    const baseline: Baseline = { median: 50, p75: 75, p95: 100 };
    const result = getSpendContext(75, baseline, "Tuesday");
    assert.equal(result, "50% above your Tuesday median");
  });

  it("reports percentage below median", () => {
    const baseline: Baseline = { median: 50, p75: 75, p95: 100 };
    const result = getSpendContext(25, baseline, "Wednesday");
    assert.equal(result, "50% below your Wednesday median");
  });

  it("reports at median when exactly equal", () => {
    const baseline: Baseline = { median: 50, p75: 75, p95: 100 };
    const result = getSpendContext(50, baseline, "Monday");
    assert.equal(result, "at your median");
  });

  it("returns not enough history when median is zero", () => {
    const baseline: Baseline = { median: 0, p75: 0, p95: 0 };
    const result = getSpendContext(50, baseline, "Friday");
    assert.equal(result, "not enough history");
  });

  it("uses provided day name in message", () => {
    const baseline: Baseline = { median: 100, p75: 150, p95: 200 };
    const result = getSpendContext(130, baseline, "Saturday");
    assert.match(result, /Saturday/);
  });
});
