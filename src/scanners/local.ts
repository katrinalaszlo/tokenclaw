import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

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

export type ToolScanResult = {
  tool: string;
  sessions: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  modelUsage: Record<string, ModelUsage>;
  projects: { name: string; cost: number; sessions: number; tokens: number }[];
  dailyCosts: DailyCost[];
  billingType: "subscription" | "api";
  planName?: string;
  planCost?: number;
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

const MODEL_PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },
  "claude-sonnet-4-5-20250514": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
};

const DEFAULT_PRICING = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

function getPricing(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  if (model.includes("opus")) return MODEL_PRICING["claude-opus-4-6"];
  if (model.includes("sonnet")) return MODEL_PRICING["claude-sonnet-4-6"];
  if (model.includes("haiku"))
    return MODEL_PRICING["claude-haiku-4-5-20251001"];
  return DEFAULT_PRICING;
}

function estimateCost(
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const p = getPricing(model);
  return (
    (input * p.input +
      output * p.output +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

async function findJsonlFiles(
  dir: string,
  recursive: boolean,
): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(full);
      } else if (entry.isDirectory() && recursive) {
        const sub = await findJsonlFiles(full, true);
        results.push(...sub);
      } else if (entry.isDirectory() && !recursive) {
        // For non-recursive (Claude Code style), look for jsonl inside project dirs
        try {
          const subEntries = await readdir(full);
          for (const sf of subEntries) {
            if (sf.endsWith(".jsonl")) {
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

async function parseJsonlFile(filePath: string): Promise<{
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUSD: number;
  modelUsage: Record<string, ModelUsage>;
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
    };
  }

  const lines = content.split("\n").filter((l) => l.trim());
  const lastUsageByMsg = new Map<
    string,
    { model: string; usage: Record<string, unknown> }
  >();
  let anonCounter = 0;

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const msg = parsed.message as
      | { id?: string; usage?: Record<string, unknown>; model?: string }
      | undefined;
    if (!msg?.usage) continue;

    const msgId = msg.id ?? `anon-${anonCounter++}`;
    lastUsageByMsg.set(msgId, {
      model: msg.model || "unknown",
      usage: msg.usage,
    });
  }

  const modelUsage: Record<string, ModelUsage> = {};
  let totalInput = 0,
    totalOutput = 0,
    totalCacheRead = 0,
    totalCacheCreation = 0,
    totalCost = 0;

  for (const [, { model, usage }] of lastUsageByMsg) {
    // Handle both Claude Code format (input_tokens) and OpenClaw format (input)
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
  }

  return {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreation,
    costUSD: totalCost,
    modelUsage,
  };
}

function projectNameFromPath(filePath: string, toolName: string): string {
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

    for (const file of allFiles) {
      const result = await parseJsonlFile(file);
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;
      totalCacheRead += result.cacheReadTokens;
      totalCacheCreation += result.cacheCreationTokens;
      totalCost += result.costUSD;

      // Get file date for time series
      let fileDate: string;
      try {
        const fileStat = await stat(file);
        fileDate = fileStat.mtime.toISOString().split("T")[0]!;
      } catch {
        fileDate = new Date().toISOString().split("T")[0]!;
      }
      const dayEntry = dailyMap.get(fileDate) || { cost: 0, sessions: 0 };
      dayEntry.cost += result.costUSD;
      dayEntry.sessions += 1;
      dailyMap.set(fileDate, dayEntry);

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
      projects,
      dailyCosts,
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
    return { billingType: "subscription", planName: "Max", planCost: 200 };
  }

  if (toolName === "OpenClaw") {
    return { billingType: "api" };
  }

  if (toolName === "Cursor") {
    return { billingType: "subscription", planName: "Pro", planCost: 20 };
  }

  if (toolName === "Claude Desktop") {
    return { billingType: "subscription", planName: "Max", planCost: 200 };
  }

  // Default: assume API for tools we don't know
  return { billingType: "api" };
}
