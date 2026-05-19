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
    `[acc] ${alert.ruleName} — $${alert.amount.toFixed(2)} (threshold: $${alert.threshold.toFixed(2)})${spikeTag}`,
    `Top tools:\n${toolLines}`,
    `Escalation: Level ${alert.level} (alerting ${frequencyLabel} until acknowledged)`,
    "",
    `Reply 'ok' to acknowledge or run \`acc ack ${alert.ruleId.slice(0, 8)}\``,
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
    `[acc] ${alert.ruleName} — $${alert.amount.toFixed(2)} OVER THRESHOLD ($${alert.threshold.toFixed(2)})${spikeTag}`,
    `Top tools:\n${toolLines}`,
    `NOW ALERTING ${frequencyLabel.toUpperCase()} UNTIL ACKNOWLEDGED`,
    "",
    `Reply 'ok' to acknowledge or run \`acc ack ${alert.ruleId.slice(0, 8)}\``,
  ];

  return lines.join("\n");
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "daily",
  "3x_daily": "3x/day",
  "5x_daily": "5x/day",
  hourly: "hourly",
};
