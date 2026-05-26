#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { scanLocalTools, projectNameFromPath } from "./scanners/local.js";
import {
  evaluateAlerts,
  type AlertRule,
  type CostSnapshot as EngineCostSnapshot,
  type AlertHistoryEntry,
} from "./alerts/engine.js";
import { sendSlackAlert, sendSlackDigest } from "./alerts/slack.js";
import {
  acknowledgeAlert,
  getAckState,
  isAcknowledged,
} from "./alerts/acknowledge.js";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  parseBudgetString,
  DEFAULT_CONFIG,
  type AccConfig,
} from "./config.js";
import {
  initDB,
  insertCostSnapshot,
  getTodaySpend,
  getAverageDaily,
  insertAlertEvent,
  getRecentAlerts,
  getCostSnapshots,
  getKeyBreakdown,
  getSpendByKeyPrefix,
  hasProxyData,
  getRecentVelocity,
} from "./db.js";
import {
  getHistoryDays,
  getBaselineForDay,
  isAnomaly,
  getSpendContext,
  getToolBaselines,
} from "./baselines.js";
import { startProxy } from "./proxy/server.js";
import {
  installMonitoring,
  uninstallMonitoring,
  isMonitoringInstalled,
  installDigest,
  isMac,
} from "./launchd.js";
import { getBudgetWindowStart } from "./proxy/parse.js";
import { writeState, readState, isStateStale } from "./state.js";

// ── Helpers ──

function fmtUSD(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0]!;
}

function weekAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0]!;
}

function monthAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0]!;
}

/** Build AlertRule[] from config thresholds + escalation tiers. */
function buildRules(config: AccConfig): AlertRule[] {
  const rules: AlertRule[] = [];

  rules.push({
    id: "daily-threshold",
    name: "Daily spend",
    threshold_usd: config.thresholds.daily,
    period: "daily",
    escalation: config.escalation.map((e) => ({
      above: e.above,
      frequency: e.frequency as "daily" | "3x_daily" | "5x_daily" | "hourly",
    })),
  });

  rules.push({
    id: "weekly-threshold",
    name: "Weekly spend",
    threshold_usd: config.thresholds.weekly,
    period: "weekly",
    escalation: config.escalation.map((e) => ({
      above: e.above,
      frequency: e.frequency as "daily" | "3x_daily" | "5x_daily" | "hourly",
    })),
  });

  return rules;
}

/** Convert DB alert rows to the shape evaluateAlerts expects. */
function dbAlertsToHistory(
  rows: ReturnType<typeof getRecentAlerts>,
): AlertHistoryEntry[] {
  return rows.map((row) => {
    let amount = 0;
    if (row.details_json) {
      try {
        const parsed = JSON.parse(row.details_json) as Record<string, unknown>;
        amount = Number(parsed.amount) || 0;
      } catch {
        // corrupt json, skip
      }
    }
    return {
      rule_id: row.rule_name,
      action: row.action as AlertHistoryEntry["action"],
      timestamp: row.created_at,
      amount_usd: amount,
      escalation_level: row.escalation_level,
    };
  });
}

function scanToEngineSnapshotsForPeriod(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
  period: "daily" | "weekly",
): EngineCostSnapshot[] {
  const today = todayISO();
  const cutoff = period === "daily" ? today : weekAgoISO();

  return found
    .filter((t) => t.billingType === "api")
    .map((t) => {
      const periodCost = t.dailyCosts
        .filter((d) => d.date >= cutoff)
        .reduce((sum, d) => sum + d.cost, 0);
      return {
        provider: "local",
        tool: t.tool,
        date: today,
        amount_usd: periodCost,
      };
    });
}

/** Save scan results to DB as cost snapshots (per date per model). */
function persistScanToDB(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  for (const tool of found.filter((t) => t.billingType === "api")) {
    for (const [model, dates] of Object.entries(tool.modelDateCosts)) {
      for (const [date, mdc] of Object.entries(dates)) {
        insertCostSnapshot(
          tool.tool,
          date,
          mdc.cost,
          {
            input: mdc.input,
            output: mdc.output,
            cacheRead: mdc.cacheRead,
          },
          model,
        );
      }
    }
  }
}

// ── Command implementations ──

function isFirstRun(): boolean {
  return !existsSync(getConfigPath());
}

function shortModel(model: string): string {
  return model
    .replace("claude-", "")
    .replace("gpt-", "")
    .replace(/-\d{4,}$/, "");
}

function isUUID(name: string): boolean {
  return /^[0-9a-f]{8}-/.test(name);
}

function shortProject(name: string): string {
  if (isUUID(name)) return "(session)";
  const parts = name.split("/");
  if (parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  return parts[parts.length - 1] || name;
}

function printScanResults(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
  _notFound: string[],
): void {
  if (found.length === 0) {
    console.log(chalk.yellow("No AI tool usage data found."));
    return;
  }

  const apiTools = found.filter((t) => t.billingType === "api");
  const subTools = found.filter((t) => t.billingType === "subscription");

  if (apiTools.length > 0) {
    const apiTotal = apiTools.reduce((s, t) => s + t.totalCost, 0);
    console.log(chalk.bold("API spend: ") + chalk.cyan(fmtUSD(apiTotal)));
    for (const t of apiTools.sort((a, b) => b.totalCost - a.totalCost)) {
      console.log(
        `  ${chalk.white(t.tool.padEnd(20))} ${chalk.cyan(fmtUSD(t.totalCost).padStart(10))}` +
          chalk.dim(`  ${t.sessions} sessions`),
      );

      const models = Object.entries(t.modelUsage)
        .sort(([, a], [, b]) => b.costUSD - a.costUSD)
        .slice(0, 3);
      if (models.length > 0) {
        const modelStr = models
          .map(([m, u]) => `${shortModel(m)} ${fmtUSD(u.costUSD)}`)
          .join(chalk.dim(" · "));
        console.log(chalk.dim("    Models:  ") + modelStr);
      }

      const topProjects = t.projects.slice(0, 3);
      if (topProjects.length > 0) {
        const projStr = topProjects
          .map((p) => `${shortProject(p.name)} ${fmtUSD(p.cost)}`)
          .join(chalk.dim(" · "));
        console.log(chalk.dim("    Top:     ") + projStr);
      }
    }
    console.log();
  }

  if (subTools.length > 0) {
    console.log(chalk.bold("Subscriptions:"));
    for (const t of subTools) {
      console.log(
        `  ${chalk.white(t.tool.padEnd(20))} ${chalk.green(t.planName + " $" + t.planCost + "/mo")}` +
          chalk.dim(`  ${t.sessions} sessions`),
      );

      const topProjects = t.projects.slice(0, 3);
      if (topProjects.length > 0) {
        const projStr = topProjects
          .map((p) => `${shortProject(p.name)} ${fmtUSD(p.cost)}`)
          .join(chalk.dim(" · "));
        console.log(chalk.dim("    Top:     ") + projStr);
      }
    }
    console.log();
  }

  console.log(
    chalk.dim(`Run ${chalk.white("tokenclaw setup")} to configure alerts.`),
  );
}

async function runFirstRun(): Promise<void> {
  initDB();

  const rl = createInterface({ input: stdin, output: stdout });

  console.log(chalk.bold("\nConnect alerts\n"));
  console.log(chalk.dim("Where should tokenclaw send alerts?\n"));

  const slackWebhook = await rl.question("Slack webhook URL: ");

  if (!slackWebhook.trim()) {
    console.log(
      chalk.yellow("\nNo webhook set. Alerts won't be sent anywhere."),
    );
    console.log(chalk.dim("Set one later: tokenclaw config slack <url>"));
  }

  console.log();
  const dailyStr = await rl.question(
    `Daily spend alert threshold (USD) [${DEFAULT_CONFIG.thresholds.daily}]: `,
  );
  const daily = dailyStr ? Number(dailyStr) : DEFAULT_CONFIG.thresholds.daily;

  const config: AccConfig = {
    ...DEFAULT_CONFIG,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      daily,
      weekly: daily * 5,
    },
    alerts: {
      ...DEFAULT_CONFIG.alerts,
      slack_webhook: slackWebhook || "",
    },
  };

  saveConfig(config);
  rl.close();

  console.log(chalk.green(`\nConfig saved to ${getConfigPath()}`));
  console.log(chalk.bold("\nNext steps:\n"));
  console.log(
    `  ${chalk.cyan("tokenclaw")}            See what you're spending`,
  );
  console.log(
    `  ${chalk.cyan("tokenclaw watch")}      Start monitoring (alerts hourly)`,
  );
  console.log(
    `  ${chalk.cyan("tokenclaw list")}       Detailed views (models, projects, trends)`,
  );
  console.log();
  console.log(
    chalk.dim(
      `Want per-key budgets or hard blocking? See ${chalk.white("tokenclaw proxy --help")}`,
    ),
  );
}

