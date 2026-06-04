import {
  initDB,
  getTodaySpend,
  getAverageDaily,
  getCostSnapshots,
  SUBSCRIPTION_TOOLS,
} from "./db.js";
import { loadConfig } from "./config.js";
import type { DigestData } from "./alerts/slack.js";
import { getHistoryDays, getBaselineForDay } from "./baselines.js";

export function buildDigest(): DigestData {
  initDB();
  const config = loadConfig();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0]!;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split("T")[0]!;
  const todayStr = new Date().toISOString().split("T")[0]!;

  const yesterdayUsd = getTodaySpend({ date: yesterdayStr });

  const weekSnapshots = getCostSnapshots(
    undefined,
    weekAgoStr,
    todayStr,
  ).filter((s) => !SUBSCRIPTION_TOOLS.has(s.tool));
  const weekUsd = weekSnapshots.reduce((s, r) => s + r.amount_usd, 0);

  const avgDaily = getAverageDaily(7);

  const yesterdaySnapshots = getCostSnapshots(
    undefined,
    yesterdayStr,
    yesterdayStr,
  ).filter((s) => !SUBSCRIPTION_TOOLS.has(s.tool));

  const toolTotals: Record<string, number> = {};
  const modelTotals: Record<string, number> = {};

  for (const snap of yesterdaySnapshots) {
    toolTotals[snap.tool] = (toolTotals[snap.tool] || 0) + snap.amount_usd;
    if (snap.model) {
      modelTotals[snap.model] =
        (modelTotals[snap.model] || 0) + snap.amount_usd;
    }
  }

  const yesterdayTools = Object.keys(toolTotals).length;

  const topToolEntry = Object.entries(toolTotals).sort(
    ([, a], [, b]) => b - a,
  )[0];
  const topModelEntry = Object.entries(modelTotals).sort(
    ([, a], [, b]) => b - a,
  )[0];

  // Baseline context for yesterday's day-of-week
  let baseline_context: string | undefined;
  if (getHistoryDays() >= 14) {
    const yesterdayDow = yesterday.getDay();
    const baseline = getBaselineForDay(yesterdayDow);
    if (baseline.median > 0) {
      const DAY_NAMES = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dayName = DAY_NAMES[yesterdayDow]!;

      // Compute which percentile yesterday's spend falls at
      // by comparing against the baseline thresholds
      let percentileLabel: string;
      if (yesterdayUsd > baseline.p95) {
        percentileLabel = ">95th";
      } else if (yesterdayUsd > baseline.p75) {
        percentileLabel = "75th-95th";
      } else {
        percentileLabel = "<75th";
      }

      baseline_context = `${percentileLabel} percentile for a ${dayName} (median: $${baseline.median.toFixed(2)})`;
    }
  }

  return {
    yesterday_usd: yesterdayUsd,
    yesterday_sessions: yesterdayTools,
    week_usd: weekUsd,
    week_threshold: config.thresholds.weekly,
    top_tool: topToolEntry
      ? { name: topToolEntry[0], cost: topToolEntry[1] }
      : { name: "none", cost: 0 },
    top_model: topModelEntry
      ? { name: topModelEntry[0], cost: topModelEntry[1] }
      : { name: "none", cost: 0 },
    avg_daily: avgDaily,
    baseline_context,
  };
}
