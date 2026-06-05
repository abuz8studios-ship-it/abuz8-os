# Qadir OS - Offline-First AI Agent

Your own AI agent that runs entirely on your machine, with its own brain built in.
No internet required. No API keys. No monthly fees. Your data never leaves your computer.

## What it is
Qadir OS is a self-contained agent operating system by ABUZ8 LLC. It ships with a local
AI brain (Liquid AI LFM2) embedded inside, and automatically runs the strongest model
your hardware can handle. Download, double-click, and it works - even offline.

## Quick start
1. Run the installer (or the portable .exe).
2. The brain is already inside - nothing else to install.
3. Start chatting. Turn your internet off and it still answers.

## Embedded brain editions
ABUZ8 OS ships as three offline-first Windows downloads. Each edition includes
llama.cpp and one embedded LFM GGUF model, so chat and local planning work without
an API key, subscription, or internet connection.

- Lite: `LFM2.5 350M Lite`, smallest download for weak laptops and USB demos.
- Standard: `LFM2 1.2B Tool`, balanced offline tool brain for everyday work.
- Pro: `LFM2 2.6B Pro`, strongest bundled reasoning brain.

## Device probe
On first run, ABUZ8 OS probes the local machine and explains what is ready:
embedded brain, CPU/RAM/GPU, local storage, Docker MCP, Ollama, Node, Python,
and fallback modes for rendering/avatar work.

## Claude Desktop MCP symbiote
The Migration view can do two-way MCP setup:

- import existing Claude Desktop `mcpServers` into ABUZ8 OS local MCP config
- import Docker Desktop MCP when Docker exposes `docker mcp`
- install ABUZ8 OS back into Claude Desktop as the `abuz8_os` MCP server

The Claude bridge is copied into the ABUZ8 data folder with its own bundled
`node.exe`, so Claude Desktop does not need a separate Node install. The bridge
exposes `abuz8_chat`, `abuz8_device_probe`, `abuz8_brains_list`,
`abuz8_brain_select`, `abuz8_memory_write`, `abuz8_tools_list`,
`abuz8_tool_create`, `abuz8_tool_call`, `abuz8_mission_board`,
`abuz8_mission_task_create`, and `abuz8_mission_task_move`.

## Mission dashboard
The Work view includes a local mission/Kanban board for launch execution. It is
stored in the ABUZ8 data folder and works offline. ABUZ8 OS and Claude Desktop
can both read the board, create tasks, and move tasks between Backlog, Ready,
Doing, Verify, and Done.

Claude can also create local ABUZ8 tool definitions through `abuz8_tool_create`.
Those definitions are metadata until the user intentionally wires a permissioned
CLI, API, MCP server, or workflow behind them.

The Work view includes a live Tool Control panel backed by `POST
/api/tools/call`. It can execute built-in tools, registered metadata tools, and
permission-gated CLI tools. It also includes five real-action tools, all blocked
until the user grants one session-only **Allow actions** consent:
`open_url`, `open_app`, `screenshot`, `file_write`, and `shell_run`.
`open_app` is allowlisted to notepad, mspaint, calc, and explorer. `shell_run`
is allowlisted to whoami, hostname, and dir. `file_write` cannot write outside
the ABUZ8 portable data sandbox. Chat also supports direct commands such as
`/probe`, `/tools`, and `/tool abuz8_device_probe {}`.

The bundled renderer includes the Master Portfolio and Mission Control v3
dashboards under `renderer/specs/`, linked from the Work view.

## Model and CLI extensibility
Portable Core includes local endpoints for:

- `POST /api/models/huggingface/download` to download a Hugging Face model file
  into the local `models/huggingface` folder
- `GET /api/models/list` to show embedded and downloaded local models
- `POST /api/cli/probe` to test a local CLI command
- `POST /api/cli/register` to save a CLI connector/auth command record
- `POST /api/oauth/exchange` for OAuth authorization-code/PKCE token exchange

Human consent, paid subscriptions, and provider tokens are still required by the
providers themselves. ABUZ8 OS supplies the local plumbing and storage; it does
not bypass provider authentication.

The Migration view exposes these as buttons with explicit permission checks:
model downloads require `allow_network_download`, CLI execution requires
`allow_cli`, and OAuth token storage requires `allow_oauth_store`.

## Release verification
From `electron/`:

```powershell
npm run build:variants
npm run verify:release
```

`verify:release` launches Lite, Standard, and Pro portables from isolated data
folders, checks `/health`, `/api/device/probe`, embedded brain chat with
`fallback:false`, CLI permission gates, CLI probe/register, model listing,
mission-board create/move, local tool creation/listing, and the Pro Claude
Desktop MCP bridge. It also verifies the generic tool dispatcher and brain
selection API. The verifier records an `ActionTools` block per variant and only
passes action tools when OS-level side effects are observed: a new browser
process, a new mspaint process, a recent non-empty screenshot PNG, exact file
content, hostname stdout, blocked denied shell command, and cleanup.

## What you are paying for
The open-source components are free, and always will be. What ABUZ8 provides - and what
your purchase supports - is the engineering: bundling everything into a one-click,
offline-ready system so you skip Docker, WSL, PowerShell, and hours of setup. You get a
deployable agent in under 15 minutes instead of a weekend of configuration.

## Credits and licenses
We build on open-source and we name what we build on.
- CREDITS.md - the projects and people behind this.
- THIRD_PARTY_NOTICES.txt - full list of all 340 bundled packages and their licenses.
- EULA_COMMERCIAL.txt - your license to use this product.

## Contact
ABUZ8 LLC - ahmad@abuz8ai.com
