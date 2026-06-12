# ABUZ8 OS — Agent Roles

11 predefined executive personas. Each is a **system prompt** + a recommended real toolset. Selecting a role in Chat (or passing `role` to `/api/chat`) threads its system prompt into the brain and any provider. Defined in `AGENT_ROLES` in `portable-core.js`.

The five executive/growth roles were distilled from the migrated Hermes **operator-mode** and **x-growth-monetization** playbooks (see `skills/x-growth-monetization/`).

| Role id | Name | What it's for | Key tools |
|---|---|---|---|
| `orchestrator` | Orchestrator | Executive coordinator — plans, routes, delegates | web_search, cmd_run, file_write, open_app, screenshot, memory, mission_board |
| `research-analyst` | Research Analyst | Live web research + source synthesis | web_search, open_url, memory_write |
| `systems-engineer` | Systems Engineer | Inspects host, runs CLIs, drives MCP | cmd_run, shell_run, cli_probe, web_search |
| `desktop-operator` | Desktop Operator | Native desktop actions | open_app, open_url, screenshot, file_write, cmd_run |
| `automation-builder` | Automation Builder | Creates tools, wires connectors | tool_create, cli_probe, web_search |
| `knowledge-keeper` | Knowledge Keeper | Local memory read/write/search | memory_write, memory_search |
| `ceo-operator` | CEO / Operator | Runs the company in Operator Mode — revenue-first, no permission theater | mission_board, mission_task_create, swarm_run, web_search, cmd_run |
| `seo-strategist` | SEO Strategist | Keyword strategy, content architecture, on-page/technical SEO | web_search, content_generate, memory_write |
| `x-growth-operator` | X Growth Operator | Audience growth + monetization; 25-problems protocol | content_generate, x_post, web_search, mission_task_create |
| `content-producer` | Content Producer | NotebookLM-style synthesis → scripts/threads/carousels | content_generate, web_search, file_write |
| `swarm-orchestrator` | Swarm Orchestrator | Decomposes a goal, runs a swarm to completion | swarm_run, mission_task_create, cmd_run, web_search |

## Operator Mode (CEO role) — the migrated rules

1. **Revenue first** — judge every task by whether it moves money or builds a revenue asset.
2. **No permission theater** — once direction is clear, execute; don't ask "shall I continue?" each step.
3. **Massive action bias** — ship the whole plan (e.g. a 7-day calendar), not one item at a time.
4. **Multi-agent output** — produce parallel deliverables together.
5. **Fact-check** specs/pricing before publishing.

## X Growth Operator — the signature protocol

Publicly solve **25 of the hardest problems in the niche per week**, each with your signature. Cadence: 3× daily (carousel + thread + tweet). Carousel = 10 slides (Hook → Problem → Why it matters → Mental model → Steps → Proof → TL;DR → CTA). Engage every reply, weekly AMA, track impressions → iterate. Revenue: ad share, digital products, affiliates, sponsorships. `POST /api/growth/seed` writes this as real Kanban tasks.

## Swarm

`POST /api/swarm/run {task, roles[]}` runs each role through the reply ladder, then a synthesis agent reconciles them. Topology: orchestrator → workers → verifier → synthesis.
