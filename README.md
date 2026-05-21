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

If `tokenclaw` isn't found after installing, use `npx tokenclaw-dev` instead — or add an alias:

```bash
echo 'alias tokenclaw="npx tokenclaw-dev"' >> ~/.zshrc && source ~/.zshrc
```

## Quick start

```bash
tokenclaw view                      # see what you're spending
tokenclaw alert --daily 50          # get Slack alerts at $50/day
tokenclaw status                    # fast one-line spend check
```

That's it. `view` scans your local AI tools (Claude Code, OpenClaw, Cursor, Windsurf, etc.) and shows what each one costs. Nothing leaves your machine.

---

## View — see your API spend

```bash
tokenclaw view
```

Shows cost by model, cost by project, daily trends, token usage, efficiency, and subscription value. Scans session logs stored on your machine — Claude Code, OpenClaw, Cursor, Windsurf, Cline, Roo Code, Aider, Continue.dev.

API-billed tools show actual dollar spend. Subscription tools (Claude Code Pro/Max, Cursor Pro) are shown separately with how much compute you're getting for your flat monthly fee.

---

## Alert — get notified when spend crosses a dollar amount

### Set thresholds

```bash
tokenclaw alert --daily 50                  # alert at $50/day total
tokenclaw alert --weekly 250                # alert at $250/week total
```

Alerts print to terminal by default. Connect Slack to get notified when you're not watching:

```bash
tokenclaw config slack https://hooks.slack.com/services/T00/B00/xxx
```

<details>
<summary>How to get a Slack webhook URL</summary>

1. Go to [api.slack.com/apps](https://api.slack.com/apps) -> **Create New App** -> **From scratch**
2. App name: "tokenclaw", pick your workspace -> **Create App**
3. Left sidebar -> **Incoming Webhooks**
4. Toggle **Activate Incoming Webhooks** to On
5. Scroll down -> click **Add New Webhook to Workspace**
6. Pick a channel -> **Allow**
7. Back on the webhooks page, copy the URL that was just created (starts with `https://hooks.slack.com/services/...`)

</details>

### Start monitoring

```bash
tokenclaw alert --watch                     # check every hour, alert when threshold crossed
tokenclaw alert --check                     # check once and exit (for cron/launchd)
```

```bash
tokenclaw alert --ack                       # silence alerts for 24h
tokenclaw alert                             # show current thresholds and recent alerts
tokenclaw alert --log                       # alert history
tokenclaw alert --clear                     # remove alerts
```

---

## Status — quick spend check

```bash
tokenclaw status                    # $18.32 / $50.00 (37%) | 12 sessions | opus-4-6
tokenclaw status --oneliner         # [tokenclaw] $18.32/$50 (37%)
tokenclaw status --json             # structured output for scripts
```

Instant read (<10ms). Updated every time you run `view`, `alert --check`, or `alert --watch`.

---

## Claude Code hook — see cost after every turn

```bash
tokenclaw hook install
```

After each conversation turn, you'll see: `[tokenclaw] $18.32/$50 (37%)`

To remove: `tokenclaw hook uninstall`

<details>
<summary>Manual setup (if the command doesn't work)</summary>

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "npx tokenclaw-dev status --oneliner 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

Uses `Stop` (fires once per turn), not `PostToolUse` (fires per tool call, would spam 10-30x per turn).

</details>

---

## Cap — block requests when spend crosses a dollar amount

Caps actually stop API requests. Requires running the proxy so tokenclaw can sit between your agent and the API.

### Start the proxy

```bash
tokenclaw proxy
```

Then point your agent at it instead of the real API:

```bash
ANTHROPIC_BASE_URL=http://localhost:4040 claude
OPENAI_BASE_URL=http://localhost:4040 your-agent
```

The proxy passes requests through, counts tokens, and blocks when a cap is hit.

### Set a cap

```bash
tokenclaw cap --key sk-ant-research --daily 10      # block at $10/day
tokenclaw cap --key sk-abc --weekly 500              # block at $500/week
tokenclaw cap --key sk-abc --monthly 2000            # block at $2000/month
```

Auto-warns at 80% of the cap. At 100%, the proxy returns 429 and the request is stopped. Caps are per-key — you need to specify which API key prefix to cap.

```bash
tokenclaw cap                               # show all active caps
tokenclaw cap --log                         # when caps blocked requests
tokenclaw cap --clear --key sk-abc          # remove a cap
```

<p align="center">
  <img src="docs/tokenclaw-proxy.jpg" alt="tokenclaw crab directing traffic between Anthropic and OpenAI" width="600">
</p>

Auto-detects provider: `/v1/messages` -> Anthropic, `/v1/chat/completions` -> OpenAI (also Groq, Together, Fireworks).

Per-key alerts also work through the proxy:

```bash
tokenclaw alert --key sk-abc --daily 10     # alert (not block) at $10/day on this key
```

---

## More features

### Velocity alert

```bash
tokenclaw alert --velocity 0.50     # alert when burning >$0.50/min sustained
```

Catches runaway agents by their spend *rate* over a 30-minute window. Requires the proxy to be running.

### Baseline — spending patterns

```bash
tokenclaw baseline
```

After 7+ days of data, shows your per-day-of-week spending patterns (median, P95). After 14 days, anomaly detection kicks in and replaces the default spike threshold with one tuned to your actual patterns. API-billed tools only.

### Session outliers

```bash
tokenclaw list sessions
```

Top 10 most expensive sessions sorted by cost. Sessions over 3x your median are highlighted in red.

### Daily digest

```bash
tokenclaw digest                    # build and send yesterday's summary to Slack
tokenclaw digest --install          # schedule at 9 AM daily (macOS launchd)
```

### MCP server — let AI agents check their own budget

If you use Claude Code, you can give it access to your spend data. When the agent sees it's burning through budget, it can switch to a cheaper model or ask before continuing.

```bash
tokenclaw mcp install
```

This adds a local server that Claude Code can query. Three tools: `get_budget_status` (how much have I spent today?), `get_session_cost` (how much did this session cost?), `estimate_cost` (how much would this model call cost?).

<details>
<summary>Manual setup</summary>

Add to your `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "tokenclaw": {
      "command": "npx",
      "args": ["tokenclaw-dev", "mcp"]
    }
  }
}
```

</details>

<details>
<summary>Make agents budget-aware</summary>

Add to your project's `CLAUDE.md`:

```markdown
## Cost awareness

Before starting expensive operations (large refactors, multi-file changes), check your budget:
- Use the `get_budget_status` tool to see remaining daily budget
- If over 80%, mention it and ask before proceeding
- Use `estimate_cost` to preview cost of large context windows
```

</details>

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
