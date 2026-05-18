# Agent Cost Control — Decisions

## Static vs Framework
**Decision:** Static HTML/CSS/JS
**Why:** Fastest to ship, no build step, deploys anywhere, here.now is static hosting. Framework adds complexity for a product demo.
**Rejected:** React (build step, overkill), Vue (same), Next.js (SSR unnecessary)

## Dark vs Light theme
**Decision:** Dark
**Why:** Dashboard products (Datadog, Grafana, Linear) use dark themes. Data visualization pops on dark backgrounds. Target audience (DevOps/platform engineers) expects dark.

## Chart library
**Decision:** Chart.js via CDN
**Why:** Lightweight, well-documented, renders to canvas, good dark theme support. No build step needed.
**Rejected:** D3 (too low-level), Recharts (React-only), ApexCharts (heavier)

## Page structure
**Decision:** Multi-page HTML (not SPA)
**Why:** Simpler routing, each page is self-contained, better for static deploy, easier to swarm-build in parallel.
