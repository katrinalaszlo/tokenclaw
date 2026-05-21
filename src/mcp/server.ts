import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readState, isStateStale } from "../state.js";
import {
  estimateCost,
  getPricing,
  DEFAULT_PRICING,
  MODEL_PRICING,
} from "../pricing.js";
import { parseJsonlFile, isAuxiliaryFile } from "../scanners/local.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";

async function findMostRecentJsonl(dir: string): Promise<string | null> {
  let best: { path: string; mtime: number } | null = null;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        try {
          const subEntries = await readdir(full);
          for (const sf of subEntries) {
            if (sf.endsWith(".jsonl") && !isAuxiliaryFile(sf)) {
              const fp = join(full, sf);
              const s = await stat(fp);
              if (!best || s.mtimeMs > best.mtime) {
                best = { path: fp, mtime: s.mtimeMs };
              }
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

  return best?.path ?? null;
}

function projectPathToDir(projectPath: string): string {
  return "-" + projectPath.replace(/^\//, "").replace(/\//g, "-");
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "tokenclaw", version: "2.2.2" });

  // ── get_budget_status ──

  server.tool(
    "get_budget_status",
    "Get current daily/weekly budget status from tokenclaw",
    {},
    async () => {
      const state = readState();

      if (!state) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No tokenclaw state available. Run `tokenclaw` first.",
              }),
            },
          ],
        };
      }

      if (isStateStale(state)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ...state,
                remaining:
                  Math.round((state.daily_threshold - state.today_usd) * 100) /
                  100,
                warning: `State is stale (last scan: ${state.last_scan}). Run \`tokenclaw\` to refresh.`,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              today_usd: state.today_usd,
              daily_threshold: state.daily_threshold,
              remaining:
                Math.round((state.daily_threshold - state.today_usd) * 100) /
                100,
              pct: state.pct,
              weekly_usd: state.weekly_usd,
              weekly_threshold: state.weekly_threshold,
              sessions_today: state.sessions_today,
            }),
          },
        ],
      };
    },
  );

  // ── get_session_cost ──

  server.tool(
    "get_session_cost",
    "Get cost of a specific session or the most recent one",
    {
      project_path: z
        .string()
        .optional()
        .describe(
          "Absolute path to a project directory. If omitted, uses the most recent session.",
        ),
    },
    async ({ project_path }) => {
      const claudeProjectsDir = join(homedir(), ".claude", "projects");
      let jsonlPath: string | null = null;

      if (project_path) {
        const dirName = projectPathToDir(project_path);
        const projectDir = join(claudeProjectsDir, dirName);
        try {
          const entries = await readdir(projectDir);
          let bestMtime = 0;
          for (const f of entries) {
            if (f.endsWith(".jsonl") && !isAuxiliaryFile(f)) {
              const fp = join(projectDir, f);
              const s = await stat(fp);
              if (s.mtimeMs > bestMtime) {
                bestMtime = s.mtimeMs;
                jsonlPath = fp;
              }
            }
          }
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `No session data found for project: ${project_path}`,
                }),
              },
            ],
          };
        }
      } else {
        jsonlPath = await findMostRecentJsonl(claudeProjectsDir);
      }

      if (!jsonlPath) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No session JSONL files found.",
              }),
            },
          ],
        };
      }

      const result = await parseJsonlFile(jsonlPath);

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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              cost_usd: Math.round(result.costUSD * 1000) / 1000,
              tokens: result.inputTokens + result.outputTokens,
              model: topModel,
              duration_minutes: durationMinutes,
            }),
          },
        ],
      };
    },
  );

  // ── estimate_cost ──

  server.tool(
    "estimate_cost",
    "Estimate cost for a model call given token counts",
    {
      model: z.string().describe("Model name (e.g. claude-sonnet-4-6, gpt-4o)"),
      input_tokens: z.number().describe("Number of input tokens"),
      output_tokens: z.number().describe("Number of output tokens"),
      cache_read_tokens: z
        .number()
        .optional()
        .describe("Number of cache read tokens"),
      cache_write_tokens: z
        .number()
        .optional()
        .describe("Number of cache write tokens"),
    },
    async ({
      model,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens,
    }) => {
      const cost = estimateCost(
        model,
        input_tokens,
        output_tokens,
        cache_read_tokens ?? 0,
        cache_write_tokens ?? 0,
      );

      const pricing = getPricing(model);
      const modelTier =
        pricing === DEFAULT_PRICING && !MODEL_PRICING[model]
          ? "unknown"
          : "known";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              estimated_cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
              model_tier: modelTier,
            }),
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
