export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
};

export type ToolScanResult = {
  tool: string;
  sessions: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  modelUsage: Record<string, ModelUsage>;
  projects: string[];
};

export type AlertRule = {
  id: string;
  name: string;
  threshold_usd: number;
  period: "daily" | "weekly" | "monthly";
  escalation: EscalationTier[];
};

export type AlertEvent = {
  rule_id: string;
  action: "fired" | "acknowledged" | "escalated";
  timestamp: string;
  details: string;
};

export type CostSnapshot = {
  provider: string;
  tool: string;
  date: string;
  amount_usd: number;
  tokens: number;
};

export type EscalationTier = {
  above: number;
  frequency: string;
};

export type Config = {
  thresholds: {
    daily_usd: number;
    weekly_usd: number;
    monthly_usd: number;
  };
  alert_destinations: {
    slack_webhook?: string;
    email?: string;
  };
  escalation_tiers: EscalationTier[];
  acknowledge_ttl: number;
};
