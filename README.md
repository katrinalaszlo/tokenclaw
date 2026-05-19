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

## What it does

tokenclaw sits between your agents and model providers and gives you three things:

- **View** spend per API key in real time
- **Alert** when usage crosses thresholds you set
- **Block** requests when limits are exceeded

## Install

<p align="center">
  <img src="docs/tokenclaw-crab.jpg" alt="tokenclaw crab holding API coin" width="120">
</p>

```bash
npm install -g tokenclaw-dev
```

## 1. View your spend

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

## 2. Set alerts and limits

Define rules per API key:

```bash
tokenclaw set --key sk-ant-research --budget 10/day --warn 80% --block 100%
```

Just want alerts? No blocking:

```bash
tokenclaw set --key sk-ant-research --budget 10/day --warn 50% --warn 80%
```

Nothing is blocked unless you explicitly add `--block`.

## 3. Start the proxy

```bash
tokenclaw proxy
```

Point your agent at it:

```bash
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

## What happens when limits are hit

When usage crosses your rules:

- **warn** → Slack alert, request passes through
- **block** → 429 returned, request stopped

```json
{
  "error": {
    "type": "budget_exceeded",
    "message": "Key sk-ant-research exceeded daily budget of $10.00 ($10.42 spent)."
  }
}
```

## How it works

<p align="center">
  <img src="docs/tokenclaw-proxy.jpg" alt="tokenclaw crab directing traffic between Anthropic and OpenAI" width="600">
</p>

Your agent sends a request. tokenclaw identifies the API key, checks spend against your rules, and either forwards or blocks.

Auto-detects provider from request path:

- `/v1/messages` → Anthropic
- `/v1/chat/completions` → OpenAI (also Groq, Together, Fireworks)

One proxy. Runs on localhost.

## Budget rules

| Flag | What it does |
|---|---|
| `--warn N%` | Send Slack alert at N% of budget |
| `--block N%` | Block requests at N% of budget |
| (no flags) | Default: warn at 80% |

Periods: `day` (midnight UTC), `week` (Monday UTC), `month` (1st UTC).

Keys match on longest prefix. Unregistered keys pass through with no limit.

## Scan your tools

Even without the proxy:

```bash
tokenclaw          # scan local AI tools, show spend
tokenclaw status   # current spend + alert status
```

Detects: Claude Code, OpenClaw, Cursor, Windsurf, Claude Desktop, Cline, Roo Code, Aider, Continue.dev.

## Safety

Nothing is blocked unless you configure a `--block` rule. Default is warn-only. The proxy is non-invasive until you tell it otherwise.

## Config

`~/.tokenclaw/config.yaml`:

```yaml
key_budgets:
  sk-ant-research:
    budget: 10
    period: day
    rules:
      - at: 80
        action: alert
      - at: 100
        action: block
alerts:
  slack_webhook: "https://hooks.slack.com/..."
```

## Commands

```bash
tokenclaw            # scan local AI tools
tokenclaw proxy      # start enforcement proxy
tokenclaw set        # set budget rules
tokenclaw keys       # view spend vs budget
tokenclaw status     # spend + alert status
tokenclaw watch      # continuous monitoring
tokenclaw ack        # silence alerts (24h)
tokenclaw config     # show config
```

## Uninstall

```bash
npm uninstall -g tokenclaw-dev
rm -rf ~/.tokenclaw
```

## License

MIT
