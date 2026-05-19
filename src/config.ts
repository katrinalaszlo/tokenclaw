import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export interface EscalationRule {
  above: number;
  frequency: "daily" | "3x_daily" | "hourly";
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
};

function getAccDir(): string {
  return join(homedir(), ".acc");
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
