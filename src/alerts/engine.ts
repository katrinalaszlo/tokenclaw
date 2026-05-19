/**
 * Alert evaluation engine.
 * Pure function: takes spend data, rules, history, and ack state.
 * Returns actions to take (alerts to send).
 */

// Inline types — no imports from ../types.ts (parallel worker constraint)

export interface CostSnapshot {
  provider: string;
  tool: string;
  date: string;
  amount_usd: number;
}

export interface AlertRule {
  id: string;
  name: string;
  threshold_usd: number;
  period: "daily" | "weekly" | "monthly";
  escalation: EscalationTier[];
}

export interface EscalationTier {
  above: number;
  frequency: "daily" | "3x_daily" | "5x_daily" | "hourly";
}

export interface AlertHistoryEntry {
  rule_id: string;
  action: "fired" | "acknowledged" | "escalated" | "resolved";
  timestamp: string;
  amount_usd: number;
  escalation_level: number;
}

export interface AckEntry {
  alertId: string;
  acknowledgedAt: string;
  expiresAt: string;
}

export type AckState = Record<string, AckEntry>;

export interface AlertAction {
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

const FREQUENCY_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  "3x_daily": 8 * 60 * 60 * 1000,
  "5x_daily": Math.floor((24 * 60 * 60 * 1000) / 5),
  hourly: 60 * 60 * 1000,
};

const SPIKE_MULTIPLIER = 3;

export function evaluateAlerts(
  currentSpend: CostSnapshot[],
  rules: AlertRule[],
  alertHistory: AlertHistoryEntry[],
  ackState: AckState,
): AlertAction[] {
  const now = new Date();
  const actions: AlertAction[] = [];

  for (const rule of rules) {
    const totalAmount = currentSpend.reduce((sum, s) => sum + s.amount_usd, 0);

    // Skip if acknowledged and not expired
    if (isAcknowledged(rule.id, ackState, now)) continue;

    const overThreshold = totalAmount > rule.threshold_usd;
    const spike = detectSpike(totalAmount, rule.id, alertHistory);

    if (!overThreshold && !spike) continue;

    const escalationLevel = getEscalationLevel(rule.escalation, totalAmount);
    const frequency = getFrequencyForLevel(rule.escalation, escalationLevel);
    const intervalMs = FREQUENCY_MS[frequency] ?? FREQUENCY_MS.daily!;

    // Check if we should alert based on frequency (don't spam)
    if (!shouldAlert(rule.id, intervalMs, alertHistory, now)) continue;

    // Determine if this is an escalation (level increased since last fired alert)
    const lastLevel = getLastFiredLevel(rule.id, alertHistory);
    const isEscalation = lastLevel !== null && escalationLevel > lastLevel;

    const tools = currentSpend
      .filter((s) => s.amount_usd > 0)
      .sort((a, b) => b.amount_usd - a.amount_usd)
      .map((s) => ({ name: s.tool, amount: s.amount_usd }));

    const alertId = `${rule.id}-${now.getTime()}`;

    actions.push({
      alertId,
      ruleId: rule.id,
      ruleName: rule.name,
      level: escalationLevel,
      amount: totalAmount,
      threshold: rule.threshold_usd,
      isEscalation,
      isSpike: spike,
      frequency,
      tools,
    });
  }

  return actions;
}

function isAcknowledged(
  ruleId: string,
  ackState: AckState,
  now: Date,
): boolean {
  const ack = ackState[ruleId];
  if (!ack) return false;
  return new Date(ack.expiresAt) > now;
}

/**
 * Spike detection: current spend > 3x the average from history.
 * If no history, skip spike check (don't fire on no data).
 */
function detectSpike(
  currentAmount: number,
  ruleId: string,
  history: AlertHistoryEntry[],
): boolean {
  const firedEntries = history.filter(
    (h) => h.rule_id === ruleId && h.action === "fired",
  );
  if (firedEntries.length < 2) return false;

  const avgAmount =
    firedEntries.reduce((sum, h) => sum + h.amount_usd, 0) /
    firedEntries.length;

  if (avgAmount <= 0) return false;

  return currentAmount > avgAmount * SPIKE_MULTIPLIER;
}

function getEscalationLevel(tiers: EscalationTier[], amount: number): number {
  let level = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (amount > tiers[i]!.above) {
      level = i;
    }
  }
  return level;
}

function getFrequencyForLevel(tiers: EscalationTier[], level: number): string {
  const tier = tiers[level];
  return tier?.frequency ?? "daily";
}

function shouldAlert(
  ruleId: string,
  intervalMs: number,
  history: AlertHistoryEntry[],
  now: Date,
): boolean {
  const lastFired = history
    .filter((h) => h.rule_id === ruleId && h.action === "fired")
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )[0];

  if (!lastFired) return true;

  const elapsed = now.getTime() - new Date(lastFired.timestamp).getTime();
  return elapsed >= intervalMs;
}

function getLastFiredLevel(
  ruleId: string,
  history: AlertHistoryEntry[],
): number | null {
  const lastFired = history
    .filter((h) => h.rule_id === ruleId && h.action === "fired")
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )[0];

  return lastFired?.escalation_level ?? null;
}
