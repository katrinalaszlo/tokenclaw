# agentcap — Progress

## Session: 2026-05-18 (v0.1.0)

### Completed
- Redesigned site (landing + dashboard + alerts) with DESIGN.md tokens
- Removed enterprise mockup pages (agents.html, budgets.html)
- Applied Geist fonts, zinc palette, correct color tokens
- Dashboard scoped to v1 reality: scan results + alerts + trends
- Added interactive chart with time range (7d/30d/90d) + tool filter + burn rate line
- All dollar amounts marked as estimated (~$) since they're token-based estimates
- Install section with copy buttons, 9 supported tools listed
- GitHub + npm links throughout
- Renamed to agentcap, published to npm as agentcap@0.1.0
- Created GitHub repo katrinalaszlo/agent-spend
- Enabled GitHub Pages at katrinalaszlo.github.io/agent-spend
- Updated gap-analysis.md with market-level gaps section
- Moved site/ to docs/ for GitHub Pages, research docs to research/

## Session: 2026-05-18 (v0.2.0 — per-key proxy)

### New files
- `src/pricing.ts` — shared model pricing + cost estimation
- `src/proxy/parse.ts` — SSE/JSON parsers, key matching, budget windows (pure, testable)
- `src/proxy/server.ts` — HTTP proxy server
- `test/proxy-parse.test.ts` — 24 unit tests

### Modified files
- `src/config.ts` — added KeyBudget type, key_budgets to AccConfig, parseBudgetString()
- `src/db.ts` — added proxy_requests table, insertProxyRequest, getSpendByKeyPrefix, getKeyBreakdown
- `src/scanners/local.ts` — imports pricing from shared module (removed duplicate)
- `src/cli.ts` — added set/keys/proxy commands, updated name to "agentcap", version to 0.2.0
- `package.json` — version 0.2.0, added test script, updated description/keywords

### Verified
- `npm run build` passes clean
- `npm test` — 24/24 tests pass
- `agentcap set --key X --budget Y/period` persists to config
- `agentcap keys` reads budget + spend correctly
- `agentcap proxy` starts, forwards to Anthropic, returns 401/429 correctly
- Budget blocking: returns 429 with clear error message naming the CLI fix command
- Unregistered keys: forward with no limit, spend tracked

### Remaining before publish
- E2E test with real Anthropic key (streaming token parsing — the production path)
- Landing page update with proxy messaging
- README update
- npm publish agentcap@0.2.0
