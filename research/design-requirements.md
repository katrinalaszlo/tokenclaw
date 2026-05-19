# Design Requirements

## 1. Requirements

| # | Requirement | Why (user evidence) | Difficulty | Gap size |
|---|---|---|---|---|
| R1 | **Zero-config spend visibility.** Install via npx, automatically detect all local AI tools, show spend per tool within 10 seconds. No signup, no API key, no config file. | Tim: "I was the day before on all these platforms and I'm just like, I've spent that much and I had no way of knowing that." The barrier was not lack of tools — it was friction to use them. | Low | Small — ccusage, codeburn do parts of this. None auto-detect across all tools in one command. |
| R2 | **Escalating alerts with acknowledgment loop.** Alerts that increase in frequency and urgency until a human explicitly responds. Ack = "I saw this, it's fine" with a scoped snooze. No ack = alerts keep firing and escalating. | David: "Detect every resource, set usage alert thresholds, escalate aggressively as costs approach $1K/day. Alert, confirm ('this is OK'), silence, repeat." This is one workflow — escalation without ack is noise, ack without escalation is a dismiss button. | High | **None.** No AI spend tool ships this. Bifrost has threshold blocks (binary, no escalation). Portkey/Helicone fire one-shot notifications. The ack loop is standard in incident management (PagerDuty) but absent from the entire AI cost category. |
| R3 | **Rate-based anomaly detection.** Detect abnormal spend velocity relative to historical baseline — not just absolute thresholds. Catch spikes by rate of change, not by crossing a number someone guessed in advance. | NovaTech: "We had a customer generating 50,000 words a day. Average is 2,000. We didn't notice for three weeks." A 25x spike. No static threshold would have caught it because nobody set one. A rate detector flags day one. | Medium | **None.** Bifrost and LiteLLM enforce hard ceilings. No tool compares current velocity against rolling average. |
| R4 | **Per-tool and per-agent cost attribution.** Break down spend by tool (Claude Code, Cursor, OpenClaw) and, where identifiable, by agent or session within a tool. | Tim: couldn't tell which platform was costing what across multiple tools. David: "detect every resource" — granularity matters when you're triaging what to kill. | Medium | Small — codeburn shows per-provider. No tool attributes to individual agents or sessions within a provider. |
| R5 | **Continuous monitoring without code changes.** Ongoing background observation of spend. Not a point-in-time scan you run manually and forget. No proxy, no SDK wrapper, no base-URL swap. | David: "$200K bug happened because nobody was watching." ccusage and codeburn are retrospective — by the time you check, the money is spent. Tim had no way of knowing until he manually looked. Continuous + zero-config = the tool watches so you don't have to. | Medium | Partial — LiteLLM and Bifrost monitor continuously but require proxy/SDK changes. Local scanners (ccusage, codeburn) are manual one-shots. No tool does both continuous and zero-config. |

## 2. Gap Statement

The escalating alert with acknowledgment loop (R2) has zero competitive coverage. Every existing AI spend tool either shows you a number passively (ccusage, codeburn) or fires a single notification that dies on arrival (Portkey, Helicone). Nobody escalates. Nobody demands a human confirm they've seen the alert. The result: David's $200K cloud spend incident happened not because there was no dashboard, but because no alarm kept yelling until someone responded. NovaTech's 25x usage spike ran for three weeks because a one-shot alert — if it existed — would have been dismissed or missed on day one. The ack loop is proven in incident management (PagerDuty, OpsGenie) and in banking fraud alerts ("Was this charge $847? Reply YES or NO"). It does not exist in any AI spend tool. That gap is the product's reason to exist.

## 3. Acceptance Criteria

**R1 — Zero-config spend visibility.**
User runs `npx [name]`, sees a per-tool spend breakdown for every detected local AI tool within 10 seconds — no config file, no API key, no account creation.

**R2 — Escalating alerts with acknowledgment loop.**
User sets a $100/day threshold. Spend crosses $100. First alert fires. User does not acknowledge. Subsequent alerts arrive at increasing frequency (per escalation tiers). User runs the ack command — alerts stop for the specified snooze duration. Snooze expires and spend is still elevated — alerts resume.

**R3 — Rate-based anomaly detection.**
Synthetic test: inject spend data at 3x the 7-day rolling average. Alert fires. Same absolute dollar amount injected as steady-state (not a spike) does not fire. Verifies the detection is velocity-based, not threshold-based.

**R4 — Per-tool and per-agent cost attribution.**
Trigger spend in two different tools (e.g., Claude Code and OpenClaw). Dashboard shows separate line items per tool. Within OpenClaw, two different agents show as separate attributions.

