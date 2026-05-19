# tokenclaw

Per-key spend enforcement for AI agents.

Monthly limits don't catch an agent that burns $200 in a single night. Daily per-key limits do.

```bash
npm install -g tokenclaw-dev
```

## 30-second setup

```bash
# Set a daily budget on an API key
tokenclaw set --key sk-ant-proj-research --budget 10/day

# Start the proxy
tokenclaw proxy

# Point your agent at it
ANTHROPIC_BASE_URL=http://localhost:4040 claude
```

When the budget is exceeded, the proxy returns 429:

```json
{
  "error": {
    "type": "budget_exceeded",
    "message": "Key sk-ant-proj-research exceeded daily budget of $10.00 ($10.42 spent)."
  }
}
```

## How it works

Local proxy between your agents and the API. Auto-detects provider from request path.

- `/v1/messages` → Anthropic
- `/v1/chat/completions` → OpenAI (also Groq, Together, Fireworks)

Every request: check budget → forward → count tokens → update spend.

## Policy actions

Each budget has an action that fires when the threshold is hit.

```bash
# Alert only — notify, don't block
tokenclaw set --key sk-ant-research --budget 10/day --action alert

# Enforce — hard stop, returns 429
tokenclaw set --key sk-ant-deploy --budget 100/day --action enforce
```

`enforce` is the default. Start with `alert` if you want visibility before committing to hard stops.

```bash
tokenclaw keys
# sk-ant-research         $7.20 / $10.00 day   (72%)  [alert]
# sk-ant-deploy           $0.00 / $100.00 day   (0%)  [enforce]
```

## Alert mode

Alert mode sends Slack notifications at 80% and 100% of budget. Requests pass through — nothing is blocked. Use this to understand your spend patterns before enforcing.

## Enforce mode

Enforce mode blocks requests when the budget is exceeded. The agent gets a 429 with a clear error message. Slack alerts still fire. This is the hard stop.

## Commands

```bash
tokenclaw                # Scan local AI tools, show spend
tokenclaw proxy          # Start the enforcement proxy
tokenclaw set            # Set a budget policy
tokenclaw keys           # Show spend vs budget per key
tokenclaw status         # Current spend + alert status
tokenclaw watch          # Continuous monitoring with alerts
tokenclaw ack            # Acknowledge alerts (silence 24h)
```

## Budget periods

| Period | Resets at |
|---|---|
| `day` | Midnight UTC |
| `week` | Monday midnight UTC |
| `month` | 1st of month midnight UTC |

## Key matching

Keys match on longest prefix. Register `sk-ant-proj-research`, and any key starting with that prefix matches. Unregistered keys pass through — spend is tracked but not limited.

## Providers

| Provider | Models |
|---|---|
| Anthropic | Claude Opus, Sonnet, Haiku (4.x) |
| OpenAI | GPT-4o, GPT-4.1, o3, o4-mini |
| Google | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |

Unknown models use Sonnet-tier pricing as a conservative estimate. Configurable overrides planned.

## Config

`~/.tokenclaw/config.yaml`:

```yaml
key_budgets:
  sk-ant-proj-research:
    budget: 10
    period: day
    mode: alert
  sk-ant-deploy:
    budget: 100
    period: day
    mode: enforce
alerts:
  slack_webhook: "https://hooks.slack.com/..."
```

## Scanning

Even without the proxy, tokenclaw scans 9 local AI tools and shows what you're spending:

Claude Code, OpenClaw, Cursor, Windsurf, Claude Desktop, Cline, Roo Code, Aider, Continue.dev.

```bash
tokenclaw        # scan and show spend
```

## Uninstall

```bash
npm uninstall -g tokenclaw-dev
rm -rf ~/.tokenclaw
```

## Troubleshooting

```bash
tokenclaw config       # show current config
tokenclaw ack          # silence active alerts
tokenclaw keys         # check budgets and spend
```

Data lives in `~/.tokenclaw/`:
- `config.yaml` — budgets, thresholds, Slack webhook
- `data.db` — spend history (SQLite)
- `ack-state.json` — acknowledged alerts

To reset: `rm -rf ~/.tokenclaw`

## License

MIT
