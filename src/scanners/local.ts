import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { estimateCost } from "../pricing.js";

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
};

export type DailyCost = {
  date: string;
  cost: number;
  sessions: number;
};

export type SessionDetail = {
  path: string;
  cost: number;
  tokens: number;
  duration_minutes: number;
  model: string;
};

export type ModelDateCost = {
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
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
  modelDateCosts: Record<string, Record<string, ModelDateCost>>;
  projects: { name: string; cost: number; sessions: number; tokens: number }[];
  dailyCosts: DailyCost[];
  sessions_detail: SessionDetail[];
  billingType: "subscription" | "api";
  planName?: string;
  planCost?: number;
  planCostAssumed?: boolean;
};

const TOOLS: { name: string; paths: string[]; recursive: boolean }[] = [
  { name: "Claude Code", paths: [".claude/projects"], recursive: false },
  {
    name: "OpenClaw",
    paths: [".openclaw/agents/main/sessions"],
    recursive: false,
  },
  {
    name: "Claude Desktop",
    paths: ["Library/Application Support/Claude"],
    recursive: true,
  },
  { name: "Cursor", paths: [".cursor/projects"], recursive: false },
  { name: "Windsurf", paths: [".windsurf"], recursive: true },
  { name: "Cline", paths: [".cline"], recursive: true },
  { name: "Roo Code", paths: [".roo-code"], recursive: true },
  { name: "Aider", paths: [".aider"], recursive: true },
  { name: "Continue.dev", paths: [".continue/sessions"], recursive: true },
];

export function isAuxiliaryFile(name: string): boolean {
  return name.includes(".checkpoint.") || name.includes(".trajectory.");
}

export async function findJsonlFiles(
  dir: string,
  recursive: boolean,
): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        !isAuxiliaryFile(entry.name)
      ) {
        results.push(full);
      } else if (entry.isDirectory() && recursive) {
        const sub = await findJsonlFiles(full, true);
        results.push(...sub);
      } else if (entry.isDirectory() && !recursive) {
        // For non-recursive (Claude Code style), look for jsonl inside project dirs
        try {
          const subEntries = await readdir(full);
          for (const sf of subEntries) {
            if (sf.endsWith(".jsonl") && !isAuxiliaryFile(sf)) {
              results.push(join(full, sf));
            }
          }
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* dir doesn't exist */
  }
  return results;
}

export async function parseJsonlFile(filePath: string): Promise<{
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
  modelUsage: Record<string, ModelUsage>;
  dateCosts: Record<string, number>;
  modelDateCosts: Record<string, Record<string, ModelDateCost>>;
  firstTimestamp: string | undefined;
  lastTimestamp: string | undefined;
}> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUSD: 0,
      modelUsage: {},
      dateCosts: {},
      modelDateCosts: {},
      firstTimestamp: undefined,
      lastTimestamp: undefined,
    };
  }

  const lines = content.split("\n").filter((l) => l.trim());
  const lastUsageByMsg = new Map<
    string,
    { model: string; usage: Record<string, unknown>; date: string }
  >();
  let anonCounter = 0;
  const fallbackDate = new Date().toISOString().split("T")[0]!;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const msg = parsed.message as
      | {
          id?: string;
          responseId?: string;
          usage?: Record<string, unknown>;
          model?: string;
        }
      | undefined;
    if (!msg?.usage) continue;

    const ts = (parsed.timestamp ?? parsed.ts) as string | undefined;
    const date = ts ? ts.split("T")[0]! : fallbackDate;

    if (ts) {
      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;
    }

    const msgId = msg.responseId ?? msg.id ?? `anon-${anonCounter++}`;
    lastUsageByMsg.set(msgId, {
      model: msg.model || "unknown",
      usage: msg.usage,
      date,
    });
  }

  const modelUsage: Record<string, ModelUsage> = {};
  const dateCosts: Record<string, number> = {};
  const modelDateCosts: Record<
    string,
    Record<
      string,
      { cost: number; input: number; output: number; cacheRead: number }
    >
  > = {};
  let totalInput = 0,
    totalOutput = 0,
    totalCacheRead = 0,
    totalCacheCreation = 0,
    totalCost = 0;

  for (const [, { model, usage, date }] of lastUsageByMsg) {
    const input = Number(usage.input_tokens ?? usage.input) || 0;
    const output = Number(usage.output_tokens ?? usage.output) || 0;
    const cacheRead =
      Number(usage.cache_read_input_tokens ?? usage.cacheRead) || 0;
    const cacheCreation =
      Number(usage.cache_creation_input_tokens ?? usage.cacheWrite) || 0;

    totalInput += input;
    totalOutput += output;
    totalCacheRead += cacheRead;
    totalCacheCreation += cacheCreation;

    if (!modelUsage[model]) {
      modelUsage[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUSD: 0,
      };
    }
    modelUsage[model].inputTokens += input;
    modelUsage[model].outputTokens += output;
    modelUsage[model].cacheReadTokens += cacheRead;
    modelUsage[model].cacheCreationTokens += cacheCreation;

    const cost = estimateCost(model, input, output, cacheRead, cacheCreation);
    modelUsage[model].costUSD += cost;
    totalCost += cost;
    dateCosts[date] = (dateCosts[date] || 0) + cost;

    if (!modelDateCosts[model]) modelDateCosts[model] = {};
    const mdc = modelDateCosts[model][date] || {
      cost: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
    };
    mdc.cost += cost;
    mdc.input += input;
    mdc.output += output;
    mdc.cacheRead += cacheRead;
    modelDateCosts[model][date] = mdc;
  }

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    costUSD: totalCost,
    modelUsage,
    dateCosts,
    modelDateCosts,
    firstTimestamp,
    lastTimestamp,
  };
}

