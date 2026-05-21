/**
 * Historical baseline intelligence.
 * Computes spending percentiles by day-of-week and by tool,
 * enabling dynamic spike detection that replaces the hardcoded SPIKE_MULTIPLIER.
 */

import { getCostSnapshots } from "./db.js";

export interface Baseline {
  median: number;
  p75: number;
  p95: number;
}

/**
 * Pure percentile computation. Takes an array of numbers, returns median/p75/p95.
 * Empty → zeros. Single value → all three equal that value.
 */
export function computePercentiles(values: number[]): Baseline {
  if (values.length === 0) return { median: 0, p75: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return { median: sorted[0]!, p75: sorted[0]!, p95: sorted[0]! };

  return {
    median: percentileAt(sorted, 0.5),
    p75: percentileAt(sorted, 0.75),
    p95: percentileAt(sorted, 0.95),
  };
}

function percentileAt(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

/**
 * Get daily totals from cost_snapshots, optionally filtered by tool.
 * Returns Map<date, totalUsd>.
 */
function getDailyTotals(tool?: string): Map<string, number> {
  const snapshots = getCostSnapshots(tool);
  const totals = new Map<string, number>();
  for (const snap of snapshots) {
    totals.set(snap.date, (totals.get(snap.date) ?? 0) + snap.amount_usd);
  }
  return totals;
}

/**
 * Query cost_snapshots grouped by day-of-week, compute percentiles.
 * dayOfWeek: 0 = Sunday, 6 = Saturday (matches JS Date.getDay()).
 */
export function getBaselineForDay(dayOfWeek: number, tool?: string): Baseline {
  const dailyTotals = getDailyTotals(tool);
  const dayValues: number[] = [];

  for (const [dateStr, total] of dailyTotals) {
    const d = new Date(dateStr + "T00:00:00");
    if (d.getDay() === dayOfWeek) {
      dayValues.push(total);
    }
  }

  return computePercentiles(dayValues);
}

/**
 * Baseline for a specific tool across all days.
 */
export function getBaselineForTool(tool: string): Baseline {
  const dailyTotals = getDailyTotals(tool);
  const values = [...dailyTotals.values()];
  return computePercentiles(values);
}

/**
 * Returns true if currentSpend > p95.
 */
export function isAnomaly(currentSpend: number, baseline: Baseline): boolean {
  if (baseline.p95 <= 0) return false;
  return currentSpend > baseline.p95;
}

/**
 * Human-readable context: "23% above your Tuesday median" or "within normal range".
 */
export function getSpendContext(
  currentSpend: number,
  baseline: Baseline,
  dayName: string,
): string {
  if (baseline.median <= 0) return "not enough history";

  const diff = currentSpend - baseline.median;
  const pct = Math.round((diff / baseline.median) * 100);

  if (pct > 0) {
    return `${pct}% above your ${dayName} median`;
  } else if (pct < 0) {
    return `${Math.abs(pct)}% below your ${dayName} median`;
  }
  return "at your median";
}

/**
 * Count distinct dates in cost_snapshots.
 */
export function getHistoryDays(): number {
  const snapshots = getCostSnapshots();
  const dates = new Set<string>();
  for (const snap of snapshots) {
    dates.add(snap.date);
  }
  return dates.size;
}

/**
 * Get daily totals for all days, used by the CLI baseline command.
 * Returns Map<dayOfWeek, number[]> where dayOfWeek is 0..6.
 */
export function getDailyTotalsByDayOfWeek(
  tool?: string,
): Map<number, number[]> {
  const dailyTotals = getDailyTotals(tool);
  const byDay = new Map<number, number[]>();

  for (const [dateStr, total] of dailyTotals) {
    const d = new Date(dateStr + "T00:00:00");
    const dow = d.getDay();
    if (!byDay.has(dow)) byDay.set(dow, []);
    byDay.get(dow)!.push(total);
  }

  return byDay;
}

/**
 * Get per-tool daily medians. Returns array of { tool, median } sorted by median desc.
 */
export function getToolBaselines(): Array<{ tool: string; median: number }> {
  const snapshots = getCostSnapshots();
  const byTool = new Map<string, Map<string, number>>();

  for (const snap of snapshots) {
    if (!byTool.has(snap.tool)) byTool.set(snap.tool, new Map());
    const toolDays = byTool.get(snap.tool)!;
    toolDays.set(snap.date, (toolDays.get(snap.date) ?? 0) + snap.amount_usd);
  }

  const results: Array<{ tool: string; median: number }> = [];
  for (const [tool, dailyTotals] of byTool) {
    const values = [...dailyTotals.values()];
    const baseline = computePercentiles(values);
    results.push({ tool, median: baseline.median });
  }

  return results.sort((a, b) => b.median - a.median);
}

// TODO: getVelocityBaseline(dayOfWeek, hour) — query proxy_requests grouped by
// day-of-week and hour, compute median $/min. Requires enough proxy history to be
// useful. Skipped for now: current data model stores individual requests, not
// pre-aggregated hourly buckets, making the windowed computation expensive.