async function runScan(): Promise<void> {
  initDB();
  console.log(chalk.dim("Scanning local AI tools...\n"));
  const { found, notFound } = await scanLocalTools();

  printScanResults(found, notFound);
  persistScanToDB(found);

  try {
    const config = loadConfig();
    writeState(found, config);
  } catch {}
}

async function runWatch(once: boolean): Promise<void> {
  const config = loadConfig();
  initDB();

  const tick = async () => {
    console.log(
      chalk.dim(`[${new Date().toLocaleTimeString()}] Running scan...`),
    );
    const { found } = await scanLocalTools();
    persistScanToDB(found);

    try {
      writeState(found, config);
    } catch {}

    const history = dbAlertsToHistory(getRecentAlerts(168));
    const ackState = getAckState();
    const allRules = buildRules(config);

    const actions: ReturnType<typeof evaluateAlerts> = [];
    for (const rule of allRules) {
      const period = rule.period === "weekly" ? "weekly" : "daily";
      const snapshots = scanToEngineSnapshotsForPeriod(found, period);
      const ruleActions = evaluateAlerts(snapshots, [rule], history, ackState);
      actions.push(...ruleActions);
    }

    // Velocity alerting ($/min over last 30 minutes)
    if (config.thresholds.velocity && config.thresholds.velocity > 0) {
      const velocity = getRecentVelocity(30);
      if (velocity > 0) {
        const velocityRule: AlertRule = {
          id: "velocity-threshold",
          name: "Spend velocity",
          threshold_usd: config.thresholds.velocity,
          period: "daily",
          type: "velocity",
          escalation: [
            { above: config.thresholds.velocity, frequency: "hourly" },
          ],
        };
        const velocitySnapshot: EngineCostSnapshot[] = [
          {
            provider: "proxy",
            tool: "all",
            date: todayISO(),
            amount_usd: velocity,
          },
        ];
        const velocityActions = evaluateAlerts(
          velocitySnapshot,
          [velocityRule],
          history,
          ackState,
        );
        actions.push(...velocityActions);
      }
    }

    // Baseline-based spike detection (replaces hardcoded SPIKE_MULTIPLIER when enough data)
    if (getHistoryDays() >= 14) {
      const todayDow = new Date().getDay();
      const baseline = getBaselineForDay(todayDow);
      const todayTotal = found
        .filter((t) => t.billingType === "api")
        .reduce((sum, t) => {
          return (
            sum +
            t.dailyCosts
              .filter((d) => d.date === todayISO())
              .reduce((s, d) => s + d.cost, 0)
          );
        }, 0);

      // Skip if acknowledged or already fired within 24h (respect ack + frequency)
      const spikeAcked = isAcknowledged("daily-spike-baseline");
      const recentSpikeFired = history.some(
        (h) =>
          h.rule_id === "daily-spike-baseline" &&
          h.action === "fired" &&
          Date.now() - new Date(h.timestamp).getTime() < 24 * 60 * 60 * 1000,
      );

      if (
        isAnomaly(todayTotal, baseline) &&
        !actions.some((a) => a.ruleId === "daily-threshold") &&
        !spikeAcked &&
        !recentSpikeFired
      ) {
        const DAY_NAMES = [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ];
        const dayName = DAY_NAMES[todayDow]!;
        const context = getSpendContext(todayTotal, baseline, dayName);

        const tools = found
          .filter((t) => t.billingType === "api" && t.totalCost > 0)
          .sort((a, b) => b.totalCost - a.totalCost)
          .map((t) => ({ name: t.tool, amount: t.totalCost }));

        actions.push({
          alertId: `daily-spike-baseline-${Date.now()}`,
          ruleId: "daily-spike-baseline",
          ruleName: `Spend anomaly (${context})`,
          level: 0,
          amount: todayTotal,
          threshold: baseline.p95,
          isEscalation: false,
          isSpike: true,
          frequency: "daily",
          tools,
        });
      }
    }

    if (actions.length === 0) {
      console.log(chalk.green("No alerts."));
      return;
    }

    for (const action of actions) {
      const label = action.isEscalation
        ? chalk.red.bold(`ESCALATED: ${action.ruleName}`)
        : chalk.yellow(`Alert: ${action.ruleName}`);

      console.log(
        `${label} — ${fmtUSD(action.amount)} (threshold: ${fmtUSD(action.threshold)})`,
      );

      // Log to DB
      insertAlertEvent(
        action.ruleId,
        action.isEscalation ? "escalated" : "fired",
        action.level,
        { amount: action.amount, threshold: action.threshold },
      );

      // Send Slack notification if configured
      if (config.alerts.slack_webhook) {
        try {
          await sendSlackAlert(config.alerts.slack_webhook, action);
          console.log(chalk.dim("  Slack notification sent."));
        } catch (err) {
          console.error(chalk.red(`  Slack send failed: ${err}`));
        }
      }
    }
  };

  await tick();

  if (!once) {
    console.log(chalk.dim("\nWatching. Checks every hour. Ctrl+C to stop.\n"));
    setInterval(
      () => {
        void tick();
      },
      60 * 60 * 1000,
    );
  }
}

function runAck(ruleName?: string): void {
  const config = loadConfig();

  const unsileceAt = new Date(
    Date.now() + config.acknowledge_ttl * 60 * 60 * 1000,
  );
  const unsileceStr = unsileceAt.toLocaleString();

  if (ruleName) {
    acknowledgeAlert(ruleName, config.acknowledge_ttl);
    console.log(chalk.green(`Acknowledged: ${ruleName}`));
    console.log(chalk.dim(`  Silenced until ${unsileceStr}`));
    return;
  }

  const rules = buildRules(config);
  let count = 0;
  for (const rule of rules) {
    if (!isAcknowledged(rule.id)) {
      acknowledgeAlert(rule.id, config.acknowledge_ttl);
      count++;
    }
  }

  if (count === 0) {
    console.log(chalk.dim("No active alerts to acknowledge."));
  } else {
    console.log(chalk.green(`Acknowledged ${count} alert(s).`));
    console.log(chalk.dim(`  Silenced until ${unsileceStr}`));
  }
}

