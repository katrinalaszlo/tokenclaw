import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAlerts,
  type AlertRule,
  type CostSnapshot,
  type AlertHistoryEntry,
  type AckState,
} from "../src/alerts/engine.js";

// ── Helpers ──

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "rule-1",
    name: "Daily spend",
    threshold_usd: 100,
    period: "daily",
    escalation: [{ above: 100, frequency: "daily" }],
    ...overrides,
  };
}

function makeSpend(amount: number): CostSnapshot[] {
  return [
    {
      provider: "anthropic",
      tool: "Claude Code",
      date: "2026-05-22",
      amount_usd: amount,
    },
  ];
}

function makeMultiToolSpend(
  items: { tool: string; amount: number }[],
): CostSnapshot[] {
  return items.map((i) => ({
    provider: "anthropic",
    tool: i.tool,
    date: "2026-05-22",
    amount_usd: i.amount,
  }));
}

// ── Threshold crossing ──

describe("evaluateAlerts threshold", () => {
  it("fires when spend exceeds threshold", () => {
    const actions = evaluateAlerts(makeSpend(150), [makeRule()], [], {});
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.amount, 150);
    assert.equal(actions[0]!.threshold, 100);
    assert.equal(actions[0]!.isSpike, false);
  });

  it("does not fire when spend is under threshold", () => {
    const actions = evaluateAlerts(makeSpend(50), [makeRule()], [], {});
    assert.equal(actions.length, 0);
  });

  it("does not fire when spend equals threshold exactly", () => {
    // evaluateAlerts uses > not >=
    const actions = evaluateAlerts(makeSpend(100), [makeRule()], [], {});
    assert.equal(actions.length, 0);
  });
});

// ── Acknowledgment ──

describe("evaluateAlerts acknowledgment", () => {
  it("suppresses alert when acked and not expired", () => {
    const ackState: AckState = {
      "rule-1": {
        alertId: "rule-1-prev",
        acknowledgedAt: "2026-05-22T10:00:00Z",
        expiresAt: "2099-12-31T23:59:59Z", // far future
      },
    };
    const actions = evaluateAlerts(makeSpend(150), [makeRule()], [], ackState);
    assert.equal(actions.length, 0);
  });

  it("fires after ack TTL expires", () => {
    const ackState: AckState = {
      "rule-1": {
        alertId: "rule-1-prev",
        acknowledgedAt: "2026-05-20T10:00:00Z",
        expiresAt: "2026-05-21T10:00:00Z", // in the past
      },
    };
    const actions = evaluateAlerts(makeSpend(150), [makeRule()], [], ackState);
    assert.equal(actions.length, 1);
  });
});

// ── Escalation tiers ──

describe("evaluateAlerts escalation", () => {
  const escalationRule = makeRule({
    threshold_usd: 50,
    escalation: [
      { above: 100, frequency: "daily" },
      { above: 500, frequency: "3x_daily" },
      { above: 1000, frequency: "5x_daily" },
    ],
  });

  it("$200 spend → level 0 (above:100 only)", () => {
    const actions = evaluateAlerts(makeSpend(200), [escalationRule], [], {});
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.level, 0);
    assert.equal(actions[0]!.frequency, "daily");
  });

  it("$600 spend → level 1 (above:500)", () => {
    const actions = evaluateAlerts(makeSpend(600), [escalationRule], [], {});
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.level, 1);
    assert.equal(actions[0]!.frequency, "3x_daily");
  });

  it("$1500 spend → level 2 (above:1000)", () => {
    const actions = evaluateAlerts(makeSpend(1500), [escalationRule], [], {});
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.level, 2);
    assert.equal(actions[0]!.frequency, "5x_daily");
  });

  it("marks isEscalation when level increases from last fired", () => {
    const history: AlertHistoryEntry[] = [
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: "2026-05-20T10:00:00Z", // old enough to pass frequency check
        amount_usd: 200,
        escalation_level: 0,
      },
    ];
    const actions = evaluateAlerts(
      makeSpend(600),
      [escalationRule],
      history,
      {},
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.isEscalation, true);
    assert.equal(actions[0]!.level, 1);
  });
});

// ── Frequency limiting ──

