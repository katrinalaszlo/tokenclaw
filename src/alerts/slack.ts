/**
 * Slack webhook notification sender.
 * Formats and sends alert messages via incoming webhook URL.
 */

// Inline type — matches AlertAction from engine.ts without importing
export interface SlackAlertPayload {
  alertId: string;
  ruleId: string;
  ruleName: string;
  level: number;
  amount: number;
  threshold: number;
  isEscalation: boolean;
  isSpike: boolean;
  frequency: string;
  tools: Array<{ name: string; amount: number }>;
}

export async function sendSlackAlert(
  webhookUrl: string,
  alert: SlackAlertPayload,
): Promise<void> {
  const text = formatAlertMessage(alert);

  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!resp.ok) {
    throw new Error(`Slack webhook failed: ${resp.status} ${resp.statusText}`);
  }
}

function formatAlertMessage(alert: SlackAlertPayload): string {
  if (alert.isEscalation) {
    return formatEscalatedAlert(alert);
  }
  return formatNormalAlert(alert);
}

function formatNormalAlert(alert: SlackAlertPayload): string {
  const toolLines = alert.tools
    .slice(0, 5)
    .map((t) => `  ${t.name}: $${t.amount.toFixed(2)}`)
    .join("\n");

  const spikeTag = alert.isSpike ? " [SPIKE: 3x normal]" : "";
  const frequencyLabel = FREQUENCY_LABELS[alert.frequency] ?? alert.frequency;

  const lines = [
    `[tokenclaw] ${alert.ruleName} — $${alert.amount.toFixed(2)} (threshold: $${alert.threshold.toFixed(2)})${spikeTag}`,
    `Top tools:\n${toolLines}`,
    `Escalation: Level ${alert.level} (alerting ${frequencyLabel} until acknowledged)`,
    "",
    `Reply 'ok' to acknowledge or run \`tokenclaw alert --ack\``,
  ];

  return lines.join("\n");
}

function formatEscalatedAlert(alert: SlackAlertPayload): string {
  const toolLines = alert.tools
    .slice(0, 5)
    .map((t) => `  ${t.name}: $${t.amount.toFixed(2)}`)
    .join("\n");

  const spikeTag = alert.isSpike ? " [SPIKE: 3x NORMAL]" : "";
  const frequencyLabel = FREQUENCY_LABELS[alert.frequency] ?? alert.frequency;

  const lines = [
    `UNACKNOWLEDGED ALERT — ESCALATED TO LEVEL ${alert.level}`,
    `[tokenclaw] ${alert.ruleName} — $${alert.amount.toFixed(2)} OVER THRESHOLD ($${alert.threshold.toFixed(2)})${spikeTag}`,
    `Top tools:\n${toolLines}`,
    `NOW ALERTING ${frequencyLabel.toUpperCase()} UNTIL ACKNOWLEDGED`,
    "",
    `Reply 'ok' to acknowledge or run \`tokenclaw alert --ack\``,
  ];

  return lines.join("\n");
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "daily",
  "3x_daily": "3x/day",
  "5x_daily": "5x/day",
  hourly: "hourly",
};

// ── Daily digest ──

export interface DigestData {
  yesterday_usd: number;
  yesterday_sessions: number;
  week_usd: number;
  week_threshold: number;
  top_tool: { name: string; cost: number };
  top_model: { name: string; cost: number };
  avg_daily: number;
  baseline_context?: string;
}

export async function sendSlackDigest(
  webhookUrl: string,
  digest: DigestData,
): Promise<void> {
  const text = formatDigestMessage(digest);

  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!resp.ok) {
    throw new Error(`Slack webhook failed: ${resp.status} ${resp.statusText}`);
  }
}

function formatDigestMessage(d: DigestData): string {
  const weekPct =
    d.week_threshold > 0
      ? Math.round((d.week_usd / d.week_threshold) * 100)
      : 0;

  const lines = [
    `*tokenclaw daily digest*`,
    `Yesterday: $${d.yesterday_usd.toFixed(2)} across ${d.yesterday_sessions} tool${d.yesterday_sessions === 1 ? "" : "s"}`,
    `This week: $${d.week_usd.toFixed(2)} / $${d.week_threshold.toFixed(2)} (${weekPct}%)`,
    `Top tool: ${d.top_tool.name} ($${d.top_tool.cost.toFixed(2)})`,
    `Top model: ${d.top_model.name} ($${d.top_model.cost.toFixed(2)})`,
    `Avg daily: $${d.avg_daily.toFixed(2)} (last 7 days)`,
  ];

  if (d.avg_daily > 0 && d.yesterday_usd > d.avg_daily) {
    const pctAbove = Math.round(
      ((d.yesterday_usd - d.avg_daily) / d.avg_daily) * 100,
    );
    lines.push(`↑ ${pctAbove}% above your 7-day average`);
  }

  if (d.baseline_context) {
    lines.push(d.baseline_context);
  }

  return lines.join("\n");
}
