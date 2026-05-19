import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { initDB, insertProxyRequest, getSpendByKeyPrefix } from "../db.js";
import { loadConfig, type KeyBudget } from "../config.js";
import { estimateCost } from "../pricing.js";
import { sendSlackAlert } from "../alerts/slack.js";
import {
  detectProvider,
  extractApiKey,
  truncateKey,
  matchKeyPrefix,
  getBudgetWindowStart,
  parseSSEUsage,
  parseJsonUsage,
  injectStreamUsage,
  UPSTREAM_HOSTS,
  type Provider,
} from "./parse.js";

const FORWARDED_HEADERS_ANTHROPIC = new Set([
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "content-type",
  "accept",
]);

const FORWARDED_HEADERS_OPENAI = new Set([
  "authorization",
  "content-type",
  "accept",
  "openai-organization",
  "openai-project",
]);

function buildForwardHeaders(
  incoming: IncomingMessage,
  provider: Provider,
): Record<string, string> {
  const allowed =
    provider === "anthropic"
      ? FORWARDED_HEADERS_ANTHROPIC
      : FORWARDED_HEADERS_OPENAI;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (allowed.has(key) && typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}

async function checkBudgetAlert(
  prefix: string,
  budget: KeyBudget,
  slackWebhook: string,
  logFn: (msg: string) => void,
): Promise<void> {
  if (!slackWebhook) return;
  const windowStart = getBudgetWindowStart(budget.period);
  const spent = getSpendByKeyPrefix(prefix, windowStart);
  const pct = budget.budget > 0 ? spent / budget.budget : 0;

  if (pct >= 1.0) {
    logFn(
      `ALERT: ${prefix} exceeded budget ($${spent.toFixed(2)} / $${budget.budget.toFixed(2)})`,
    );
    try {
      await sendSlackAlert(slackWebhook, {
        alertId: `key-${prefix}-${Date.now()}`,
        ruleId: `key-budget-${prefix}`,
        ruleName: `Key budget: ${prefix}`,
        level: 1,
        amount: spent,
        threshold: budget.budget,
        isEscalation: false,
        isSpike: false,
        frequency: "hourly",
        tools: [{ name: prefix, amount: spent }],
      });
    } catch (err) {
      logFn(`Slack alert failed: ${err}`);
    }
  } else if (pct >= 0.8) {
    logFn(`WARNING: ${prefix} at ${Math.round(pct * 100)}% of budget`);
    try {
      await sendSlackAlert(slackWebhook, {
        alertId: `key-${prefix}-warn-${Date.now()}`,
        ruleId: `key-budget-${prefix}`,
        ruleName: `Key budget warning: ${prefix}`,
        level: 0,
        amount: spent,
        threshold: budget.budget,
        isEscalation: false,
        isSpike: false,
        frequency: "daily",
        tools: [{ name: prefix, amount: spent }],
      });
    } catch (err) {
      logFn(`Slack alert failed: ${err}`);
    }
  }
}

async function recordAndAlert(
  storedPrefix: string,
  match: { prefix: string; budget: KeyBudget } | null,
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  },
  slackWebhook: string,
  logFn: (msg: string) => void,
): Promise<void> {
  const cost = estimateCost(
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheCreationTokens,
  );
  insertProxyRequest(
    storedPrefix,
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheCreationTokens,
    cost,
  );
  logFn(
    `${storedPrefix} ${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} $${cost.toFixed(4)}`,
  );
  if (match) {
    await checkBudgetAlert(match.prefix, match.budget, slackWebhook, logFn);
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  keyBudgets: Record<string, KeyBudget>,
  slackWebhook: string,
  logFn: (msg: string) => void,
): Promise<void> {
  const provider = detectProvider(req.url ?? "");
  const apiKey = extractApiKey(
    req.headers as Record<string, string | string[] | undefined>,
    provider,
  );

  if (!apiKey) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          type: "authentication_error",
          message: `Missing API key. ${provider === "anthropic" ? "Set x-api-key header." : "Set Authorization: Bearer <key> header."}`,
        },
      }),
    );
    return;
  }

  const keyPrefix = truncateKey(apiKey);
  const match = matchKeyPrefix(apiKey, keyBudgets);

  if (match) {
    const windowStart = getBudgetWindowStart(match.budget.period);
    const spent = getSpendByKeyPrefix(match.prefix, windowStart);
    const pct =
      match.budget.budget > 0 ? (spent / match.budget.budget) * 100 : 0;

    // Evaluate rules: fire all matching, apply most severe action
    let shouldBlock = false;
    for (const rule of match.budget.rules) {
      if (pct >= rule.at) {
        if (rule.action === "block") {
          shouldBlock = true;
        } else if (rule.action === "alert") {
          await checkBudgetAlert(
            match.prefix,
            match.budget,
            slackWebhook,
            logFn,
          );
        }
      }
    }

    if (shouldBlock) {
      logFn(
        `BLOCKED ${match.prefix} — $${spent.toFixed(2)} / $${match.budget.budget.toFixed(2)} ${match.budget.period} (${Math.round(pct)}%)`,
      );
      res.writeHead(429, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            type: "budget_exceeded",
            message: `Key ${match.prefix} exceeded ${match.budget.period === "day" ? "daily" : match.budget.period + "ly"} budget of $${match.budget.budget.toFixed(2)} ($${spent.toFixed(2)} spent).`,
          },
        }),
      );
      return;
    }
  }

  // Read request body
  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(chunk as Buffer);
  }
  const rawBody = Buffer.concat(bodyChunks).toString();

  // For OpenAI streaming, inject stream_options so we get usage in the response
  const requestBody =
    provider === "openai" ? injectStreamUsage(rawBody) : rawBody;

  // Forward to upstream
  const upstreamHost = UPSTREAM_HOSTS[provider];
  const forwardHeaders = buildForwardHeaders(req, provider);
  const upstreamUrl = `https://${upstreamHost}${req.url}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: req.method ?? "POST",
      headers: forwardHeaders,
      body: requestBody,
    });
  } catch (err) {
    logFn(`Upstream error (${provider}): ${err}`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          type: "proxy_error",
          message: `Failed to reach ${upstreamHost}`,
        },
      }),
    );
    return;
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "";
  const isStreaming = contentType.includes("text/event-stream");

  // Forward response headers
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (
      key !== "content-encoding" &&
      key !== "transfer-encoding" &&
      key !== "content-length"
    ) {
      responseHeaders[key] = value;
    }
  }
  res.writeHead(upstreamRes.status, responseHeaders);

  if (!upstreamRes.ok || !upstreamRes.body) {
    const errBody = await upstreamRes.text();
    res.end(errBody);
    return;
  }

  const storedPrefix = match?.prefix ?? keyPrefix;

  if (isStreaming) {
    let sseBuffer = "";
    const decoder = new TextDecoder();
    const reader = upstreamRes.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        sseBuffer += decoder.decode(value, { stream: true });
      }
    } catch (err) {
      logFn(`Stream read error: ${err}`);
    }
    res.end();

    const usage = parseSSEUsage(sseBuffer, provider);
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      await recordAndAlert(storedPrefix, match, usage, slackWebhook, logFn);
    }
  } else {
    const responseBody = await upstreamRes.text();
    res.end(responseBody);

    const usage = parseJsonUsage(responseBody, provider);
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      await recordAndAlert(storedPrefix, match, usage, slackWebhook, logFn);
    }
  }
}

export function startProxy(port: number = 4040): void {
  initDB();
  const config = loadConfig();
  const keyBudgets = config.key_budgets;
  const slackWebhook = config.alerts.slack_webhook;
  const budgetCount = Object.keys(keyBudgets).length;

  const logFn = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    console.log(`[${ts}] ${msg}`);
  };

  const server = createServer((req, res) => {
    handleRequest(req, res, keyBudgets, slackWebhook, logFn).catch((err) => {
      logFn(`Unhandled error: ${err}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { type: "proxy_error", message: "Internal proxy error" },
          }),
        );
      }
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`tokenclaw proxy listening on http://localhost:${port}`);
    console.log(
      "Forwarding: /v1/messages → api.anthropic.com, /v1/chat/completions → api.openai.com",
    );
    console.log(
      `${budgetCount} key budget${budgetCount === 1 ? "" : "s"} active`,
    );
    if (budgetCount > 0) {
      for (const [prefix, budget] of Object.entries(keyBudgets)) {
        console.log(`  ${prefix}: $${budget.budget}/${budget.period}`);
      }
    }
    console.log("");
  });
}
