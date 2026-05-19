# tokenclaw

<p align="center">
  <img src="docs/tokenclaw-logo.jpg" alt="tokenclaw — claw back your agent spend" width="600">
</p>

View, alert, and control AI agent spend in real time.

AI agents do not stop when something goes wrong. They keep running, retrying, and silently burning through API budgets.

> "I left an agent running overnight. $280."
>
> "Agent entered an infinite loop. $4,200 in a weekend."
>
> "I set a spending limit. Turns out it was just an email."

<p align="center">
  <img src="docs/tokenclaw-overnight.jpg" alt="11pm: sleeping while agent runs. 6am: $2,847 bill. should've used tokenclaw." width="400">
</p>

tokenclaw gives you visibility and control over that spend before it becomes a surprise bill.

<p align="center">
  <img src="docs/tokenclaw-meme.jpg" alt="tokenclaw crab getting yanked off stage — wait I can explain" width="500">
</p>

## Install

```bash
npm install -g tokenclaw-dev
```

---

## Observe

See what your AI tools are spending. No proxy, no config, nothing leaves your machine.

### See your spend

```bash
tokenclaw
```

Reads the session logs that AI tools store locally (Claude Code, Cursor, Windsurf, etc.), counts tokens, and estimates cost.

```bash
tokenclaw list models       # cost breakdown by model
tokenclaw list projects     # cost breakdown by project
tokenclaw list trends       # daily spend over time
tokenclaw list usage        # token counts and breakdown
tokenclaw list efficiency   # cache hit rates, cost per session
```

### Get alerts

```bash
tokenclaw init
```

```
tokenclaw setup

Daily spend alert threshold (USD) [100]: 50
Slack webhook URL (optional): https://hooks.slack.com/services/T00/B00/xxx

Config saved to ~/.tokenclaw/config.yaml
```

Sets a $50/day budget (weekly auto-set to $250). When total API spend crosses the threshold, you get a Slack alert. ([Create a webhook here.](https://api.slack.com/messaging/webhooks))

```bash
tokenclaw watch
```

Re-scans every hour. Alerts when thresholds are crossed.

---

## Control (Experimental)

Enforce per-key spend limits with a local proxy. Blocks requests when a budget is exceeded.

### Start the proxy

```bash
tokenclaw proxy
```

### Point your agent at it

```bash
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

### Set a per-key budget

```bash
tokenclaw set --key sk-ant-research --budget 10/day --warn 80% --block 100%
```

- At 80% ($8) — Slack alert
- At 100% ($10) — proxy returns 429, request stopped

Nothing is blocked unless you add `--block`. Default is warn-only.

```bash
tokenclaw keys           # view spend vs budget per key
```

<p align="center">
  <img src="docs/tokenclaw-proxy.jpg" alt="tokenclaw crab directing traffic between Anthropic and OpenAI" width="600">
</p>

Auto-detects provider: `/v1/messages` → Anthropic, `/v1/chat/completions` → OpenAI (also Groq, Together, Fireworks).

---

## Commands

### Observe

| Command | What it does |
|---|---|
| `tokenclaw` | Scan local AI tools, show spend |
| `tokenclaw list <view>` | Detailed views: models, projects, trends, usage, efficiency |
| `tokenclaw init` | Set up alerts (daily budget, Slack) |
| `tokenclaw watch` | Monitor spend, alert hourly |
| `tokenclaw status` | Current spend + alert status |
| `tokenclaw ack` | Silence alerts for 24h |
| `tokenclaw config` | Show current config |

### Control

| Command | What it does |
|---|---|
| `tokenclaw proxy` | Start per-key enforcement proxy |
| `tokenclaw set` | Set per-key budget with warn/block rules |
| `tokenclaw keys` | View spend vs budget per key |

## Uninstall

```bash
npm uninstall -g tokenclaw-dev
rm -rf ~/.tokenclaw
```

## License

MIT