function runStatus(): void {
  initDB();
  const config = loadConfig();

  // Spend summary
  const today = getTodaySpend();
  const weekSnapshots = getCostSnapshots(undefined, weekAgoISO(), todayISO());
  const weekSpend = weekSnapshots.reduce((s, r) => s + r.amount_usd, 0);
  const monthSnapshots = getCostSnapshots(undefined, monthAgoISO(), todayISO());
  const monthSpend = monthSnapshots.reduce((s, r) => s + r.amount_usd, 0);

  console.log(chalk.bold.underline("Spend"));
  console.log(
    `  Today:      ${chalk.cyan(fmtUSD(today))}` +
      chalk.dim(` / ${fmtUSD(config.thresholds.daily)} threshold`),
  );
  console.log(
    `  This week:  ${chalk.cyan(fmtUSD(weekSpend))}` +
      chalk.dim(` / ${fmtUSD(config.thresholds.weekly)} threshold`),
  );
  console.log(`  This month: ${chalk.cyan(fmtUSD(monthSpend))}`);
  console.log();

  // Active alerts
  const recentAlerts = getRecentAlerts(168);
  const fired = recentAlerts.filter(
    (a) => a.action === "fired" || a.action === "escalated",
  );

  console.log(chalk.bold.underline("Active Alerts"));
  if (fired.length === 0) {
    console.log(chalk.green("  None"));
  } else {
    for (const a of fired.slice(0, 10)) {
      const level =
        a.escalation_level > 0 ? chalk.yellow(` [L${a.escalation_level}]`) : "";
      console.log(`  ${a.rule_name}${level} — ${a.action} at ${a.created_at}`);
    }
  }
  console.log();

  // Acknowledged alerts
  const ackState = getAckState();
  const ackEntries = Object.values(ackState);

  console.log(chalk.bold.underline("Acknowledged"));
  if (ackEntries.length === 0) {
    console.log(chalk.dim("  None"));
  } else {
    for (const ack of ackEntries) {
      const remaining = new Date(ack.expiresAt).getTime() - Date.now();
      const hoursLeft = Math.max(0, Math.round(remaining / (60 * 60 * 1000)));
      console.log(
        `  ${chalk.green(ack.alertId)}` +
          chalk.dim(` — ${hoursLeft}h remaining`),
      );
    }
  }
}

async function runInit(): Promise<void> {
  await runFirstRun();
}

async function runList(view: string): Promise<void> {
  initDB();
  const { found } = await scanLocalTools();
  persistScanToDB(found);

  if (view === "sessions") {
    listSessions(found);
    return;
  }

  const apiOnly = found.filter((t) => t.billingType === "api");

  if (apiOnly.length === 0) {
    console.log(chalk.yellow("No API-billed tool usage found."));
    console.log(
      chalk.dim(
        "Subscription tools (Claude Code, Cursor, etc.) have flat monthly costs.",
      ),
    );
    return;
  }

  switch (view) {
    case "models":
      listModels(apiOnly);
      break;
    case "projects":
      listProjects(apiOnly);
      break;
    case "trends":
      listTrends(apiOnly);
      break;
    case "usage":
      listUsage(apiOnly);
      break;
    case "efficiency":
      listEfficiency(apiOnly);
      break;
    default:
      console.log(chalk.red(`Unknown view: ${view}`));
      console.log(
        chalk.dim(
          "Available: models, projects, trends, usage, efficiency, sessions",
        ),
      );
  }
}

function listModels(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  console.log(chalk.bold("Cost by model\n"));

  const allModels: Record<
    string,
    {
      cost: number;
      input: number;
      output: number;
      cache: number;
      tools: string[];
    }
  > = {};

  for (const t of found) {
    for (const [model, usage] of Object.entries(t.modelUsage)) {
      if (!allModels[model]) {
        allModels[model] = {
          cost: 0,
          input: 0,
          output: 0,
          cache: 0,
          tools: [],
        };
      }
      allModels[model].cost += usage.costUSD;
      allModels[model].input += usage.inputTokens;
      allModels[model].output += usage.outputTokens;
      allModels[model].cache +=
        usage.cacheReadTokens + usage.cacheCreationTokens;
      if (!allModels[model].tools.includes(t.tool)) {
        allModels[model].tools.push(t.tool);
      }
    }
  }

  const sorted = Object.entries(allModels)
    .filter(([, data]) => data.input + data.output > 0)
    .sort(([, a], [, b]) => b.cost - a.cost);
  const maxCost = sorted[0]?.[1].cost || 1;
  const uniqueTools = new Set(sorted.flatMap(([, d]) => d.tools));

  for (const [model, data] of sorted) {
    const barLen = Math.max(1, Math.round((data.cost / maxCost) * 20));
    const bar =
      chalk.cyan("█".repeat(barLen)) + chalk.dim("░".repeat(20 - barLen));
    const toolSuffix =
      uniqueTools.size > 1 ? chalk.dim(`  ${data.tools.join(", ")}`) : "";
    const cacheSuffix =
      data.cache > 0 ? ` + ${fmtTokens(data.cache)} cache` : "";
    console.log(
      `  ${chalk.white(shortModel(model).padEnd(18))} ${chalk.cyan(fmtUSD(data.cost).padStart(10))}  ${bar}  ${chalk.dim(fmtTokens(data.input + data.output) + " in/out" + cacheSuffix)}${toolSuffix}`,
    );
  }
}

function listProjects(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  const allProjects: Record<
    string,
    { cost: number; sessions: number; tool: string }
  > = {};

  for (const t of found) {
    for (const p of t.projects) {
      const name = shortProject(p.name);
      if (name === "(session)") continue;
      const key = `${name}|${t.tool}`;
      if (!allProjects[key]) {
        allProjects[key] = { cost: 0, sessions: 0, tool: t.tool };
      }
      allProjects[key].cost += p.cost;
      allProjects[key].sessions += p.sessions;
    }
  }

  const sorted = Object.entries(allProjects).sort(
    ([, a], [, b]) => b.cost - a.cost,
  );
  const maxCost = sorted[0]?.[1].cost || 1;

  if (sorted.length === 0) return;

  console.log(chalk.bold("Cost by project\n"));
  for (const [key, data] of sorted.slice(0, 10)) {
    const name = key.split("|")[0]!;
    const barLen = Math.max(1, Math.round((data.cost / maxCost) * 20));
    const bar =
      chalk.cyan("█".repeat(barLen)) + chalk.dim("░".repeat(20 - barLen));
    console.log(
      `  ${chalk.white(name.padEnd(25))} ${chalk.cyan(fmtUSD(data.cost).padStart(10))}  ${bar}  ${chalk.dim(data.tool)}`,
    );
  }
}

