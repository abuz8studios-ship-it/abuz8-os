# ABUZ8 OS — GPU / Jarvis unlock fix (2026-06-10 16:19 EDT)

Owner: Ahmad Abu Zait · Engineer: Qadir · Machine: **Pegasus** (2× RTX 5090, 64 GB VRAM, CUDA 12.0, driver 610.47)

## What was broken (audited from the LIVE app.asar, not the stale tree)
The shipped `Abuz8Fable.exe` / installed `ABUZ8 OS` never used the GPU and could not see local models:
1. **GPU forced off** — `ensureEmbeddedBrain()` launched llama-server with `-ngl 0` (CPU only), and `resources\brain\` shipped **only `ggml-cpu-*.dll`** (no CUDA backend), so the dual 5090s were idle.
2. **No model discovery** — `/api/brains/list` only listed the (empty) embedded catalog. Ollama / LM Studio / vLLM / llama.cpp servers were probed for *health* but their **models were never enumerated or selectable**, and chat never routed to them.
3. **Probe was name-only** — `detectGpuNames()` used WMI names with no VRAM/driver/CUDA; the device read as "fallback".
4. **Mobile PWA 404** — only `/index.html` was served; `/manifest.json`, `/sw.js`, `/mobile.html` returned 404, so the phone app could not install.
5. **Source drift** — the live `app.asar` core (182 KB) was newer than this project's `portable-core.js` (139 KB); a naive rebuild would have **regressed** the engine.

## What changed (file: `portable-core.js`, synced into this project)
- **GPU offload**: `-ngl 0` → `detectGpuLayers()` (`999` when an NVIDIA GPU **and** `ggml-cuda.dll` are present; `ABUZ8_NGL` env overrides).
- **Real GPU introspection**: added `nvidiaSmiQuery()` / `detectGpus()`; `machineProbe()` now returns per-GPU `{name, vram_gb, driver_version, cuda_compute}`, plus `gpu_count`, `gpu_total_vram_gb`, `nvidia_count`, `cuda_ready`.
- **Universal model probe**: `detectExternalBrains()` enumerates **Ollama** (`/api/tags`), **LM Studio** (`:1234/v1/models`), **vLLM** (`:8000`), **llama.cpp** (`:8080`); merged into `/api/brains/list`.
- **Routing + selection**: `setActiveBrain()` accepts `ollama:`/`lmstudio:`/`vllm:`/`llamacpp:` ids; `primaryReply()` routes chat through `callProviderChat()` to the selected backend; `agenticReply`/`reasonReply`/`/api/status` show the active brain.
- **Auto-adopt**: on launch, when no GGUF is bundled and nothing is selected, the app adopts the best local GPU model (prefers Ollama, skips embedding models) → **chat works on the GPU with zero config**.
- **Mobile PWA**: static routes serve `/mobile`, `/mobile.html`, `/manifest.json`, `/sw.js`, `/verify.html`, `/renderer/*` (added to the LAN open-paths allowlist).
- **Telegram two-way**: `startTelegramPolling()` long-polls `getUpdates` and answers phone messages with the GPU brain (set `telegram_token` in Settings, send `/start`).
- **Connectors**: extended `CLI_CATALOG` with code, cursor, claude, gemini, codex, lms, wsl, wrangler.

## GPU backend files (staged from `E:\ABU\llama.cpp\bin`, byte-identical build — no download)
Copied into BOTH `…\ABUZ8 OS\resources\brain\` (installed app) and `…\electron\brain\` (this project):
`ggml-cuda.dll`, `cublas64_13.dll`, `cublasLt64_13.dll`, `cudart64_13.dll`.

## Verified (real Electron runtime, 2026-06-10)
- `device/probe`: `tier=workstation, gpu_count=2, total_vram_gb=64, nvidia=2, cuda_ready=True`.
- `brains/list`: 14 live Ollama GPU models discovered & selectable.
- chat (no manual selection) → `brain=ollama · nemotron3:33b-q4_K_M`, coherent reply (GPU).
- `/manifest.json` & `/mobile` → HTTP 200.
- `bundled llama-server --list-devices` → both RTX 5090 + "loaded CUDA backend".

## How to rebuild the portable `Abuz8Fable.exe`
This project is now the canonical, fixed source (`portable-core.js` matches the installed app; `brain/` has CUDA).
```powershell
cd "E:\ABU\ABUZ8_OS_DIST\electron"
npm run build      # electron-builder --win --x64 (nsis + portable). Output in .\out
```
Rename the produced `ABUZ8_OS-1.0.0-portable.exe` to `Abuz8Fable.exe` if desired.
Backups of the pre-fix files are saved alongside as `*.pre-gpu-fix-20260610-1611`.

## Honest ROADMAP (not yet done — do not advertise as live)
- **Streaming TTS + endless voice loop**: backend TTS/STT work one-shot (Windows SAPI); the renderer does not yet run a continuous listen→speak loop, and Kokoro `bm_fable.pt` is unwired.
- **Per-provider email/OAuth sign-in** (Gmail/Gemini/NVIDIA/Anthropic/ChatGPT): only a generic token-exchange endpoint exists; real sign-in needs registered client IDs + an `/api/oauth/callback`.
- **Per-provider email/OAuth + streaming voice loop** remain the main ROADMAP items.

## Phase 2 (2026-06-10 17:07 EDT) — OS control + MCP mesh + Superman skin
- **Full OS + mouse control**: agent tool `mcp_call` drives any registered MCP server, consent-gated behind "Allow actions". Verified two-way: **desktop-commander** (files/terminal/processes — real dir listing) and **windows-mcp** (App, PowerShell, Click, Type, Move, Scroll, Screenshot, Clipboard, Registry, …).
- **MCP mesh auto-import on launch** (`reinstateBridge`): now also imports **Claude Desktop Extensions** (`%APPDATA%\Claude\Claude Extensions\*\manifest.json` → resolves `${__dirname}`, drops `${user_config.*}`) and **Antigravity** (`%APPDATA%\Antigravity\User\mcp.json`, `~/.gemini/.../mcp_config.json`). New endpoints `/api/mcp/import/antigravity`, `/api/mcp/import/claude-extensions`. 9 servers imported on this machine.
- **spawnMcpClient quoting fix**: shell:true spawns now quote command+args, so paths with spaces ("Claude Extensions") no longer split (was MODULE_NOT_FOUND / "unrecognized subcommand").
- **Temp-data-root guard**: `installClaudeSymbiote` skips writing the Claude config when running from a `%TEMP%` data dir (prevents test runs from poisoning Claude Desktop).
- **Superman living theme** (renderer): 4 shades — Man of Steel / Krypton Blue / Cape Red / Solar Flare — default on, with a slow-drifting tricolor aura (`body.living::after`, reduced-motion aware). Tricolor accents #4d9aff / #e6483f / #ffc62e.

## Build / deploy (2026-06-10 17:07 EDT)
- `npm run build` packaged **`out\win-unpacked\`** successfully (verified: cuda_ready, 9 MCP servers, nemotron3:33b) but the **NSIS single-file installer FAILED**: `makensis.exe` is 32-bit and cannot mmap the payload 7z once the CUDA libs (`cublasLt64_13.dll` = 458 MB) push it past ~2 GB. Not a disk issue (48 GB free).
- Distributable shipped as **`out\Abuz8Fable-Jarvis-portable.zip`** (3.26 GB, unzip + run `ABUZ8 OS.exe`).
- For a true single-file `Abuz8Fable.exe`: use a **7-Zip SFX** (streams, no 2 GB mmap limit) OR drop `cublasLt` from the installer and copy it from `E:\ABU\llama.cpp\bin` on first run.
