# ABUZ8 OS — Sovereign Local-First AI Agent

**ABUZ8 OS** is a self-contained desktop AI operating system that runs on *your*
hardware. It probes your machine, adopts whatever GPU and local model runners it
finds, talks and listens in real time, controls your desktop through MCP, and
reaches your phone — all local-first, no mandatory cloud, no API key required to
start.

Built by **ABUZ8 LLC**. Windows is the reference build today; Linux and macOS
images build from the same source through CI (see *Cross-Platform*).

> **Truth-status legend** — every capability below is tagged:
> `LIVE` = working and verified · `EARLY ACCESS` = working, rough edges ·
> `ROADMAP` = designed, not yet shipped. We do not ship fake features.

---

## Capabilities

### Brain & hardware
- **`LIVE` Self-probe ("Pegasus")** — detects CPU, RAM, every NVIDIA GPU, total
  VRAM, CUDA readiness, disk, Docker, Node, Python, and open local ports on boot.
- **`LIVE` Auto-GPU brain** — if a CUDA GPU is present, the OS adopts the best
  available local model automatically (verified on dual RTX 5090 / 64 GB VRAM,
  running `nemotron3:33b`). Falls back to a bundled CPU brain on machines with no
  GPU.
- **`LIVE` Universal model selection** — enumerates and routes to live models
  from **Ollama, LM Studio, vLLM, and llama.cpp** (`/v1/models`, `/api/tags`),
  plus a curated downloadable GGUF catalog sized to your RAM/VRAM.

### Voice (Felix-grade)
- **`LIVE` Native streaming voice loop** — **Whisper large-v3** speech-to-text
  and **Kokoro-82M** text-to-speech, both resident on GPU through a local
  sidecar. Measured warm latency: ~110 ms TTS, ~440 ms STT.
- **`LIVE` Live Talk** — hands-free, endless conversation: the OS listens
  (browser-side voice-activity detection), transcribes, thinks, speaks the reply
  in a natural neural voice (`bm_fable` default), then listens again.
- **`LIVE` Graceful ladder** — GPU sidecar → Piper → Windows SAPI → browser
  speech, so voice still works on a laptop with no GPU.

### Desktop & tool control
- **`LIVE` Full OS + mouse control via MCP** — the agent drives any registered
  MCP server through one consent-gated `mcp_call` tool. Verified two-way with
  **Desktop Commander** (files, terminal, processes) and **Windows-MCP** (mouse
  click/move, keyboard, screenshots, clipboard, registry, UI automation).
- **`LIVE` MCP mesh auto-import** — on launch, imports MCP servers from **Claude
  Desktop**, **Claude Desktop Extensions**, and **Antigravity** into one config.
- **`LIVE` Consent gate** — every real-world action is blocked until the user
  flips one session-scoped **Allow actions** switch.

### Reach
- **`LIVE` Telegram bridge** — two-way chat with the OS from your phone.
- **`LIVE` Mobile PWA** — installable web app served by the OS for phone use on
  your LAN.
- **`EARLY ACCESS` Own phone number (Twilio)** — two-way SMS through a real
  carrier number you provision; the OS answers inbound texts with the brain.
  *(Requires your own Twilio account + number. There is no "software IMEI" —
  a real number from a carrier/VoIP provider is the honest, legal way.)*
- **`EARLY ACCESS` Internet tunnel** — optional Cloudflare tunnel exposes the
  mobile app over the internet. **Off by default** — it puts an OS-control
  surface online, so enable it deliberately and treat the URL as a secret.

### Interface
- **`LIVE` Living Superman theme** — four shades (Man of Steel, Krypton Blue,
  Cape Red, Solar Flare) with a slow-drifting tricolor aura. Plus 9 other themes.
- **`LIVE` Local memory + mission/Kanban board** — stored on your machine only.

---

## Quick start

**Windows (one-click):** download the latest release, run `Abuz8Fable.exe`. It
self-extracts and launches; the UI opens on `127.0.0.1:8900`.

**From source:**
```bash
cd electron
npm install
npm start
```
The native GPU voice sidecar (Whisper + Kokoro) needs Python 3.11 with
`transformers`, `torch` (CUDA), `kokoro`, and `soundfile`. Without it, voice
falls back to Piper/Windows/browser automatically.

---

## Privacy & local-first

No developer data ships in the release. On first run the OS creates fresh,
product-owned folders for memory, logs, model downloads, and connector records.
Cloud brains, OAuth connectors, Twilio, and tunnels are **opt-in** and only
store credentials locally after you provide them. The OS never bypasses any
provider's authentication or payment.

---

## Cross-platform

The reference build is Windows x64. The same Electron source targets Linux
(`AppImage`/`deb`) and macOS (`dmg`) through `electron-builder`; a CI matrix
(`.github/workflows/build.yml`) produces all three from a tagged commit. GPU
voice and CUDA features require an NVIDIA GPU on the host regardless of OS.

---

## License & contact

Proprietary — © 2026 ABUZ8 LLC. See `LICENSE.txt` / `EULA_COMMERCIAL.txt`.
Bundled third-party components retain their own licenses (`THIRD_PARTY_NOTICES.txt`).

ABUZ8 LLC — support@abuz8ai.com
