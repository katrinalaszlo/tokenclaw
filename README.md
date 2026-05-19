# tokenclaw

Claw back your agent spend.

You left an agent running overnight. You woke up to a $280 bill. Your provider's "spending limit" was monthly and didn't kick in. OpenAI silently converted their hard caps to email alerts. Anthropic only has workspace-level limits. Neither has per-key. Neither has daily.

tokenclaw is the hard stop that should have existed from day one.

```bash
npm install -g tokenclaw

# Give each API key a daily budget
tokenclaw set --key sk-ant-proj-research --budget 10/day
tokenclaw set --key sk-proj-deploy --budget 100/day

# Start the proxy
tokenclaw proxy
# → Forwarding: /v1/messages → Anthropic, /v1/chat/completions → OpenAI
# → 2 key budgets active

# Point your agents at it
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

Budget exceeded? Blocked.

```json
{
  "error": {
    "type": "budget_exceeded",
    "message": "Key sk-ant-proj-research exceeded daily budget of $10.00 ($10.42 spent). Run `tokenclaw set --key sk-ant-proj-research --budget 20/day` to increase."
  }
}
```

The agent can't spend past the budget. The 429 tells it exactly what happened. You get a Slack alert. No surprises in the morning.

## How it works

```
Agent (Claude Code / OpenClaw / GPT agent)
  ↓ ANTHROPIC_BASE_URL=http://localhost:4040
Local Proxy (tokenclaw proxy)
  ↓ checks key budget → BLOCK if over
  ↓ auto-detects provider from request path
  ↓ forwards to api.anthropic.com or api.openai.com
  ↓ streams response back, counts tokens, updates spend
Agent gets response (or 429 if blocked)
```

- `/v1/messages` → Anthropic
- `/v1/chat/completions` → OpenAI (also Groq, Together, Fireworks, anything OpenAI-compatible)
- One proxy. One port. Provider auto-detected.

## Why this exists

Your provider's built-in limits won't save you:

- **OpenAI** silently converted hard spending caps to email alerts in 2025. Per-project budgets are soft — requests continue even after the limit. Per-key limits don't exist.
- **Anthropic** has workspace-level monthly limits. No per-key. No daily. No weekly.
- **Neither** enforces in real time at the per-request level with daily granularity.

Monthly limits don't catch an agent that burns $200 in a single night. Daily per-key limits do.

## Commands

### Proxy

```bash
tokenclaw proxy              # Start on localhost:4040
tokenclaw proxy --port 8080  # Custom port
```

### Per-key budgets

```bash
tokenclaw set --key sk-ant-proj-research --budget 10/day
tokenclaw set --key sk-proj-deploy --budget 500/week
tokenclaw set --key sk-ant-team --budget 2000/month

tokenclaw keys
# sk-ant-proj-research         $7.20 / $10.00 day   (72%)
# sk-proj-deploy               $12.50 / $500.00 week (3%)
# (unregistered keys)          $3.10 today           (no limit)
```

Keys match on longest prefix. Register `sk-ant-proj-research`, any key starting with that prefix matches. Unregistered keys pass through with no limit — spend is still tracked.

### Scanning (no proxy needed)

```bash
tokenclaw              # Scan 9 AI tools, show spend
tokenclaw status       # Spend + alert status
tokenclaw dashboard    # Browser dashboard
```

Auto-discovers: Claude Code, OpenClaw, Cursor, Windsurf, Claude Desktop, Cline, Roo Code, Aider, Continue.dev.

### Alerts

```bash
tokenclaw init         # Set thresholds + Slack webhook
tokenclaw watch        # Continuous monitoring
tokenclaw ack          # Acknowledge (silence for 24h)
```

Per-key: Slack alerts at 80% and 100%. Account-level: escalates daily → 3x/day → hourly until acknowledged.

## Budget periods

| Period | Resets at |
|---|---|
| `day` | Midnight UTC |
| `week` | Monday midnight UTC |
| `month` | 1st of month midnight UTC |

## Pricing

Token costs estimated from built-in model pricing tables:

| Provider | Models |
|---|---|
| Anthropic | Claude Opus, Sonnet, Haiku (4.x) |
| OpenAI | GPT-4o, GPT-4.1, o3, o4-mini |
| Google | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |

Unknown models fall back to Sonnet-tier pricing.

## Config

`~/.tokenclaw/config.yaml`:

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

Node.js 18+

## License

MIT
