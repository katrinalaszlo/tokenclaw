# Agent Cost Control — Spec

## Purpose
Datadog for agent spend. A web dashboard that tracks, limits, and attributes AI agent costs across providers (Anthropic, OpenAI, tool calls, SaaS APIs). The observability + control layer above billing.

## Non-Goals
- No backend/API (static MVP with mock data)
- No actual billing integration (UI demonstrates the concept)
- No user auth (dashboard is the product demo)
- No mobile-first (desktop dashboard)

## Pages

### 1. Landing Page (index.html)
Marketing page. Hero, problem statement, feature cards, how-it-works, CTA.
Sells the pain: "$47K agent bill, no idea which agent spent what."

### 2. Dashboard (dashboard.html)
Main control center. Shows:
- Total spend (today / week / month / all-time)
- Spend by provider (Anthropic, OpenAI, Google, Tools)
- Spend by agent (horizontal bar chart)
- Budget utilization gauges per agent
- Real-time activity feed (last 50 actions with cost)
- Trend sparklines

### 3. Agents (agents.html)
Agent registry. Shows:
- Table of all registered agents (name, status, total spend, budget remaining)
- Agent detail panel (click to expand)
- "Register Agent" action
- Per-agent spend breakdown by provider

### 4. Budgets (budgets.html)
Budget management. Shows:
- Budget envelopes per agent with progress bars
- Set/edit limits (daily, weekly, monthly)
- Alert thresholds (warn at 80%, hard cap at 100%)
- Kill switch toggles per agent
- Budget history / burn rate

### 5. Alerts (alerts.html)
Alert center. Shows:
- Active alerts (agent X hit 90% of budget)
- Alert history timeline
- Kill switch activations
- Configure alert rules

## Design Direction
- Dark theme (#0a0a0f background, cards at #12121a)
- Accent: Electric cyan (#00d4ff) for primary actions, amber (#ffb800) for warnings, red (#ff4444) for alerts
- Typography: Inter / system stack, 14px base
- Dense but readable — Datadog/Grafana energy, not Notion
- Cards with subtle 1px borders (#1e1e2e)
- Charts: CSS-only where possible, Chart.js for complex viz
- Sidebar nav, top metrics bar
- Responsive enough to not break, but optimized for 1440px+

## Mock Data
All data is hardcoded JS. Agents:
- `code-reviewer` (Claude) — $1,240/mo, 78% of budget
- `pr-summarizer` (GPT-4o) — $890/mo, 45% of budget
- `test-generator` (Claude) — $2,100/mo, 92% of budget (near limit!)
- `deploy-checker` (mixed) — $340/mo, 23% of budget
- `data-pipeline` (Claude + tools) — $4,200/mo, 67% of budget
- `customer-support-bot` (GPT-4o) — $1,800/mo, 81% of budget

Providers: Anthropic (52%), OpenAI (31%), Google (8%), Tool calls (9%)
Total monthly: ~$10,570

## Key Decisions
- Static HTML/CSS/JS — no build step, no framework
- Chart.js for charts (CDN loaded)
- Inter font from Google Fonts
- Shared CSS via styles.css
- Shared nav via JS include pattern
- Deploy to here.now

## Acceptance Criteria
- [ ] Landing page loads, communicates value prop clearly
- [ ] Dashboard shows all 6 agents with realistic spend data
- [ ] Charts render (provider breakdown, agent comparison)
- [ ] Budget gauges show utilization with color coding (green/amber/red)
- [ ] Activity feed scrolls with timestamped entries
- [ ] Sidebar navigation works across all pages
- [ ] Kill switch toggles are interactive
- [ ] Alert badges show counts
- [ ] Dark theme is consistent, no white flashes
- [ ] All pages link to each other via nav
- [ ] Deploys to here.now successfully
