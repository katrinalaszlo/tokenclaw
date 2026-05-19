# [Name TBD] — Product Requirements Document

## One-liner

A package you install that tells you what you're spending on AI and yells when something's wrong.

---

## The Problem (in their words)

**David Garnitz** (serial founder, Sesame — voice AI):
> "I wouldn't pay for this on day one, but I would totally install a package where... if it can tell me in some simple way what am I spending — I run a CLI command, or I open a dashboard occasionally — even that as a free tool would be pretty useful."

> "Have you ever had a situation in the cloud where you accidentally spent tens or hundreds of thousands of dollars? Most people that have been in engineering long enough will say yes."

His prescription for Sesame-scale:
> "Detect every resource, set usage alert thresholds, escalate aggressively as costs approach $1K/day. Alert, confirm ('this is OK'), silence, repeat."

**Tim Hillison** (runs OpenClaw):
> "I was the day before on all these platforms and I'm just like, I've spent that much and I had no way of knowing that."

**NovaTech** (SaaS customer):
> "We had a customer generating 50,000 words a day. Average is 2,000. We didn't notice for three weeks."

**Dean Ogle** (VC):
> "When the bubble pops, you're in a great spot. Everyone will need to start monitoring their costs."

---

## Why now

1. **Claude Code going usage-based.** Every power user suddenly pays per token.
2. **More people running agents.** OpenClaw, Codex agents, Devin. Autonomous, 24/7, spending real money.
3. **API keys replacing subscriptions.** More developers on usage-based billing, not flat rate.
4. **Agents will make purchases.** Today it's API calls. Tomorrow it's buying services, running infrastructure, spending money on your behalf.

The protection layer needs to exist before the spending gets out of control.

---

## Who

Builders who use AI tools and API keys. Today: developers running Claude Code, Cursor, OpenClaw. Tomorrow: anyone whose agents spend money autonomously.

David described this person exactly: someone "hacking stuff together and deploying it on one of the clouds" who doesn't remember to set up billing reports when prototyping.

---

## What it does

### Install and forget

```
npx [name]
```

No code changes. No proxy. No base URL swaps. No signup. You install it, it scans, it watches.

### Layer 1: What am I spending? (free)

Scans local AI tools automatically:

| Tool | Data location |
|---|---|
| Claude Code | ~/.claude/projects/ |
| OpenClaw | ~/.openclaw/agents/main/sessions/ |
| Cursor | ~/.cursor/projects/ |
| Claude Desktop | ~/Library/Application Support/Claude/ |
| Windsurf | ~/.windsurf/ |
| Cline | ~/.cline/ |
| Roo Code | ~/.roo-code/ |
| Aider | ~/.aider/ |
| Continue.dev | ~/.continue/sessions/ |

Shows both numbers side by side:
- What you consumed (API-rate estimate from tokens)
- What you paid (subscription plan cost, if applicable)

Dashboard opens locally. Shareable card for social (acquisition hook).

### Layer 2: Yell when something's wrong (free or paid)

David's escalation pattern:

```
1. Set threshold ($100/day, $500/week, whatever)
2. Spend crosses threshold → ALERT (Slack, email, desktop notification)
3. You confirm "this is OK" → silence for 24h
4. Spend keeps rising → ESCALATE (more frequent, louder)
5. You don't confirm → keeps yelling
```

This is not a one-time notification. It's an escalating alarm that requires acknowledgment. The pattern David described at Sesame: alert, confirm, silence, repeat.

Rate-based, not just threshold-based:
- "Your spend jumped 3x from yesterday"
- "At this rate you'll burn through $X by end of week"
- "This agent session has cost $Y in 2 hours (your average is $Z)"

### Layer 3: Protection (paid, future)

As agents get more autonomous:
- Per-agent spend limits
- Per-session budgets
- Approval workflows ("Agent wants to spend $50 on this API call. Allow?")
- Kill switch for runaway agents
- Transaction-level controls when agents make purchases

This layer grows as agents grow. The enforcement layer that sits between the agent and money.

---

## The analogy

Credit card fraud alerts. Everyone's gotten the text from their bank: "Was this charge $847? Reply YES or NO." If you don't reply, the card gets frozen.

This product does the same thing for AI spend. Watches for anomalies. Alerts you. Requires acknowledgment. Escalates if you don't respond.

---

## The gap (validated by research)

