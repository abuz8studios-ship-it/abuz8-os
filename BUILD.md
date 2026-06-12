# BUILD / Replicate ABUZ8 OS on another computer

This repo contains the **complete application source** (everything in `src/`) plus config templates. To run it on a fresh machine you also need three categories of **binary assets** that are too large to keep in git (Electron runtime ~250 MB, llama.cpp ~3 GB, a Node runtime ~95 MB). Those are listed below with exact filenames and where to get them.

Target platform: **Windows 10/11 x64**. (The brain binaries are Windows builds; the JS is cross-platform but the bundled `llama-server.exe` / native TTS are Windows-only.)

---

## 0. Fast path — clone an existing install

If you still have a working install, the simplest "exact replica" is to copy the whole folder:

```
C:\Users\<you>\AppData\Local\Programs\ABUZ8 OS\     ← the app (Electron + resources)
C:\Users\<you>\AppData\Roaming\abuz8-os\            ← your data (config, memory, skills, board)
```

Copy both to the same paths on the new machine, then re-run the Claude Desktop bridge install (it self-heals on launch). Done. The rest of this doc is for rebuilding from source.

---

## 1. Prerequisites

- **Node.js LTS** (v18+; this machine used v24). Install from nodejs.org.
- **`@electron/asar`** packer: `npm i -g @electron/asar` (or use `npx`).
- **Electron runtime** matching the original (the app shipped as a packaged Electron app). Two options:
  - Use `electron` from npm to run unpacked during development: `npm i -D electron`.
  - Or package with `electron-builder` / `electron-packager` for a real installer.

## 2. Lay down the source

```powershell
# from this repo
mkdir build\resources
npx @electron/asar pack .\src .\build\resources\app.asar
```

`app.asar` now contains `main.js`, `backends.js`, `portable-core.js`, `preload.js`, `package.json`, `renderer/`, and `mcp/abuz8-mcp-stdio.js`.

## 3. Add the binary assets (NOT in git)

Place these next to `app.asar` under the Electron `resources/` folder:

### 3a. `resources/brain/` — the embedded LFM2 brain (~3 GB)
llama.cpp Windows build + GGUF models. Required files:

| File | Size | Source |
|---|---|---|
| `llama-server.exe` | ~13 MB | [github.com/ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) Windows release (any recent `b####` build) |
| `llama.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu-*.dll`, `llama-common.dll`, `mtmd.dll` | — | same release zip (copy the whole `bin/`) |
| `concrt140.dll`, `msvcp140.dll`, `vcruntime140*.dll`, `libomp140.x86_64.dll` | — | MSVC redistributable (or copy from the release) |
| `LFM2.5-350M-Q4_K_M.gguf` | ~219 MB | Hugging Face `LiquidAI/LFM2.5-350M-GGUF` |
| `LFM2-1.2B-Tool-Q4_K_M.gguf` | ~1.19 GB | Hugging Face `LiquidAI/LFM2-1.2B-Tool-GGUF` (or equivalent LFM2 1.2B Q4_K_M) |
| `LFM2-2.6B-Exp-Q4_K_M.gguf` | ~1.56 GB | Hugging Face LFM2 2.6B Q4_K_M |

> The brain catalog (`EMBEDDED_BRAIN_CATALOG` in `portable-core.js`) references these three filenames. Keep the names identical or update the catalog.

### 3b. `resources/mcp/` — the Claude Desktop symbiote
| File | Size | Source |
|---|---|---|
| `abuz8-mcp-stdio.js` | 8.5 KB | from this repo (`src/mcp/`) — copied automatically when you pack, but Claude runs the **unpacked** copy |
| `node.exe` | ~95 MB | any Node.js LTS `node.exe` (used so Claude Desktop can run the bridge without a system Node) |

`portable-core.js → persistentClaudeBridge()` copies these into `%APPDATA%\abuz8-os\mcp\abuz8-claude-bridge\` on launch.

### 3c. Electron runtime
The standard Electron `.exe` + `*.dll` + `*.pak` + `resources/` layout. Use the same major Electron version the app was built with, or repackage with `electron-builder`.

## 4. Resulting install layout

```
ABUZ8 OS\
  ABUZ8 OS.exe                 (Electron)
  resources\
    app.asar                   (your packed src/)
    brain\                     (3a — llama.cpp + GGUFs)
    mcp\                       (3b — node.exe + symbiote)
```

## 5. First run

```powershell
.\ABUZ8 OS.exe
```

- Portable Core binds `127.0.0.1:8900`, creates `%APPDATA%\abuz8-os\`, seeds config from `config-templates/` defaults, and self-installs the Claude Desktop symbiote.
- First chat spawns `llama-server.exe` (cold load ~1–2 min).

## 6. Restore your config (optional)

Copy the files from `config-templates/` into `%APPDATA%\abuz8-os\config\` and `…\mcp\`, then put your real API key back into `providers.json` (it's redacted to `REPLACE_WITH_YOUR_KEY` here). Copy `skills/` into `%APPDATA%\abuz8-os\skills\`.

## 7. Rebuild after editing source

Use `scripts/rebuild.ps1` (Windows) or `scripts/rebuild.sh` (git-bash): it kills the running app, repacks `src/` → `app.asar`, swaps it in, and relaunches.

---

## Verifying a good build

```powershell
curl http://127.0.0.1:8900/health                       # {"ok":true,...}
curl http://127.0.0.1:8900/api/system/scan              # ports + CLIs + endpoints
curl http://127.0.0.1:8900/api/agents/roles             # 11 roles
curl http://127.0.0.1:8900/api/bridge/status            # symbiote installed
```
