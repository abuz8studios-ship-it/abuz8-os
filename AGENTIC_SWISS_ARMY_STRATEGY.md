# ABUZ8 OS Agentic Swiss Army Strategy

## Product Position

ABUZ8 OS is not another agent framework. It is a local-first desktop agent OS:

- Always boots with its own embedded LFM brain.
- Explains what the current device can do.
- Imports MCP connectors from other tools.
- Routes work to local, cloud, Docker, or external agent frameworks when available.
- Keeps user data, memory, logs, and workspaces in product-owned folders.

## Who Is Ahead In Specific Lanes

| Competitor lane | What they do well | ABUZ8 migration target |
| --- | --- | --- |
| OpenAI Agents SDK / Codex | Handoffs, tools, tracing, skills, sandboxed coding/file work | Add native run traces, skill cards, patch review, and sandbox profiles |
| Microsoft Agent Framework | Enterprise orchestration, typed workflows, telemetry, Foundry deployment | Add workflow YAML, typed tasks, approval gates, and enterprise export |
| LangGraph | Durable graph state, checkpoint/resume, human-in-the-loop | Add persistent mission graph and resumable runs |
| CrewAI | Crews, flows, role templates, business automations | Add ready-made business crews: website, content, sales, CRM, support |
| Docker MCP | Secure packaged MCP catalog and gateway | Add Docker MCP import, trust labels, and isolated connector launch |
| OpenHands / coding agents | Sandboxed coding runtime, lifecycle control, evaluation | Add workspace sandbox, tests-before-apply, and code mission mode |
| Desktop Commander / Manus-style UX | Device probing, action clarity, desktop/files/tool ergonomics | Keep first-run probe, explicit permissions, and one-screen capability summary |

## Feature Migration Plan

1. Local Brain Router

Status: implemented.

- Lite: LFM2.5 350M.
- Standard: LFM2 1.2B Tool.
- Pro: LFM2 2.6B.
- Runtime: llama.cpp, CPU-safe by default.
- API: `/api/device/probe`, `/api/brains/list`, `/api/chat`.

2. Universal Connector Registry

Status: partially implemented.

- Import Claude Desktop MCP.
- Import Docker Desktop MCP when available.
- Keep imported connectors disabled by default.
- Next: add trust levels, secrets audit, and connector test buttons.

3. Mission Graph

Status: next build.

- Store tasks as nodes.
- Record tool calls and outputs as edges.
- Support pause/resume and human approval checkpoints.
- Export traces for review.

4. Business Crew Templates

Status: next build.

- Website Builder crew.
- Social Media crew.
- CRM/Sales crew.
- Local Files/Research crew.
- Creative Studio crew.

5. Desktop Control With Permissions

Status: planned.

- File read/write permission scopes.
- Shell command approval gate.
- Browser automation mode.
- Screenshot/vision mode.
- No destructive action without confirmation.

6. Enterprise Readiness

Status: planned.

- Code signing.
- Security review.
- Audit logs.
- Permission ledger.
- GitHub-ready repository structure.
- Reproducible build script and hashes.

## Non-Negotiable Promise

The app must always have a useful local brain. Optional frameworks can improve it, but they cannot be required for first launch.