A thorough gap analysis of every tool in the market (see docs/gap-analysis.md) confirms: **the acknowledgment loop does not exist in any AI spend tool today.**

| Requirement | How many tools have it |
|---|---|
| npm/npx install | Many (ccusage, codeburn, Bifrost) |
| Scans spend | Many (ccusage, codeburn, CostGoat, Bifrost) |
| One-shot threshold alerts | CostGoat, Bifrost (hard stops), Portkey, Helicone |
| Escalating alerts | **Zero** (Bifrost has hard stops, not escalation) |
| Acknowledgment loop ("this is OK" or keeps yelling) | **Zero** |
| Rate-based predictions | codeburn (passive forecast only) |
| Per-agent spend tracking | **Zero** |
| Scales to teams/multi-agent | Partial (Bifrost, CostGoat team plan, Portkey enterprise) |

CostGoat is the closest thing to a competitor -- desktop menubar app, 20 integrations (Claude Code, AWS, OpenRouter, etc.), $9/mo. But it's a billing dashboard with one-shot threshold alerts. 6-hour refresh cycle. No escalation, no acknowledgment, no rate-based detection. Solves "what's my balance?" not "something is wrong right now."

The closest approximation to the full alarm system today is duct-taping three tools: Bifrost for hard stops + codeburn for analysis + PagerDuty webhooks for escalation. Nobody ships this pre-assembled.

IDC FutureScape 2026: G1000 orgs face up to 30% rise in underestimated AI infra costs by 2027 from "opaque consumption models" of agentic workloads.

---

## What this is NOT

- **Not LiteLLM/Portkey.** Those are infrastructure you wire into your codebase. This is a package you install with no code changes.
- **Not Observe.** Observe is per-customer margin for SaaS founders. This is personal/team spend protection for builders.
- **Not CostGoat.** CostGoat is a menubar billing dashboard -- tracks credit balances across 20 services, alerts when you're running low. Different problem: "am I about to run out?" vs "is something going wrong right now?" CostGoat refreshes every 6 hours; a runaway agent burns money in minutes.
- **Not CostLayer/CodexBar.** Those are passive dashboards. This actively escalates when something's wrong and requires acknowledgment.
- **Not a proxy (in v1).** The proxy is Layer 3. v1 works by scanning local data and polling billing APIs.
- **Not ccusage/codeburn.** Those are retrospective scanners. By the time you check, the money is spent. This watches continuously and demands attention when something's wrong.

---

## The escalation pattern is the product

Every other tool shows you a number. This tool demands your attention when the number is wrong.

The difference between a dashboard and an alarm system. Dashboards get checked when you remember. Alarms check on you.

David's $200K bug happened because nobody was watching. Not because nobody had a dashboard. Because nobody had an alarm that wouldn't shut up until a human said "this is OK."

---

## How it works (no proxy needed for v1)

**Local scanning:** reads JSONL session files from tool data directories. Same approach as Claude Usage Tracker and agentlens. Calculates token costs from session data.

**Billing API polling (optional):** if you have admin API keys (Anthropic, OpenAI), pulls actual charges. Updated every few hours.

**Alert engine:** runs as a background daemon or cron job.
- Compares current spend to thresholds
- Checks rate of change (acceleration detection)
- Sends notifications via Slack webhook, email, or macOS notifications
- Tracks acknowledgment state
- Escalates if unacknowledged

**Config:** `~/.ai-spend/config.yaml`
```yaml
thresholds:
  daily: 100
  weekly: 500
  alert_on_spike: true    # 3x normal rate
  
alerts:
  slack_webhook: https://hooks.slack.com/...
  escalation:
    - above: 100
      frequency: daily
    - above: 500
      frequency: 3x_daily
    - above: 1000
      frequency: hourly

acknowledge_ttl: 24h
```

This is tanso-watch's config pattern (already designed and tested).

---

## User experience

### First run
```
$ npx [name]

  Scanning AI tools...
  found  Claude Code     416 sessions    ~$12,570 consumed
  found  OpenClaw         23 sessions    ~$340 consumed
  found  Cursor           89 sessions    (subscription)
  
  Set a daily spend alert? (recommended)
  > $100/day
  
  Where should alerts go?
  > Slack webhook: https://hooks.slack.com/...
  
  Saved to ~/.ai-spend/config.yaml
  
  Opening dashboard...
  http://localhost:3456
  
  Background monitor started. Will alert on spend > $100/day.
```

