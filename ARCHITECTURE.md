# ABUZ8 OS — Architecture

This document describes every component, port, file path, and request flow of the running system, so it can be understood and reproduced exactly.

---

## 1. Process model

ABUZ8 OS is an **Electron** desktop application. On launch:

1. **`main.js`** (Electron main process) creates the `BrowserWindow`, loads `renderer/index.html`, and starts two in-process subsystems:
   - **`portable-core.js`** — the bundled local HTTP API ("Portable Core").
   - **`backends.js`** — optional connector probes (non-blocking).
2. **Portable Core** binds `http://127.0.0.1:8900`. It is the single source of truth the UI, the MCP bridge, and Claude Desktop all talk to.
3. On first chat, Portable Core spawns **`llama-server.exe`** (bundled `llama.cpp`) on `http://127.0.0.1:8902` with the selected GGUF model.

```
┌─────────────────────────────────────────────────────────────┐
│ Electron main (main.js)                                      │
│   • BrowserWindow → renderer/index.html (dashboard UI)       │
│   • portableCore.start()  ── HTTP ──► 127.0.0.1:8900         │
│   • backends.startAll()   (optional probes, never required)  │
└─────────────────────────────────────────────────────────────┘
            │                                   ▲
            │ spawn (on first chat)             │ HTTP (fetch)
            ▼                                   │
   llama-server.exe :8902  ◄── /completion ──  portable-core.js
   (LFM2 GGUF brain)                            │
                                                │ stdio JSON-RPC
                                       ┌────────┴─────────┐
                                       │ MCP servers       │  (fetch, filesystem,
                                       │ (spawned clients) │   memory, git, time…)
                                       └───────────────────┘

   Claude Desktop ──stdio──► mcp/abuz8-mcp-stdio.js ──HTTP──► 127.0.0.1:8900
   (the "symbiote": Claude calls ABUZ8 tools)
```

---

## 2. Ports

| Port | Owner | Purpose |
|---|---|---|
| `8900` | Portable Core (`portable-core.js`) | Main HTTP API — chat, tools, MCP, scan, swarm, content, bridge |
| `8902` | `llama-server.exe` | Embedded LFM2 brain (OpenAI-ish `/completion` + `/v1/completions`) |
| `1234` | LM Studio (optional, external) | OpenAI-compatible local models |
| `11434` | Ollama (optional, external) | Local models |
| `8188` | ComfyUI (optional, external) | Image/video |
| `9119` / `18789` / `8910` | Hermes / OpenClaw / Mission (optional, external) | Sibling agents if running |

Override the core port with env `ABUZ8_PORT`; the brain port with `ABUZ8_LFM_PORT`.

---

## 3. Data root

All mutable state lives under **`%APPDATA%\abuz8-os\`** (i.e. `C:\Users\<you>\AppData\Roaming\abuz8-os`). Resolved by `resolveDataRoot()` — honors `ABUZ8_DATA_DIR`, then `PORTABLE_EXECUTABLE_DIR` (USB/portable mode), then Electron `userData`.

```
abuz8-os/
  config/
    runtime.json        Brain tiers, selected brain, backend port
    providers.json      Model providers (OpenRouter / LM Studio / Ollama)
    settings.json       App settings (consent default, tokens)
    cloud-brains/       Registered cloud brain endpoints
  mcp/
    mcp_servers.json    MCP server catalog (command/args/env/enabled)
    abuz8-claude-bridge/  Self-installed copy of the symbiote + node.exe
  memory/events.jsonl   Append-only memory log
  skills/               Migrated skill packs (markdown + json)
  mission/board.json    Kanban board
  exports/content/      Generated content (carousels, scripts…)
  logs/                 tool-calls.jsonl, action-consent.jsonl
  models/               User-downloaded GGUFs (Hugging Face shelf)
