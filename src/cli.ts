#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { existsSync } from "node:fs";
import { scanLocalTools } from "./scanners/local.js";
import {
  evaluateAlerts,
  type AlertRule,
  type CostSnapshot as EngineCostSnapshot,
  type AlertHistoryEntry,
} from "./alerts/engine.js";
import { sendSlackAlert } from "./alerts/slack.js";
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
} from "./db.js";
import { startProxy } from "./proxy/server.js";
import { getBudgetWindowStart } from "./proxy/parse.js";

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

/** Convert scan results to the CostSnapshot shape the engine expects.
 *  Only includes API-billed tools — subscription tools have flat monthly
 *  costs that don't map to daily/weekly spend thresholds. */
function scanToEngineSnapshots(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): EngineCostSnapshot[] {
  return found
    .filter((t) => t.billingType === "api")
    .map((t) => ({
      provider: "local",
      tool: t.tool,
      date: todayISO(),
      amount_usd: t.totalCost,
    }));
}

/** Save scan results to DB as cost snapshots. */
function persistScanToDB(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  const date = todayISO();
  for (const tool of found) {
    for (const [model, usage] of Object.entries(tool.modelUsage)) {
      insertCostSnapshot(
        tool.tool,
        date,
        usage.costUSD,
        {
          input: usage.inputTokens,
          output: usage.outputTokens,
          cacheRead: usage.cacheReadTokens,
        },
        model,
      );
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

function shortProject(name: string): string {
  if (/^[0-9a-f]{8}-/.test(name)) return "(session)";
  const parts = name.split("/");
  const last = parts[parts.length - 1] || name;
  if (parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  return last;
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
    chalk.dim(`Run ${chalk.white("tokenclaw init")} to set up spend alerts.`),
  );
}

async function runFirstRun(): Promise<void> {
  initDB();

  console.log(chalk.bold("\nWelcome to tokenclaw!\n"));
  console.log(chalk.dim("Scanning local AI tools...\n"));
  const { found, notFound } = await scanLocalTools();

  printScanResults(found, notFound);
  persistScanToDB(found);

  const rl = createInterface({ input: stdin, output: stdout });

  console.log(chalk.bold("\n\nWhat would you like to set up?\n"));
  console.log(
    `  ${chalk.white("1)")} Alerts only — get notified when spend crosses a threshold`,
  );
  console.log(
    `  ${chalk.white("2)")} Alerts + hard cap — block requests when a per-key budget is exceeded`,
  );
  console.log(chalk.dim("     (option 2 requires running a local proxy)\n"));

  const choice = await rl.question("Choose [1/2]: ");

  if (choice.trim() === "2") {
    await setupProxy(rl);
  } else {
    await setupAlerts(rl);
  }

  rl.close();
}

async function setupAlerts(
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  console.log(chalk.bold("\n— Alert setup —\n"));

  const dailyStr = await rl.question(
    `Daily spend threshold (USD) [${DEFAULT_CONFIG.thresholds.daily}]: `,
  );
  const daily = dailyStr ? Number(dailyStr) : DEFAULT_CONFIG.thresholds.daily;

  const slackWebhook = await rl.question("Slack webhook URL (optional): ");

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

  console.log(chalk.green(`\nConfig saved to ${getConfigPath()}`));
  console.log(
    `\nNext: run ${chalk.cyan("tokenclaw watch")} to start monitoring.`,
  );
  console.log(
    chalk.dim("You can upgrade to per-key budgets + blocking later with ") +
      chalk.white("tokenclaw proxy") +
      chalk.dim("."),
  );
}

async function setupProxy(
  rl: ReturnType<typeof createInterface>,
): Promise<void> {
  console.log(chalk.bold("\n— Proxy + per-key budget setup —\n"));

  const keyPrefix = await rl.question(
    "API key prefix to budget (e.g. sk-ant-research): ",
  );
  if (!keyPrefix.trim()) {
    console.log(
      chalk.yellow(
        "No key entered. You can add one later with: tokenclaw set --key <prefix> --budget <amount>/<period>",
      ),
    );
    saveConfig({ ...DEFAULT_CONFIG });
    return;
  }

  const budgetStr = await rl.question("Budget (e.g. 10/day, 500/week): ");
  let base: ReturnType<typeof parseBudgetString>;
  try {
    base = parseBudgetString(budgetStr || "100/day");
  } catch (err) {
    console.error(chalk.red(String(err)));
    saveConfig({ ...DEFAULT_CONFIG });
    return;
  }

  const warnStr = await rl.question("Warn at what % of budget? [80]: ");
  const warnAt = warnStr ? parseInt(warnStr, 10) : 80;

  const blockStr = await rl.question(
    "Block at what % of budget? (leave blank to skip): ",
  );
  const rules: Array<{ at: number; action: "alert" | "block" }> = [
    { at: warnAt, action: "alert" },
  ];
  if (blockStr.trim()) {
    rules.push({ at: parseInt(blockStr, 10), action: "block" });
  }
  rules.sort((a, b) => a.at - b.at);

  const slackWebhook = await rl.question("Slack webhook URL (optional): ");

  const config: AccConfig = {
    ...DEFAULT_CONFIG,
    alerts: {
      ...DEFAULT_CONFIG.alerts,
      slack_webhook: slackWebhook || "",
    },
    key_budgets: {
      [keyPrefix.trim()]: { ...base, rules },
    },
  };

  saveConfig(config);

  console.log(chalk.green(`\nConfig saved to ${getConfigPath()}`));
  console.log(`\nNext: start the proxy and point your agent at it:\n`);
  console.log(chalk.cyan("  tokenclaw proxy"));
  console.log(chalk.cyan("  ANTHROPIC_BASE_URL=http://localhost:4040 claude"));
}

async function runScan(): Promise<void> {
  if (isFirstRun()) {
    await runFirstRun();
    return;
  }

  initDB();
  console.log(chalk.dim("Scanning local AI tools...\n"));
  const { found, notFound } = await scanLocalTools();

  printScanResults(found, notFound);
  persistScanToDB(found);
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

    const snapshots = scanToEngineSnapshots(found);
    const rules = buildRules(config);
    const history = dbAlertsToHistory(getRecentAlerts(168)); // 7 days
    const ackState = getAckState();
    const actions = evaluateAlerts(snapshots, rules, history, ackState);

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

  if (ruleName) {
    acknowledgeAlert(ruleName, config.acknowledge_ttl);
    console.log(
      chalk.green(`Acknowledged: ${ruleName}`) +
        chalk.dim(` (silenced for ${config.acknowledge_ttl}h)`),
    );
    return;
  }

  // Ack all active alerts
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
    console.log(
      chalk.green(`Acknowledged ${count} alert(s).`) +
        chalk.dim(` Silenced for ${config.acknowledge_ttl}h.`),
    );
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
  console.log(chalk.dim("Scanning local AI tools...\n"));
  const { found } = await scanLocalTools();
  persistScanToDB(found);

  if (found.length === 0) {
    console.log(chalk.yellow("No AI tool usage data found."));
    return;
  }

  switch (view) {
    case "models":
      listModels(found);
      break;
    case "projects":
      listProjects(found);
      break;
    case "trends":
      listTrends(found);
      break;
    case "usage":
      listUsage(found);
      break;
    case "efficiency":
      listEfficiency(found);
      break;
    default:
      console.log(chalk.red(`Unknown view: ${view}`));
      console.log(
        chalk.dim("Available: models, projects, trends, usage, efficiency"),
      );
  }
}

function listModels(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  console.log(chalk.bold("Cost by model\n"));

  const allModels: Record<
    string,
    { cost: number; input: number; output: number; tools: string[] }
  > = {};

  for (const t of found) {
    for (const [model, usage] of Object.entries(t.modelUsage)) {
      if (!allModels[model]) {
        allModels[model] = { cost: 0, input: 0, output: 0, tools: [] };
      }
      allModels[model].cost += usage.costUSD;
      allModels[model].input += usage.inputTokens;
      allModels[model].output += usage.outputTokens;
      if (!allModels[model].tools.includes(t.tool)) {
        allModels[model].tools.push(t.tool);
      }
    }
  }

  const sorted = Object.entries(allModels).sort(
    ([, a], [, b]) => b.cost - a.cost,
  );
  const maxCost = sorted[0]?.[1].cost || 1;

  for (const [model, data] of sorted) {
    const barLen = Math.max(1, Math.round((data.cost / maxCost) * 20));
    const bar =
      chalk.cyan("█".repeat(barLen)) + chalk.dim("░".repeat(20 - barLen));
    console.log(
      `  ${chalk.white(shortModel(model).padEnd(18))} ${chalk.cyan(fmtUSD(data.cost).padStart(10))}  ${bar}  ${chalk.dim(fmtTokens(data.input + data.output) + " tokens")}`,
    );
    console.log(chalk.dim(`  ${"".padEnd(18)} ${data.tools.join(", ")}`));
  }
}

function listProjects(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  console.log(chalk.bold("Cost by project\n"));

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

  for (const [key, data] of sorted.slice(0, 15)) {
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
    const inputPct = total > 0 ? Math.round((t.inputTokens / total) * 100) : 0;
    const outputPct = 100 - inputPct;

    console.log(chalk.white(`  ${t.tool}`));
    console.log(
      `    Input:    ${chalk.cyan(fmtTokens(t.inputTokens).padStart(8))}  ${chalk.dim(`(${inputPct}%)`)}`,
    );
    console.log(
      `    Output:   ${chalk.cyan(fmtTokens(t.outputTokens).padStart(8))}  ${chalk.dim(`(${outputPct}%)`)}`,
    );
    console.log(
      `    Cache:    ${chalk.green(fmtTokens(t.cacheReadTokens).padStart(8))}  ${chalk.dim("read")}` +
        `   ${chalk.yellow(fmtTokens(t.cacheCreationTokens).padStart(8))}  ${chalk.dim("write")}`,
    );
    console.log(
      `    Total:    ${chalk.white(fmtTokens(total).padStart(8))}  ${chalk.dim(`across ${t.sessions} sessions`)}`,
    );
    console.log();
  }
}

function listEfficiency(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): void {
  console.log(chalk.bold("Efficiency\n"));

  for (const t of found) {
    const totalTokens = t.inputTokens + t.outputTokens;
    const costPerSession = t.sessions > 0 ? t.totalCost / t.sessions : 0;
    const cacheTotal = t.cacheReadTokens + t.cacheCreationTokens;
    const cacheHitRate =
      cacheTotal > 0
        ? Math.round(
            (t.cacheReadTokens / (t.cacheReadTokens + t.inputTokens)) * 100,
          )
        : 0;

    console.log(chalk.white(`  ${t.tool}`));
    console.log(`    Cost/session:   ${chalk.cyan(fmtUSD(costPerSession))}`);
    console.log(
      `    Cost/1K tokens: ${chalk.cyan(fmtUSD(totalTokens > 0 ? (t.totalCost / totalTokens) * 1000 : 0))}`,
    );
    console.log(
      `    Cache hit rate: ${cacheHitRate > 50 ? chalk.green(`${cacheHitRate}%`) : chalk.yellow(`${cacheHitRate}%`)}`,
    );

    if (t.billingType === "subscription" && t.planCost) {
      const leverage =
        t.planCost > 0 ? Math.round(t.totalCost / t.planCost) : 0;
      console.log(
        `    Subscription:   ${chalk.green(`${leverage}x`)} value ${chalk.dim(`(paying $${t.planCost}/mo, consuming ${fmtUSD(t.totalCost)} at API rates)`)}`,
      );
    }
    console.log();
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
  .description("Claw back your agent spend — per-key budget caps + local proxy")
  .version("0.2.0")
  .option("--no-color", "Disable colored output")
  .option("--config <path>", "Custom config file path")
  .hook("preAction", (_thisCommand, _actionCommand) => {
    const opts = program.opts();
    if (opts.color === false) {
      // chalk@5: setting level to 0 disables color
      chalk.level = 0;
    }
  });

// Default command: scan
program
  .command("scan", { isDefault: true })
  .description("Scan local AI tools and show spend summary")
  .action(async () => {
    await runScan();
  });

program
  .command("watch")
  .description("Continuously monitor spend and fire alerts")
  .option("--once", "Run once and exit (no interval)")
  .action(async (opts: { once?: boolean }) => {
    await runWatch(!!opts.once);
  });

program
  .command("list [view]")
  .description("Detailed views: models, projects, trends, usage, efficiency")
  .action(async (view?: string) => {
    if (!view) {
      console.log(chalk.bold("Available views:\n"));
      console.log("  tokenclaw list models      Cost breakdown by model");
      console.log("  tokenclaw list projects     Cost breakdown by project");
      console.log("  tokenclaw list trends       Daily spend over time");
      console.log("  tokenclaw list usage        Token counts and breakdown");
      console.log(
        "  tokenclaw list efficiency   Cache hit rates, cost per session",
      );
      return;
    }
    await runList(view);
  });

program
  .command("ack [rule-name]")
  .description("Acknowledge an alert (silence for TTL)")
  .action((ruleName?: string) => {
    runAck(ruleName);
  });

program
  .command("status")
  .description("Show current spend and alert status")
  .action(() => {
    runStatus();
  });

program
  .command("init")
  .description("Interactive first-run setup")
  .action(async () => {
    await runInit();
  });

program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    runConfig();
  });

program
  .command("set")
  .description("Set a per-key budget with rules")
  .requiredOption("--key <prefix>", "API key prefix to budget")
  .requiredOption(
    "--budget <amount>",
    "Budget in format: 10/day, 500/week, 2000/month",
  )
  .option("--warn <pct...>", "Alert at N% of budget (repeatable)")
  .option("--block <pct>", "Block requests at N% of budget")
  .action(
    (opts: {
      key: string;
      budget: string;
      warn?: string[];
      block?: string;
    }) => {
      try {
        const base = parseBudgetString(opts.budget);
        const rules: Array<{ at: number; action: "alert" | "block" }> = [];

        if (opts.warn) {
          for (const w of opts.warn) {
            rules.push({ at: parseInt(w, 10), action: "alert" });
          }
        }
        if (opts.block) {
          rules.push({ at: parseInt(opts.block, 10), action: "block" });
        }
        if (rules.length === 0) {
          rules.push({ at: 80, action: "alert" });
        }
        rules.sort((a, b) => a.at - b.at);

        const keyBudget = { ...base, rules };
        const config = loadConfig();
        config.key_budgets[opts.key] = keyBudget;
        saveConfig(config);

        console.log(
          chalk.green(`Set: ${opts.key} → $${base.budget}/${base.period}`),
        );
        for (const r of rules) {
          const label =
            r.action === "block"
              ? chalk.red(`block at ${r.at}%`)
              : chalk.yellow(`warn at ${r.at}%`);
          console.log(`  ${label}`);
        }
      } catch (err) {
        console.error(chalk.red(String(err)));
        process.exit(1);
      }
    },
  );

program
  .command("keys")
  .description("Show registered keys with spend vs budget")
  .action(() => {
    initDB();
    const config = loadConfig();
    const budgets = config.key_budgets;

    if (Object.keys(budgets).length === 0) {
      console.log(
        chalk.dim(
          "No key budgets configured. Use: tokenclaw set --key <prefix> --budget <amount>/<period>",
        ),
      );
      return;
    }

    const todayStart = getBudgetWindowStart("day");

    console.log(chalk.bold.underline("Key Budgets"));
    for (const [prefix, budget] of Object.entries(budgets)) {
      const since = getBudgetWindowStart(budget.period);
      const spent = getSpendByKeyPrefix(prefix, since);
      const pct =
        budget.budget > 0 ? Math.round((spent / budget.budget) * 100) : 0;
      const hasBlock = budget.rules.some((r) => r.action === "block");
      const bar =
        pct >= 100 && hasBlock
          ? chalk.red("BLOCKED")
          : pct >= 100
            ? chalk.yellow("OVER")
            : pct >= 80
              ? chalk.yellow(`${pct}%`)
              : chalk.green(`${pct}%`);

      console.log(
        `  ${chalk.white(prefix.padEnd(30))} ${fmtUSD(spent)} / ${fmtUSD(budget.budget)} ${budget.period}   (${bar})`,
      );
      for (const r of budget.rules) {
        const label =
          r.action === "block"
            ? chalk.red(`  block at ${r.at}%`)
            : chalk.dim(`  warn at ${r.at}%`);
        console.log(label);
      }
    }

    // Show unregistered key spend
    const breakdown = getKeyBreakdown(todayStart);
    const registeredPrefixes = Object.keys(budgets);
    const unregistered = breakdown.filter(
      (row) =>
        !registeredPrefixes.some(
          (p) => row.api_key_prefix === p || row.api_key_prefix.startsWith(p),
        ),
    );

    if (unregistered.length > 0) {
      const unregTotal = unregistered.reduce((s, r) => s + r.total_cost, 0);
      console.log(
        chalk.dim(`  (unregistered keys)`.padEnd(32)) +
          chalk.dim(`${fmtUSD(unregTotal)} today`) +
          chalk.dim("           (no limit)"),
      );
    }
  });

program
  .command("proxy")
  .description("Start the local proxy server")
  .option("--port <port>", "Port to listen on", "4040")
  .action((opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(chalk.red("Invalid port number"));
      process.exit(1);
    }
    startProxy(port);
  });

program.parse();
