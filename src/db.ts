import Database from "better-sqlite3";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

export const SUBSCRIPTION_TOOLS = new Set([
  "Claude Code",
  "Cursor",
  "Claude Desktop",
]);

let db: Database.Database | null = null;

function getAccDir(): string {
  return join(homedir(), ".tokenclaw");
}

function getDbPath(): string {
  return join(getAccDir(), "data.db");
}

export function initDB(): Database.Database {
  if (db) return db;

  const dir = getAccDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(getDbPath());
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool TEXT NOT NULL,
      date TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_name TEXT NOT NULL,
      action TEXT NOT NULL,
      escalation_level INTEGER NOT NULL DEFAULT 0,
      details_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proxy_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_prefix TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      cost_usd REAL NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  // Migration: dedup cost_snapshots before adding unique index
  const hasIndex = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_cost_snapshots_unique'`,
    )
    .get();
  if (!hasIndex) {
    db.exec(`
      DELETE FROM cost_snapshots
      WHERE id NOT IN (
        SELECT MAX(id) FROM cost_snapshots
        GROUP BY tool, date, COALESCE(model, '')
      );
      CREATE UNIQUE INDEX idx_cost_snapshots_unique
        ON cost_snapshots(tool, date, COALESCE(model, ''));
    `);
  }

  return db;
}

function getDb(): Database.Database {
  if (!db) return initDB();
  return db;
}

export function insertCostSnapshot(
  tool: string,
  date: string,
  amount: number,
  tokens: { input: number; output: number; cacheRead: number },
  model?: string,
): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO cost_snapshots (tool, date, amount_usd, input_tokens, output_tokens, cache_read_tokens, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tool, date, COALESCE(model, ''))
       DO UPDATE SET amount_usd = excluded.amount_usd,
                     input_tokens = excluded.input_tokens,
                     output_tokens = excluded.output_tokens,
                     cache_read_tokens = excluded.cache_read_tokens,
                     created_at = excluded.created_at`,
    )
    .run(
      tool,
      date,
      amount,
      tokens.input,
      tokens.output,
      tokens.cacheRead,
      model ?? null,
      new Date().toISOString(),
    );
}

export interface CostSnapshotRow {
  id: number;
  tool: string;
  date: string;
  amount_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  model: string | null;
  created_at: string;
}

export function getCostSnapshots(
  tool?: string,
  startDate?: string,
  endDate?: string,
): CostSnapshotRow[] {
  const database = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (tool) {
    conditions.push("tool = ?");
    params.push(tool);
  }
  if (startDate) {
    conditions.push("date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("date <= ?");
    params.push(endDate);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return database
    .prepare(
      `SELECT * FROM cost_snapshots ${where} ORDER BY date DESC, created_at DESC`,
    )
    .all(...params) as CostSnapshotRow[];
}

export function getTodaySpend(options?: {
  tool?: string;
  date?: string;
}): number {
  const database = getDb();
  const targetDate = options?.date ?? new Date().toISOString().split("T")[0]!;
  const excludeList = [...SUBSCRIPTION_TOOLS];
  const placeholders = excludeList.map(() => "?").join(",");

  if (options?.tool) {
    const row = database
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) as total FROM cost_snapshots WHERE date = ? AND tool = ?`,
      )
      .get(targetDate, options.tool) as { total: number };
    return row.total;
  }

  const row = database
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM cost_snapshots WHERE date = ? AND tool NOT IN (${placeholders})`,
    )
    .get(targetDate, ...excludeList) as { total: number };
  return row.total;
}

export function getAverageDaily(days: number = 30): number {
  const database = getDb();
  const excludeList = [...SUBSCRIPTION_TOOLS];
  const placeholders = excludeList.map(() => "?").join(",");
  const row = database
    .prepare(
      `SELECT COALESCE(AVG(daily_total), 0) as avg_daily
       FROM (
         SELECT date, SUM(amount_usd) as daily_total
         FROM cost_snapshots
         WHERE date >= date('now', '-' || ? || ' days')
           AND tool NOT IN (${placeholders})
         GROUP BY date
       )`,
    )
    .get(days, ...excludeList) as { avg_daily: number };
  return row.avg_daily;
}

export interface AlertEventRow {
  id: number;
  rule_name: string;
  action: string;
  escalation_level: number;
  details_json: string | null;
  created_at: string;
}

export function insertAlertEvent(
  ruleName: string,
  action: "fired" | "acknowledged" | "escalated",
  level: number,
  details?: Record<string, unknown>,
): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO alert_events (rule_name, action, escalation_level, details_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      ruleName,
      action,
      level,
      details ? JSON.stringify(details) : null,
      new Date().toISOString(),
    );
}

export function getRecentAlerts(hours: number = 24): AlertEventRow[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT * FROM alert_events
       WHERE created_at >= datetime('now', '-' || ? || ' hours')
       ORDER BY created_at DESC`,
    )
    .all(hours) as AlertEventRow[];
}

// ── Proxy request tracking ──

export interface ProxyRequestRow {
  id: number;
  api_key_prefix: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  timestamp: string;
}

export function insertProxyRequest(
  apiKeyPrefix: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  costUsd: number,
): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO proxy_requests (api_key_prefix, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      apiKeyPrefix,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
      new Date().toISOString(),
    );
}

export function getSpendByKeyPrefix(prefix: string, since: string): number {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as total
       FROM proxy_requests
       WHERE api_key_prefix = ? AND timestamp >= ?`,
    )
    .get(prefix, since) as { total: number };
  return row.total;
}

export interface KeySpendRow {
  api_key_prefix: string;
  total_cost: number;
  request_count: number;
  last_request: string;
}

export function getKeyBreakdown(since: string): KeySpendRow[] {
  const database = getDb();
  return database
    .prepare(
      `SELECT api_key_prefix,
              SUM(cost_usd) as total_cost,
              COUNT(*) as request_count,
              MAX(timestamp) as last_request
       FROM proxy_requests
       WHERE timestamp >= ?
       GROUP BY api_key_prefix
       ORDER BY total_cost DESC`,
    )
    .all(since) as KeySpendRow[];
}

export function hasProxyData(): boolean {
  const database = getDb();
  const row = database
    .prepare(`SELECT COUNT(*) as count FROM proxy_requests`)
    .get() as { count: number };
  return row.count > 0;
}

export function getRecentVelocity(minutes: number): number {
  const database = getDb();
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as total
       FROM proxy_requests
       WHERE timestamp >= ?`,
    )
    .get(since) as { total: number };
  return minutes > 0 ? row.total / minutes : 0;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
