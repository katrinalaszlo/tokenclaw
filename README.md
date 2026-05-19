# tokenclaw

Claw back your agent spend. Local proxy that sits between your agents and LLM providers, tracks spend per API key, and enforces hard spending limits.

```bash
npm install -g tokenclaw

# Set per-key budgets
tokenclaw set --key sk-ant-proj-research --budget 10/day
tokenclaw set --key sk-proj-deploy --budget 100/day

# Start the proxy
tokenclaw proxy
# → Listening on http://localhost:4040
# → Forwarding: /v1/messages → Anthropic, /v1/chat/completions → OpenAI
# → 2 key budgets active

# Point your agents at it
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

When a key exceeds its budget, the proxy returns 429:

```json
{
  "error": {
    "type": "budget_exceeded",
    "message": "Key sk-ant-proj-research exceeded daily budget of $10.00 ($10.42 spent). Run `tokenclaw set --key sk-ant-proj-research --budget 20/day` to increase."
  }
}
```

## How it works

```
Agent (Claude Code / OpenClaw / GPT agent)
  ↓ ANTHROPIC_BASE_URL=http://localhost:4040
Local Proxy (tokenclaw proxy)
  ↓ checks key budget → BLOCK if over
  ↓ auto-detects provider from request path
  ↓ forwards to api.anthropic.com or api.openai.com
  ↓ reads response → counts tokens → updates spend
Agent gets response (or 429 if blocked)
```

- `/v1/messages` routes to Anthropic
- `/v1/chat/completions` routes to OpenAI (also covers Groq, Together, Fireworks, etc.)
- Provider auto-detected from path. One proxy, one port.

## Commands

### Proxy

```bash
tokenclaw proxy              # Start on default port 4040
tokenclaw proxy --port 8080  # Custom port
```

### Per-key budgets

```bash
tokenclaw set --key sk-ant-proj-research --budget 10/day
tokenclaw set --key sk-proj-deploy --budget 500/week
tokenclaw set --key sk-ant-team --budget 2000/month

tokenclaw keys  # Show spend vs budget per key
# sk-ant-proj-research         $7.20 / $10.00 day   (72%)
# sk-proj-deploy               $12.50 / $500.00 week (3%)
# (unregistered keys)          $3.10 today           (no limit)
```

Keys match on prefix. Register `sk-ant-proj-research`, and any key starting with that prefix is matched. If multiple prefixes overlap, longest wins.

Unregistered keys pass through with no limit. Spend is still tracked.

### Scanning (no proxy needed)

```bash
tokenclaw              # Scan local AI tools, show spend
tokenclaw status       # Current spend + alert status
tokenclaw dashboard    # Open spend dashboard in browser
```

Auto-discovers: Claude Code, OpenClaw, Cursor, Windsurf, Claude Desktop, Cline, Roo Code, Aider, Continue.dev.

### Alerts

```bash
tokenclaw init         # Interactive setup (thresholds + Slack webhook)
tokenclaw watch        # Continuous monitoring with alerts
tokenclaw ack          # Acknowledge alerts (silence for 24h)
```

Slack alerts fire at 80% and 100% of per-key budgets. Account-level alerts escalate: daily → 3x/day → hourly until acknowledged.

## Budget periods

- `day` — resets at midnight UTC
- `week` — resets Monday midnight UTC
- `month` — resets 1st of month midnight UTC

## Pricing

Token costs estimated from model pricing tables. Supports:

| Provider | Models |
|---|---|
| Anthropic | Claude Opus, Sonnet, Haiku (4.x family) |
| OpenAI | GPT-4o, GPT-4.1, o3, o4-mini |
| Google | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |

Unknown models fall back to Sonnet-tier pricing.

## Config

Stored at `~/.tokenclaw/config.yaml`:

```yaml
key_budgets:
  sk-ant-proj-research:
    budget: 10
    period: day
  sk-proj-deploy:
    budget: 100
    period: day
thresholds:
  daily: 100
  weekly: 500
alerts:
  slack_webhook: "https://hooks.slack.com/..."
```

## Requirements

- Node.js 18+
- SQLite (bundled via better-sqlite3)

## License

MIT
