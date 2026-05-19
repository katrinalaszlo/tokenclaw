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

## Spend — see what you're spending

```bash
tokenclaw                         # scan local tools, show spend
tokenclaw spend status            # current spend + burn rate
tokenclaw spend list models       # cost breakdown by model
tokenclaw spend list projects     # cost breakdown by project
tokenclaw spend list trends       # daily spend over time
tokenclaw spend list usage        # token counts and breakdown
tokenclaw spend list efficiency   # cache hit rates, cost per session
```

Reads the session logs that AI tools store locally (Claude Code, Cursor, Windsurf, etc.), counts tokens, and estimates cost. Nothing leaves your machine.

---

## Alert — get notified

```bash
tokenclaw alert setup             # interactive: set daily budget + Slack webhook
tokenclaw alert set --daily 50    # set daily threshold to $50
tokenclaw alert set --weekly 250  # set weekly threshold to $250
tokenclaw alert watch             # monitor hourly, alert when thresholds crossed
tokenclaw alert ack               # silence alerts for 24h
```

When total API spend crosses your threshold, you get a Slack alert. ([Create a webhook here.](https://api.slack.com/messaging/webhooks))

Set Slack directly:

```bash
tokenclaw config slack https://hooks.slack.com/services/T00/B00/xxx
```

---

## Budget — set spend limits per key

```bash
tokenclaw budget set --key sk-ant-research --budget 500/month
tokenclaw budget list             # show all budgets
tokenclaw budget show sk-ant-research  # show details for a key
```

Budgets are policy. They define how much a key should spend. Enforcement is separate.

---

## Control — enforce limits via proxy (Experimental)

The proxy sits between your agents and the API. It tracks spend per API key and can block requests.

```bash
tokenclaw control proxy                                  # start the proxy
tokenclaw control set --key sk-ant-research --warn-at 80% --block-at 100%  # enforcement rules
tokenclaw control keys                                   # view enforcement status
```

Point your agent at the proxy:

```bash
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

- At 80% — Slack alert
- At 100% — proxy returns 429, request stopped

Nothing is blocked unless you set `--block-at`. Default is warn-only.

<p align="center">
  <img src="docs/tokenclaw-proxy.jpg" alt="tokenclaw crab directing traffic between Anthropic and OpenAI" width="600">
</p>

Auto-detects provider: `/v1/messages` → Anthropic, `/v1/chat/completions` → OpenAI (also Groq, Together, Fireworks).

---

## Config

```bash
tokenclaw config                  # show current config
tokenclaw config slack <url>      # set Slack webhook
tokenclaw config reset            # reset to defaults
```

## Uninstall

```bash
npm uninstall -g tokenclaw-dev
rm -rf ~/.tokenclaw
```

## License

MIT
