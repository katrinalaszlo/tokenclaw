# tokenclaw — Findings

## User research: how developers want to cap AI spend (2026-05-19)

### Core persona
Solo devs, indie builders, OpenClaw hackers. Not enterprise FinOps. Running side projects, automations, agent swarms on personal budgets.

### Emotional cycle
curiosity → excitement → surprise bill → paranoia → optimization obsession

### What they actually ask for (in order of frequency)
1. **"Is my agent in a loop?"** — #1 fear. Recursive tools, runaway retries, overnight failures. $350 in one day, $2,100 overnight. They want anomaly detection, not monthly totals.
2. **Per-session visibility** — "this chat cost $0.03" not "your monthly bill is $X". They think in sessions/agents/tasks, not invoices.
3. **Real-time feedback** — live burn rate during execution, like an FPS counter. Not after-the-fact billing.
4. **What's wasting tokens?** — One user found 31% from heartbeats, 28% from session bloat, only 41% from actual work.
5. **Auto-protection** — stop agents at thresholds, downgrade models, pause recursive chains. Prevention > reporting.

### What providers ship vs what users want
| Provider | Ships | Users want |
|---|---|---|
| OpenAI | Email alerts (removed hard caps in 2025) | Hard stop that blocks the API call |
| Anthropic | Workspace monthly notifications | Per-key daily hard caps |
| Cursor | Hard stop per user (the only one that blocks) | Exactly this, but for API too |

### Budget granularity people mention
- Monthly total (baseline, everyone assumes this)
- **Daily** (the overnight horror story crowd — most vocal)
- Per-session / per-run (coding agent users: "max $15 for this refactor")
- Per-project / per-workspace (OpenAI used to have this, people miss it)
- Per-API-key (leaked key damage containment)

### Desired alert pattern (layered)
- 80% of budget → soft warning (Slack)
- 100% → hard stop (429, block the request)
- Optional: graceful degradation (downgrade to cheaper model instead of full stop)

### Product implication for tokenclaw
MVP: budget-based alerts + hard stops. Daily per-key caps via proxy.
V2: velocity detection ("spend rate jumped 4x in 10 min")
V3: per-session cost tracking, waste identification

## Competitive landscape (from earlier session 2026-05-18)

### 13+ companies, all pre-traction
- OpenCard/Sigil, Axon402, AgentCard, Privacy.com, Modexia, Truzify
- Engram, Lava, K2 Rail, Stripe Link for Agents, Mastercard Agent Pay
- LetAgentPay, Skymel

### Nobody does per-key daily enforcement locally
All competitors are SaaS/enterprise. tokenclaw is the only local-first CLI.

### Reddit signal
- "hard cap" is the exact word everyone uses
- "$280 lost in one weekend, no alert, no kill switch"
- LiteLLM has soft limits but they're bypassable