```

Binary assets ship **inside the install** (not the data root): `resources/brain/` (llama.cpp + 3 GGUF models) and `resources/mcp/` (node.exe + symbiote).

---

## 4. Component reference

### 4.1 `main.js` (Electron main)
- Creates the window (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
- Starts Portable Core and optional backends; wires IPC (`abuz8:platform`, `abuz8:backends`).
- **Audit note:** an earlier `installOptionalProbeGuard()` redirect that blackholed all optional connector ports was removed — it broke every external connection. The function is now a no-op with an explanatory comment.

### 4.2 `portable-core.js` (the core — ~2500 lines)
The HTTP server (`route()`), brain manager, MCP client, and all feature modules. Key sections:

- **Brain manager** — `availableEmbeddedBrains()`, `selectEmbeddedBrain()`, `ensureEmbeddedBrain()` (spawns `llama-server.exe`), `lfmHealthy()` (requires HTTP **200**, not 503-while-loading), `waitForLfm()` (up to 150 s cold-load), `embeddedReply()`.
- **Reply ladder** — `reasonReply()`: forced provider → embedded brain → any enabled provider → canned core text. Threads an agent **role system prompt** through to the brain and providers.
- **Agent roles** — `AGENT_ROLES` (11 personas) + `resolveRoleSystem()`.
- **Tools** — `localToolsList()`, `callLocalTool()`; action tools (`open_url`, `open_app`, `screenshot`, `file_write`, `shell_run`, `cmd_run`, `web_search`) gated by `actionConsentGranted`.
- **System scan** — `systemScan()`: `scanListeningPorts()` (netstat parse) + `mapPidsToNames()` (tasklist) + `discoverClis()` (CLI_CATALOG probes) + `APP_ENDPOINTS`.
- **MCP client** — `ensureMcpClient()`, `mcpRequest()`, `mcpListTools()`, `mcpCallTool()`: real JSON-RPC over stdio (initialize → tools/list → tools/call).
- **Swarm** — `runSwarm()`: runs each role via `reasonReply`, then a synthesis pass.
- **Content** — `generateContent()` with `CONTENT_FORMATS` (carousel/thread/youtube/blog/notebook).
- **X** — `xPost()` via X API v2 (token-gated, honest failure).
- **Growth** — `seedGrowthBoard()` (25-problems protocol + 7-day cadence onto the mission board).
- **Bridge** — `bridgeStatus()`, `reinstateBridge()`, auto self-heal in `start()`.
- **Providers** — `callProviderChat()` (OpenAI-compatible, system message support, error throwing).

### 4.3 `backends.js`
Optional connector probes (Ollama, LM Studio, ComfyUI, docker-mcp). Reports availability; never required for launch. Adopts services, never spawns them.

### 4.4 `renderer/index.html` (dashboard, single file)
- **Shell:** fixed 100vh grid (top bar + sidebar + main), internal-scroll panels.
- **Theme system:** `THEMES` map of 7 palettes applied via CSS variables, persisted in `localStorage`.
- **Views:** Chat, Agents, Swarm, Kanban, System Map, Growth & Content, Tools, MCP Servers, Skills, Memory, Claude Bridge, Settings — each wired to real `:8900` endpoints.
- **Chat:** role + model pickers, consent toggle, agentic fallback ladder, cold-load "brain warming up" state.

### 4.5 `mcp/abuz8-mcp-stdio.js` (the symbiote)
A stdio MCP server registered in Claude Desktop's `claude_desktop_config.json`. Implements `initialize`, `tools/list`, `tools/call` and proxies each tool to a Portable Core HTTP endpoint. Lets Claude Desktop drive ABUZ8.

---

## 5. Request flows

**Chat (offline):** UI `POST /api/chat {content, role, provider}` → `reasonReply` → `embeddedReply` → `ensureEmbeddedBrain` spawns/uses `llama-server.exe` → `POST :8902/completion` → response labeled with the real brain name.

**Tool call:** UI `POST /api/tools/call {tool, args}` → `callLocalTool` → consent check → action runs (e.g. `cmd_run` → `cmd.exe /c <command>`).

**MCP tool:** UI `POST /api/mcp/call {server, tool, args}` → `ensureMcpClient` spawns the server, initializes, → `mcpRequest('tools/call')` → result.

**Swarm:** UI `POST /api/swarm/run {task, roles}` → `runSwarm` loops `reasonReply` per role → synthesis pass → `{agents[], synthesis}`.

**Two-way bridge:** Claude Desktop → `abuz8-mcp-stdio.js` → `:8900` (inbound). On startup `reinstateBridge()` re-writes the symbiote into Claude's config and imports Claude's other MCP servers into ABUZ8's own catalog (outbound shared fleet).

---

## 6. Security model

- Local-only binding (`127.0.0.1`); no inbound network surface.
- Action tools (shell, file write, app launch, screenshot, `cmd_run`) are **off by default** and require a per-session **Allow actions** consent (`/api/actions/consent`), logged to `logs/action-consent.jsonl`.
- `file_write` is sandboxed to the data root; `shell_run` is an allowlist (`whoami/hostname/dir`); `cmd_run` is full power but consent-gated.
- API keys live only in `config/` on the local disk; nothing is transmitted except to the provider you configure.
