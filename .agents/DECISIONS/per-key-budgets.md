# Per-Key Budgets — Decision Log

## Gate question: Can we track per-key spend from local JSONL?
**Answer: NO.** Claude Code JSONL files contain model, usage tokens, content, session ID — but no API key identifier. Checked real session files on 2026-05-18.

## Approaches considered

### 1. Billing API polling
- Anthropic/OpenAI admin APIs return per-key breakdowns
- Monitoring only, no enforcement
- Partially built (scanners/anthropic.ts, scanners/openai.ts — untested)
- Ships in days
- **Rejected as primary approach.** Good for enrichment later, but doesn't give enforcement.

### 2. Local proxy (CHOSEN)
- Agent sets ANTHROPIC_BASE_URL=localhost:4000
- Proxy sees every request including the API key
- Can track AND enforce per-key budgets
- Ships in 1-2 weeks for MVP
- Reliability matters — proxy is in the critical path
- **Chosen because:** it's the product Reddit is asking for ("hard cap", "kill switch"), works locally (no cloud), and enables per-key governance.

### 3. Per-project budgets from JSONL
- Works with existing data (tool + project path)
- No keys needed
- Ships in hours
- **Not rejected — can ship as interim.** But not the differentiator.

### 4. Combine billing API + per-project
- Monitoring only
- **Parked.** Useful later as enrichment on top of proxy.

## Risk: Proxy is the crowded lane
14+ companies building agent spend enforcement. Stripe will absorb this. Counter-argument: none of them are local-first CLI tools for individual developers. They're all SaaS/enterprise. A `npx tokenclaw proxy` that runs locally is a different product.
