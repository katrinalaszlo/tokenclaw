# tokenclaw — Task Plan

## Current Goal
Fix the dashboard: branding, cost display, remove phantom alerts, remove broken sidebar links. Make the dashboard the impressive first thing people see after scanning.

## Key Decisions
- **Name: tokenclaw.** npm: tokenclaw-dev. Domain: tokenclaw.dev.
- **Subscription vs API:** Show what you PAID (subscription cost) as primary. Show token consumption as secondary "at API rates."
- **No phantom features.** Don't show alerts/budgets/agents sidebar if those pages don't exist.

## Dashboard Issues (from user screenshots)

| Issue | Location | Fix |
|-------|----------|-----|
| "Agent Cost Control" branding | template.ts title, sidebar, footer | → "tokenclaw" |
| $12.3K shown for Claude Code (subscription) | template.ts metric cards | Show $200/mo (plan cost), ~$12.3K as "consumed at API rates" |
| "Today's Spend: $50.5K" wrong | cli.ts runDashboard + template.ts | Fix: todaySpend should only sum today's snapshots |
| "Active Alerts: 2" when none configured | cli.ts runDashboard alert assembly | Don't show alert card if no alerts triggered |
| Sidebar: Agents, Budgets, Alerts links broken | template.ts sidebar nav | Remove broken links. Keep just Dashboard. |
| Alert section renders when empty | template.ts alert section | Hide entire section if alerts.length === 0 |

## Build Phases (v0.2.1 — dashboard fix)

### Phase 1: Template branding `status: not_started`
- "Agent Cost Control" → "tokenclaw" in title, sidebar brand, footer
- Verify: npm run build

### Phase 2: Fix cost display `status: not_started`
- Top cards: "What you paid" = sum of subscription costs + API costs. "Consumed at API rates" = token estimate as secondary
- Per-tool table: subscription shows plan name + plan cost. API shows token estimate.
- Model breakdown: label as "Token consumption by model (at API rates)" — make clear these are estimates
- Verify: npm run build + dashboard visual check

### Phase 3: Remove broken sidebar + alerts `status: not_started`
- Remove Agents, Budgets, Alerts from sidebar nav
- Remove "Active Alerts" metric card entirely
- Remove alert section from dashboard body if no alerts
- Verify: npm run build + dashboard visual check

### Phase 4: Fix today's spend `status: not_started`
- Investigate why $50.5K shows as today — likely summing all-time data
- Fix in runDashboard() or getTodaySpend()
- Verify: npm run build + check metric card

### Phase 5: Landing page dashboard preview `status: not_started`
- Take screenshot of fixed dashboard
- Add to landing page as preview image
- Commit + push

## Shipped (v0.2.0)
| Component | Status |
|---|---|
| Per-key proxy (Anthropic + OpenAI) | Shipped |
| CLI: set, keys, proxy commands | Shipped |
| 40 unit tests | Shipped |
| Landing page (tokenclaw.dev) | Shipped |
| npm: tokenclaw-dev@0.2.0 | Published |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| npm blocked "tokenclaw" (similar to openclaw) | 1 | Published as tokenclaw-dev |
