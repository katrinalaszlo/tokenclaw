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

## See what you're spending

```bash
tokenclaw
```

tokenclaw reads the session logs that AI tools store on your machine (Claude Code, Cursor, Windsurf, etc.), counts tokens, and estimates what each tool costs. Nothing is sent anywhere.

## Get alerted when you spend too much

Run `tokenclaw init` to configure alerts:

```
Daily spend threshold (USD) [100]: 50
Slack webhook URL (optional): https://hooks.slack.com/services/T00/B00/xxx
```

This sets a $50/day budget. When your spend crosses it, tokenclaw sends a Slack alert. ([Create a Slack webhook here.](https://api.slack.com/messaging/webhooks))

You can also set a weekly threshold and escalation rules in `~/.tokenclaw/config.yaml`:

```yaml
thresholds:
  daily: 50
  weekly: 250
alerts:
  slack_webhook: "https://hooks.slack.com/services/T00/B00/xxx"
```

Then start monitoring:

```bash
tokenclaw watch
```

Re-scans your session logs every hour and sends Slack alerts when thresholds are crossed. No proxy needed.

## Block requests when a key goes over budget

This requires the proxy. The proxy sits between your agents and the API, tracking spend per API key.

**Start the proxy:**

```bash
tokenclaw proxy
```

**Point your agent at it:**

```bash
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

**Set a per-key budget:**

```bash
tokenclaw set --key sk-ant-research --budget 10/day --warn 80% --block 100%
```

- At 80% ($8), you get a Slack alert.
- At 100% ($10), the proxy returns a 429 and the request is stopped.

```bash
tokenclaw keys
```

```
sk-ant-research   $7.20 / $10 (72%)
  warn at 80%
  block at 100%

sk-proj-deploy    $12.50 / $100 (12%)
  warn at 80%
```

Nothing is blocked unless you explicitly add `--block`. Default is warn-only.

<p align="center">
  <img src="docs/tokenclaw-proxy.jpg" alt="tokenclaw crab directing traffic between Anthropic and OpenAI" width="600">
</p>

Auto-detects provider from request path: `/v1/messages` → Anthropic, `/v1/chat/completions` → OpenAI (also Groq, Together, Fireworks).

## Commands

| Command | What it does |
|---|---|
| `tokenclaw` | Scan local AI tools, show spend |
| `tokenclaw watch` | Monitor spend, send alerts hourly |
| `tokenclaw proxy` | Start the per-key enforcement proxy |
| `tokenclaw set` | Set a per-key budget (requires proxy) |
| `tokenclaw keys` | View spend vs budget per key |
| `tokenclaw status` | Current spend + alert status |
| `tokenclaw init` | Re-run setup (daily budget, Slack) |
| `tokenclaw ack` | Silence alerts for 24h |
| `tokenclaw config` | Show current config |

## Uninstall

```bash
npm uninstall -g tokenclaw-dev
rm -rf ~/.tokenclaw
```

## License

MIT