function listTrends(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  console.log(chalk.bold("Daily spend trend\n"));

  const dailyTotals: Record<string, number> = {};
  for (const t of found) {
    for (const d of t.dailyCosts) {
      dailyTotals[d.date] = (dailyTotals[d.date] || 0) + d.cost;
    }
  }

  const sorted = Object.entries(dailyTotals).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const last14 = sorted.slice(-14);

  if (last14.length === 0) {
    console.log(chalk.dim("  No daily data available."));
    return;
  }

  const maxDay = Math.max(...last14.map(([, c]) => c));
  const total = last14.reduce((s, [, c]) => s + c, 0);
  const avg = total / last14.length;

  for (const [date, cost] of last14) {
    const barLen = Math.max(1, Math.round((cost / maxDay) * 30));
    const bar =
      cost > avg * 1.5
        ? chalk.red("█".repeat(barLen))
        : chalk.cyan("█".repeat(barLen));
    const label = date.slice(5);
    console.log(`  ${chalk.dim(label)}  ${bar}  ${fmtUSD(cost)}`);
  }

  console.log();
  console.log(
    chalk.dim(
      `  avg: ${fmtUSD(avg)}/day  total: ${fmtUSD(total)} over ${last14.length} days`,
    ),
  );
}

function listUsage(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  console.log(chalk.bold("Token usage\n"));

  for (const t of found) {
    const total = t.inputTokens + t.outputTokens;

    console.log(chalk.white(`  ${t.tool}`));
    console.log(
      `    Input:    ${chalk.cyan(fmtTokens(t.inputTokens).padStart(8))}`,
    );
    console.log(
      `    Output:   ${chalk.cyan(fmtTokens(t.outputTokens).padStart(8))}`,
    );
    console.log(
      `    Cache:    ${chalk.green(fmtTokens(t.cacheReadTokens).padStart(8))}  ${chalk.dim("read")}` +
        `   ${chalk.yellow(fmtTokens(t.cacheCreationTokens).padStart(8))}  ${chalk.dim("write")}`,
    );
    console.log(
      `    In/Out:   ${chalk.white(fmtTokens(total).padStart(8))}  ${chalk.dim(`across ${t.sessions} sessions`)}`,
    );
    console.log();
  }
}

function listEfficiency(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  console.log(chalk.bold("Efficiency\n"));

  for (const t of found) {
    const costPerSession = t.sessions > 0 ? t.totalCost / t.sessions : 0;
    const cacheTotal = t.cacheReadTokens + t.cacheCreationTokens;
    const rawRate =
      cacheTotal > 0
        ? (t.cacheReadTokens / (t.cacheReadTokens + t.inputTokens)) * 100
        : 0;
    const cacheHitRate =
      rawRate >= 100 || t.inputTokens === 0
        ? "100%"
        : rawRate >= 99.95
          ? ">99.9%"
          : `${rawRate.toFixed(1)}%`;

    console.log(chalk.white(`  ${t.tool}`));
    console.log(`    Cost/session:   ${chalk.cyan(fmtUSD(costPerSession))}`);
    console.log(
      `    Cache hit rate: ${rawRate > 50 ? chalk.green(cacheHitRate) : chalk.yellow(cacheHitRate)}`,
    );

    if (t.billingType === "subscription" && t.planCost) {
      const leverage =
        t.planCost > 0 ? Math.round(t.totalCost / t.planCost) : 0;
      const assumed = t.planCostAssumed ? ", assumed" : "";
      console.log(
        `    Subscription:   ${chalk.green(`${leverage}x`)} value ${chalk.dim(`(paying $${t.planCost}/mo${assumed}, consuming ${fmtUSD(t.totalCost)} at API rates)`)}`,
      );
    }
    console.log();
  }
}

function listSessions(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  const allSessions = found.flatMap((t) =>
    t.sessions_detail.map((s) => ({ ...s, tool: t.tool })),
  );

  // Filter to sessions with cost > 0 for meaningful stats
  const nonZero = allSessions.filter((s) => s.cost > 0);

  if (nonZero.length === 0) {
    console.log(chalk.dim("No session data found."));
    return;
  }

  // Median cost (of non-zero sessions)
  const sorted = [...nonZero].sort((a, b) => a.cost - b.cost);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]!.cost + sorted[mid]!.cost) / 2
      : sorted[mid]!.cost;

  const top10 = [...nonZero].sort((a, b) => b.cost - a.cost).slice(0, 10);
  const outlierThreshold = median * 3;

  console.log(chalk.bold("Most expensive sessions\n"));
  console.log(
    chalk.dim(
      `  ${nonZero.length} sessions total, median: ${fmtUSD(median)}\n`,
    ),
  );

  for (const s of top10) {
    const projName = shortProject(projectNameFromPath(s.path, s.tool));
    const dur = s.duration_minutes > 0 ? `${s.duration_minutes}min` : "<1min";
    const costStr = fmtUSD(s.cost);
    const line = `${costStr.padStart(8)}  ${projName.padEnd(25)} ${shortModel(s.model).padEnd(14)} ${dur.padStart(7)}`;
    if (s.cost > outlierThreshold) {
      console.log(`  ${chalk.red(line)}  ${chalk.red("(>3x median)")}`);
    } else {
      console.log(`  ${line}`);
    }
  }
}

function listSubscriptions(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  const subs = found.filter(
    (t) => t.billingType === "subscription" && t.planCost,
  );
  if (subs.length === 0) return;

  console.log(chalk.bold("Subscription value\n"));
  for (const t of subs) {
    const leverage =
      t.planCost! > 0 ? Math.round(t.totalCost / t.planCost!) : 0;
    console.log(
      `  ${chalk.white(t.tool.padEnd(20))} ${chalk.green(t.planName + " $" + t.planCost + "/mo")}` +
        chalk.dim(`  ${t.sessions} sessions`) +
        `  ${chalk.cyan(`${leverage}x`)} value`,
    );
    console.log(
      chalk.dim(
        `  ${"".padEnd(20)} consuming ${fmtUSD(t.totalCost)} at API rates`,
      ),
    );
  }
}

function listKeySpend(): void {
  const since = getBudgetWindowStart("day");
  const breakdown = getKeyBreakdown(since);

  if (breakdown.length === 0) return;

  console.log(chalk.bold("Spend by API key") + chalk.dim("  (proxy data)\n"));
  const maxCost = breakdown[0]?.total_cost || 1;

  for (const row of breakdown.slice(0, 10)) {
    const barLen = Math.max(1, Math.round((row.total_cost / maxCost) * 20));
    const bar =
      chalk.cyan("█".repeat(barLen)) + chalk.dim("░".repeat(20 - barLen));
    console.log(
      `  ${chalk.white(row.api_key_prefix.padEnd(25))} ${chalk.cyan(fmtUSD(row.total_cost).padStart(10))}  ${bar}  ${chalk.dim(row.request_count + " requests")}`,
    );
  }
}

function runConfig(): void {
  const config = loadConfig();
  const configPath = getConfigPath();

  console.log(chalk.bold("Config path: ") + chalk.cyan(configPath));
  console.log();
  console.log(chalk.bold.underline("Thresholds"));
  console.log(`  Daily:          ${fmtUSD(config.thresholds.daily)}`);
  console.log(`  Weekly:         ${fmtUSD(config.thresholds.weekly)}`);
  console.log(
    `  Spike alerts:   ${config.thresholds.alert_on_spike ? "on" : "off"}`,
  );
  console.log();
  console.log(chalk.bold.underline("Alert Destinations"));
  console.log(
    `  Slack:  ${config.alerts.slack_webhook || chalk.dim("not set")}`,
  );
  console.log(`  Email:  ${config.alerts.email || chalk.dim("not set")}`);
  console.log();
  console.log(chalk.bold.underline("Escalation"));
  for (const tier of config.escalation) {
    console.log(`  > $${tier.above} → ${tier.frequency}`);
  }
  console.log();
  console.log(`Acknowledge TTL: ${config.acknowledge_ttl}h`);
}

