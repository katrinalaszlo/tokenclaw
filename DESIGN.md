# Design System — [Name TBD]

## Product Context
- **What this is:** AI spend monitoring + alerting for developers. Scans local AI tools, tracks costs, sends escalating alerts that require acknowledgment.
- **Who it's for:** Individual developers and small teams using Claude Code, OpenClaw, Cursor, and other AI coding tools.
- **Space/industry:** Developer tools / FinOps
- **Project type:** CLI tool with local web dashboard
- **Memorable thing:** "Finally, someone built this."

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal. Typography and spacing do all the work.
- **Mood:** Quiet, functional, obvious. A well-organized workshop. Everything is where you'd expect it. The only visual drama comes from alert states.
- **Peers:** Linear, Vercel dashboard. NOT CostGoat (too consumer), NOT Grafana (too busy).

## Typography
- **Display/Headings:** Geist Sans. Signals "built by a developer who ships."
- **Body:** Geist Sans. Consistent family.
- **Data/Numbers:** Geist Mono. Tabular figures for costs, tokens, percentages.
- **Code:** Geist Mono.
- **Loading:** CDN via `https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css` and `https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-mono/style.css`
- **Scale:** 12px (small/labels), 14px (body), 16px (subheading), 20px (heading), 28px (page title), 36px (hero metric)

## Color
- **Approach:** Restrained. One accent + neutrals. Color is rare and meaningful.
- **Palette:** Tailwind zinc. Developers recognize it instantly.

| Token | Value | Usage |
|---|---|---|
| --bg-primary | #09090b | Page background (zinc-950) |
| --bg-surface | #18181b | Cards, panels (zinc-900) |
| --bg-hover | #27272a | Hover states (zinc-800) |
| --border | #27272a | Borders, dividers (zinc-800) |
| --border-subtle | #1c1c1f | Subtle separators |
| --text-primary | #fafafa | Primary text (zinc-50) |
| --text-secondary | #a1a1aa | Secondary text (zinc-400) |
| --text-muted | #71717a | Muted text, labels (zinc-500) |
| --accent | #22d3ee | Interactive elements, links (cyan-400) |
| --accent-dim | rgba(34, 211, 238, 0.15) | Accent backgrounds |
| --danger | #ef4444 | Alerts, errors, escalation (red-500) |
| --danger-dim | rgba(239, 68, 68, 0.15) | Alert backgrounds |
| --warning | #f59e0b | Warnings, approaching threshold (amber-500) |
| --warning-dim | rgba(245, 158, 11, 0.15) | Warning backgrounds |
| --success | #22c55e | Acknowledged, healthy (green-500) |
| --success-dim | rgba(34, 197, 94, 0.15) | Success backgrounds |

- **Dark mode:** Default and only mode. No light mode needed for v1.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable
- **Scale:** 1(4px) 2(8px) 3(12px) 4(16px) 5(20px) 6(24px) 8(32px) 10(40px) 12(48px)

## Layout
- **Approach:** Grid-disciplined
- **Structure:** Fixed sidebar (240px) + scrollable main content
- **Grid:** Single column main content with card groups
- **Max content width:** 1200px
- **Border radius:** sm(6px), md(8px), lg(12px)

## Motion
- **Approach:** Minimal-functional
- **Transitions:** 150ms ease for hover states, 200ms for panel open/close
- **The ONE expressive motion:** Alert pulse. Active unacknowledged alerts get a subtle pulsing red dot. This is the only animation in the entire product. It earns its place because it demands attention.
- **No:** entrance animations, scroll effects, loading skeletons, bouncy transitions

## Alert Visual Hierarchy
Alerts are the product's core feature. Their visual treatment is critical.

| State | Left border | Dot | Background | Text |
|---|---|---|---|---|
| Active (unacknowledged) | 3px red-500 | Pulsing red | danger-dim | Primary |
| Escalating | 3px red-500 | Pulsing red, faster | danger-dim | Primary, bold |
| Acknowledged | 3px green-500 | Static green | success-dim | Muted |
| Resolved | None | None | Surface | Muted |

## Subscription vs API Badges
| Type | Badge color | Badge text |
|---|---|---|
| Subscription | success-dim + green text | "Max $200/mo" |
| API | accent-dim + cyan text | "API" |

## Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-05-18 | Geist over Inter | Developer recognition. Signals craft. |
| 2026-05-18 | Zinc palette (Tailwind) | Battle-tested, developers trust it, no custom colors to maintain. |
| 2026-05-18 | Alert-as-drama | Only visual intensity = alerts. Quiet dashboard means alerts are unmissable. |
| 2026-05-18 | No light mode | Developer dashboards are dark. One mode = less code, more consistency. |
| 2026-05-18 | Industrial/Utilitarian over Brutalist | Brutalist feels intentionally rough. Industrial feels intentionally functional. Subtle difference, but functional > rough for a financial tool. |