describe("evaluateAlerts frequency limiting", () => {
  it("suppresses re-fire within frequency window", () => {
    const now = new Date();
    // Last fired 1 hour ago — daily frequency = 24h window, so within interval
    const recentTs = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const history: AlertHistoryEntry[] = [
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: recentTs,
        amount_usd: 150,
        escalation_level: 0,
      },
    ];
    const actions = evaluateAlerts(makeSpend(150), [makeRule()], history, {});
    assert.equal(actions.length, 0);
  });

  it("fires after frequency window elapses", () => {
    const now = new Date();
    // Last fired 25 hours ago — outside 24h daily window
    const oldTs = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const history: AlertHistoryEntry[] = [
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: oldTs,
        amount_usd: 150,
        escalation_level: 0,
      },
    ];
    const actions = evaluateAlerts(makeSpend(150), [makeRule()], history, {});
    assert.equal(actions.length, 1);
  });

  it("hourly frequency allows re-fire after 1 hour", () => {
    const rule = makeRule({
      escalation: [{ above: 100, frequency: "hourly" }],
    });
    const now = new Date();
    const oldTs = new Date(now.getTime() - 61 * 60 * 1000).toISOString(); // 61 min ago
    const history: AlertHistoryEntry[] = [
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: oldTs,
        amount_usd: 150,
        escalation_level: 0,
      },
    ];
    const actions = evaluateAlerts(makeSpend(150), [rule], history, {});
    assert.equal(actions.length, 1);
  });
});

// ── Spike detection ──

describe("evaluateAlerts spike detection", () => {
  it("fires spike when current > 3x average of history", () => {
    // Set threshold high so only spike triggers (not threshold crossing)
    const rule = makeRule({ threshold_usd: 99999 });
    // History average: (100 + 100) / 2 = 100. Spike threshold: 300.
    const history: AlertHistoryEntry[] = [
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: "2026-05-18T10:00:00Z",
        amount_usd: 100,
        escalation_level: 0,
      },
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: "2026-05-19T10:00:00Z",
        amount_usd: 100,
        escalation_level: 0,
      },
    ];
    // Current spend: 350 > 3 * 100 = 300 → spike
    const actions = evaluateAlerts(makeSpend(350), [rule], history, {});
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.isSpike, true);
  });

  it("no spike when current < 3x average", () => {
    const rule = makeRule({ threshold_usd: 99999 });
    const history: AlertHistoryEntry[] = [
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: "2026-05-18T10:00:00Z",
        amount_usd: 100,
        escalation_level: 0,
      },
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: "2026-05-19T10:00:00Z",
        amount_usd: 100,
        escalation_level: 0,
      },
    ];
    // Current spend: 250 < 3 * 100 = 300 → no spike, no threshold → no alert
    const actions = evaluateAlerts(makeSpend(250), [rule], history, {});
    assert.equal(actions.length, 0);
  });

  it("no spike with fewer than 2 history entries", () => {
    const rule = makeRule({ threshold_usd: 99999 });
    const history: AlertHistoryEntry[] = [
      {
        rule_id: "rule-1",
        action: "fired",
        timestamp: "2026-05-18T10:00:00Z",
        amount_usd: 50,
        escalation_level: 0,
      },
    ];
    // Even though 500 > 3*50, only 1 history entry → spike detection skipped
    const actions = evaluateAlerts(makeSpend(500), [rule], history, {});
    assert.equal(actions.length, 0);
  });

  it("no spike with zero history entries", () => {
    const rule = makeRule({ threshold_usd: 99999 });
    const actions = evaluateAlerts(makeSpend(500), [rule], [], {});
    assert.equal(actions.length, 0);
  });
});

// ── Multi-tool breakdown ──

describe("evaluateAlerts tools breakdown", () => {
  it("includes top tools sorted by spend descending", () => {
    const spend = makeMultiToolSpend([
      { tool: "Claude Code", amount: 80 },
      { tool: "Cursor", amount: 40 },
      { tool: "Aider", amount: 31 },
    ]);
    const actions = evaluateAlerts(spend, [makeRule()], [], {});
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.tools.length, 3);
    assert.equal(actions[0]!.tools[0]!.name, "Claude Code");
    assert.equal(actions[0]!.tools[1]!.name, "Cursor");
    assert.equal(actions[0]!.tools[2]!.name, "Aider");
  });
});

// ── Multiple rules ──

describe("evaluateAlerts multiple rules", () => {
  it("evaluates each rule independently", () => {
    const rules = [
      makeRule({ id: "rule-1", threshold_usd: 100 }),
      makeRule({ id: "rule-2", name: "Weekly spend", threshold_usd: 200 }),
    ];
    // $150 → crosses rule-1 (100) but not rule-2 (200)
    const actions = evaluateAlerts(makeSpend(150), rules, [], {});
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.ruleId, "rule-1");
  });

  it("fires both rules when both thresholds crossed", () => {
    const rules = [
      makeRule({ id: "rule-1", threshold_usd: 100 }),
      makeRule({ id: "rule-2", name: "Weekly spend", threshold_usd: 200 }),
    ];
    const actions = evaluateAlerts(makeSpend(250), rules, [], {});
    assert.equal(actions.length, 2);
    const ruleIds = actions.map((a) => a.ruleId).sort();
    assert.deepEqual(ruleIds, ["rule-1", "rule-2"]);
  });
});