// ── CLI Setup ──

const program = new Command();

program
  .name("tokenclaw")
  .description("See, alert, and control AI agent spend")
  .version("2.4.0")
  .option("--no-color", "Disable colored output")
  .option("--config <path>", "Custom config file path")
  .hook("preAction", (_thisCommand, _actionCommand) => {
    const opts = program.opts();
    if (opts.color === false) {
      chalk.level = 0;
    }
  });

// ── VIEW ──

program
  .command("view")
  .description(
    "See your API spend (models, projects, trends, usage, efficiency)",
  )
  .action(async () => {
    initDB();
    const { found } = await scanLocalTools();
    persistScanToDB(found);

    try {
      const config = loadConfig();
      writeState(found, config);
    } catch {}

    const apiOnly = found.filter((t) => t.billingType === "api");

    if (apiOnly.length > 0) {
      console.log(chalk.bold("API Spend\n"));
      listModels(apiOnly);
      console.log();
      listProjects(apiOnly);
      console.log();
      listTrends(apiOnly);
      console.log();
      listUsage(apiOnly);
      console.log();
      listEfficiency(apiOnly);
      if (hasProxyData()) {
        console.log();
        listKeySpend();
      }
    } else {
      console.log(chalk.dim("No API-billed tool usage found.\n"));
    }

    const subs = found.filter(
      (t) => t.billingType === "subscription" && t.planCost,
    );
    if (subs.length > 0) {
      const totalConsumed = subs.reduce((s, t) => s + t.totalCost, 0);
      const uniquePlans = new Map<string, number>();
      for (const t of subs) {
        const plan = t.planName || "Unknown";
        if (
          !uniquePlans.has(plan) ||
          (t.planCost || 0) > uniquePlans.get(plan)!
        ) {
          uniquePlans.set(plan, t.planCost || 0);
        }
      }
      const totalPaid = [...uniquePlans.values()].reduce((s, c) => s + c, 0);
      const leverage =
        totalPaid > 0 ? Math.round(totalConsumed / totalPaid) : 0;
      if (leverage > 1) {
        const anyAssumed = subs.some((t) => t.planCostAssumed);
        const assumed = anyAssumed ? ", assumed" : "";
        console.log();
        console.log(
          chalk.dim(
            `  ✦ btw — your Claude ${[...uniquePlans.keys()].join("/")} (${fmtUSD(totalPaid)}/mo${assumed}) consumed ${fmtUSD(totalConsumed)} at API rates this month. ${leverage}x value.`,
          ),
        );
      }
    }
  });

// ── STATUS ──

function shortModelName(model: string): string {
  return model
    .replace("claude-", "")
    .replace("gpt-", "")
    .replace(/-\d{4,}$/, "");
}

program
  .command("status")
  .description("Quick spend summary (reads cached state file)")
  .option("--oneliner", "Single line for hooks/prompts (no color)")
  .option("--json", "Print state as JSON")
  .action(async (opts: { oneliner?: boolean; json?: boolean }) => {
    let state = readState();

    if (!state || isStateStale(state)) {
      initDB();
      const { found } = await scanLocalTools();
      persistScanToDB(found);
      const config = loadConfig();
      writeState(found, config);
      state = readState();
    }

    if (!state) {
      console.error("No data available. Run `tokenclaw` first.");
      process.exit(1);
    }

    const config = loadConfig();
    const threshold = config.thresholds.daily;
    const pct =
      threshold > 0 ? Math.round((state.today_usd / threshold) * 100) : 0;

    if (opts.json) {
      console.log(
        JSON.stringify({ ...state, daily_threshold: threshold, pct }, null, 2),
      );
      return;
    }

    if (opts.oneliner) {
      console.log(
        `[tokenclaw] $${state.today_usd.toFixed(2)}/$${threshold} (${pct}%)`,
      );
      return;
    }

    console.log(
      `${chalk.cyan("$" + state.today_usd.toFixed(2))} / ${chalk.dim("$" + threshold.toFixed(2))} (${pct}%)` +
        chalk.dim(
          ` | ${state.sessions_today} sessions | ${shortModelName(state.top_model)}`,
        ),
    );
  });

// ── TODAY ──

program
  .command("today")
  .description("Today's spend at a glance")
  .action(async () => {
    initDB();
    const { found } = await scanLocalTools();
    persistScanToDB(found);

    const config = loadConfig();
    writeState(found, config);

    const today = new Date().toISOString().split("T")[0]!;
    const apiTools = found.filter((t) => t.billingType === "api");

    let todayTotal = 0;
    const toolSpend: Array<{ name: string; cost: number }> = [];

    for (const t of apiTools) {
      const dayCost = t.dailyCosts
        .filter((d) => d.date === today)
        .reduce((sum, d) => sum + d.cost, 0);
      if (dayCost > 0) {
        toolSpend.push({ name: t.tool, cost: dayCost });
        todayTotal += dayCost;
      }
    }

    const threshold = config.thresholds.daily;
    const pct = threshold > 0 ? Math.round((todayTotal / threshold) * 100) : 0;

    console.log();
    if (toolSpend.length === 0) {
      console.log(chalk.dim("  No API spend today."));
    } else {
      for (const t of toolSpend.sort((a, b) => b.cost - a.cost)) {
        console.log(
          `  ${chalk.white(t.name.padEnd(18))} ${chalk.cyan(fmtUSD(t.cost))}`,
        );
      }
      console.log();
      console.log(
        `  ${chalk.bold("Total")}              ${chalk.cyan(fmtUSD(todayTotal))}` +
          (threshold > 0 ? chalk.dim(` / ${fmtUSD(threshold)} (${pct}%)`) : ""),
      );
    }
    console.log();
  });

// ── LIST ──

program
  .command("list <view>")
  .description(
    "Detailed views (models, projects, trends, usage, efficiency, sessions)",
  )
  .action(async (view: string) => {
    await runList(view);
  });

// ── ALERT ──

function parseLimit(opts: {
  daily?: string;
  weekly?: string;
  monthly?: string;
}): { amount: number; period: "day" | "week" | "month" } | null {
  if (opts.daily) return { amount: Number(opts.daily), period: "day" };
  if (opts.weekly) return { amount: Number(opts.weekly), period: "week" };
  if (opts.monthly) return { amount: Number(opts.monthly), period: "month" };
  return null;
}

