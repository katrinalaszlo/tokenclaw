import {
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ToolScanResult } from "./scanners/local.js";
import type { AccConfig } from "./config.js";

export interface StateFile {
  today_usd: number;
  daily_threshold: number;
  weekly_usd: number;
  weekly_threshold: number;
  pct: number;
  top_tool: string;
  top_model: string;
  sessions_today: number;
  last_scan: string;
}

function getStatePath(): string {
  return join(homedir(), ".tokenclaw", "state.json");
}

export function writeState(found: ToolScanResult[], config: AccConfig): void {
  const dir = join(homedir(), ".tokenclaw");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const today = new Date().toISOString().split("T")[0]!;
  const apiTools = found.filter((t) => t.billingType === "api");

  let todayUsd = 0;
  let weeklyUsd = 0;
  let sessionsToday = 0;
  const toolCosts: Record<string, number> = {};
  const modelCosts: Record<string, number> = {};

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split("T")[0]!;

  for (const tool of apiTools) {
    let toolDayCost = 0;
    let toolWeekCost = 0;
    let toolDaySessions = 0;

    for (const d of tool.dailyCosts) {
      if (d.date === today) {
        toolDayCost += d.cost;
        toolDaySessions += d.sessions;
      }
      if (d.date >= weekAgoStr) {
        toolWeekCost += d.cost;
      }
    }

    todayUsd += toolDayCost;
    weeklyUsd += toolWeekCost;
    sessionsToday += toolDaySessions;
    toolCosts[tool.tool] = (toolCosts[tool.tool] || 0) + toolDayCost;

    for (const [model, usage] of Object.entries(tool.modelUsage)) {
      modelCosts[model] = (modelCosts[model] || 0) + usage.costUSD;
    }
  }

  const topTool =
    Object.entries(toolCosts).sort(([, a], [, b]) => b - a)[0]?.[0] || "none";
  const topModel =
    Object.entries(modelCosts).sort(([, a], [, b]) => b - a)[0]?.[0] || "none";
  const pct =
    config.thresholds.daily > 0
      ? Math.round((todayUsd / config.thresholds.daily) * 100)
      : 0;

  const state: StateFile = {
    today_usd: Math.round(todayUsd * 100) / 100,
    daily_threshold: config.thresholds.daily,
    weekly_usd: Math.round(weeklyUsd * 100) / 100,
    weekly_threshold: config.thresholds.weekly,
    pct,
    top_tool: topTool,
    top_model: topModel,
    sessions_today: sessionsToday,
    last_scan: new Date().toISOString(),
  };

  const statePath = getStatePath();
  const tmpPath = statePath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmpPath, statePath);
}

export function readState(): StateFile | null {
  const statePath = getStatePath();
  if (!existsSync(statePath)) return null;

  try {
    const raw = readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as StateFile;
  } catch {
    return null;
  }
}

export function isStateStale(
  state: StateFile,
  maxAgeMs: number = 2 * 60 * 60 * 1000,
): boolean {
  const age = Date.now() - new Date(state.last_scan).getTime();
  return age > maxAgeMs;
}
