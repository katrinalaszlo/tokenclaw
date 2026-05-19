# Per-Key Proxy — TODO

## Phase 1: Config + types
- [ ] Add `KeyBudget` type: `{ budget: number, period: 'day' | 'week' | 'month' }`
- [ ] Add `key_budgets: Record<string, KeyBudget>` to AccConfig
- [ ] Update config load/save to handle key_budgets
- [ ] Parse budget strings: "10/day", "500/week", "2000/month"
  Verify: `npm run build`

## Phase 2: DB schema
- [ ] Add `proxy_requests` table to db.ts
- [ ] Add `getSpendByKeyPrefix(prefix, since)` query
- [ ] Add `getKeyBreakdown()` for status display
- [ ] Add `insertProxyRequest()` function
  Verify: `npm run build`

## Phase 3: Proxy server
- [ ] Create `src/proxy/server.ts` — HTTP server on localhost:4040
- [ ] Extract API key from `x-api-key` header
- [ ] Check key budget before forwarding
- [ ] Forward non-streaming requests to api.anthropic.com
- [ ] Forward streaming (SSE) requests with passthrough
- [ ] Parse response for token usage (input, output, cache)
- [ ] Calculate cost using existing `estimateCost()`
- [ ] Insert proxy request into DB
- [ ] Return 429 with helpful message when budget exceeded
  Verify: `npm run build && curl -X POST http://localhost:4040/v1/messages -H "x-api-key: test" -H "content-type: application/json" -d '{"model":"claude-sonnet-4-6","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'`

## Phase 4: CLI commands
- [ ] `tokenclaw set --key <prefix> --budget <amount>/<period>` — save to config
- [ ] `tokenclaw keys` — show registered keys with spend vs budget
- [ ] `tokenclaw proxy` — start the proxy server (foreground)
- [ ] `tokenclaw proxy --port <port>` — custom port (default 4040)
- [ ] Update `tokenclaw status` to include key breakdown if proxy data exists
  Verify: `npx tsx src/cli.ts set --key sk-test --budget 10/day && npx tsx src/cli.ts keys`

## Phase 5: Alert integration
- [ ] Generate per-key alert rules from key_budgets config
- [ ] Fire Slack alert when key approaches budget (80%)
- [ ] Fire Slack alert when key exceeds budget (blocked)
- [ ] Include key prefix in alert message
  Verify: manual test with Slack webhook

## Phase 6: Test + ship
- [ ] Unit tests for cost calculation, budget check, key matching
- [ ] Integration test: proxy forwards real request (needs API key)
- [ ] Update landing page with proxy messaging
- [ ] Update README
- [ ] `npm run build && npm publish` as tokenclaw@0.2.0
  Verify: `npx tokenclaw proxy --help`