program
  .command("alert")
  .description("Notify via Slack when spend crosses a dollar amount")
  .option("--daily <amount>", "Alert at $X/day")
  .option("--weekly <amount>", "Alert at $X/week")
  .option("--monthly <amount>", "Alert at $X/month")
  .option(
    "--velocity <amount>",
    "Alert when burn rate exceeds $X/min (requires proxy)",
  )
  .option("--key <prefix>", "Per-key alert (requires proxy)")
  .option("--setup", "Interactive setup (connect Slack)")
  .option("--watch", "Start continuous monitoring in foreground")
  .option("--check", "Run one alert check and exit (used by launchd)")
  .option("--ack", "Silence alerts for 24h")
  .option("--clear", "Remove alert and stop monitoring")
  .option("--log", "Show alert history")
  .action(
    async (opts: {
      daily?: string;
      weekly?: string;
      monthly?: string;
      velocity?: string;
      key?: string;
      setup?: boolean;
      watch?: boolean;
      check?: boolean;
      ack?: boolean;
      clear?: boolean;
      log?: boolean;
    }) => {
      if (opts.check) {
        await runWatch(true);
        return;
      }
      if (opts.log) {
        initDB();
        const recent = getRecentAlerts(168);
        const fired = recent.filter(
          (a) => a.action === "fired" || a.action === "escalated",
        );
        if (fired.length === 0) {
          console.log(chalk.dim("No alerts in the last 7 days."));
          return;
        }
        console.log(chalk.bold("Alert log (last 7 days)\n"));
        for (const a of fired) {
          const level =
            a.escalation_level > 0
              ? chalk.yellow(` L${a.escalation_level}`)
              : "";
          let amount = "";
          if (a.details_json) {
            try {
              const d = JSON.parse(a.details_json);
              amount = ` ${fmtUSD(Number(d.amount))}`;
            } catch {}
          }
          console.log(
            `  ${chalk.dim(a.created_at)}  ${a.rule_name}${level}${amount}`,
          );
        }
        return;
      }
      if (opts.clear) {
        const config = loadConfig();
        if (opts.key) {
          const existing = config.key_budgets[opts.key];
          if (existing && !existing.rules.some((r) => r.action === "block")) {
            delete config.key_budgets[opts.key];
            saveConfig(config);
            console.log(chalk.green(`Alert removed for ${opts.key}`));
          } else {
            console.log(chalk.dim(`No alert found for ${opts.key}`));
          }
        } else {
          config.thresholds.daily = 0;
          config.thresholds.weekly = 0;
          saveConfig(config);
          const result = uninstallMonitoring();
          console.log(chalk.green("Total spend alerts cleared."));
          if (result.message !== "No monitoring installed.") {
            console.log(chalk.dim(result.message));
          }
        }
        return;
      }
      if (opts.setup) {
        await runInit();
        return;
      }
      if (opts.watch) {
        await runWatch(false);
        return;
      }
      if (opts.ack) {
        runAck();
        return;
      }

      if (opts.velocity) {
        const config = loadConfig();
        config.thresholds.velocity = Number(opts.velocity);
        saveConfig(config);
        console.log(
          chalk.green(
            `Velocity alert: Slack when burn rate > $${opts.velocity}/min`,
          ),
        );
        console.log(
          chalk.dim("Measured over 30-minute window from proxy data."),
        );
        return;
      }

      const limit = parseLimit(opts);
      if (!limit) {
        initDB();
        const config = loadConfig();
        console.log(chalk.bold("Total spend alerts:\n"));
        console.log(`  Daily:  ${fmtUSD(config.thresholds.daily)}`);
        console.log(`  Weekly: ${fmtUSD(config.thresholds.weekly)}`);

        const keyAlerts = Object.entries(config.key_budgets).filter(
          ([, b]) => !b.rules.some((r) => r.action === "block"),
        );
        if (keyAlerts.length > 0) {
          console.log(chalk.bold("\nPer-key alerts:\n"));
          for (const [prefix, b] of keyAlerts) {
            const since = getBudgetWindowStart(b.period);
            const spent = getSpendByKeyPrefix(prefix, since);
            console.log(
              `  ${chalk.white(prefix.padEnd(25))} ${fmtUSD(spent)} / ${fmtUSD(b.budget)} ${b.period}`,
            );
          }
        }

        const recent = getRecentAlerts(168);
        const fired = recent.filter(
          (a) => a.action === "fired" || a.action === "escalated",
        );
        if (fired.length > 0) {
          console.log(chalk.bold("\nRecent alerts:\n"));
          for (const a of fired.slice(0, 10)) {
            const level =
              a.escalation_level > 0
                ? chalk.yellow(` [L${a.escalation_level}]`)
                : "";
            console.log(`  ${chalk.dim(a.created_at)}  ${a.rule_name}${level}`);
          }
        } else {
          console.log(chalk.dim("\nNo recent alerts."));
        }

        if (config.thresholds.daily > 0 || config.thresholds.weekly > 0) {
          if (isMonitoringInstalled()) {
            console.log(
              chalk.green("\n  Monitoring active — checking every hour."),
            );
          } else {
            console.log(
              chalk.yellow(
                "\n  Monitoring not installed. Set a threshold to auto-install:",
              ),
            );
            console.log(chalk.dim("  tokenclaw alert --daily 50"));
          }
        } else {
          console.log(chalk.dim(`\nSet:   tokenclaw alert --daily 50`));
          console.log(chalk.dim(`Slack: tokenclaw alert --setup`));
        }
        return;
      }

      if (opts.key) {
        console.log(
          chalk.dim(
            "Per-key alerts require the proxy. Make sure it's running: tokenclaw proxy\n",
          ),
        );
        const config = loadConfig();
        const rules: Array<{ at: number; action: "alert" | "block" }> = [
          { at: 100, action: "alert" },
        ];
        config.key_budgets[opts.key] = {
          budget: limit.amount,
          period: limit.period,
          rules,
        };
        saveConfig(config);
        console.log(
          chalk.green(
            `Alert set: ${opts.key} → $${limit.amount}/${limit.period}`,
          ),
        );
      } else {
        const config = loadConfig();
        if (limit.period === "day") {
          config.thresholds.daily = limit.amount;
          config.thresholds.weekly = limit.amount * 5;
        } else if (limit.period === "week") {
          config.thresholds.weekly = limit.amount;
        }
        saveConfig(config);
        console.log(
          chalk.green(
            `Alert set: $${limit.amount}/${limit.period} total spend`,
          ),
        );
        if (!config.alerts.slack_webhook) {
          console.log(
            chalk.dim(
              "  No Slack webhook configured. Alerts will print to terminal only.",
            ),
          );
          console.log(
            chalk.dim("  Add Slack: tokenclaw config slack <webhook-url>"),
          );
        }

        const result = installMonitoring();
        console.log(
          result.ok
            ? chalk.green(result.message)
            : chalk.yellow(result.message),
        );
      }
    },
  );

// ── CAP ──

