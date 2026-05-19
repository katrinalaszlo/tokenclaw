#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

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
import { generateDashboard, type DashboardData } from "./dashboard/template.js";
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

/** Convert scan results to the CostSnapshot shape the engine expects. */
function scanToEngineSnapshots(
  found: Awaited<ReturnType<typeof scanLocalTools>>["found"],
): EngineCostSnapshot[] {
  return found.map((t) => ({
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

async function runScan(): Promise<void> {
  initDB();
  console.log(chalk.dim("Scanning local AI tools...\n"));
  const { found, notFound } = await scanLocalTools();

  if (found.length === 0) {
    console.log(chalk.yellow("No AI tool usage data found."));
    if (notFound.length > 0) {
      console.log(chalk.dim(`Checked: ${notFound.join(", ")}`));
    }
    return;
  }

  // Compute actual spend (subscription cost for sub tools, token estimate for API tools)
  let totalActual = 0;
  let totalConsumed = 0;
  for (const t of found) {
    totalConsumed += t.totalCost;
    totalActual +=
      t.billingType === "subscription" && t.planCost ? t.planCost : t.totalCost;
  }
  const totalSessions = found.reduce((s, t) => s + t.sessions, 0);

  console.log(
    chalk.bold("What you paid: ") + chalk.cyan(fmtUSD(totalActual) + "/mo"),
  );
  console.log(
    chalk.dim(`What you consumed: ${fmtUSD(totalConsumed)} at API rates\n`),
  );

  // Per-tool breakdown
  console.log(chalk.bold.underline("Tools found:"));
  for (const t of found.sort((a, b) => b.totalCost - a.totalCost)) {
    if (t.billingType === "subscription") {
      console.log(
        `  ${chalk.white(t.tool.padEnd(20))} ${chalk.green(t.planName + " $" + t.planCost + "/mo").padStart(10)}` +
          chalk.dim(`  ${t.sessions} sessions`) +
          chalk.dim(`  consumed ~${fmtUSD(t.totalCost)} at API rates`),
      );
    } else {
      console.log(
        `  ${chalk.white(t.tool.padEnd(20))} ${chalk.cyan(fmtUSD(t.totalCost).padStart(10))}` +
          chalk.dim(
            `  ${t.sessions} sessions  ${fmtTokens(t.inputTokens + t.outputTokens)} tokens`,
          ) +
          chalk.yellow("  API"),
      );
    }

    const topProjects = t.projects.slice(0, 3);
    for (const p of topProjects) {
      console.log(chalk.dim(`    ${p.name.padEnd(30)} ${fmtUSD(p.cost)}`));
    }
  }

  if (notFound.length > 0) {
    console.log(chalk.dim(`\nNot found: ${notFound.join(", ")}`));
  }

  // Persist to DB
  persistScanToDB(found);
  console.log(chalk.dim("\nSnapshots saved to DB."));
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

async function runDashboard(): Promise<void> {
  initDB();
  const config = loadConfig();

  console.log(chalk.dim("Scanning..."));
  const { found } = await scanLocalTools();
  persistScanToDB(found);

  const totalSpend = found.reduce(
    (s, t) =>
      s +
      (t.billingType === "subscription" && t.planCost
        ? t.planCost
        : t.totalCost),
    0,
  );
  const todaySpend = getTodaySpend();
  const dailyAverage = getAverageDaily(30);

  // Aggregate tools
  const tools = found
    .map((t) => ({
      name: t.tool,
      cost: t.totalCost,
      sessions: t.sessions,
      tokens: t.inputTokens + t.outputTokens,
      billingType: t.billingType,
      planName: t.planName,
      planCost: t.planCost,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Aggregate models across all tools
  const modelMap = new Map<string, number>();
  for (const t of found) {
    for (const [model, usage] of Object.entries(t.modelUsage)) {
      modelMap.set(model, (modelMap.get(model) ?? 0) + usage.costUSD);
    }
  }
  const models = [...modelMap.entries()]
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost);

  // Alert state
  const snapshots = scanToEngineSnapshots(found);
  const rules = buildRules(config);
  const history = dbAlertsToHistory(getRecentAlerts(168));
  const ackState = getAckState();
  const actions = evaluateAlerts(snapshots, rules, history, ackState);

  const alerts: DashboardData["alerts"] = actions.map((a) => ({
    rule: a.ruleName,
    status: "active" as const,
    message: `${fmtUSD(a.amount)} spent (threshold: ${fmtUSD(a.threshold)})`,
    timestamp: new Date().toISOString(),
    escalationLevel: a.level,
  }));

  // Add acknowledged alerts
  for (const [id, ack] of Object.entries(ackState)) {
    alerts.push({
      rule: id,
      status: "acknowledged",
      message: `Acknowledged until ${new Date(ack.expiresAt).toLocaleString()}`,
      timestamp: ack.acknowledgedAt,
      escalationLevel: 0,
    });
  }

  // Burn rate
  const trend: "rising" | "falling" | "stable" =
    dailyAverage <= 0
      ? "stable"
      : todaySpend > dailyAverage * 1.5
        ? "rising"
        : todaySpend < dailyAverage * 0.5
          ? "falling"
          : "stable";

  // Flatten daily costs across all tools for the time series chart
  const dailyCosts: { date: string; cost: number; tool: string }[] = [];
  for (const t of found) {
    for (const d of t.dailyCosts) {
      dailyCosts.push({ date: d.date, cost: d.cost, tool: t.tool });
    }
  }

  const dashboardData: DashboardData = {
    totalActualSpend: totalSpend,
    tools,
    models,
    alerts,
    burnRate: {
      current: todaySpend,
      average: dailyAverage,
      trend,
    },
    dailyCosts,
  };

  const html = generateDashboard(dashboardData);
  const PORT = 3456;

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(PORT, async () => {
    const url = `http://localhost:${PORT}`;
    console.log(chalk.bold(`Dashboard: ${chalk.cyan(url)}`));
    console.log(chalk.dim("Ctrl+C to stop.\n"));

    try {
      const openModule = await import("open");
      await openModule.default(url);
    } catch {
      console.log(chalk.dim("Install 'open' to auto-open browser."));
    }
  });
}

async function runInit(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(chalk.bold("Agent Cost Control — Setup\n"));

  const dailyStr = await rl.question(
    `Daily spend threshold (USD) [${DEFAULT_CONFIG.thresholds.daily}]: `,
  );
  const daily = dailyStr ? Number(dailyStr) : DEFAULT_CONFIG.thresholds.daily;

  const weeklyStr = await rl.question(
    `Weekly spend threshold (USD) [${DEFAULT_CONFIG.thresholds.weekly}]: `,
  );
  const weekly = weeklyStr
    ? Number(weeklyStr)
    : DEFAULT_CONFIG.thresholds.weekly;

  const slackWebhook = await rl.question("Slack webhook URL (optional): ");

  const config: AccConfig = {
    ...DEFAULT_CONFIG,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      daily,
      weekly,
    },
    alerts: {
      ...DEFAULT_CONFIG.alerts,
      slack_webhook: slackWebhook || "",
    },
  };

  saveConfig(config);
  console.log(chalk.green(`\nConfig saved to ${getConfigPath()}`));

  const cronAnswer = await rl.question("Set up hourly cron job? (y/N): ");
  if (cronAnswer.toLowerCase() === "y") {
    console.log(chalk.dim("\nAdd this line to your crontab (crontab -e):"));
    console.log(
      chalk.cyan("0 * * * * acc watch --once 2>&1 >> ~/.acc/watch.log"),
    );
  }

  rl.close();
  console.log(chalk.dim("\nDone. Run 'acc scan' to see your first report."));
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
  .command("dashboard")
  .description("Open spend dashboard in browser")
  .action(async () => {
    await runDashboard();
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
  .description("Set a per-key budget")
  .requiredOption("--key <prefix>", "API key prefix to budget")
  .requiredOption(
    "--budget <amount>",
    "Budget in format: 10/day, 500/week, 2000/month",
  )
  .action((opts: { key: string; budget: string }) => {
    try {
      const keyBudget = parseBudgetString(opts.budget);
      const config = loadConfig();
      config.key_budgets[opts.key] = keyBudget;
      saveConfig(config);
      console.log(
        chalk.green(
          `Set budget: ${opts.key} → $${keyBudget.budget}/${keyBudget.period}`,
        ),
      );
    } catch (err) {
      console.error(chalk.red(String(err)));
      process.exit(1);
    }
  });

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
      const bar =
        pct >= 100
          ? chalk.red("BLOCKED")
          : pct >= 80
            ? chalk.yellow(`${pct}%`)
            : chalk.green(`${pct}%`);

      console.log(
        `  ${chalk.white(prefix.padEnd(30))} ${fmtUSD(spent)} / ${fmtUSD(budget.budget)} ${budget.period}   (${bar})`,
      );
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
