# CLEAN MACHINE TEST - ABUZ8 OS

Date: 2026-06-05
Target: Electron installer + portable artifact

## Verdict

**PASS for portable MVP runtime.**

The built portable executable starts a bundled Portable Core on `127.0.0.1:8900`, answers health checks, and returns chat responses without relying on a home server, Python backend, Docker, ComfyUI, Ollama, or private developer paths.

## Smoke Test Performed

Artifact:

`electron/out/ABUZ8_OS-1.0.0-portable.exe`

Steps:

1. Confirmed `127.0.0.1:8900` was not already listening.
2. Launched the portable EXE.
3. Waited for `GET http://127.0.0.1:8900/health`.
4. Posted to `POST http://127.0.0.1:8900/api/chat`.
5. Closed the launched ABUZ8 OS process.
6. Confirmed `127.0.0.1:8900` was free after shutdown.

Observed:

- Health: `ok: true`, service `portable-core`.
- Chat: returned a Portable Core response.
- Portable data folder was created beside the portable artifact during the test.
- Temporary smoke-test data was removed from `electron/out` afterward.

## What Is Bundled

- Electron desktop shell
- `portable-core.js` local API
- `backends.js` optional connector probe layer
- Renderer UI
- MCP import/install local storage
- App-owned memory, MCP, skills, logs, models, workspaces, cache, exports, and config folder creation

## Optional Integrations

These are detected or imported when present, but are not required for first launch:

- Claude Desktop MCP config
- Docker Desktop MCP Toolkit
- Ollama
- LM Studio
- ComfyUI
- Cloud/API brains

## Remaining Release Caveats

- The build is not code-signed because no signing certificate was provided.
- The bundled Portable Core is a reliable local control/API fallback, not yet a full embedded open-weight LLM runtime.
- The recommended next step is adding a model downloader/runner for Liquid LFM2-2.6B under the app `models` folder.
