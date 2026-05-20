# tokenclaw

<p align="center">
  <img src="docs/tokenclaw-logo.jpg" alt="tokenclaw — claw back your agent spend" width="600">
</p>

View, alert, and control AI API spend in real time.

AI agents do not stop when something goes wrong. They keep running, retrying, and silently burning through API budgets.

> "I left an agent running overnight. $280."
>
> "Agent entered an infinite loop. $4,200 in a weekend."
>
> "I set a spending limit. Turns out it was just an email."

<p align="center">
  <img src="docs/tokenclaw-overnight.jpg" alt="11pm: sleeping while agent runs. 6am: $2,847 bill. should've used tokenclaw." width="400">
</p>

tokenclaw tracks your API spend and gives you visibility and control before it becomes a surprise bill.

<p align="center">
  <img src="docs/tokenclaw-meme.jpg" alt="tokenclaw crab getting yanked off stage — wait I can explain" width="500">
</p>

## Install

```bash
npm install -g tokenclaw-dev
```

---

## View — see your API spend

```bash
tokenclaw view
```

Shows all spend data in one shot: cost by model, cost by project, daily trends, token usage, efficiency, and subscription value. If the proxy is running, also shows spend by API key.

Reads session logs stored locally. Only shows API-billed spend — subscription tools (Claude Code Pro, Cursor Pro) are shown separately with their value multiplier. Nothing leaves your machine.

---

## Alert — get notified when spend crosses a dollar amount

No proxy needed for total spend alerts. Per-key alerts require the proxy.

**1. Connect Slack:**

```bash
tokenclaw alert --setup
```

**2. Set a threshold:**

```bash
tokenclaw alert --daily 50                  # Slack at $50/day total
tokenclaw alert --weekly 250                # Slack at $250/week total
tokenclaw alert --key sk-abc --daily 10     # Slack at $10/day on this key (proxy)
```

**3. Start monitoring:**

```bash
tokenclaw alert --watch                     # checks hourly, sends Slack when threshold crossed
```

`--watch` must be running for alerts to fire. Run in a background terminal or add to cron.

```bash
tokenclaw alert --ack                       # silence alerts for 24h
tokenclaw alert                             # show current thresholds
```

---

## Cap — block requests when spend crosses a dollar amount

Requires the proxy. Start the proxy first, then set caps.

```bash
tokenclaw proxy                             # start proxy
```

Point your agent at it:

```bash
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

Set a cap:

```bash
tokenclaw cap --key sk-ant-research --daily 10      # block at $10/day
tokenclaw cap --key sk-abc --weekly 500              # block at $500/week
tokenclaw cap --key sk-abc --monthly 2000            # block at $2000/month
```

Auto-warns at 80% of the cap. At 100%, the proxy returns 429 and the request is stopped.

```bash
tokenclaw keys                              # show all alerts and caps on keys
```

<p align="center">
  <img src="docs/tokenclaw-proxy.jpg" alt="tokenclaw crab directing traffic between Anthropic and OpenAI" width="600">
</p>

Auto-detects provider: `/v1/messages` → Anthropic, `/v1/chat/completions` → OpenAI (also Groq, Together, Fireworks).

---

## Config

```bash
tokenclaw config                            # show current config
tokenclaw config slack <url>                # set Slack webhook
tokenclaw config reset                      # reset to defaults
```

## Uninstall

```bash
npm uninstall -g tokenclaw-dev
rm -rf ~/.tokenclaw
```

## License

MIT
