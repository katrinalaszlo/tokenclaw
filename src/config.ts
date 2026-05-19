import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export interface EscalationRule {
  above: number;
  frequency: "daily" | "3x_daily" | "hourly";
}

export type BudgetPeriod = "day" | "week" | "month";
export type BudgetMode = "alert" | "enforce";

export interface KeyBudget {
  budget: number;
  period: BudgetPeriod;
  mode: BudgetMode;
}

export interface AccConfig {
  thresholds: {
    daily: number;
    weekly: number;
    alert_on_spike: boolean;
  };
  alerts: {
    slack_webhook: string;
    email: string;
  };
  escalation: EscalationRule[];
  acknowledge_ttl: number;
  key_budgets: Record<string, KeyBudget>;
}

export const DEFAULT_CONFIG: AccConfig = {
  thresholds: {
    daily: 100,
    weekly: 500,
    alert_on_spike: true,
  },
  alerts: {
    slack_webhook: "",
    email: "",
  },
  escalation: [
    { above: 100, frequency: "daily" },
    { above: 500, frequency: "3x_daily" },
    { above: 1000, frequency: "hourly" },
  ],
  acknowledge_ttl: 24,
  key_budgets: {},
};

export function parseBudgetString(s: string): Omit<KeyBudget, "mode"> {
  const match = s.match(/^(\d+(?:\.\d+)?)\/(day|week|month)$/);
  if (!match) {
    throw new Error(
      `Invalid budget format "${s}". Expected: 10/day, 500/week, or 2000/month`,
    );
  }
  return { budget: Number(match[1]), period: match[2] as BudgetPeriod };
}

function getAccDir(): string {
  return join(homedir(), ".tokenclaw");
}

export function getConfigPath(): string {
  return join(getAccDir(), "config.yaml");
}

export function loadConfig(): AccConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = yamlParse(raw) as Partial<AccConfig> | null;
  if (!parsed) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...parsed.thresholds,
    },
    alerts: {
      ...DEFAULT_CONFIG.alerts,
      ...parsed.alerts,
    },
    escalation: parsed.escalation ?? DEFAULT_CONFIG.escalation,
    acknowledge_ttl: parsed.acknowledge_ttl ?? DEFAULT_CONFIG.acknowledge_ttl,
    key_budgets: Object.fromEntries(
      Object.entries(parsed.key_budgets ?? {}).map(([k, v]) => [
        k,
        { ...v, mode: v.mode ?? "enforce" },
      ]),
    ),
  };
}

export function saveConfig(config: AccConfig): void {
  const dir = getAccDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const content = yamlStringify(config);
  writeFileSync(getConfigPath(), content, "utf-8");
}
