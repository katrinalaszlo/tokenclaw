# agentcap — Findings

## Per-key governance research (from vault session 2026-05-18)

### The insight
"Treating spending authority like a balance on a key rather than a policy in a dashboard." — Lava user, r/AI_Agents

Nobody in the 13+ companies building agent spend control does per-key governance. They all do account-level or agent-level caps. Per-key maps to how developers already scope access: one key per agent, one key per project, one key per team.

### Competitive landscape (13+ companies, all pre-traction)
- OpenCard/Sigil (getopencard.com / trysigil.io) — runtime control plane + marketplace
- Axon402 — orchestrator/runtime agent split with scoped wallets
- AgentCard — prepaid virtual Visa for agents
- Privacy.com — agent-specific virtual cards with OpenClaw integration
- Modexia — USDC wallets with x402 auto-intercept
- Truzify — payment control layer with rules/approvals/audit
- Engram — routing/coordination layer that intercepts requests
- Lava — credit limits at the request layer, blocks when budget gone
- K2 Rail — hard-coded financial kill-switch API
- Stripe Link for Agents — one-time cards with push notification approval
- Mastercard Agent Pay — enterprise agent payment auth
- LetAgentPay — OSS policy middleware
- Skymel — workflow-level spend control

### Reddit signal (real pain, not theoretical)
- r/openclaw: "$280 lost in one weekend, no alert, no kill switch" (2mo ago, 22 comments)
- Most agents avg $40-80/month unchecked, spikes on weekends/overnight
- "No native spending cap in OpenClaw"
- LiteLLM has soft limits but they're bypassable and per-key not per-workflow
- Everyone asks for "hard cap" — that's the exact word

### IMF three-layer model (April 2026)
- Intent (probabilistic, agent explores) → Authorization (deterministic, must win) → Settlement (money moves)
- Authorization must live outside the reasoning loop — model can reason around in-prompt checks
- Enforcement has to be a structural boundary the agent can't see

### Key question for Phase 1
Do JSONL session files contain API key identifiers? Determines if per-key tracking works locally or needs billing API.