### When something goes wrong
```
SLACK ALERT:
[name] Daily spend alert
Today: $287 (normal: ~$90/day)
Source: OpenClaw agent "threat-intel" — $194 in last 6 hours
Action required: reply "ok" to acknowledge, or run `[name] ack`
Next alert in 4 hours if unacknowledged.
```

### Escalation
```
SLACK ALERT (ESCALATING):
[name] UNACKNOWLEDGED — spend still rising
Today: $412 (4.6x your daily average)
Source: OpenClaw agent "threat-intel" — $319 in last 9 hours
THIS ALERT WILL REPEAT HOURLY UNTIL ACKNOWLEDGED.
Run `[name] ack` or `[name] kill threat-intel`
```

---

## Business model

| Tier | Price | What you get |
|---|---|---|
| Free | $0 | Scanner + dashboard + shareable card + 3 alert rules |
| Pro | $9/mo | Unlimited alerts, escalation patterns, Slack/email, per-agent tracking, historical trends |
| Team | $29/mo | Multiple users, team rollup, shared thresholds |
| Enterprise | Custom | Agent approval workflows, transaction controls, audit logs |

---

## Build plan

### Phase 1: Scanner + dashboard (reuse existing code)
- Multi-tool scanner (local.ts — already built)
- Dashboard with both numbers (template.ts — needs update)
- Shareable card (acquisition hook)
- `npx [name]` works in 60 seconds

### Phase 2: Alert engine
- Background daemon (cron or long-running process)
- Threshold config (YAML)
- Slack webhook notifications
- Acknowledgment flow (ack command, 24h TTL)
- Escalation tiers
- Reuse tanso-watch's alert architecture (already designed)

### Phase 3: Rate-based intelligence
- Burn rate calculation from recent sessions
- Spike detection (3x normal)
- Per-agent session cost tracking (OpenClaw agents)
- "At this rate" predictions

### Phase 4: Agent controls (future)
- Per-agent spend limits
- Kill command for specific agents
- Approval workflows
- Proxy layer for hard enforcement

---

## Competitive differentiation

| Feature | CostGoat | codeburn | Bifrost | LiteLLM | This |
|---|---|---|---|---|---|
| Shows spend | Yes (billing APIs) | Yes (local JSONL) | Yes (real-time proxy) | Yes (per-key) | Yes |
| Alerts | One-shot threshold | No | Hard stops | 429 hard stops | **Escalating, requires ack** |
| Rate-based prediction | No | Menu bar forecast (passive) | No | No | **Yes** |
| No code changes | Yes (desktop app) | Yes (npx) | One env var | No (proxy) | **Yes (npx)** |
| Agent-aware | No | No | Per-virtual-key | Per-key | **Per-agent** |
| Escalation pattern | No | No | No | No | **Yes** |
| Ack loop | No | No | No | No | **Yes** |
| Install and forget | Desktop app | CLI (manual) | Gateway infra | Gateway infra | **npx + daemon** |

The unique things: escalation that requires acknowledgment, rate-based predictions, per-agent awareness, zero code changes.

---

## What existing code we can reuse

| Component | Source | Status |
|---|---|---|
| Multi-tool scanner (9 tools) | ai-wrapped/src/scanners/local.ts | Built |
| Dashboard template | ai-wrapped/src/dashboard/template.ts | Needs update |
| Config system | ai-wrapped/src/config.ts | Built |
| Anthropic billing API | ai-wrapped/src/scanners/anthropic.ts | Built |
| OpenAI billing API | ai-wrapped/src/scanners/openai.ts | Built |
| Alert engine architecture | tanso-watch design | Designed, can adapt |
| Escalation + ack flow | tanso-watch/src/alerts/ | Built |
| Slack webhook | tanso-watch/src/alerts/slack.ts | Built |

tanso-watch already has the alert engine, escalation tiers, acknowledgment flow, and Slack webhook. We're not starting from zero.

---

## Risks

1. **Name matters.** Needs to be instantly clear. Not "governor," not "wrapped."
2. **Daemon reliability.** Background process needs to be rock solid. Cron is simpler but less responsive.
3. **Alert fatigue.** The escalation pattern needs tuning. Too aggressive = ignored. Too gentle = useless.
4. **API key access.** Billing APIs require admin keys. Local scanning works without them but is estimate-only.
5. **Agent identification.** Identifying which OpenClaw agent is spending requires parsing session metadata. Need to verify this works.