program
  .command("cap")
  .description(
    "Block API requests when spend crosses a dollar amount (requires proxy)",
  )
  .option("--key <prefix>", "API key prefix (e.g. sk-ant-research)")
  .option("--daily <amount>", "Block at $X/day")
  .option("--weekly <amount>", "Block at $X/week")
  .option("--monthly <amount>", "Block at $X/month")
  .option("--clear", "Remove cap on a key (use with --key)")
  .option("--log", "Show cap/block history")
  .action(
    (opts: {
      key?: string;
      daily?: string;
      weekly?: string;
      monthly?: string;
      clear?: boolean;
      log?: boolean;
    }) => {
      if (opts.log) {
        initDB();
        const recent = getRecentAlerts(168);
        const blocks = recent.filter(
          (a) =>
            a.action === "blocked" ||
            (a.details_json && a.details_json.includes("block")),
        );
        if (blocks.length === 0) {
          console.log(chalk.dim("No blocks in the last 7 days."));
          return;
        }
        console.log(chalk.bold("Cap log (last 7 days)\n"));
        for (const a of blocks) {
          let amount = "";
          if (a.details_json) {
            try {
              const d = JSON.parse(a.details_json);
              amount = ` ${fmtUSD(Number(d.amount))}`;
            } catch {}
          }
          console.log(
            `  ${chalk.dim(a.created_at)}  ${chalk.red("blocked")}  ${a.rule_name}${amount}`,
          );
        }
        return;
      }
      if (opts.clear) {
        if (!opts.key) {
          console.error(chalk.red("--key is required with --clear."));
          process.exit(1);
          return;
        }
        const config = loadConfig();
        if (config.key_budgets[opts.key]) {
          delete config.key_budgets[opts.key];
          saveConfig(config);
          console.log(chalk.green(`Cap removed for ${opts.key}`));
        } else {
          console.log(chalk.dim(`No cap found for ${opts.key}`));
        }
        return;
      }

      const limit = parseLimit(opts);

      if (!limit) {
        initDB();
        const config = loadConfig();
        const caps = Object.entries(config.key_budgets).filter(([, b]) =>
          b.rules.some((r) => r.action === "block"),
        );

        if (caps.length === 0) {
          console.log(chalk.dim("No caps configured."));
          console.log(
            chalk.dim("Use: tokenclaw cap --key <prefix> --daily <amount>"),
          );
          return;
        }

        console.log(chalk.bold("Active caps:\n"));
        for (const [prefix, b] of caps) {
          const since = getBudgetWindowStart(b.period);
          const spent = getSpendByKeyPrefix(prefix, since);
          const pct = b.budget > 0 ? Math.round((spent / b.budget) * 100) : 0;
          const status =
            pct >= 100
              ? chalk.red("BLOCKED")
              : pct >= 80
                ? chalk.yellow(`${pct}%`)
                : chalk.green(`${pct}%`);
          console.log(
            `  ${chalk.white(prefix.padEnd(25))} ${fmtUSD(spent)} / ${fmtUSD(b.budget)} ${b.period}  (${status})`,
          );
        }
        return;
      }

      if (!opts.key) {
        console.error(chalk.red("--key is required for caps."));
        console.log(
          chalk.dim("Use: tokenclaw cap --key <prefix> --daily <amount>"),
        );
        process.exit(1);
        return;
      }

      const config = loadConfig();
      const rules: Array<{ at: number; action: "alert" | "block" }> = [
        { at: 80, action: "alert" },
        { at: 100, action: "block" },
      ];
      config.key_budgets[opts.key] = {
        budget: limit.amount,
        period: limit.period,
        rules,
      };
      saveConfig(config);

      console.log(
        chalk.green(
          `Cap: ${opts.key} → block at $${limit.amount}/${limit.period}`,
        ),
      );
      console.log(chalk.dim(`  warn at ${fmtUSD(limit.amount * 0.8)} (80%)`));
      console.log(
        chalk.dim(`\nMake sure the proxy is running: tokenclaw proxy`),
      );
    },
  );

// ── PROXY ──

program
  .command("proxy")
  .description(
    "Start the enforcement proxy (required for per-key alerts and caps)",
  )
  .option("--port <port>", "Port to listen on", "4040")
  .action((opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(chalk.red("Invalid port number"));
      process.exit(1);
    }
    startProxy(port);
  });

// ── CONFIG ──

const configCmd = program.command("config").description("Settings");

configCmd
  .command("show", { isDefault: true })
  .description("Show config")
  .action(() => {
    runConfig();
  });
configCmd
  .command("reset")
  .description("Reset to defaults")
  .action(() => {
    saveConfig({ ...DEFAULT_CONFIG });
    console.log(chalk.green("Config reset."));
  });
configCmd
  .command("slack <webhook>")
  .description("Set Slack webhook URL")
  .action((webhook: string) => {
    const config = loadConfig();
    config.alerts.slack_webhook = webhook;
    saveConfig(config);
    console.log(chalk.green("Slack webhook saved."));
  });

// ── HOOK ──

const HOOK_COMMAND = "tokenclaw status --oneliner 2>/dev/null || true";

const hookCmd = program
  .command("hook")
  .description("Claude Code hook integration");

hookCmd
  .command("install")
  .description("Add tokenclaw Stop hook to Claude Code settings")
  .action(() => {
    const claudeDir = join(homedir(), ".claude");
    const settingsPath = join(claudeDir, "settings.json");

    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, "utf-8");
        settings = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        settings = {};
      }
    }

    // Navigate into hooks.Stop
    if (!settings.hooks || typeof settings.hooks !== "object") {
      settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, unknown>;

    if (!Array.isArray(hooks.Stop)) {
      hooks.Stop = [];
    }
    const stopHooks = hooks.Stop as Array<Record<string, unknown>>;

    // Check if already installed
    const alreadyInstalled = stopHooks.some((group) => {
      const inner = group.hooks;
      if (!Array.isArray(inner)) return false;
      return inner.some(
        (h: Record<string, unknown>) =>
          typeof h.command === "string" && h.command.includes("tokenclaw"),
      );
    });

    if (alreadyInstalled) {
      console.log(chalk.dim("Hook already installed."));
      return;
    }

    stopHooks.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
        },
      ],
    });

    writeFileSync(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf-8",
    );
    console.log(chalk.green("Installed tokenclaw Stop hook."));
    console.log(chalk.dim(`  ${settingsPath}`));
    console.log(
      chalk.dim(`  After each turn you'll see: [tokenclaw] $18.32/$50 (37%)`),
    );
  });

hookCmd
  .command("uninstall")
  .description("Remove tokenclaw Stop hook from Claude Code settings")
  .action(() => {
    const settingsPath = join(homedir(), ".claude", "settings.json");

    if (!existsSync(settingsPath)) {
      console.log(chalk.dim("No Claude Code settings found."));
      return;
    }

    let settings: Record<string, unknown>;
    try {
      const raw = readFileSync(settingsPath, "utf-8");
      settings = JSON.parse(raw || "{}") as Record<string, unknown>;
    } catch {
      console.log(chalk.dim("Could not parse settings.json."));
      return;
    }

    const hooks = settings.hooks as Record<string, unknown> | undefined;
    if (!hooks || !Array.isArray(hooks.Stop)) {
      console.log(chalk.dim("No tokenclaw hook found."));
      return;
    }

    const stopHooks = hooks.Stop as Array<Record<string, unknown>>;
    const before = stopHooks.length;

    hooks.Stop = stopHooks.filter((group) => {
      const inner = group.hooks;
      if (!Array.isArray(inner)) return true;
      return !inner.some(
        (h: Record<string, unknown>) =>
          typeof h.command === "string" && h.command.includes("tokenclaw"),
      );
    });

    const after = (hooks.Stop as unknown[]).length;
    const removed = before - after;

    if (removed === 0) {
      console.log(chalk.dim("No tokenclaw hook found."));
      return;
    }

    writeFileSync(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf-8",
    );
    console.log(chalk.green(`Removed ${removed} tokenclaw hook(s).`));
    console.log(chalk.dim(`  ${settingsPath}`));
  });

// ── BASELINE ──

const DAY_NAMES_ORDERED = [
  { name: "Mon", dow: 1 },
  { name: "Tue", dow: 2 },
  { name: "Wed", dow: 3 },
  { name: "Thu", dow: 4 },
  { name: "Fri", dow: 5 },
  { name: "Sat", dow: 6 },
  { name: "Sun", dow: 0 },
];