**R5 — Continuous monitoring without code changes.**
User installs, sets a threshold, closes the terminal. Spend crosses threshold 4 hours later. Alert is delivered. Verifies: no terminal open, no manual scan, no proxy, no code change in user's projects.

## 4. Anti-Requirements

**LiteLLM and Bifrost proxy all API traffic.** We don't. Zero-config means no code paths change. If using the tool requires modifying a base URL or wrapping an SDK, adoption dies at step one.

**Portkey and Helicone require account creation and API keys.** We don't. Signup friction kills adoption for individual developers. The tool must work the moment you install it.

**LangSmith traces request quality and latency.** We don't. This tool is spend-only. Observability, quality metrics, and trace analysis are different products for different buyers. Scope creep toward "AI observability platform" would dilute the alert-loop core.

**Portkey manages team roles and permissions.** We don't. V1 is developer-first, single-user. Team features are a future layer, not a launch requirement. Building for enterprise governance before nailing the individual use case is how tools become shelfware.

**codeburn renders a full TUI dashboard with 19 providers.** We don't optimize for provider count. Covering the tools people actually run locally (Claude Code, Cursor, OpenClaw, etc.) matters more than claiming 19 integrations. Depth of insight per tool beats breadth of provider logos.

## 5. Escalation Design

### Default Tiers

| Tier | Trigger | Alert frequency | Channel |
|---|---|---|---|
| L1 — Notice | Spend crosses configured threshold | Once | Terminal notification + primary channel (Slack/email/desktop) |
| L2 — Warning | 15 minutes after L1, unacknowledged | Every 4 hours | Primary channel, subject line marked UNACKNOWLEDGED |
| L3 — Urgent | 4 hours after L2, still unacknowledged | Every hour | Primary channel + secondary channel if configured |
| L4 — Critical | 12 hours unacknowledged AND spend still rising | Every 30 minutes | All configured channels, marked CRITICAL |

Timing is tunable per-user. These are defaults that balance urgency against alert fatigue.

### Acknowledgment

**What "ack" means:** "I have seen this alert and the current spend level is expected." It does not mean "stop monitoring." It means "snooze this specific alert condition for a defined duration."

**Ack parameters:**
- **Duration:** How long to snooze. Default 24 hours. Options: 1h, 4h, 12h, 24h, 48h, "until end of billing period."
- **Scope:** What the ack covers. Options: "this tool only" (e.g., ack OpenClaw but keep alerting on Claude Code), "this agent only," or "all tools."
- **Ack is temporary.** When the snooze expires, the system re-evaluates. If spend is still elevated, alerts resume at L1. Ack never permanently silences.

**Ack interface:** CLI command (`[name] ack`), Slack reply ("ok"), or dashboard button. All equivalent.

### No Acknowledgment

If nobody acknowledges through L4:
- Alerts continue at L4 frequency (every 30 minutes) indefinitely.
- Each alert includes cumulative unacknowledged duration and total spend since first alert.
- The tool does NOT auto-kill agents or block spend in v1. Hard enforcement is a Layer 3/future capability. V1 is an alarm, not a circuit breaker.
- Rationale: auto-killing a legitimate long-running agent is worse than over-alerting. The human makes the call.

### Rate-Based vs. Threshold-Based Detection

**Threshold-based:** "Alert me when daily spend exceeds $100." Static. Requires the user to know what "normal" is and set a number in advance. Good for hard limits.

**Rate-based:** "Alert me when spend velocity is 3x my rolling 7-day average." Dynamic. Adapts as usage patterns change. Catches the NovaTech scenario — 25x spike with no threshold set — on day one.

**Both run simultaneously.** They are complementary, not competing:
- Threshold catches "I never want to spend more than $X/day regardless of trend."
- Rate catches "something changed dramatically" even if the absolute number is below any threshold.
- Either trigger independently feeds into the same escalation pipeline.

### Edge Cases

**High spend, legitimate use.** This is the primary purpose of the ack loop. User gets the alert, recognizes the spend ("I'm running a large batch job"), acks with appropriate scope and duration. The system records the ack for audit trail. When snooze expires, re-evaluation happens automatically.

**Alert fatigue from misconfigured thresholds.** If a user acks the same alert type 3+ times in 7 days, suggest raising the threshold. "You've acknowledged your daily spend exceeding $100 four times this week. Consider raising your threshold to $150." The tool should help the user calibrate, not just repeat.

**Tool cost vs. value.** The tool must be free or near-free for individuals. Its value proposition is insurance against tail-risk events ($200K cloud bills, 25x usage spikes running for weeks) — not optimizing $5/day spend. If the tool costs more than the spend it monitors, it has failed. The free tier must cover the core alert loop for solo developers. Paid tiers exist for teams and power users who need more channels, more granular attribution, or higher alert volume.

