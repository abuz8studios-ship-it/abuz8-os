# ABUZ8 OS v1.0.0 - Offline-First Agent Desktop

ABUZ8 OS is a local-first Windows agent desktop with an embedded LFM brain,
automatic device probe, Claude Desktop MCP symbiote bridge, Docker MCP import,
Hugging Face model download plumbing, CLI connector registration, a local mission
Kanban dashboard, and no required API subscription for local chat.

## Downloads

Choose one edition:

- `ABUZ8_OS-1.0.0-lite-portable.exe` - smallest portable build, includes `LFM2.5 350M Lite`
- `ABUZ8_OS-1.0.0-lite-setup.exe` - installer edition of Lite
- `ABUZ8_OS-1.0.0-standard-portable.exe` - balanced portable build, includes `LFM2 1.2B Tool`
- `ABUZ8_OS-1.0.0-standard-setup.exe` - installer edition of Standard
- `ABUZ8_OS-1.0.0-pro-portable.exe` - strongest portable build, includes `LFM2 2.6B Pro`
- `ABUZ8_OS-1.0.0-pro-setup.exe` - installer edition of Pro
- `SHA256SUMS.json` - artifact hashes

Artifacts are generated in:

```text
electron/out/variants
```

## What Works Offline

- Local Portable Core API on `127.0.0.1:8900`
- Embedded llama.cpp/LFM brain on `127.0.0.1:8902`
- Chat with `fallback:false` on all three editions
- Memory write/recent endpoints
- Automatic device probe for CPU, RAM, GPU, storage, Docker, Docker MCP, Node, Python, and Ollama
- Local model shelf listing embedded and downloaded files
- Local mission/Kanban board with persisted task create/move endpoints

## Claude Desktop MCP Symbiote

The Migration view can install ABUZ8 OS into Claude Desktop as `abuz8_os`.
The bridge exposes these tools:

- `abuz8_chat`
- `abuz8_device_probe`
- `abuz8_brains_list`
- `abuz8_brain_select`
- `abuz8_memory_write`
- `abuz8_tools_list`
- `abuz8_tool_create`
- `abuz8_tool_call`
- `abuz8_mission_board`
- `abuz8_mission_task_create`
- `abuz8_mission_task_move`

The bridge persists a bundled `node.exe` and MCP stdio script into the ABUZ8 data
folder, so Claude Desktop does not need a separate Node installation.

## Connector Plumbing

- Import existing Claude Desktop `mcpServers`
- Import Docker Desktop MCP gateway when available
- Register any local CLI command after explicit permission
- Execute built-in and registered local tools through `/api/tools/call`
- Execute five real-action tools after one session-only Allow actions consent:
  `open_url`, `open_app`, `screenshot`, `file_write`, and `shell_run`
- Switch embedded Lite/Standard/Pro brains through the UI, API, or Claude MCP
- Download Hugging Face model files after explicit permission
- Exchange OAuth authorization codes after explicit user consent and store tokens locally

Provider subscriptions, paid accounts, and private tokens are never bundled and
must be supplied by the user/provider flow.

## Verified

Run from `electron/`:

```powershell
npm run build:variants
npm run verify:release
```

Latest verifier pass:

```text
Lite      -> LFM2.5 350M Lite -> fallback:false
Standard  -> LFM2 1.2B Tool   -> fallback:false
Pro       -> LFM2 2.6B Pro    -> fallback:false
```

The verifier also checks device probe, CLI permission gate, CLI probe/register,
model listing, mission board create/move, local tool creation/listing, the Pro
Claude Desktop MCP bridge, and an `ActionTools` proof block per variant. Action
tools pass only when the OS side effect is observed and cleaned up: browser
process, mspaint process, screenshot PNG, exact sandbox file write, hostname
stdout, denied shell command, and blocked sandbox escape.

## Known Pre-Release Blockers

- Code signing certificate is not configured.
- Setup installers still need a clean Windows VM interactive install/uninstall pass.
- Paid/cloud connectors require user-owned OAuth tokens or subscriptions.
- Full parity with large hosted agent systems still needs deeper graph runtime,
  trace viewer, and sandboxed coding workspace.
