# Per-Key Local Proxy — Spec

## Purpose
Local reverse proxy that sits between AI agents and LLM providers. Tracks spend per API key, enforces hard budget caps, blocks requests when budget is exhausted. Runs on the user's machine — no cloud, no telemetry.

## Non-Goals
- Multi-provider in v1 (Anthropic only — covers Claude Code + OpenClaw)
- Dashboard UI (CLI output is enough)
- Billing API integration (proxy sees actual requests, doesn't need billing API)
- Team/org features
- Remote/hosted proxy

## How it works

```
Agent (Claude Code / OpenClaw)
  ↓ ANTHROPIC_BASE_URL=http://localhost:4040
Local Proxy (tokenclaw proxy)
  ↓ checks key budget → BLOCK if over
  ↓ forwards to api.anthropic.com
  ↓ reads response → counts output tokens → updates spend
Agent gets response (or 429 if blocked)
```

## CLI interface

```bash
# Set a per-key budget
tokenclaw set --key sk-ant-proj-research --budget 10/day
tokenclaw set --key sk-ant-proj-deploy --budget 100/day

# Start the proxy
tokenclaw proxy
# → Listening on http://localhost:4040
# → Forwarding to https://api.anthropic.com
# → 2 key budgets active

# Check status
tokenclaw keys
# sk-ant-proj-research   $7.20 / $10.00 day   (72%)
# sk-ant-proj-deploy     $12.50 / $100.00 day  (13%)
# (unregistered keys)    $3.10 today           (no limit)

# The agent just needs one env var
ANTHROPIC_BASE_URL=http://localhost:4040 claude
```

## Key decisions

### Key matching
Match on prefix. User registers `sk-ant-proj-research`, proxy matches any key starting with that prefix. This handles key rotation (new key same project prefix).

### Unregistered keys
Keys without a budget pass through with no limit. Spend is still tracked. User can see "unregistered keys spent $X today" in status.

### Budget reset
Daily budgets reset at midnight local time. Weekly at Monday midnight. Monthly on the 1st.

### When budget is exceeded
Proxy returns HTTP 429 with body:
```json
{"error": {"type": "budget_exceeded", "message": "Key sk-ant-proj-research exceeded daily budget of $10.00 ($10.42 spent). Run `tokenclaw ack research` to add $10 or `tokenclaw set --key sk-ant-proj-research --budget 20/day` to increase."}}
```
Agent sees a clear error. User gets a Slack alert (if configured). Budget doesn't silently reset.

### Cost calculation
Input tokens known from request body (count before forwarding). Output tokens known from response. Use model pricing table (already built in scanners/local.ts). Cache tokens from response headers/body.

### Streaming
Most Anthropic calls use SSE streaming. Proxy must:
1. Forward request to Anthropic
2. Stream response back to agent in real-time (no buffering)
3. Count tokens from the final `message_delta` event (contains usage)
4. Update spend after stream completes

### Persistence
SQLite (already have db.ts). New table `proxy_requests`:
```sql
CREATE TABLE proxy_requests (
  id INTEGER PRIMARY KEY,
  api_key_prefix TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER DEFAULT 0,
  cost_usd REAL NOT NULL,
  timestamp TEXT NOT NULL
);
```

Key budgets stored in config.yaml (already have config system):
```yaml
key_budgets:
  sk-ant-proj-research:
    budget: 10
    period: day
  sk-ant-proj-deploy:
    budget: 100
    period: day
```

## Edge cases and failure modes

| Case | Behavior |
|---|---|
| Proxy crashes | Agent gets connection refused. Fail-closed. Agent can't spend. |
| Anthropic returns 500 | Forward error to agent. Don't count tokens (no spend). |
| Request succeeds but response parsing fails | Log error, don't count tokens. Fail-open on counting (conservative — undercounts rather than blocking legitimate work). |
| Multiple agents hit proxy simultaneously | SQLite WAL mode handles concurrent reads. Writes are serialized but fast (< 1ms). |
| Key not in request headers | Reject with 401. Anthropic requires x-api-key header. |
| Budget exceeded mid-stream | Can't stop a stream in progress. Block the NEXT request. Spend may slightly exceed budget by one response. |
| Clock changes (DST, NTP) | Use UTC for all budget windows. |

## Acceptance criteria

- [ ] `tokenclaw proxy` starts HTTP server on localhost:4040
- [ ] Forwards valid Anthropic API requests to api.anthropic.com
- [ ] Streaming responses pass through without buffering
- [ ] Tracks input/output tokens per request per key
- [ ] Calculates cost using existing model pricing
- [ ] `tokenclaw set --key X --budget Y/period` persists to config
- [ ] `tokenclaw keys` shows spend vs budget per registered key
- [ ] Returns 429 when key budget exceeded
- [ ] Unregistered keys pass through with tracking, no limit
- [ ] Budget resets at correct period boundary (UTC)
- [ ] Slack alert fires when key approaches/exceeds budget
- [ ] Works with Claude Code via ANTHROPIC_BASE_URL env var
- [ ] Works with OpenClaw via ANTHROPIC_BASE_URL env var

## Test plan

- Unit: cost calculation from request/response bodies
- Unit: budget check logic (under/at/over, period reset)
- Unit: key prefix matching
- Unit: streaming token counting from SSE events
- Integration: proxy forwards a real request to Anthropic (needs API key)
- Integration: proxy blocks when budget exceeded
- E2E: set budget, start proxy, run Claude Code with ANTHROPIC_BASE_URL, verify tracking
