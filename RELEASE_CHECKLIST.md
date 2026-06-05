# ABUZ8 OS Release Checklist

## Clean-Machine Core

- [x] Launch portable EXE from an isolated temp data folder.
- [x] `GET http://127.0.0.1:8900/health` returns `ok: true`.
- [x] Chat returns through the packaged LFM brain with `fallback: false`.
- [x] Lite portable answers with `brain: LFM2.5 350M Lite`.
- [x] Standard portable answers with `brain: LFM2 1.2B Tool`.
- [x] Pro portable answers with `brain: LFM2 2.6B Pro`.
- [x] App creates product-owned folders for memory, MCP, skills, logs, models, workspaces, cache, exports, and config.
- [ ] Launch installed setup build on a clean Windows VM.

## UI Contract

- [x] All 10 views fit at 1920x1080 in the dist renderer pass.
- [x] HUD shows all widgets without vertical overflow.
- [x] Chat shows Portable Core online by default.
- [x] Migration view includes Claude/Docker MCP, Hugging Face model shelf, and CLI bridge controls.
- [x] Work dashboard includes persisted mission/Kanban board with create and move controls.
- [x] Work dashboard includes live Tool Control panel backed by `/api/tools/call`.
- [x] Work dashboard links bundled Master Portfolio and Mission Control v3 dashboards.
- [x] Chat includes active embedded brain selector and direct `/probe`, `/tools`, `/tool ...` commands.
- [x] External brains are marked optional unless their local service is detected.
- [x] Creator/avatar actions fall back to browser preview when no GPU renderer exists.
- [ ] Final manual walkthrough on a clean VM after code signing.

## Connectors

- [x] Claude Desktop MCP import works when `%APPDATA%\Claude\claude_desktop_config.json` exists.
- [x] ABUZ8 OS installs itself into Claude Desktop as `abuz8_os` MCP symbiote.
- [x] Claude MCP bridge uses persisted bundled `node.exe` plus bridge script; no external Node install required.
- [x] Docker MCP import reports a clear missing-tool message when Docker Desktop MCP Toolkit is absent.
- [x] Catalog MCP install writes disabled connector definitions to the app MCP config.
- [x] CLI probe/register endpoints require explicit `allow_cli: true`.
- [x] Hugging Face download endpoint requires explicit `allow_network_download: true`.
- [x] OAuth token exchange requires explicit `allow_oauth_store: true`.
- [x] Claude MCP bridge exposes chat, device probe, brains list, brain select, memory write, tools list, tool create, tool call, mission board, mission task create, and mission task move.
- [x] Action tools are blocked by default behind one session-only Allow actions consent.
- [x] Action tool allowlists are enforced: `open_app` permits only notepad, mspaint, calc, explorer; `shell_run` permits only whoami, hostname, dir.
- [x] `file_write` is sandboxed to the portable data directory and blocks path escape.
- [x] No credentials are bundled.

## Packaging

- [x] `npm run build` creates NSIS installer and portable EXE.
- [x] `npm run build:variants` creates Lite, Standard, and Pro setup/portable artifacts.
- [x] `npm run verify:release` verifies all portable editions, permission gates, brain selection, generic tool call, mission board, local tool creation/listing, Pro Claude MCP bridge, and real action-tool side effects with cleanup.
- [x] `electron/out/variants/SHA256SUMS.json` is generated.
- [x] Package includes `portable-core.js`, `backends.js`, embedded brain runtime, and MCP bridge runtime.
- [x] Package excludes renderer backup files.
- [x] README explains USB launch, installed launch, optional connectors, model tiers, and the agent-framework integration lane.
- [ ] Code signing certificate installed and configured.
- [ ] Clean Windows VM setup installers tested interactively.
