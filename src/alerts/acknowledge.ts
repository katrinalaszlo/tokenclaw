/**
 * Acknowledgment management.
 * Tracks which alerts have been acknowledged with a TTL.
 * Storage: JSON file at ~/.acc/ack-state.json
 *
 * Ack loop: alert fires -> user acks -> silence for TTL -> alert can fire again
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ACK_DIR = join(homedir(), ".acc");
const ACK_FILE = join(ACK_DIR, "ack-state.json");
const DEFAULT_TTL_HOURS = 24;

export interface AckEntry {
  alertId: string;
  acknowledgedAt: string;
  expiresAt: string;
}

export type AckState = Record<string, AckEntry>;

/**
 * Acknowledge an alert. Silences it for ttlHours (default 24).
 * alertId is typically the rule ID — acking a rule silences all alerts from that rule.
 */
export function acknowledgeAlert(
  alertId: string,
  ttlHours: number = DEFAULT_TTL_HOURS,
): void {
  const state = getAckState();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  state[alertId] = {
    alertId,
    acknowledgedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  writeAckState(state);
}

/**
 * Check if an alert is currently acknowledged (not expired).
 */
export function isAcknowledged(alertId: string): boolean {
  const state = getAckState();
  const entry = state[alertId];
  if (!entry) return false;
  return new Date(entry.expiresAt) > new Date();
}

/**
 * Load full ack state from disk. Returns empty object if file missing.
 * Prunes expired entries on read.
 */
export function getAckState(): AckState {
  let raw: string;
  try {
    raw = readFileSync(ACK_FILE, "utf-8");
  } catch {
    return {};
  }

  let state: AckState;
  try {
    state = JSON.parse(raw) as AckState;
  } catch {
    return {};
  }

  // Prune expired entries
  const now = new Date();
  const pruned: AckState = {};
  for (const [id, entry] of Object.entries(state)) {
    if (new Date(entry.expiresAt) > now) {
      pruned[id] = entry;
    }
  }

  // Write back if we pruned anything
  if (Object.keys(pruned).length !== Object.keys(state).length) {
    writeAckState(pruned);
  }

  return pruned;
}

function writeAckState(state: AckState): void {
  mkdirSync(ACK_DIR, { recursive: true });
  writeFileSync(ACK_FILE, JSON.stringify(state, null, 2), "utf-8");
}
