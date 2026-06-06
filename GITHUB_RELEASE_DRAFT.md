# ABUZ8 OS Consumer Pro 1.0.0 - 2.6B Offline Agent Desktop

ABUZ8 OS Consumer Pro is a local-first Windows agent desktop with one bundled
2.6B LFM brain, fresh consumer onboarding, device probe, local memory, mission
control, MCP bridge support, model download plumbing, cloud brain registration,
and permission-gated desktop tools.

## Downloads

- `ABUZ8_OS-1.0.0-consumer-pro-2.6b-portable.exe`
- `ABUZ8_OS-1.0.0-consumer-pro-2.6b-setup.exe`
- `SHA256SUMS.json`
- `release-verify.json`

## What Works Offline

- Local Portable Core API on `127.0.0.1:8900`
- Embedded llama.cpp/LFM brain on `127.0.0.1:8902`
- One embedded model: `LFM2-2.6B-Exp-Q4_K_M.gguf`
- Chat with `fallback:false`
- Memory write/recent endpoints
- Automatic device probe for the machine where the app is running
- Local mission/Kanban board with persisted task create/move endpoints
- Native Windows TTS through `/api/tts`, verified by WAV output
- Streaming chat speech through sentence-boundary native TTS with browser
  fallback
- Browser STT controls where the local Chromium/Edge speech API is available
- Claude Desktop MCP bridge files stored under the user's own ABUZ8 data folder

No home server, developer workspace, API key, internet connection, or GPU is
required for the bundled local brain.

## Privacy

The Consumer Pro build is intentionally fresh. It does not include developer
memory, private dashboards, customer records, local workspace paths, API keys,
OAuth tokens, or cloud credentials.

All memory, mission tasks, connector records, model downloads, logs, and cloud
brain registrations are created on the user's own computer after first launch.

## Optional Cloud And Subscription Brains

The bundled local 2.6B brain works without a subscription. Users can optionally:

- download additional local GGUF models after explicit permission
- register cloud model endpoints
- use provider subscriptions or OAuth credentials they own
- store provider configuration locally

Provider subscriptions, paid accounts, and private tokens are never bundled.

## Connector Plumbing

- Import existing Claude Desktop `mcpServers`
- Import Docker Desktop MCP gateway when available
- Register local CLI commands after explicit permission
- Exchange OAuth authorization codes after explicit user consent
- Execute built-in and registered local tools through `/api/tools/call`

Action tools are blocked until the user grants one session-only **Allow actions**
consent:

- `open_url`
- `open_app`
- `screenshot`
- `file_write`
- `shell_run`

## Verified

Latest verifier pass for `consumer-pro-2.6b`:

```text
AllPass: true
Brain: LFM2 2.6B Pro
Fallback: false
EmbeddedCount: 1
EmbeddedModels: LFM2-2.6B-Exp-Q4_K_M.gguf
ActionTools: true
Agentic chat-to-tool path: true
NativeTts: true
NativeStt: false
```

## Known Pre-Release Blockers

- Code signing certificate is not configured.
- Final clean offline VM rerun after the VC runtime fix is still pending because
  the current Windows Sandbox host session stopped executing logon commands.
- Setup installer still needs an interactive install/uninstall pass on a clean
  Windows VM.
- Offline native STT is not bundled yet; current STT is browser/OS speech API
  dependent.
