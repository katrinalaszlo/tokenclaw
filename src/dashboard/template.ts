export type DashboardData = {
  totalActualSpend: number;
  tools: {
    name: string;
    cost: number;
    sessions: number;
    tokens: number;
    billingType: "subscription" | "api";
    planName?: string;
    planCost?: number;
  }[];
  models: { name: string; cost: number }[];
  alerts: {
    rule: string;
    status: "active" | "acknowledged" | "resolved";
    message: string;
    timestamp: string;
    escalationLevel: number;
  }[];
  burnRate: {
    current: number;
    average: number;
    trend: "rising" | "falling" | "stable";
  };
  dailyCosts: { date: string; cost: number; tool: string }[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtCost(n: number): string {
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1000)
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function trendArrow(trend: "rising" | "falling" | "stable"): string {
  if (trend === "rising") return "&#9650;";
  if (trend === "falling") return "&#9660;";
  return "&#8212;";
}

function trendClass(trend: "rising" | "falling" | "stable"): string {
  if (trend === "rising") return "up";
  if (trend === "falling") return "down";
  return "neutral";
}

function burnColor(current: number, average: number): string {
  if (average <= 0) return "accent";
  const ratio = current / average;
  if (ratio >= 2) return "red";
  if (ratio >= 1.3) return "amber";
  return "green";
}

function alertSeverityClass(level: number): string {
  if (level >= 3) return "severity-critical";
  if (level >= 2) return "severity-warning";
  return "severity-info";
}

function alertIcon(level: number): string {
  if (level >= 3) return "&#9889;";
  if (level >= 2) return "&#9888;";
  return "&#9432;";
}

const CHART_COLORS = [
  "#00d4ff",
  "#a855f7",
  "#00e676",
  "#ffb800",
  "#ff4444",
  "#3b82f6",
  "#f472b6",
  "#fb923c",
];

export function generateDashboard(data: DashboardData): string {
  const activeAlerts = data.alerts.filter((a) => a.status === "active");
  const ackedAlerts = data.alerts.filter((a) => a.status === "acknowledged");

  const subscriptionTools = data.tools.filter(
    (t) => t.billingType === "subscription",
  );
  const apiTools = data.tools.filter((t) => t.billingType === "api");

  const modelLabels = data.models.map((m) => escapeHtml(m.name));
  const modelCosts = data.models.map((m) => Math.round(m.cost * 100) / 100);
  const totalModelCost = modelCosts.reduce((a, b) => a + b, 0);

  const bc = burnColor(data.burnRate.current, data.burnRate.average);
  const tc = trendClass(data.burnRate.trend);

  // --- Daily cost time series ---
  const dailyAgg = new Map<string, Record<string, number>>();
  for (const entry of data.dailyCosts) {
    if (!dailyAgg.has(entry.date)) dailyAgg.set(entry.date, {});
    const day = dailyAgg.get(entry.date)!;
    day[entry.tool] = (day[entry.tool] || 0) + entry.cost;
  }
  const dailyDates = [...dailyAgg.keys()].sort();
  const toolNames = [...new Set(data.dailyCosts.map((d) => d.tool))];
  const dailyDatasets = toolNames.map((tool, i) => ({
    label: tool,
    data: dailyDates.map(
      (date) => Math.round((dailyAgg.get(date)?.[tool] || 0) * 100) / 100,
    ),
    borderColor: CHART_COLORS[i % CHART_COLORS.length],
    backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "33",
    fill: true,
    tension: 0.3,
    pointRadius: 2,
    borderWidth: 2,
  }));

  // --- Provider breakdown bars from models ---
  const maxModelCost = Math.max(...modelCosts, 1);
  const providerBarsHtml = data.models.length
    ? data.models
        .sort((a, b) => b.cost - a.cost)
        .map((m, i) => {
          const pct =
            totalModelCost > 0
              ? Math.round((m.cost / totalModelCost) * 100)
              : 0;
          const widthPct = Math.max(
            2,
            Math.round((m.cost / maxModelCost) * 100),
          );
          const color = CHART_COLORS[i % CHART_COLORS.length];
          return `
          <div class="provider-bar">
            <span class="provider-name">${escapeHtml(m.name)}</span>
            <div class="provider-track"><div class="provider-fill" style="width:${widthPct}%;background:${color};">${pct > 8 ? pct + "%" : ""}</div></div>
            <span class="provider-amount">${fmtCost(m.cost)}</span>
          </div>`;
        })
        .join("")
    : '<div class="empty-state"><div class="empty-icon">&#128269;</div><div class="empty-title">No model data</div></div>';

  // --- Agent cost table rows ---
  const sortedTools = [...data.tools].sort((a, b) => {
    const costA =
      a.billingType === "subscription" ? (a.planCost ?? a.cost) : a.cost;
    const costB =
      b.billingType === "subscription" ? (b.planCost ?? b.cost) : b.cost;
    return costB - costA;
  });

  const agentTableRows = sortedTools
    .map((t) => {
      const displayCost =
        t.billingType === "subscription" ? (t.planCost ?? t.cost) : t.cost;
      const badgeHtml =
        t.billingType === "subscription"
          ? `<span class="badge active"><span class="dot"></span> ${escapeHtml(t.planName ?? "Subscription")}</span>`
          : `<span class="badge info"><span class="dot"></span> API</span>`;
      const costDisplay =
        t.billingType === "subscription"
          ? `${fmtCost(t.planCost ?? 0)}/mo`
          : fmtCost(t.cost);

      return `
            <tr>
              <td><span class="agent-name">${escapeHtml(t.name)}</span></td>
              <td>${badgeHtml}</td>
              <td class="mono">${costDisplay}</td>
              <td class="mono">${fmtCost(t.cost)}</td>
              <td class="mono">${t.sessions.toLocaleString()}</td>
              <td class="mono">${fmt(t.tokens)}</td>
            </tr>`;
    })
    .join("");

  // --- Active alert cards ---
  const activeAlertsHtml = activeAlerts.length
    ? activeAlerts
        .map(
          (a) => `
        <div class="alert-card ${alertSeverityClass(a.escalationLevel)}">
          <div class="alert-icon">${alertIcon(a.escalationLevel)}</div>
          <div class="alert-body">
            <div class="alert-title">${escapeHtml(a.rule)}</div>
            <div class="alert-desc">${escapeHtml(a.message)}</div>
            <div class="alert-time">${escapeHtml(a.timestamp)}${a.escalationLevel > 1 ? ` &middot; escalated ${a.escalationLevel}x` : ""}</div>
            <div class="alert-actions" style="margin-top:12px;">
              <button class="btn btn-secondary btn-sm">Acknowledge</button>
              <button class="btn btn-secondary btn-sm">Snooze</button>
              <button class="btn btn-secondary btn-sm">View Details</button>
            </div>
          </div>
        </div>`,
        )
        .join("")
    : "";

  const ackedAlertsHtml = ackedAlerts
    .map(
      (a) => `
      <div class="alert-card severity-info" style="opacity:0.7;">
        <div class="alert-icon">&#10003;</div>
        <div class="alert-body">
          <div class="alert-title">${escapeHtml(a.rule)}</div>
          <div class="alert-desc">${escapeHtml(a.message)}</div>
          <div class="alert-time">${escapeHtml(a.timestamp)}</div>
        </div>
      </div>`,
    )
    .join("");

  const alertSectionHtml =
    activeAlerts.length === 0 && ackedAlerts.length === 0
      ? `<div class="no-alerts">No active alerts</div>`
      : `${activeAlertsHtml}${ackedAlertsHtml}`;

  // --- Filter buttons for alerts ---
  const filterBarHtml =
    data.alerts.length > 0
      ? `
      <div class="filter-bar">
        <button class="filter-btn active">All</button>
        <button class="filter-btn">Critical</button>
        <button class="filter-btn">Warning</button>
        <button class="filter-btn">Info</button>
      </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard — tokenclaw</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-tertiary: #1a1a28;
  --bg-hover: #1e1e2e;
  --border: #2a2a3a;
  --border-subtle: #1e1e2e;
  --text-primary: #e8e8f0;
  --text-secondary: #8888a0;
  --text-muted: #555570;
  --accent: #00d4ff;
  --accent-dim: rgba(0, 212, 255, 0.15);
  --accent-glow: rgba(0, 212, 255, 0.3);
  --green: #00e676;
  --green-dim: rgba(0, 230, 118, 0.15);
  --amber: #ffb800;
  --amber-dim: rgba(255, 184, 0, 0.15);
  --red: #ff4444;
  --red-dim: rgba(255, 68, 68, 0.15);
  --purple: #a855f7;
  --purple-dim: rgba(168, 85, 247, 0.15);
  --radius: 8px;
  --radius-lg: 12px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", "Fira Code", "Consolas", monospace;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--accent);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}

/* Layout */
.app-layout {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-subtle);
  padding: 24px 0;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.sidebar-logo {
  padding: 0 20px 24px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 8px;
}

.sidebar-logo h1 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-logo h1 .logo-icon {
  width: 28px;
  height: 28px;
  background: var(--accent);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #000;
  font-weight: 800;
}

.sidebar-logo .logo-sub {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.sidebar-nav {
  flex: 1;
  padding: 8px 12px;
}

.nav-section {
  margin-bottom: 24px;
}

.nav-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  padding: 0 8px;
  margin-bottom: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  text-decoration: none;
}

.nav-item.active {
  background: var(--accent-dim);
  color: var(--accent);
}

.nav-item .nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.nav-item .nav-badge {
  margin-left: auto;
  background: var(--red);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-subtle);
}

.sidebar-footer .org-name {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.sidebar-footer .org-plan {
  font-size: 11px;
  color: var(--text-muted);
}

/* Main content */
.main-content {
  flex: 1;
  margin-left: 240px;
  padding: 32px;
  max-width: 1400px;
}

.page-header {
  margin-bottom: 28px;
}

.page-header h2 {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.page-header p {
  color: var(--text-secondary);
  font-size: 13px;
}

.page-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Metric cards */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}

.metric-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 20px;
}

.metric-card .metric-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.metric-card .metric-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.metric-card .metric-value.accent {
  color: var(--accent);
}
.metric-card .metric-value.green {
  color: var(--green);
}
.metric-card .metric-value.amber {
  color: var(--amber);
}
.metric-card .metric-value.red {
  color: var(--red);
}

.metric-card .metric-change {
  font-size: 12px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.metric-change.up {
  color: var(--red);
}
.metric-change.down {
  color: var(--green);
}
.metric-change.neutral {
  color: var(--text-muted);
}

/* Cards */
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-subtitle {
  font-size: 12px;
  color: var(--text-muted);
}

/* Grid layouts */
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
}

/* Tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.data-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
  color: var(--text-secondary);
}

.data-table tr:hover td {
  background: var(--bg-hover);
}

.data-table .agent-name {
  color: var(--text-primary);
  font-weight: 600;
  font-family: var(--mono);
  font-size: 12px;
}

/* Status badges */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
}

.badge.active {
  background: var(--green-dim);
  color: var(--green);
}
.badge.warning {
  background: var(--amber-dim);
  color: var(--amber);
}
.badge.critical {
  background: var(--red-dim);
  color: var(--red);
}
.badge.paused {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
.badge.info {
  background: var(--accent-dim);
  color: var(--accent);
}
.badge.purple {
  background: var(--purple-dim);
  color: var(--purple);
}

.badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* Progress bars */
.progress-bar {
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.progress-bar .progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s ease;
}

.progress-fill.green {
  background: var(--green);
}
.progress-fill.amber {
  background: var(--amber);
}
.progress-fill.red {
  background: var(--red);
}
.progress-fill.accent {
  background: var(--accent);
}

.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  font-family: var(--font);
}

.btn-primary {
  background: var(--accent);
  color: #000;
}

.btn-primary:hover {
  background: #33ddff;
  box-shadow: 0 0 20px var(--accent-glow);
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--text-muted);
}

.btn-danger {
  background: var(--red-dim);
  color: var(--red);
  border: 1px solid rgba(255, 68, 68, 0.3);
}

.btn-danger:hover {
  background: rgba(255, 68, 68, 0.25);
}

.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
}

/* Activity feed */
.activity-feed {
  max-height: 400px;
  overflow-y: auto;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.activity-item:last-child {
  border-bottom: none;
}

.activity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}

.activity-content {
  flex: 1;
}

.activity-content .activity-text {
  font-size: 13px;
  color: var(--text-secondary);
}

.activity-content .activity-text strong {
  color: var(--text-primary);
  font-family: var(--mono);
  font-size: 12px;
}

.activity-content .activity-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.activity-cost {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* Charts */
.chart-container {
  position: relative;
  height: 280px;
}

.chart-container canvas {
  width: 100% !important;
  height: 100% !important;
}

/* Provider breakdown bars */
.provider-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.provider-bar .provider-name {
  width: 100px;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.provider-bar .provider-track {
  flex: 1;
  height: 24px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.provider-bar .provider-fill {
  height: 100%;
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding-left: 8px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.8);
  transition: width 0.8s ease;
}

.provider-bar .provider-amount {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-secondary);
  width: 80px;
  text-align: right;
}

/* Gauge */
.gauge-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.gauge-item {
  text-align: center;
  padding: 16px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
}

.gauge-ring {
  width: 100px;
  height: 100px;
  margin: 0 auto 12px;
  position: relative;
}

.gauge-ring svg {
  transform: rotate(-90deg);
  width: 100px;
  height: 100px;
}

.gauge-ring circle {
  fill: none;
  stroke-width: 8;
  stroke-linecap: round;
}

.gauge-ring .gauge-bg {
  stroke: var(--bg-primary);
}

.gauge-ring .gauge-value {
  transition: stroke-dashoffset 1s ease;
}

.gauge-percent {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.gauge-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--mono);
}

.gauge-sublabel {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Alert cards */
.alert-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
  border-left: 3px solid;
  margin-bottom: 12px;
}

.alert-card.severity-critical {
  border-left-color: var(--red);
}
.alert-card.severity-warning {
  border-left-color: var(--amber);
}
.alert-card.severity-info {
  border-left-color: var(--accent);
}

.alert-icon {
  font-size: 18px;
  margin-top: 1px;
}

.alert-body {
  flex: 1;
}

.alert-body .alert-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.alert-body .alert-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.alert-body .alert-time {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
}

.alert-actions {
  display: flex;
  gap: 8px;
}

/* Tags / pills */
.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--mono);
}

.tag.anthropic {
  background: #d97706;
  color: #000;
}
.tag.openai {
  background: #10b981;
  color: #000;
}
.tag.google {
  background: #3b82f6;
  color: #fff;
}
.tag.tools {
  background: var(--purple);
  color: #fff;
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.empty-state .empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-state .empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

/* Sparkline */
.sparkline {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 24px;
}

.sparkline .spark-bar {
  width: 3px;
  background: var(--accent);
  border-radius: 1px;
  opacity: 0.6;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* Section heading */
.section-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.section-heading h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.section-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--red-dim);
  color: var(--red);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  min-width: 20px;
}

/* Filter bar */
.filter-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}
.filter-btn {
  padding: 5px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font);
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}
.filter-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.filter-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: rgba(0, 212, 255, 0.3);
}

/* Time selector */
.time-selector { display: flex; gap: 4px; }
.time-selector button {
  padding: 5px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font);
  cursor: pointer;
  transition: all 0.15s;
}
.time-selector button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.time-selector button.active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: rgba(0, 212, 255, 0.3);
}

/* No alerts */
.no-alerts {
  background: var(--green-dim);
  border: 1px solid rgba(0, 230, 118, 0.2);
  border-radius: var(--radius);
  padding: 16px;
  font-size: 13px;
  color: var(--green);
  text-align: center;
}

/* Alert pulse */
.alert-pulse {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--red);
  margin-right: 8px;
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); }
  50% { opacity: 0.8; box-shadow: 0 0 0 6px rgba(255, 68, 68, 0); }
}

/* Chart empty */
.chart-empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: 13px;
}

/* Utility */
.mono {
  font-family: var(--mono);
}
.text-muted {
  color: var(--text-muted);
}
.text-secondary {
  color: var(--text-secondary);
}
.text-accent {
  color: var(--accent);
}
.text-green {
  color: var(--green);
}
.text-amber {
  color: var(--amber);
}
.text-red {
  color: var(--red);
}
.mt-4 {
  margin-top: 4px;
}
.mt-8 {
  margin-top: 8px;
}
.mt-16 {
  margin-top: 16px;
}
.mt-24 {
  margin-top: 24px;
}
.mb-16 {
  margin-bottom: 16px;
}
.mb-24 {
  margin-bottom: 24px;
}
.flex {
  display: flex;
}
.items-center {
  align-items: center;
}
.justify-between {
  justify-content: space-between;
}
.gap-8 {
  gap: 8px;
}
.gap-12 {
  gap: 12px;
}
.gap-16 {
  gap: 16px;
}

/* Footer */
.footer {
  text-align: center;
  padding: 32px 0 0;
  border-top: 1px solid var(--border-subtle);
  margin-top: 20px;
}
.footer p {
  font-size: 12px;
  color: var(--text-muted);
}
.footer a { color: var(--accent); }

/* Responsive */
@media (max-width: 1024px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .sidebar {
    display: none;
  }
  .main-content {
    margin-left: 0;
  }
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
</head>
<body>

  <div class="app-layout">

    <!-- Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <h1><span class="logo-icon" style="font-size:14px;">TC</span> tokenclaw</h1>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-section">
          <div class="nav-section-label">Overview</div>
          <a href="#" class="nav-item active">
            <span class="nav-icon">&#8801;</span>
            Dashboard
          </a>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="org-name">tokenclaw</div>
        <div class="org-plan">${data.tools.length} tools detected</div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">

      <!-- Page Header -->
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <h2>Dashboard</h2>
            <p>Real-time agent spend across all providers</p>
          </div>
          <div class="time-selector">
            <button>24h</button>
            <button class="active">7d</button>
            <button>30d</button>
          </div>
        </div>
      </div>

      <!-- Top Metrics -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Total Spend</div>
          <div class="metric-value accent">${fmtCost(data.totalActualSpend)}</div>
          <div class="metric-change neutral">${subscriptionTools.length} subscription + ${apiTools.length} API tools</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Today's Spend</div>
          <div class="metric-value">${fmtCost(data.burnRate.current)}</div>
          <div class="metric-change ${tc}">${trendArrow(data.burnRate.trend)} ${data.burnRate.trend} vs avg</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Daily Average</div>
          <div class="metric-value">${fmtCost(data.burnRate.average)}</div>
          <div class="metric-change neutral">30-day rolling</div>
        </div>
      </div>

      <!-- Spend by Model + Spend Trend -->
      <div class="grid-2 mb-24">

        <!-- Spend by Model (provider bars) -->
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Token Consumption by Model</div>
              <div class="card-subtitle">Estimated at API rates</div>
            </div>
          </div>
          ${providerBarsHtml}
          ${data.models.length ? `<div class="chart-container" style="height:200px;margin-top:20px;"><canvas id="modelChart"></canvas></div>` : ""}
        </div>

        <!-- Daily Spend Trend -->
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Daily Spend Trend</div>
              <div class="card-subtitle">${fmtCost(data.burnRate.current)}/day current, ${fmtCost(data.burnRate.average)}/day avg <span class="metric-change ${tc}" style="font-size:11px;">${trendArrow(data.burnRate.trend)} ${data.burnRate.trend}</span></div>
            </div>
          </div>
          <div class="chart-container">
            <canvas id="trendChart"></canvas>
          </div>
        </div>
      </div>


      <!-- Agent Cost Table -->
      <div class="card mt-24" style="padding:0;">
        <div style="padding:24px 24px 0;">
          <div class="card-header" style="margin-bottom:0;">
            <div>
              <div class="card-title">Agent Cost Breakdown</div>
              <div class="card-subtitle">All tracked tools</div>
            </div>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Type</th>
              <th>Cost</th>
              <th>API Usage</th>
              <th>Sessions</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            ${agentTableRows || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px;">No tools detected. Run <code>tokenclaw</code> to scan.</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div class="footer">
        <p>Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} by <a href="https://github.com/katrinalaszlo/tokenclaw">tokenclaw</a></p>
      </div>

    </main>
  </div>

<script>
  Chart.defaults.color = '#8888a0';
  Chart.defaults.borderColor = '#1e1e2e';
  Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
  Chart.defaults.font.size = 11;

  ${
    data.models.length
      ? `
  new Chart(document.getElementById('modelChart'), {
    type: 'doughnut',
    data: {
      labels: ${JSON.stringify(modelLabels)},
      datasets: [{
        data: ${JSON.stringify(modelCosts)},
        backgroundColor: ${JSON.stringify(CHART_COLORS.slice(0, data.models.length))},
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a28',
          borderColor: '#2a2a3a',
          borderWidth: 1,
          titleColor: '#e8e8f0',
          bodyColor: '#8888a0',
          padding: 10,
          callbacks: {
            label: function(ctx) {
              var total = ctx.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var pct = total > 0 ? Math.round(ctx.parsed / total * 100) : 0;
              return ctx.label + ': $' + ctx.parsed.toFixed(2) + ' (' + pct + '%)';
            }
          }
        }
      }
    }
  });
  `
      : ""
  }

  ${
    dailyDates.length > 1
      ? `
  new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: ${JSON.stringify(dailyDates.map((d) => d.slice(5)))},
      datasets: ${JSON.stringify(dailyDatasets)}
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { color: '#1e1e2e' },
          ticks: { maxRotation: 0 }
        },
        y: {
          grid: { color: '#1e1e2e' },
          stacked: true,
          ticks: { callback: function(v) { return '$' + v; } }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, usePointStyle: true, pointStyle: 'circle', boxWidth: 8 }
        },
        tooltip: {
          backgroundColor: '#1a1a28',
          borderColor: '#2a2a3a',
          borderWidth: 1,
          titleColor: '#e8e8f0',
          bodyColor: '#8888a0',
          padding: 10,
          callbacks: {
            label: function(ctx) { return ctx.dataset.label + ': $' + ctx.parsed.y.toFixed(2); },
            footer: function(items) {
              var total = items.reduce(function(a, i) { return a + i.parsed.y; }, 0);
              return 'Total: $' + total.toFixed(2);
            }
          }
        }
      }
    }
  });
  `
      : ""
  }

<\/script>
</body>
</html>`;
}
