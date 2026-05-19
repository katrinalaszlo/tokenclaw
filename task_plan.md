# agentcap — Task Plan

## Goal
Per-API-key budget limits via local reverse proxy. Agent sets `ANTHROPIC_BASE_URL=localhost:4040`, proxy sees every request including API key, tracks spend, enforces hard caps. The differentiator: spending authority lives on the key, not in a dashboard.

## Key Decisions
- **Name: agentcap.** Published to npm as agentcap@0.1.0.
- **Proxy approach chosen.** JSONL files don't contain API keys (verified 2026-05-18). Proxy is the only path to per-key enforcement.
- **UTC for all budget windows.** Midnight UTC for day, Monday UTC for week, 1st UTC for month.
- **Longest-prefix-wins** for key matching when multiple prefixes overlap.
- **Local-first.** No cloud, no telemetry. Proxy runs on localhost only.

## Shipped (v0.1.0)
| Component | Location | Status |
|---|---|---|
| Scanner (9 AI tools) | src/scanners/local.ts | Shipped |
| Alert engine + escalation | src/alerts/engine.ts | Shipped |
| Ack flow + TTL | src/alerts/acknowledge.ts | Shipped |
| Slack webhook | src/alerts/slack.ts | Shipped |
| Config (YAML) | src/config.ts | Shipped |
| SQLite persistence | src/db.ts | Shipped |
| Dashboard (HTML gen) | src/dashboard/template.ts | Shipped |
| CLI (7 commands) | src/cli.ts | Shipped |

## Build phases (v0.2.0 — per-key proxy)

### Phase 0: Extract pricing `status: complete`
- Move MODEL_PRICING, getPricing, estimateCost from scanners/local.ts to src/pricing.ts
- Re-import in scanners/local.ts
- Verify: npm run build

### Phase 1: Config + types `status: complete`
- Add KeyBudget type: { budget: number, period: 'day' | 'week' | 'month' }
- Add key_budgets: Record<string, KeyBudget> to AccConfig
- Parse budget strings: "10/day", "500/week", "2000/month"
- Verify: npm run build

### Phase 2: DB schema `status: complete`
- Add proxy_requests table to db.ts
- Add getSpendByKeyPrefix(prefix, since) query
- Add getKeyBreakdown() for status display
- Add insertProxyRequest() function
- Verify: npm run build

### Phase 3: Proxy server `status: complete`
- 3a: HTTP server skeleton + passthrough (no budget, no counting)
- 3b: Add budget check + 429 path
- 3c: Add SSE parse + cost calc + DB insert
- 3d: Non-streaming JSON response path
- Verify: npm run build + curl test

### Phase 4: CLI commands `status: complete`
- agentcap set --key <prefix> --budget <amount>/<period>
- agentcap keys — show registered keys with spend vs budget
- agentcap proxy — start proxy server (foreground)
- agentcap proxy --port <port>
- Update agentcap status to include key breakdown
- Verify: npm run build + CLI test

### Phase 5: Alert integration `status: complete`
- Generate per-key alert rules from key_budgets config
- Fire Slack alert at 80% and 100% budget
- Include key prefix in alert message

### Phase 6: Test + ship `status: in_progress`
- [x] Unit tests: 24 tests (SSE parser, JSON parser, key matching, budget windows, cost calc, config parsing)
- [ ] E2E test with real Anthropic key (streaming path — needs Kat's key)
- [ ] Update landing page
- [ ] Update README
- [ ] npm publish agentcap@0.2.0

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| npm blocked agent-spend (too similar to agentspend) | 1 | Published as agentcap instead |
| npm required OTP for publish | 1 | Used recovery code |
| JSONL files have no API key data | 1 | Pivot to local proxy approach |