**Multiple overlapping alerts.** If both threshold and rate-based rules fire simultaneously, they produce one unified alert (not two separate messages). The alert body shows which conditions triggered. Escalation follows whichever tier is higher.

**Clock skew / gaps in local data.** Local JSONL files may have gaps (tool wasn't running, laptop was closed). Rate-based detection uses wall-clock time for the rolling window, not session time. A gap followed by a burst looks like a spike — correctly, because it is one from a spend perspective.

---

## 6. User Stories

**US1 — Solo developer, first-time install.**
As a developer using Claude Code and Cursor daily, I want to run one command and immediately see what I've been spending across all my AI tools, so I can make informed decisions about my usage without digging through multiple dashboards or billing pages.
*Persona: Tim. Spends across multiple platforms. No time to check each one.*

**US2 — Developer who sets a budget and walks away.**
As a developer with a monthly AI budget, I want to set a daily spend threshold and trust that the tool will alert me — loudly and repeatedly — if I exceed it, so I don't have to remember to check.
*Persona: David. Has been burned by unmonitored cloud spend. Wants the alarm to find him, not the other way around.*

**US3 — Developer running long autonomous agents.**
As a developer running overnight OpenClaw agents, I want alerts that detect abnormal spend velocity even when I haven't set an explicit threshold, so a runaway agent doesn't burn through my budget while I sleep.
*Persona: NovaTech's customer (25x spike, 3 weeks unnoticed). Also Tim — agents running unattended on OpenClaw.*

**US4 — Developer who gets a legitimate alert.**
As a developer who intentionally kicked off an expensive batch job, I want to acknowledge the alert with a scoped snooze ("this tool, 12 hours") so I stop getting pinged without disabling monitoring for everything else.
*Persona: David. "Confirm ('this is OK'), silence, repeat."*

**US5 — Developer who missed an alert.**
As a developer who was AFK when an alert fired, I want the tool to escalate through increasingly urgent channels until I or someone on my team responds, so cost incidents don't go unnoticed because a single Slack message got buried.
*Persona: David. "Escalate aggressively." The $200K incident happened because nobody was watching.*

---

## 7. Happy Paths

**HP1 — First run (R1).**
Install → auto-detect tools → show spend breakdown → prompt for optional threshold → save config → open dashboard. User goes from zero to full visibility in under 60 seconds.

**HP2 — Threshold alert, fast ack (R2).**
Spend crosses threshold → L1 alert fires to Slack → user sees it within minutes → runs `ack 24h` → alerts snooze → 24h later, spend back to normal → no further alerts. Clean cycle.

**HP3 — Threshold alert, slow ack (R2).**
Spend crosses threshold → L1 fires → user doesn't respond → L2 fires at 15 min ("UNACKNOWLEDGED") → user sees it → acks → snooze. System worked — escalation caught the missed L1.

**HP4 — Rate spike on an overnight agent (R3).**
Agent runs overnight → spend velocity hits 4x rolling average → rate-based alert fires at 2am → user sees it at 7am (by then at L3, hourly) → acks or kills the agent. Damage limited to hours, not weeks.

**HP5 — Attribution triage (R4).**
Alert fires for total daily spend. User opens dashboard → sees OpenClaw agent "threat-intel" is 80% of today's cost → kills that agent, acks the alert for remaining tools. Granularity enabled targeted action.

**HP6 — Snooze expiry, spend normalized (R2).**
User acks with 12h snooze → 12h later, system re-evaluates → spend is back within normal range → no new alert fires. Silent re-evaluation, no noise.

**HP7 — Snooze expiry, spend still elevated (R2).**
User acks with 12h snooze → 12h later, spend still above threshold → new L1 alert fires → user re-acks or investigates. The ack didn't permanently silence the problem.

---

## 8. Error Paths

**EP1 — No AI tools detected (R1).**
User installs, scanner finds no recognized tool data directories. Show: "No AI tools detected. Supported tools: [list]. If you use one of these, check that it's been run at least once." Don't fail silently. Don't show an empty dashboard.

**EP2 — Tool detected but no session data (R1).**
Tool directory exists (e.g., `~/.claude/`) but contains no parseable session files. Show the tool as detected with "$0 — no session data found." Distinguish "not installed" from "installed but no usage."

**EP3 — Corrupted or unreadable session files (R1, R4).**
JSONL file exists but contains malformed entries. Skip corrupted entries, process the rest. Report: "X of Y entries in [tool] could not be parsed." Don't crash. Don't silently under-report spend.

**EP4 — Alert channel unreachable (R2, R5).**
Slack webhook returns 4xx/5xx, or email delivery fails. Retry with backoff. If still failing after 3 attempts, fall back to local notification (desktop/terminal). Log the delivery failure. Never silently drop an alert.

**EP5 — Ack command when no active alert (R2).**
User runs `ack` but there's no pending alert. Show: "No active alerts to acknowledge." Don't create a phantom snooze.

**EP6 — Rate detection with insufficient history (R3).**
User just installed — less than 7 days of data for a rolling average. Rate-based detection cannot fire until baseline exists. Threshold-based alerts still work immediately. Show: "Rate-based anomaly detection will activate after 7 days of usage data."

**EP7 — Background monitor stops unexpectedly (R5).**
Daemon/process crashes. On next user interaction (CLI command or dashboard open), detect the monitor is down and warn: "Background monitor is not running. Alerts are paused. Run `[name] start` to resume." Don't let the user believe they're protected when they're not.

**EP8 — Config file missing or corrupted (R2, R5).**
`~/.ai-spend/config.yaml` deleted or unparseable. Fall back to defaults (no thresholds, no alert channels). Warn on next CLI invocation: "Config not found or corrupted. Run `[name] setup` to reconfigure." Don't crash. Don't silently run without thresholds.

**EP9 — Overlapping acks with conflicting scope (R2).**
User acks "all tools, 24h" then acks "Claude Code only, 1h." Narrower scope within a broader ack is a no-op (already covered). Broader ack after a narrower one supersedes. Last-write-wins on overlapping scope. Show the active ack state on next status check.

---

## 9. Design Notes

**DN1 — Estimates are good enough.**
Local token scanning produces cost estimates, not exact billing amounts. This is fine. Tim and David's problem was zero visibility, not imprecise visibility. An estimate that says "$287 today" when the real number is $310 is infinitely more useful than no number at all. Don't block v1 on billing API integration for exact cents.

**DN2 — The alert is the product, the dashboard is the hook.**
The dashboard gets people to install. The alert loop is what saves them money. Design decisions should favor alert reliability over dashboard polish. A missed alert is a product failure. A slow-rendering chart is cosmetic.

**DN3 — Default thresholds should be opinionated.**
Most users won't configure thresholds on first run. Offer a sensible default based on detected historical spend ("Your average daily spend is ~$45. Set alert at $100?"). A tool with no thresholds set is a dashboard, not an alarm. Prompt on first run, don't require it.

**DN4 — Ack friction is intentional.**
Acknowledging an alert should require a deliberate action (typing a command, clicking a button, replying in Slack). It should not auto-dismiss on open/read. The friction is the feature — it forces the user to consciously decide "this is OK." Removing friction removes the safety mechanism.

**DN5 — Alert content must be actionable.**
Every alert must include: what triggered it (threshold or rate), how much was spent, which tool/agent is responsible, and what the user can do about it (`ack`, `kill`, open dashboard). An alert that says "spend is high" without attribution or next steps is noise.

**DN6 — The tool must not cost more than it saves.**
This is a constraint, not a feature. Free tier covers the core loop (scan + threshold alerts + ack) for solo developers. If someone spends $30/month on AI tools and we charge $9/month to monitor it, we've failed the value test. Paid tiers target users whose spend justifies the cost — teams, heavy agent users, multi-tool power users.

**DN7 — Local-first, not cloud-first.**
V1 runs entirely on the user's machine. No data leaves the machine unless the user configures an external alert channel (Slack webhook, email). This is a trust decision — developers are more likely to install a tool that reads local files than one that phones home. Cloud features (team sync, shared dashboards) are future layers.

**DN8 — Fail loud, not fail safe.**
If the monitor crashes, say so. If a session file is corrupted, report it. If an alert can't be delivered, try harder and then warn locally. The worst outcome is the user believing they're protected when they're not. Every failure mode should surface to the user, not hide behind a silent fallback.

**DN9 — Calibration over configuration.**
Users shouldn't need to be experts to set good thresholds. The tool should observe usage for a week, then suggest thresholds based on actual patterns. "Your p95 daily spend is $87. Alert at $100?" is better than a blank config field. After repeated acks, suggest raising the threshold. The tool should learn what "normal" looks like for this user.

---

## Future Parking Lot

Requirements without direct user evidence. Tracked here, not in the requirements table.

- **Per-agent spend limits with hard enforcement (kill switch).** David described this aspiration ("kill it now") but his primary ask was the alert-ack loop. Hard enforcement is Layer 3.
- **Approval workflows for agent purchases.** "Agent wants to spend $50. Allow?" No user has described this workflow yet. Anticipated from the "agents will make purchases" trend.
- **Team rollup and shared thresholds.** Dean's "everyone will need to monitor" implies teams, but no user described a team workflow. Individual-first.
- **Billing API integration for exact-dollar spend.** Local scanning gives estimates from token counts. Billing API gives actuals. No user complained about estimate accuracy — they complained about having no visibility at all. Exact numbers are a polish feature.