export function projectNameFromPath(
  filePath: string,
  toolName: string,
): string {
  if (toolName === "Claude Code") {
    const parts = filePath.split("/");
    const projIdx = parts.indexOf("projects");
    if (projIdx >= 0 && projIdx + 1 < parts.length) {
      return parts[projIdx + 1].replace(/-/g, "/");
    }
  }
  const parts = filePath.split("/");
  return parts[parts.length - 1].replace(".jsonl", "");
}

export async function scanLocalTools(): Promise<{
  found: ToolScanResult[];
  notFound: string[];
}> {
  const home = homedir();
  const found: ToolScanResult[] = [];
  const notFound: string[] = [];

  for (const tool of TOOLS) {
    let allFiles: string[] = [];

    for (const relPath of tool.paths) {
      const absPath = join(home, relPath);
      try {
        await stat(absPath);
      } catch {
        continue;
      }
      const files = await findJsonlFiles(absPath, tool.recursive);
      allFiles.push(...files);
    }

    if (allFiles.length === 0) {
      notFound.push(tool.name);
      continue;
    }

    const modelUsage: Record<string, ModelUsage> = {};
    const toolModelDateCosts: Record<
      string,
      Record<string, ModelDateCost>
    > = {};
    let totalInput = 0,
      totalOutput = 0,
      totalCacheRead = 0,
      totalCacheCreation = 0,
      totalCost = 0;
    const projectMap = new Map<
      string,
      { cost: number; sessions: number; tokens: number }
    >();
    const dailyMap = new Map<string, { cost: number; sessions: number }>();
    const sessionsDetail: SessionDetail[] = [];

    for (const file of allFiles) {
      const result = await parseJsonlFile(file);
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;
      totalCacheRead += result.cacheReadTokens;
      totalCacheCreation += result.cacheCreationTokens;
      totalCost += result.costUSD;

      // Per-session detail
      let durationMinutes = 0;
      if (result.firstTimestamp && result.lastTimestamp) {
        const first = new Date(result.firstTimestamp).getTime();
        const last = new Date(result.lastTimestamp).getTime();
        durationMinutes = Math.max(0, Math.round((last - first) / 60000));
      }
      const topModel =
        Object.entries(result.modelUsage).sort(
          ([, a], [, b]) => b.costUSD - a.costUSD,
        )[0]?.[0] || "unknown";
      sessionsDetail.push({
        path: file,
        cost: result.costUSD,
        tokens: result.inputTokens + result.outputTokens,
        duration_minutes: durationMinutes,
        model: topModel,
      });

      for (const [date, cost] of Object.entries(result.dateCosts)) {
        const dayEntry = dailyMap.get(date) || { cost: 0, sessions: 0 };
        dayEntry.cost += cost;
        dayEntry.sessions += 1;
        dailyMap.set(date, dayEntry);
      }

      for (const [model, usage] of Object.entries(result.modelUsage)) {
        if (!modelUsage[model]) {
          modelUsage[model] = {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUSD: 0,
          };
        }
        modelUsage[model].inputTokens += usage.inputTokens;
        modelUsage[model].outputTokens += usage.outputTokens;
        modelUsage[model].cacheReadTokens += usage.cacheReadTokens;
        modelUsage[model].cacheCreationTokens += usage.cacheCreationTokens;
        modelUsage[model].costUSD += usage.costUSD;
      }

      for (const [model, dates] of Object.entries(result.modelDateCosts)) {
        if (!toolModelDateCosts[model]) toolModelDateCosts[model] = {};
        for (const [date, mdc] of Object.entries(dates)) {
          const existing = toolModelDateCosts[model][date] || {
            cost: 0,
            input: 0,
            output: 0,
            cacheRead: 0,
          };
          existing.cost += mdc.cost;
          existing.input += mdc.input;
          existing.output += mdc.output;
          existing.cacheRead += mdc.cacheRead;
          toolModelDateCosts[model][date] = existing;
        }
      }

      const projName = projectNameFromPath(file, tool.name);
      const existing = projectMap.get(projName) || {
        cost: 0,
        sessions: 0,
        tokens: 0,
      };
      existing.cost += result.costUSD;
      existing.sessions += 1;
      existing.tokens += result.inputTokens + result.outputTokens;
      projectMap.set(projName, existing);
    }

    if (totalInput === 0 && totalOutput === 0) {
      notFound.push(tool.name);
      continue;
    }

    const projects = [...projectMap.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost);

    const dailyCosts = [...dailyMap.entries()]
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const billing = await detectBillingType(tool.name);

    found.push({
      tool: tool.name,
      sessions: allFiles.length,
      totalCost,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreation,
      modelUsage,
      modelDateCosts: toolModelDateCosts,
      projects,
      dailyCosts,
      sessions_detail: sessionsDetail,
      ...billing,
    });
  }

  return { found, notFound };
}

