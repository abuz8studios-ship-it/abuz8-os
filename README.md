# ABUZ8 OS Consumer Pro - Offline-First AI Agent

ABUZ8 OS Consumer Pro is a self-contained Windows agent desktop with one local
brain bundled inside: `LFM2-2.6B-Exp-Q4_K_M.gguf`.

It is designed to run from the buyer's own desktop, laptop, workstation, or USB
drive without a home server. Local chat, memory, mission control, device probe,
and the core tool dispatcher run on the user's machine.

## What Is Bundled

- Consumer Pro portable EXE and setup installer
- Local Portable Core API on `127.0.0.1:8900`
- Embedded llama.cpp/LFM brain on `127.0.0.1:8902`
- One embedded model: `LFM2-2.6B-Exp-Q4_K_M.gguf`
- Local memory and mission/Kanban board
- Native Windows TTS endpoint (`/api/tts`) using the bundled local API and the
  buyer's installed Windows voices
- Streaming chat speech: responses are spoken sentence-by-sentence through
  native TTS with browser TTS fallback
- Browser microphone/STT controls for supported Chromium/Edge environments
- MCP bridge for Claude Desktop
- Docker Desktop MCP import when Docker exposes `docker mcp`
- Model download plumbing for user-approved local GGUF downloads
- Cloud brain registration for user-owned or subscription-backed providers

Lite and Standard GGUF models are not included in the Consumer Pro package.

## Privacy And Local Data

The release does not ship with developer machine memory, private workspace data,
portfolio dashboards, customer records, keys, tokens, or local file paths.

On first run, ABUZ8 OS creates fresh product-owned folders on the machine where
it is running. Memory, mission tasks, logs, model downloads, connector records,
OAuth tokens, and cloud brain settings are stored locally only after user action
or explicit consent.

The device probe reads the current machine's CPU, RAM, GPU, storage, Docker,
Docker MCP, Node, Python, Ollama, and local readiness state. It does not depend
on the original build machine.

## Offline Mode

The bundled 2.6B local brain works without internet, an API key, or a cloud
subscription. No home server is required.

Optional cloud brains, hosted model providers, OAuth connectors, and paid APIs
require user-owned credentials or an active subscription from the relevant
provider. ABUZ8 OS supplies the local plumbing and storage; it does not bypass
provider authentication or payment.

## Action Tools

The Work view includes a Tool Control panel backed by `POST /api/tools/call`.
The built-in real-action tools are blocked until the user grants one
session-only **Allow actions** consent:

- `open_url`
- `open_app`
- `screenshot`
- `file_write`
- `shell_run`

`open_app` is allowlisted to notepad, mspaint, calc, and explorer. `shell_run`
is allowlisted to whoami, hostname, and dir. `file_write` cannot write outside
the ABUZ8 portable data sandbox.

Chat also has an agentic middle layer: plain-language requests can trigger
permission-gated tool calls through the same dispatcher.

## Model Extensibility

Portable Core includes local endpoints for:

- `POST /api/models/huggingface/download`
- `GET /api/models/list`
- `POST /api/cloud-brains/register`
- `POST /api/cli/probe`
- `POST /api/cli/register`
- `POST /api/oauth/exchange`

Downloaded GGUF files under the local ABUZ8 data folder become selectable local
brains. Cloud brain records are stored locally and may reference user-owned
environment variables, OAuth tokens, or subscription credentials.

## Verification

The release verifier launches the Consumer Pro 2.6B portable from an isolated
data folder and checks:

- local core health
- embedded 2.6B brain with `fallback:false`
- exactly one embedded GGUF model
- device probe from the current machine
- local memory and mission board
- native Windows TTS returning WAV audio
- Claude Desktop MCP bridge
- tool dispatcher consent gates
- action tools by observed OS side effects
- cleanup after verification

Native offline STT is not bundled in this package yet. Full offline STT should
be added with a packaged recognizer such as Whisper before advertising
"offline native STT."

## Contact

ABUZ8 LLC - support@abuz8ai.com
