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
    modelUsage?: Record<
      string,
      { costUSD: number; inputTokens: number; outputTokens: number }
    >;
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
  hasProxyData: boolean;
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
  if (n >= 0.001) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtPpt(paid: number, tokens: number): string {
  if (tokens <= 0) return "&mdash;";
  const perToken = paid / tokens;
  if (perToken >= 0.001) return `$${(perToken * 1000).toFixed(4)}/1K`;
  if (perToken >= 0.0000001) return `$${(perToken * 1_000_000).toFixed(2)}/1M`;
  return "&mdash;";
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
  const sortedTools = [...data.tools].sort((a, b) => {
    const costA =
      a.billingType === "subscription" ? (a.planCost ?? a.cost) : a.cost;
    const costB =
      b.billingType === "subscription" ? (b.planCost ?? b.cost) : b.cost;
    return costB - costA;
  });

  // Build tool rows
  const toolRowsHtml = sortedTools
    .map((t, idx) => {
      const youPay =
        t.billingType === "subscription" ? (t.planCost ?? t.cost) : t.cost;
      const totalTokens = t.tokens;
      const apiRateCost = t.cost;
      const planLabel =
        t.billingType === "subscription"
          ? (t.planName ?? "Subscription")
          : "API billing";

      // Value badge for subscriptions
      let valHtml = "";
      if (
        t.billingType === "subscription" &&
        youPay > 0 &&
        apiRateCost > youPay * 1.5
      ) {
        const mult = Math.round(apiRateCost / youPay);
        valHtml = ` <span class="val-pill">${mult}x Val<span class="val-tip">At API rates this would cost <strong>~${fmtCost(apiRateCost)}</strong>.<br>Your subscription saves you <span style="color:#22c55e;font-weight:600;">${fmtCost(apiRateCost - youPay)}</span>.</span></span>`;
      }

      // Model breakdown rows (filter out zero-cost junk)
      const toolId = `t${idx}`;
      const models = t.modelUsage
        ? Object.entries(t.modelUsage)
            .map(([name, u]) => ({
              name,
              cost: u.costUSD,
              tokens: u.inputTokens + u.outputTokens,
            }))
            .filter((m) => m.cost > 0.001 || m.tokens > 0)
            .sort((a, b) => b.tokens - a.tokens)
        : [];

      const modelRowsHtml = models
        .map((m) => {
          // For subscription: effective $/token = youPay * (model's share of tokens) / model tokens
          // Simplifies to: youPay / totalTokens (same rate for all models under a subscription)
          // For API: actual cost / tokens
          const modelPaid =
            t.billingType === "subscription" && totalTokens > 0
              ? youPay * (m.tokens / totalTokens)
              : m.cost;

          return `<div class="sub-row">
        <div class="sub-name">${escapeHtml(m.name)}</div>
        <div class="sub-val">${fmtCost(modelPaid)}</div>
        <div class="sub-val">${fmtTokens(m.tokens)}</div>
        <div class="sub-val">${fmtPpt(modelPaid, m.tokens)}</div>
      </div>`;
        })
        .join("");

      const hasModels = models.length > 0;

      return `
    <div class="tool-row" ${hasModels ? `onclick="toggle('${toolId}')"` : ""}>
      <div class="tool-name-cell">
        <div class="tool-name">${escapeHtml(t.name)}${hasModels ? ' <span class="exp">&#9654;</span>' : ""}</div>
        <div class="tool-sub">${escapeHtml(planLabel)}${valHtml}</div>
      </div>
      <div class="col-r bold">${fmtCost(youPay)}${t.billingType === "subscription" ? "<span class='dim'>/mo</span>" : ""}</div>
      <div class="col-r muted">${fmtTokens(totalTokens)}</div>
      <div class="col-r accent">${fmtPpt(youPay, totalTokens)}</div>
    </div>
    ${
      hasModels
        ? `<div class="breakdown" id="${toolId}">
      <div class="sub-header">
        <span>Model</span><span class="r">You pay</span><span class="r">Tokens</span><span class="r">$/Token</span>
      </div>
      ${modelRowsHtml}
    </div>`
        : ""
    }`;
    })
    .join("");

  // Daily cost time series
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>tokenclaw</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #09090b; --surface: #18181b; --border: #27272a; --border2: #1c1c1f;
    --text: #fafafa; --muted: #71717a; --accent: #22d3ee;
    --danger: #ef4444; --success: #22c55e; --warning: #f59e0b;
    --mono: 'SF Mono', 'Fira Code', monospace;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 48px 24px; -webkit-font-smoothing: antialiased; }
  .container { max-width: 880px; margin: 0 auto; }
  .brand { font-size: 15px; font-weight: 600; color: var(--muted); margin-bottom: 32px; }
  .brand span { color: var(--accent); }

  /* Grid: 4 columns */
  .grid4 { display: grid; grid-template-columns: 1.8fr 0.8fr 0.7fr 0.8fr; }

  /* Header */
  .col-header { padding: 0 24px 10px; }
  .col-header span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .r { text-align: right; }

  /* Tool rows */
  .tool-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 32px; }
  .tool-row { display: grid; grid-template-columns: 1.8fr 0.8fr 0.7fr 0.8fr; align-items: center; padding: 20px 24px; background: var(--surface); border: 1px solid var(--border); cursor: pointer; transition: border-color 0.15s; }
  .tool-row:first-child { border-radius: 12px 12px 0 0; }
  .tool-row:hover { border-color: #3f3f46; }

  .tool-name-cell { display: flex; flex-direction: column; gap: 3px; }
  .tool-name { font-size: 15px; font-weight: 600; }
  .tool-sub { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .exp { font-size: 10px; color: var(--muted); transition: transform 0.15s; display: inline-block; }
  .tool-row.open .exp { transform: rotate(90deg); }

  .col-r { font-family: var(--mono); font-size: 15px; text-align: right; }
  .bold { font-weight: 700; font-size: 17px; }
  .muted { color: var(--muted); }
  .accent { color: var(--success); }
  .dim { font-size: 12px; font-weight: 400; color: var(--muted); }

  /* Value pill */
  .val-pill { display: inline-block; font-family: var(--mono); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; color: var(--accent); background: rgba(34,211,238,0.08); border: 1px solid rgba(34,211,238,0.15); cursor: default; position: relative; }
  .val-tip { display: none; position: absolute; bottom: calc(100% + 8px); right: 0; background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; padding: 12px 16px; font-family: -apple-system, sans-serif; font-size: 12px; font-weight: 400; line-height: 1.6; color: var(--text); white-space: nowrap; z-index: 10; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
  .val-pill:hover .val-tip { display: block; }

  /* Breakdown (collapsed by default) */
  .breakdown { display: none; background: #0e0e10; border-left: 1px solid var(--border); border-right: 1px solid var(--border); padding: 8px 0 12px; }
  .breakdown.open { display: block; }

  .sub-header { display: grid; grid-template-columns: 1.8fr 0.8fr 0.7fr 0.8fr; padding: 4px 24px 8px 48px; }
  .sub-header span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }

  .sub-row { display: grid; grid-template-columns: 1.8fr 0.8fr 0.7fr 0.8fr; padding: 6px 24px 6px 48px; border-top: 1px solid var(--border2); }
  .sub-name { font-size: 13px; color: var(--muted); }
  .sub-val { font-family: var(--mono); font-size: 13px; color: var(--muted); text-align: right; }

  /* Chart */
  .chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
  .chart-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .chart-sub { font-size: 12px; color: var(--muted); margin-bottom: 16px; }

  /* Filters */
  .filter-btn { font-size: 12px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .filter-btn.active { background: var(--surface); color: var(--text); border-color: #3f3f46; }
  .filter-btn:hover { border-color: #3f3f46; }

  .key-select-wrap { position: relative; }
  .key-select { font-size: 12px; padding: 5px 28px 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font-family: inherit; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2371717a' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; }
  .key-select:hover { border-color: #3f3f46; }
  .key-select.disabled { opacity: 0.5; cursor: not-allowed; color: var(--muted); }
  .key-tooltip { display: none; position: absolute; top: calc(100% + 6px); right: 0; background: #27272a; border: 1px solid #3f3f46; border-radius: 6px; padding: 8px 12px; font-size: 11px; color: var(--text); white-space: nowrap; z-index: 10; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .key-tooltip code { font-size: 11px; color: var(--accent); background: rgba(34,211,238,0.1); padding: 1px 5px; border-radius: 3px; }
  .key-select-wrap:hover .key-tooltip { display: block; }

  .footer { text-align: center; padding: 24px 0; font-size: 12px; color: var(--muted); }
  .footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
<div class="container">

  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;flex-wrap:wrap;gap:12px;">
    <div class="brand" style="margin-bottom:0;"><span>tokenclaw</span></div>
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="display:flex;gap:4px;">
        <button class="filter-btn active" onclick="setRange('7d',this)">7d</button>
        <button class="filter-btn" onclick="setRange('30d',this)">30d</button>
        <button class="filter-btn" onclick="setRange('90d',this)">90d</button>
        <button class="filter-btn" onclick="setRange('all',this)">All</button>
      </div>
      <div class="key-select-wrap">
        <select class="key-select ${data.hasProxyData ? "" : "disabled"}" ${data.hasProxyData ? "" : "disabled"}>
          <option>All API Keys</option>
        </select>
        ${data.hasProxyData ? "" : `<div class="key-tooltip">Run <code>tokenclaw proxy</code> to filter by API key</div>`}
      </div>
    </div>
  </div>

  <div class="grid4 col-header">
    <span>Tool</span>
    <span class="r">You pay</span>
    <span class="r">Tokens</span>
    <span class="r">$/Token</span>
  </div>

  <div class="tool-list">
    ${toolRowsHtml}
  </div>

  ${
    dailyDates.length > 1
      ? `
  <div class="chart-card">
    <div class="chart-title">Daily API Spend</div>
    <div class="chart-sub">API-billed tools only</div>
    <div style="height:280px;"><canvas id="trendChart"></canvas></div>
  </div>`
      : ""
  }

  <div class="footer">
    <a href="https://github.com/katrinalaszlo/tokenclaw">tokenclaw</a> &middot; MIT
  </div>

</div>

<script>
function toggle(id) {
  var bd = document.getElementById(id);
  var row = bd.previousElementSibling;
  bd.classList.toggle('open');
  row.classList.toggle('open');
}

var allDates = ${JSON.stringify(dailyDates)};
var allDatasets = ${JSON.stringify(dailyDatasets)};
var trendChart = null;

function setRange(range, btn) {
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  if (!trendChart) return;

  var now = new Date();
  var cutoff = new Date(0);
  if (range === '7d') cutoff = new Date(now - 7*86400000);
  else if (range === '30d') cutoff = new Date(now - 30*86400000);
  else if (range === '90d') cutoff = new Date(now - 90*86400000);

  var filtered = [];
  allDates.forEach(function(d, i) {
    if (new Date(d) >= cutoff) filtered.push(i);
  });

  trendChart.data.labels = filtered.map(function(i) { return allDates[i]; });
  trendChart.data.datasets.forEach(function(ds, di) {
    ds.data = filtered.map(function(i) { return allDatasets[di].data[i]; });
  });
  trendChart.update();
}

${
  dailyDates.length > 1
    ? `
Chart.defaults.color = '#71717a';
Chart.defaults.borderColor = '#27272a';
Chart.defaults.font.family = "-apple-system, sans-serif";
Chart.defaults.font.size = 11;
trendChart = new Chart(document.getElementById('trendChart'), {
  type: 'line',
  data: { labels: ${JSON.stringify(dailyDates)}, datasets: ${JSON.stringify(dailyDatasets)} },
  options: {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: { x: { grid: { display: false } }, y: { grid: { color: '#1c1c1f' }, ticks: { callback: function(v){return '$'+v;} } } },
    plugins: {
      legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle', boxWidth: 8 } },
      tooltip: { backgroundColor: '#1a1a28', borderColor: '#2a2a3a', borderWidth: 1, titleColor: '#e8e8f0', bodyColor: '#8888a0', padding: 10,
        callbacks: { label: function(ctx){return ctx.dataset.label+': $'+ctx.parsed.y.toFixed(2);}, footer: function(items){return 'Total: $'+items.reduce(function(a,i){return a+i.parsed.y;},0).toFixed(2);} }
      }
    }
  }
});`
    : ""
}
<\/script>
</body>
</html>`;
}