program
  .command("baseline")
  .description("Show spending patterns based on historical data")
  .action(() => {
    initDB();
    const historyDays = getHistoryDays();

    if (historyDays < 7) {
      console.log(
        chalk.yellow(
          `Not enough data yet (${historyDays} days, need at least 7).`,
        ),
      );
      console.log(
        chalk.dim("Keep running tokenclaw and baselines will build up."),
      );
      return;
    }

    const todayDow = new Date().getDay();
    const todaySpend = getTodaySpend();

    console.log(
      chalk.bold(`Your spending patterns`) +
        chalk.dim(` (${historyDays} days of history)\n`),
    );

    // Header
    console.log(
      `  ${chalk.dim("Day".padEnd(12))}${chalk.dim("Median".padStart(10))}${chalk.dim("P95".padStart(10))}${chalk.dim("Today".padStart(10))}`,
    );

    for (const { name, dow } of DAY_NAMES_ORDERED) {
      const baseline = getBaselineForDay(dow);
      const medianStr =
        baseline.median > 0 ? fmtUSD(baseline.median) : chalk.dim("--");
      const p95Str = baseline.p95 > 0 ? fmtUSD(baseline.p95) : chalk.dim("--");

      let todayStr = "";
      let marker = "";
      if (dow === todayDow) {
        todayStr = fmtUSD(todaySpend);
        if (baseline.median > 0) {
          const pct = Math.round(
            ((todaySpend - baseline.median) / baseline.median) * 100,
          );
          if (pct > 0) {
            marker = chalk.yellow(` <- today (+${pct}%)`);
          } else if (pct < 0) {
            marker = chalk.green(` <- today (${pct}%)`);
          } else {
            marker = chalk.dim(" <- today");
          }
        } else {
          marker = chalk.dim(" <- today");
        }
      }

      const isToday = dow === todayDow;
      const dayLabel = isToday
        ? chalk.white.bold(name.padEnd(12))
        : chalk.white(name.padEnd(12));

      console.log(
        `  ${dayLabel}${medianStr.padStart(10)}${p95Str.padStart(10)}${todayStr.padStart(10)}${marker}`,
      );
    }

    // Per-tool baselines
    const toolBaselines = getToolBaselines();
    if (toolBaselines.length > 0) {
      console.log(chalk.bold("\nBy tool:"));
      for (const { tool, median } of toolBaselines) {
        if (median > 0) {
          console.log(
            `  ${chalk.white(tool.padEnd(20))} ${chalk.cyan(fmtUSD(median))}/day median`,
          );
        }
      }
    }
  });

// ── DIGEST ──

program
  .command("digest")
  .description("Send daily spend digest to Slack")
  .option("--install", "Schedule daily digest at 9 AM via launchd")
  .option("--uninstall", "Remove digest schedule")
  .action(async (opts: { install?: boolean; uninstall?: boolean }) => {
    if (opts.install) {
      const result = installDigest();
      console.log(
        result.ok ? chalk.green(result.message) : chalk.yellow(result.message),
      );
      return;
    }

    if (opts.uninstall) {
      const { uninstallDigest } = await import("./launchd.js");
      const result = uninstallDigest();
      console.log(
        result.ok ? chalk.green(result.message) : chalk.yellow(result.message),
      );
      return;
    }

    const { buildDigest } = await import("./digest.js");
    const digest = buildDigest();

    console.log(chalk.bold("tokenclaw daily digest\n"));
    console.log(
      `Yesterday: ${chalk.cyan("$" + digest.yesterday_usd.toFixed(2))} across ${digest.yesterday_sessions} tool${digest.yesterday_sessions === 1 ? "" : "s"}`,
    );
    const weekPct =
      digest.week_threshold > 0
        ? Math.round((digest.week_usd / digest.week_threshold) * 100)
        : 0;
    console.log(
      `This week: ${chalk.cyan("$" + digest.week_usd.toFixed(2))} / $${digest.week_threshold.toFixed(2)} (${weekPct}%)`,
    );
    console.log(
      `Top tool:  ${digest.top_tool.name} (${chalk.cyan("$" + digest.top_tool.cost.toFixed(2))})`,
    );
    console.log(
      `Top model: ${digest.top_model.name} (${chalk.cyan("$" + digest.top_model.cost.toFixed(2))})`,
    );
    console.log(
      `Avg daily: ${chalk.cyan("$" + digest.avg_daily.toFixed(2))} (last 7 days)`,
    );

    if (digest.avg_daily > 0 && digest.yesterday_usd > digest.avg_daily) {
      const pctAbove = Math.round(
        ((digest.yesterday_usd - digest.avg_daily) / digest.avg_daily) * 100,
      );
      console.log(chalk.yellow(`↑ ${pctAbove}% above your 7-day average`));
    }

    if (digest.baseline_context) {
      console.log(chalk.dim(`Baseline: ${digest.baseline_context}`));
    }

    const config = loadConfig();
    if (config.alerts.slack_webhook) {
      try {
        await sendSlackDigest(config.alerts.slack_webhook, digest);
        console.log(chalk.dim("\nSlack digest sent."));
      } catch (err) {
        console.error(chalk.red(`\nSlack send failed: ${err}`));
      }
    } else {
      console.log(
        chalk.dim(
          "\nNo Slack webhook configured. Run: tokenclaw config slack <url>",
        ),
      );
    }
  });

// ── MCP ──

const mcpCmd = program
  .command("mcp")
  .description("MCP server — let agents self-check their budget");

mcpCmd
  .command("start", { isDefault: true })
  .description("Start MCP server on stdio")
  .action(async () => {
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer();
  });

mcpCmd
  .command("install")
  .description("Add tokenclaw MCP server to Claude Code settings")
  .action(() => {
    const claudeDir = join(homedir(), ".claude");
    const settingsPath = join(claudeDir, "settings.json");

    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, "utf-8");
        settings = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        settings = {};
      }
    }

    if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
      settings.mcpServers = {};
    }
    const mcpServers = settings.mcpServers as Record<string, unknown>;

    if (mcpServers.tokenclaw) {
      console.log(chalk.dim("MCP server already installed."));
      return;
    }

    mcpServers.tokenclaw = {
      command: "tokenclaw",
      args: ["mcp"],
    };

    writeFileSync(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf-8",
    );
    console.log(chalk.green("Installed tokenclaw MCP server."));
    console.log(chalk.dim(`  ${settingsPath}`));
    console.log(
      chalk.dim(
        "  Agents can now call get_budget_status, get_session_cost, estimate_cost",
      ),
    );
  });

mcpCmd
  .command("uninstall")
  .description("Remove tokenclaw MCP server from Claude Code settings")
  .action(() => {
    const settingsPath = join(homedir(), ".claude", "settings.json");

    if (!existsSync(settingsPath)) {
      console.log(chalk.dim("No Claude Code settings found."));
      return;
    }

    let settings: Record<string, unknown>;
    try {
      const raw = readFileSync(settingsPath, "utf-8");
      settings = JSON.parse(raw || "{}") as Record<string, unknown>;
    } catch {
      console.log(chalk.dim("Could not parse settings.json."));
      return;
    }

    const mcpServers = settings.mcpServers as
      | Record<string, unknown>
      | undefined;
    if (!mcpServers || !mcpServers.tokenclaw) {
      console.log(chalk.dim("No tokenclaw MCP server found."));
      return;
    }

    delete mcpServers.tokenclaw;

    writeFileSync(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf-8",
    );
    console.log(chalk.green("Removed tokenclaw MCP server."));
    console.log(chalk.dim(`  ${settingsPath}`));
  });

program.parse();
