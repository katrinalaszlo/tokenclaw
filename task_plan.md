# [Name TBD] — Task Plan

## Goal
Credit card fraud alerts for AI spend. Install a package, it watches your AI tools, it yells when something's wrong, it won't shut up until you say "this is OK." The acknowledgment loop is the gap no tool has.

## Key Decisions
- **Standalone product.** Not Observe (different buyer), not AI Wrapped (no unique angle).
- **The ack loop is the product.** Every other tool shows numbers. This one demands attention.
- **No proxy in v1.** Local scanning + billing API polling. Proxy is Layer 3 future.
- **npx install.** Zero code changes. Zero signup.
- **Reuse existing code.** Scanner from ai-wrapped, alerts from tanso-watch.

## What exists
| Component | Location | Status |
|---|---|---|
| Multi-tool scanner (9 tools) | ai-wrapped/src/scanners/local.ts | Built, tested |
| Dashboard HTML template | ai-wrapped/src/dashboard/template.ts | Built, needs redesign |
| Config system | ai-wrapped/src/config.ts | Built |
| Anthropic billing API client | ai-wrapped/src/scanners/anthropic.ts | Built, untested |
| OpenAI billing API client | ai-wrapped/src/scanners/openai.ts | Built, untested |
| Alert engine + escalation | tanso-watch/src/alerts/engine.ts | Built |
| Slack webhook | tanso-watch/src/alerts/slack.ts | Built |
| Ack flow + TTL | tanso-watch/src/alerts/ | Built |
| Cron setup | tanso-watch/src/cron-setup.ts | Built |
| SQLite cost snapshots | tanso-watch/src/db.ts | Built |
| Mockup UI (5 pages) | agent-cost-control/site/ | Static HTML mockups |
| PRD | agent-cost-control/docs/PRD.md | Done |
| Gap analysis | agent-cost-control/docs/gap-analysis.md | Done |

## Phases

### Phase 1: Scaffold + scanner `status: not_started`
- New TypeScript project in agent-cost-control/
- Copy + adapt scanner from ai-wrapped (local.ts)
- Copy + adapt config from ai-wrapped (config.ts)
- CLI entry point: `npx [name]` scans and prints summary
- Test: runs on Kat's machine, finds Claude Code + OpenClaw

### Phase 2: Alert engine + ack loop `status: not_started`
- Copy + adapt alert engine from tanso-watch
- Escalation tiers (configurable)
- Slack webhook notifications
- `[name] ack` command to acknowledge alerts
- Ack TTL (24h default, configurable)
- Unacknowledged alerts escalate (more frequent)
- Background daemon via cron
- This is THE feature. This is what makes it different.

### Phase 3: Dashboard `status: not_started`
- Local web dashboard (single HTML, Chart.js)
- Spend by tool, by model, by day
- Active alerts with ack buttons
- Alert history
- Burn rate indicator

### Phase 4: Rate-based intelligence `status: not_started`
- Spend velocity detection (not just thresholds)
- Spike detection (3x normal rate)
- "At this rate" predictions
- Per-agent session tracking (OpenClaw)

### Phase 5: Ship `status: not_started`
- README with clear install + usage
- npm publish
- Launch (HN, Reddit, Twitter, LinkedIn)
- Name chosen by then

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |
