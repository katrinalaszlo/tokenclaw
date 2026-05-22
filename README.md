# tokenclaw

See exactly where your AI spend goes.

Track Claude, OpenAI, Gemini, Cursor, and Windsurf costs from your terminal. Set alerts before costs spiral.

```
Traditional cloud monitoring was built for servers.
tokenclaw was built for AI agents.
```

<p align="center">
  <img src="docs/tokenclaw-logo.jpg" alt="tokenclaw" width="500">
</p>

## 30-second setup

```bash
npm install -g tokenclaw-dev
tokenclaw today
```

That's it. No auth, no config. Reads your local session logs and shows what you've spent:

```
  OpenClaw           $12.41
  Claude Code        $6.20

  Total              $18.61 / $50.00 (37%)
```

Works immediately if you use Claude Code, OpenClaw, Cursor, Windsurf, Cline, Roo Code, Aider, or Continue.dev.

---

## Catch runaway costs early

```bash
tokenclaw alert --daily 50
```

Get notified before a bad loop burns hundreds overnight. Installs a background check (runs hourly, survives reboots on macOS).

Connect Slack to get alerts when you're not watching:

```bash
tokenclaw config slack https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

---

## See cost after every Claude Code turn

```bash
tokenclaw hook install
```

Every time Claude finishes a turn, you see:

```
[tokenclaw] $18.32/$50 (37%)
```

---

## Hard-block a runaway agent

```bash
tokenclaw proxy                                     # start the proxy
ANTHROPIC_BASE_URL=http://localhost:4040 claude      # point agent at it
tokenclaw cap --key sk-ant-research --daily 10      # block at $10/day
```

At 80% the proxy warns. At 100% it returns 429 and the agent stops. Your money stops leaving.

<p align="center">
  <img src="docs/tokenclaw-proxy.jpg" alt="tokenclaw proxy" width="500">
</p>

---

## Built for

- Claude Code users on Max plans burning $200+/day
- OpenClaw / OpenRouter API users
- Cursor and Windsurf power users
- AI agent builders running autonomous workflows
- Anyone who's had a surprise API bill

---

## All commands

| Command | What it does |
|---------|-------------|
| `tokenclaw today` | Today's spend by tool |
| `tokenclaw view` | Full breakdown: models, projects, trends, efficiency |
| `tokenclaw status` | One-line spend check (instant) |
| `tokenclaw alert --daily 50` | Alert at $50/day |
| `tokenclaw alert --velocity 0.50` | Alert when burning >$0.50/min |
| `tokenclaw hook install` | Show spend after every Claude Code turn |
| `tokenclaw cap --key <prefix> --daily <n>` | Hard-block at $n/day (needs proxy) |
| `tokenclaw baseline` | Your spending patterns by day-of-week |
| `tokenclaw list sessions` | Most expensive sessions |
| `tokenclaw digest` | Daily Slack summary |
| `tokenclaw mcp install` | Let AI agents check their own budget |

---

## Advanced

<details>
<summary>Velocity alerts</summary>

```bash
tokenclaw alert --velocity 0.50
```

Alerts on spend *rate* over a 30-minute window from proxy data. Catches runaway loops before they hit the total threshold.

</details>

<details>
<summary>Spending baselines</summary>

```bash
tokenclaw baseline
```

After 7+ days, shows per-day-of-week patterns (median, P95). After 14 days, anomaly detection replaces the default spike threshold with one tuned to your actual spend. API-billed tools only.

</details>

<details>
<summary>Daily digest</summary>

```bash
tokenclaw digest --install
```

Sends yesterday's spend summary to Slack at 9 AM daily (macOS launchd).

</details>

<details>
<summary>MCP server (let agents self-regulate)</summary>

```bash
tokenclaw mcp install
```

Gives Claude Code access to three tools: `get_budget_status`, `get_session_cost`, `estimate_cost`. Agents can check their budget before expensive operations and switch to cheaper models when running low.

Add to your project's CLAUDE.md:

```markdown
## Cost awareness
Before expensive operations, check budget via the tokenclaw MCP server.
If remaining budget is <20%, prefer Sonnet over Opus for routine tasks.
```

</details>

<details>
<summary>Manual hook/MCP setup (if commands don't work)</summary>

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "npx tokenclaw-dev status --oneliner 2>/dev/null || true" }] }]
  },
  "mcpServers": {
    "tokenclaw": { "command": "npx", "args": ["tokenclaw-dev", "mcp"] }
  }
}
```

</details>

<details>
<summary>Cap details</summary>

Caps require the proxy (`tokenclaw proxy`). The proxy sits between your agent and the API, counts tokens, and blocks when a cap is hit.

```bash
tokenclaw cap --key sk-abc --weekly 500
tokenclaw cap --key sk-abc --monthly 2000
tokenclaw cap                               # view all caps
tokenclaw cap --clear --key sk-abc          # remove a cap
```

Auto-detects provider: `/v1/messages` goes to Anthropic, `/v1/chat/completions` goes to OpenAI.

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
