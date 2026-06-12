# ABUZ8 OS

**A local-first agent operating system for Windows.** Offline reasoning brain, native desktop + CLI control, MCP tool fleet, a two-way Claude Desktop bridge, a multi-agent swarm, and an executive growth/content suite — all running on your own machine, with nothing faked and nothing phoning home unless you connect it yourself.

> Built as an Electron desktop app around a bundled HTTP "Portable Core" (`127.0.0.1:8900`) and an embedded `llama.cpp` brain (`127.0.0.1:8902`). No cloud account is required to chat, run tools, or control the desktop.

---

## What it does

| Capability | How it works | Status |
|---|---|---|
| **Offline chat brain** | Bundled LFM2 GGUF models (350M / 1.2B / 2.6B) served by `llama-server.exe` | ✅ Works with zero network |
| **Multi-model access** | Pick the offline brain *or* any OpenAI-compatible provider (OpenRouter, LM Studio, Ollama) | ✅ |
| **Native desktop + CLI control** | `cmd_run` runs any shell command/pipeline; open apps, write files, screenshots — gated by one real consent toggle | ✅ |
| **System Map** | Scans every listening TCP port, maps PIDs→processes, detects 20+ installed CLIs, lists the OS API surface | ✅ |
| **MCP servers** | Real MCP client (JSON-RPC over stdio): enable, list tools, and call tools on fetch/filesystem/memory/git/etc. | ✅ |
| **Two-way Claude Desktop bridge** | Inbound symbiote (Claude → ABUZ8 tools) + outbound import of Claude's MCP servers (ABUZ8 runs the same fleet) | ✅ inbound + shared tools |
| **Agent roles** | 11 predefined executive personas (Orchestrator, Systems Engineer, CEO/Operator, SEO, X-Growth, Content, Swarm…) | ✅ |
| **Multi-agent swarm** | Fan a goal out to multiple roles, then synthesize one plan | ✅ |
| **Kanban + delegation** | Mission board; create/move tasks, delegate to a role | ✅ |
| **Content pipeline** | Topic → X carousel / thread / YouTube script / SEO outline / research synthesis, saved to disk | ✅ |
| **X growth protocol** | Seeds the "solve 25 hard problems/week" board + 7-day cadence (migrated from the operator-mode playbook) | ✅ |
| **X posting** | X API v2; posts when you add an OAuth2 `tweet.write` token, otherwise says so honestly | ⚠️ needs your token |
| **Agent-first reasoning** | Understands tasks → gathers (tools/research) → reasons → synthesizes; iterative ReAct tool-chaining + self-reflection | ✅ |
| **Vector memory / RAG** | Local embeddings; remembers facts across sessions and recalls them in chat | ✅ |
| **Deep-read research** | Fetches & reads full source pages, not just snippets | ✅ |
| **Soul** | Name + 4 files (identity/voice/mission/directives) loaded into every reply | ✅ |
| **Offline voice** | Piper neural TTS (4 voices incl. Arabic) + Whisper STT; in-chat hands-free conversation; fast 0.5B voice brain (~1-3 s replies) | ✅ |
| **Hardware-adaptive** | Uses all CPU cores, scales context to RAM, one-click GPU unlock (CUDA) — Surface → DGX | ✅ |
| **Browser & desktop automation** | Playwright (system Edge) + PyAutoGUI | ✅ |
| **Color palettes** | Claude Dark/Light, cinematic (Nebula, Deep Ocean, Aurora, Sunset Dusk, Twilight), Mythos, Fable, Sakīna (Islamic green/blue/gold-lapis), Superman · Krypton | ✅ |

Full honesty policy: anything that needs an external credential says so instead of faking success. See [`docs/HONESTY.md`](docs/HONESTY.md).

---

## Quick start (run the existing install)

1. Launch **ABUZ8 OS** (Start menu or `…\Programs\ABUZ8 OS\ABUZ8 OS.exe`).
2. The Portable Core boots on `http://127.0.0.1:8900`; the offline brain loads on first chat (~1–2 min cold).
3. Pick an **agent role** + **model** at the bottom of Chat, toggle **Allow actions** to enable native control, and go.

## Rebuild from this repo on a fresh machine

See **[BUILD.md](BUILD.md)** for the exact, reproducible steps (Electron shell + binary assets + `asar` packing). Short version:

```powershell
# 1. Install Node.js LTS. 2. Obtain the Electron runtime + brain binaries (BUILD.md lists them).
# 3. Pack the app source into app.asar:
npx @electron/asar pack ./src ./app.asar
# 4. Drop app.asar into the Electron resources folder alongside the brain/ and mcp/ asset dirs.
```

---

## Architecture at a glance

```
Electron main (main.js)
 ├─ portable-core.js   → HTTP API on 127.0.0.1:8900  (chat, tools, MCP client, system scan, swarm, content…)
 │   └─ llama-server.exe → embedded brain on 127.0.0.1:8902 (LFM2 GGUF)
 ├─ backends.js        → optional connector probes (Ollama, LM Studio, ComfyUI…)
 └─ renderer/index.html → single-page dashboard (sidebar nav, themes, all views)

mcp/abuz8-mcp-stdio.js → stdio MCP bridge registered in Claude Desktop config (the symbiote)
```

Full detail in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Repo layout

```
src/                  Real application source (packed into app.asar)
  main.js             Electron main process
  portable-core.js    The local HTTP API + brain manager + MCP client (~2500 lines)
  backends.js         Optional connector probes
  preload.js          Context-isolated IPC bridge
  renderer/index.html Dashboard UI (themes + all views)
  mcp/abuz8-mcp-stdio.js  Claude Desktop symbiote (stdio JSON-RPC)
config-templates/     runtime.json, settings.json, providers.json (key redacted), mcp_servers.json
skills/               Migrated skill packs (x-growth-monetization playbooks)
docs/                 API, AGENTS, BRIDGE, SALES, ONE-PAGER, HONESTY
scripts/              rebuild.ps1 / rebuild.sh
```

---

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — every component, port, data path, and request flow
- **[docs/AGENT-ARCHITECTURE.md](docs/AGENT-ARCHITECTURE.md)** — agent-first loop, the 4 phases, the 4 brains, the soul
- **[docs/HARDWARE.md](docs/HARDWARE.md)** — hardware-adaptive brain + GPU unlock (Surface → DGX)
- **[BUILD.md](BUILD.md)** — exact reproduction on a new computer
- **[docs/API.md](docs/API.md)** — full HTTP endpoint reference
- **[docs/AGENTS.md](docs/AGENTS.md)** — the 11 agent roles and their prompts
- **[docs/BRIDGE.md](docs/BRIDGE.md)** — the two-way Claude Desktop symbiosis, exactly what's real
- **[docs/SALES.md](docs/SALES.md)** — problems solved vs. the paid tools it replaces (honest ROI)
- **[CHANGELOG.md](CHANGELOG.md)** — the full audit + rebuild history

## License

Proprietary — © ABUZ8 LLC. Bundled third-party components (Electron, llama.cpp, LFM2 models, MCP servers) retain their own licenses. See [LICENSE](LICENSE).
