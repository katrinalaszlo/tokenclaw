import {
  initDB,
  getTodaySpend,
  getAverageDaily,
  getCostSnapshots,
} from "./db.js";
import { loadConfig } from "./config.js";
import type { DigestData } from "./alerts/slack.js";

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

  const weekSnapshots = getCostSnapshots(undefined, weekAgoStr, todayStr);
  const weekUsd = weekSnapshots.reduce((s, r) => s + r.amount_usd, 0);

  const avgDaily = getAverageDaily(7);

  const yesterdaySnapshots = getCostSnapshots(
    undefined,
    yesterdayStr,
    yesterdayStr,
  );

  const toolTotals: Record<string, number> = {};
  const modelTotals: Record<string, number> = {};
  let yesterdaySessions = 0;

  for (const snap of yesterdaySnapshots) {
    toolTotals[snap.tool] = (toolTotals[snap.tool] || 0) + snap.amount_usd;
    if (snap.model) {
      modelTotals[snap.model] =
        (modelTotals[snap.model] || 0) + snap.amount_usd;
    }
    yesterdaySessions++;
  }

  const topToolEntry = Object.entries(toolTotals).sort(
    ([, a], [, b]) => b - a,
  )[0];
  const topModelEntry = Object.entries(modelTotals).sort(
    ([, a], [, b]) => b - a,
  )[0];

  return {
    yesterday_usd: yesterdayUsd,
    yesterday_sessions: yesterdaySessions,
    week_usd: weekUsd,
    week_threshold: config.thresholds.weekly,
    top_tool: topToolEntry
      ? { name: topToolEntry[0], cost: topToolEntry[1] }
      : { name: "none", cost: 0 },
    top_model: topModelEntry
      ? { name: topModelEntry[0], cost: topModelEntry[1] }
      : { name: "none", cost: 0 },
    avg_daily: avgDaily,
  };
}