const SUBSCRIPTION_PLANS: Record<string, { name: string; cost: number }[]> = {
  "Claude Code": [
    { name: "Pro ($20/mo)", cost: 20 },
    { name: "Max ($100/mo)", cost: 100 },
    { name: "Max ($200/mo)", cost: 200 },
  ],
  Cursor: [
    { name: "Pro ($20/mo)", cost: 20 },
    { name: "Business ($40/mo)", cost: 40 },
  ],
  "Claude Desktop": [
    { name: "Pro ($20/mo)", cost: 20 },
    { name: "Max ($100/mo)", cost: 100 },
    { name: "Max ($200/mo)", cost: 200 },
  ],
};

async function detectBillingType(toolName: string): Promise<{
  billingType: "subscription" | "api";
  planName?: string;
  planCost?: number;
  planCostAssumed?: boolean;
}> {
  const home = homedir();

  if (toolName === "Claude Code") {
    try {
      const settingsPath = join(home, ".claude", "settings.json");
      const raw = await readFile(settingsPath, "utf-8");
      const settings = JSON.parse(raw);
      if (settings.customApiKey) {
        return { billingType: "api" };
      }
    } catch {
      /* no settings file */
    }
    return {
      billingType: "subscription",
      planName: "Max",
      planCost: 200,
      planCostAssumed: true,
    };
  }

  if (toolName === "OpenClaw") {
    return { billingType: "api" };
  }

  if (toolName === "Cursor") {
    return {
      billingType: "subscription",
      planName: "Pro",
      planCost: 20,
      planCostAssumed: true,
    };
  }

  if (toolName === "Claude Desktop") {
    return {
      billingType: "subscription",
      planName: "Max",
      planCost: 200,
      planCostAssumed: true,
    };
  }

  // Default: assume API for tools we don't know
  return { billingType: "api" };
}
