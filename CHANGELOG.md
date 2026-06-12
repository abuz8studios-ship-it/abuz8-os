# Changelog

## [1.22.0] — 2026-06-12 — Sessions · command palette · file attachments · self-update · 3D talking avatar

Closing the last UX gaps vs Hermes, plus a real talking character.
- **Chat sessions** — named, searchable, durable threads (`+ New`, `Chats`, rename, delete, search).
  Server-side at `sessions/*.json`; the chat auto-persists. `/api/sessions`, `/api/session`.
  *Verified: save → list → search → delete.*
- **Command palette (Ctrl/Cmd+K)** — fuzzy launcher for every view + action (new chat, Brief me,
  Studio, check updates…). Ctrl+Shift+N = new chat.
- **File attachments — understands any file** — 📎 / drag-drop: **PDFs** (bundled pdf.js text
  extraction), **images** (read by the vision brain), **text/code/csv/json/md/logs** (read directly);
  binary files noted honestly. Content is fed to the agent as hidden context, keeping the chat clean.
- **Self-update** — `/api/update/check` against a configurable release manifest ({version,
  installer_url}); honest "no channel configured" until set. APP_VERSION 1.22.0.
- **3D talking avatar** — the avatar window now renders a real-time **Three.js character head** whose
  mouth/jaw **lip-syncs to his TTS** (amplitude-driven), with head motion + blinks; non-breaking
  fallback to the 2D avatar if WebGL is unavailable. (A photoreal GTA-grade model is an art-asset swap.)

## [1.21.0] — 2026-06-12 — Messaging gateway (chat with ABUZ8 from Telegram) + CEO/SEO cockpit

Benchmarked against Hermes Agent v0.16.0 (v2026.6.5). ABUZ8 already matches/exceeds most of
it (Electron desktop app + installer, dashboard, providers, memory, skills, kanban, MCP — plus
Operator, Forge, vision, Earn, Second Brain, the business cockpit that Hermes lacks). The one
signature feature Hermes had that we lacked — a **two-way messaging gateway** — is now built:
- **Telegram gateway** — talk to your sovereign agent from a normal Telegram chat anywhere.
  A 3s poll loop (`tgPollOnce`) reads incoming messages via getUpdates, runs them through the
  full agent (`agenticReply`), and replies via sendMessage (with a typing indicator). Reuses the
  Telegram bot token you connect in Social. Toggle in **Connect → Telegram gateway**.
  `/api/gateway/telegram`. *Verified: status/enable/disable + poll loop wired.*
- **CEO desk + SEO** in the Command Center — the CEO seat now has an objective box (→ the
  orchestrator runs the agent team) + Brief me, and an SEO card (keyword → SEO article) so all
  six C-suite seats (CEO/CFO/CRO/COO/CKO/CTO + SEO) are on one screen.
- Honest: the gateway needs your free Telegram bot token (@BotFather) connected in Social; on a
  CPU brain replies take ~30-60s (instant with a connected frontier model or on GPU).

## [1.20.0] — 2026-06-12 — Command Center (HUD) + Content Studio — the business-OS cockpit

The pieces that turn ABUZ8 into a one-person-company OS (CEO/CFO/CRO/COO/CKO/CTO in one).
- **Command Center (HUD)** — a single cockpit aggregating the whole business live: Revenue (CFO,
  Stripe), Growth (CRO, content loops + posts + platforms), Operations (COO, missions + schedules),
  Knowledge (CKO, notes + memories), the Team (CTO, classes + providers + connectors + vision),
  and the latest activity. `/api/hud`. *Verified pulling live data across all functions.*
- **Content Studio** — the production gap, filled: **image generation** (free best-effort via
  Pollinations; reliable with a FREE Hugging Face token, hf_… → FLUX, or an OpenAI images key) and
  **SEO articles** (keyword → full H1/H2 markdown article). `/api/studio/image|article`. New
  `image_gen` connector. *Verified: real structured SEO article generated; image path honest.*
- Honest: Pollinations gated its free tier (now rate-limited/402), so image gen is best-effort
  free and reliable with a free HF token (30-second setup) — not faked.

## [1.19.0] — 2026-06-12 — Second Brain (the missing piece from Obsidian/Understand-Anything)

Researched the field (Julian Goldie's Hermes Agent OS, Nous Hermes Agent, Jarvis OS, Obsidian,
Understand-Anything, Paperclip) — ABUZ8 already matches most (self-improving skills, persistent
memory, orchestration-as-company, local-first, voice, Operator, MCP). The one genuinely missing,
high-leverage piece for organization + revenue was a **second brain / knowledge vault** (the common
thread across Obsidian + Understand-Anything + claude-obsidian + Paperclip-notes). Built it:
- **Capture any source** — drop a link or text → ABUZ8 reads it (URL fetch + strip), the brain
  auto-titles + summarizes + extracts key points + tags, and **files it as Markdown YOU own**
  (`brain/notes/*.md`) + indexes it into the RAG vector store.
- **Ask your own knowledge** — questions retrieve from your notes + past work and answer with them.
  *Verified: ingested a note → brain summarized it (title + 4 key points) → "what price & market?"
  answered "$29/mo, Muslim solo entrepreneurs…" straight from the note.*
- New **Second Brain** view; `/api/vault/ingest|ask|notes|note`.
- (Honest: next-best migrations identified but not yet built — a multi-modal **Content Studio**
  (image generation for posts, the marketing gap) and a unified **HUD mission-control** cockpit.)

## [1.18.0] — 2026-06-12 — Learn from Claude: import your full history into memory

A "Learn from Claude" button in the Claude Bridge that ingests **every past conversation**
into ABUZ8's long-term RAG memory, so it recalls and builds on your prior work.
- **Honest mechanic:** Claude's chats live in your claude.ai account (the desktop app is
  cloud-backed, local cache is opaque), so the complete path is the one-time **claude.ai data
  export** (`conversations.json`). The button makes importing it one tap.
- **Scan** finds a `conversations.json` in Downloads/Desktop/Documents; **Choose file** imports
  any export; both ingest every conversation into `events.jsonl` + the vector store, then
  background-index for recall. Robust parser handles the export shape (chat_messages / content).
- `/api/bridge/learn/scan`, `/api/bridge/learn/import {path|json}`. *Verified: a 2-conversation
  export imported (2 convos, 4 messages) into both the memory log and the RAG vector index.*
- Result: relevant past Claude work is retrieved into ABUZ8's reasoning context automatically —
  it genuinely gets smarter from your history. (Recall quality scales with a stronger embed setup.)

## [1.17.0] — 2026-06-12 — Earn: the dead-simple money machine + first-run wizard

Onboarding a 5-year-old could finish, wired to the engine we already built (faceless
content → auto-post → your link).
- **First-run wizard** (shows on first launch): Hi → pick your niche (chips) → your money
  link (optional) → connect one account (or skip) → 🎉 "You're earning." Sets `onboarded`.
- **Earn tab** — one screen: a big **Start earning** button, then a live "money machine is ON"
  dashboard (posts made, where it's posting, Post-now / Pause, connect-account nudge).
- **`/api/earn/start`** creates a recurring `content_loop` (drafts faceless content on your
  topic + appends your link, posts to connected socials, fires one immediately),
  **`/api/earn/status`**, **`/api/earn/stop`**. *Verified: start creates+runs the loop; status
  reflects it.*
- **Honest:** it automates the *work* that earns (content + posting + your link) and starts
  today; real income builds with your audience over time, and auto-posting needs one social
  account connected (the UI nudges you, and the easy ones — X/Telegram/Bluesky/Discord — take seconds).

## [1.16.0] — 2026-06-12 — One unified multimodal brain (leaner + sees)

Consolidated to a **single brain** that reasons, tool-calls, AND sees — and deleted the
redundant text-only model. You can't bolt a vision projector onto a model it wasn't trained
for, so instead of keeping Nemotron (text) + Gemma (vision) we made **Gemma 3 4B the one brain**:
- `ensureEmbeddedBrain` now loads the main model **with its `--mmproj` vision projector** when one
  sits beside it → one llama.cpp server handles text *and* image requests. `callLocalVision`,
  `jarvis/see`, the Forge, and the Operator all route to this single brain.
- **Deleted Nemotron 4B (−2.8GB).** Local models went **6.4GB → 3.7GB**; the installer drops
  ~7.5GB → ~4.7GB. Half the model weight, lighter RAM, more edge-usable (one 4B, not two),
  faster cold-start, vision native to the main brain.
- **Verified:** the unified Gemma brain answered a text question AND read a test image, both on
  the one model. Frontier quality stays one tap away via the Providers Ark (Claude/GPT/Gemini).
- Honest: same 4B param count, so per-token speed is similar on CPU — the real 2× levers remain
  GPU (auto-enabled) or a smaller quant for phones/old machines.

## [1.15.0] — 2026-06-12 — Mobile companion app (installable PWA)

There was never a native iOS/Android app, and the old mobile files were orphaned (never
served). This wires up and rebuilds a real **mobile companion** — an installable PWA that
controls the ABUZ8 agent running on your computer from your phone over Wi-Fi.
- **Served now:** `/m` (mobile app), `/manifest.json`, `/sw.js` — added to the LAN open-paths,
  and the phone URLs (`/api/lan/status`) now point at `/m`. *Verified all serve 200 with the
  right MIME, and the phone URL is `http://<pc-ip>:8900/m`.*
- **The app:** mobile-first UI with Chat (talks to `/api/chat`), **Brief me** (`/api/jarvis/brief`,
  spoken), live **Activity**, status, and spoken replies via `/api/tts`. Sends the LAN key on
  every call. Installable to the home screen (manifest + service worker), works offline-shell.
- **Honest:** it's a PWA companion (the brain/vision/OS-control run on the PC; the phone is the
  remote), not an App-Store native app. Voice *input* needs an HTTPS link (a tunnel); text +
  spoken replies work over plain Wi-Fi. Enable **LAN access** in Settings to connect a phone.

All work performed during the 2026-06-10 audit & rebuild of ABUZ8 OS. The app pre-dates this; these entries cover the repair and expansion captured in this repo.

## [1.14.0] — 2026-06-12 — The Operator (autonomous computer use)

The frontier capability, unlocked now that ABUZ8 has eyes (Gemma 3 / cloud vision),
hands (PyAutoGUI), and a brain. Give it a goal and it **operates the computer itself**:
- **See → think → act loop** — the renderer captures the screen each step; `operatorStep()`
  (vision model) returns the single next action as JSON with **resolution-independent
  coordinates** (0–1000 grid); the renderer executes it via PyAutoGUI (`gui_do`) and loops.
  `/api/operator/step`. **Verified:** given a test image + "click the green square," the local
  Gemma vision brain returned a grounded `click` action, fully offline.
- **Actions** — click / double-click / right-click / type / key / hotkey / scroll / wait / done.
  `gui.py` upgraded to convert normalized `nx,ny` → true pixels via PyAutoGUI's own screen size.
- **Safety** — requires "Allow actions" ON + a per-run screen-share grant; step-capped; Stop
  button; PyAutoGUI corner-failsafe. New **Operator** view with a live action log.
- **Honest:** the local 4B vision brain is coarse on exact coordinates and slow per step
  (~100s on CPU); accuracy + speed jump with a connected cloud vision model or on a GPU, and
  the loop self-corrects by re-looking after each action.

## [1.13.0] — 2026-06-12 — Offline local vision (Gemma 3) + auto-GPU on boot

- **Local vision brain (Gemma 3 4B, multimodal)** — fully offline eyes, no cloud, no key.
  Served on the bundled llama.cpp (v9124, `--mmproj` multimodal) at port 8905; `jarvis/see`
  and the Forge route to it (cloud vision provider → local Gemma → honest fallback).
  **Verified:** it correctly read a test image (red circle, green square, on-screen text)
  with `source: local:gemma-3-vision`. ~100s cold on CPU; fast on GPU.
  `ensureVisionBrain`, `callLocalVision`, `/api/vision/local/status|warm`.
- **Auto-GPU on boot** — on startup, if an NVIDIA GPU is present and not yet accelerated,
  ABUZ8 **automatically installs the CUDA runtime and moves the brains (incl. vision) onto
  the GPU** — so the same portable build self-tunes: Surface → CPU, Pegasus/DGX → GPU.
  Opt-out via `auto_gpu:false`. `maybeAutoAccelerate()` in `start()`.
- Vision-model detection broadened to recognize Gemma 3, NVIDIA NIM vision, and open VLMs
  (Llava/Qwen-VL/InternVL/etc.) while treating Gemma 2/3-1B/Nemotron as text-only.

## [1.12.0] — 2026-06-12 — The Jarvis layer (he sees your screen + briefs you)

The two traits that make an assistant truly "Jarvis," both real:
- **Screen vision** — "what's on my screen?" / "read this": the app captures the screen with
  the native, user-granted `getDisplayMedia` (auto-granted via `setDisplayMediaRequestHandler`,
  no picker, **zero PowerShell**) and a connected vision model (gpt-4o/Gemini/Grok/Claude) reads
  it. Honest fallbacks when no frame or no vision model. `/api/jarvis/see`.
- **Proactive briefing** — "brief me" / "good morning": a real, instant briefing fused from the
  live clock, weather, active missions, and (if connected) calendar + unread inbox — spoken by
  the avatar. Deterministic (no model echo). `/api/jarvis/brief`. *Verified: real Fri Jun 12 2026
  briefing in 0.7s.*
- **Image → real 3D mesh** — a **Tripo** connector turns a photo into an editable mesh for the
  Forge (`/api/forge/mesh` + `/mesh-status`); honest `needs_auth` until a key is added.
- Tools `jarvis_see`/`jarvis_brief` + intents ("what's on my screen", "brief me") routed
  client-side to the native capture. See/Brief buttons in the avatar window.

## [1.11.0] — 2026-06-12 — The Forge (holographic CAD / world builder)

A real-time Three.js CAD workspace — build engines, reactors, rockets, labs, towers and
**cities**, commanded by voice, hands, and click (Stark-style).
- **Assembly library** (engine, arc reactor, rocket, tower, building, city, gear train, lab,
  atom, molecule) — each a named multi-part 3D assembly.
- **Exploded view** — "blow it up" animates parts outward; slider scrubs 0–100%; collapse reassembles.
- **Select → keep / delete / isolate / duplicate** — click or pinch a part (the arc-reactor-rebuild move).
- **Voice commands** (offline Whisper → `/api/forge/interpret`, verified across build/explode/
  delete/add/scale/city) · **Hands** mode (MediaPipe: one hand orbits, two hands zoom) · mouse orbit/zoom.
- **Photo → 3D** (`/api/forge/analyze`) — vision model identifies the object + parts when connected,
  else an honest label-driven reconstruction. (A 2D photo can't reveal hidden internals; a true
  photo→mesh needs an image-to-3D model on GPU/cloud — documented, not faked.) Docs: `docs/FORGE.md`.

## [1.10.0] — 2026-06-11 — Voice barge-in + true 3D point-cloud hologram

### Voice barge-in (interrupt like a real call)
While ABUZ8 speaks, a parallel echo-cancelled mic VAD listens; when you start talking it
**cuts the TTS and hands the turn back to you** (`startBargeWatch` → `speakReply`). A raised
threshold (0.06) + 240ms sustained + a zero-gain sink keep the speech from triggering itself.

### True 3D point-cloud hologram (Three.js, bundled offline)
Bundled **Three.js** (`vendor/three/three.module.js`, 1.27MB, served offline). Holographic mode
now renders a real WebGL scene: a glowing wireframe core by default, and **"Scan frame" builds
a genuine 3D point cloud** of the webcam image (depth from brightness) you rotate, zoom and spin
with both hands. CSS-3D remains the fallback when WebGL is unavailable. All 10 Three.js classes
verified exported; the engine serves with the correct MIME. (Live manipulation needs camera + hands.)

## [1.9.0] — 2026-06-11 — Persistent OAuth · agent-callable connectors · holographic control

### Persistent OAuth (hands-free, auto-refresh)
Real OAuth 2.0 + PKCE with a **loopback redirect on the app's own server**
(`http://127.0.0.1:8900/oauth/callback`). Authorize once in the browser; ABUZ8 stores the
**refresh token and silently renews access forever** — no more 1-hour re-paste. Presets:
Google (Gmail·Calendar·YouTube), Meta (Instagram·Facebook), TikTok. Gmail/Calendar/Instagram
now pull the auto-refreshed token automatically. Setup uses the user's own OAuth client
(one-time) — credentials are never shipped or faked. Verified: a genuine Google consent URL
with PKCE + `access_type=offline` + `prompt=consent`. `/api/oauth/status|setup|start|disconnect`.

### Connectors are agent-callable mid-task
The agent's ReAct tool menu now includes **`send_email`, `calendar_create`, `stripe_op`,
`social_post`, `social_draft`, `get_weather`, `get_time`** — so inside an orchestration it can
actually email, schedule, charge, and post **without you driving**. Each routes to the real
connector and returns honest `needs_auth` when a credential is missing (verified).

### Two-hand holographic control (Iron-Man style)
Vision now tracks **both hands** (MediaPipe, `numHands:2`). A holographic stage lets you
manipulate an artifact in 3D: **two-hand pinch → zoom + rotate**, two-hand drag → pan, one-hand
pinch → 3D spin (rotateX/Y). **Scan frame** freezes the live webcam image onto the artifact so
you grab the real thing. Glowing pinch HUD; CSS-3D transform engine; 100% offline. (Live
manipulation needs a camera + hands; the pipeline is structurally complete.)

## [1.8.0] — 2026-06-11 — Social Beacon (post everywhere) + faceless content loops

The in-shell answer to "migrate Postiz": ABUZ8 becomes the home beacon that broadcasts
to every network and runs faceless-content marketing loops on its own.
- **13-platform catalog.** Work-now with a simple token (real, verified): X, Mastodon,
  Bluesky (AT Protocol), Telegram, Discord. Wired-but-OAuth-gated: Instagram, TikTok,
  LinkedIn, Facebook, YouTube, Threads, Reddit, Pinterest.
- **Fan-out beacon** — `POST /api/social/post {platforms[],text}` posts to all selected
  networks at once with an **honest per-platform result** (posted / needs_auth / error).
  Verified: reports exactly which credential each platform needs; never fakes success.
- **Faceless AI content** — `POST /api/social/draft {topic,platform}` writes a ready-to-post,
  platform-tailored post (hook→value→CTA→hashtags). Verified: a real 270-char X post.
- **Marketing loops** — the autonomy scheduler gained `social` and `content_loop` actions;
  a loop drafts fresh content on your topic and broadcasts it on a cadence (Social → Schedule loop).
- Tools `social_post`/`social_draft` + NL intents ("broadcast: …"). Edge control already
  works (Playwright launches the `msedge` channel first). New Social view. Docs: `docs/SOCIAL.md`.
- Keys stay local in `config/social.json`.

## [1.7.0] — 2026-06-11 — Providers (the Ark), native Arabic, real-world grounding

### Provider catalog — the Noah's Ark of AI
30+ providers preset (Antigravity/Continue/LiteLLM style): OpenRouter, OpenAI, Anthropic
(with a new `/v1/messages` adapter), Gemini, Grok, DeepSeek, Kimi, GLM, MiniMax, Perplexity,
Mistral; NVIDIA NIM, Cerebras, Groq, Together, Fireworks, DeepInfra, Mercury, SambaNova,
Cohere, Bedrock*, Azure; local engines (llama.cpp native, Ollama, LM Studio, vLLM, Jan —
auto-detected); and the Claude Desktop bridge for a Claude *subscription*. Pick a brain;
chat routes there with **native-engine fallback if it fails** (verified). New Providers view.
`/api/providers(/connect|/test|/models|/select|/use-native|/disconnect|/detect)`. Docs: `docs/PROVIDERS.md`.

### Native Arabic (understand · speak · transcribe)
- **Speaks Arabic**: TTS auto-switches to the Kareem voice (with libtashkeel diacritization)
  whenever the text is Arabic — verified 315 KB of real Arabic audio.
- **Transcribes Arabic**: Whisper now passes `-l auto` (multilingual model) and accepts `language:'ar'`.
- **Understands & replies in Arabic**: every system prompt carries a language-matching directive;
  verified the local 4B answering "من أنت؟" in fluent Arabic.

### Real-world grounding (no more stale model facts)
- **Correct date/time**: the real OS clock is injected into every system prompt and exposed as a
  `get_time` tool — it now says 2026, never 2023. Verified.
- **Live weather**: a `get_weather` tool locates the user by IP and pulls Open-Meteo (no key) —
  current + 4-day forecast. "what's the weather tomorrow" routes to it in <1s. Verified.

### Wake word grabs the command
"Abuu/abu" must lead the utterance (Siri-style), and anything said after it ("hey abu, what's the
weather tomorrow") is captured and acted on in the same breath — not just a greeting.

\* Bedrock listed for completeness; SigV4 adapter pending.

## [1.6.0] — 2026-06-11 — Connect: real connectors, fleet mesh, account, wake word

### Real connectors (keys stay on the machine)
A connectors framework with **genuine API calls** — verified by Stripe rejecting a
bogus key from its own API. `config/connectors.json` (gitignored). Stripe (balance/
customers/charges), Cloudflare (token verify/zones/DNS), Gmail (list/**send**),
Google Calendar (list/**create**), OpenRouter (cloud brain), Serper (auto-upgrades
web search). `/api/connectors(/set|/test|/call|/delete)`. Docs: `docs/CONNECT.md`.

### Fleet mesh (OpenClaw-style control-node + workers)
Every ABUZ8 instance is a worker out of the box (`/health` + `/api/chat` + LAN key).
This node becomes a **control node**: add workers by URL, **live ping** (health +
latency), and **dispatch** tasks that run on the worker's own brain and return results.
*Verified: a dispatched task ran on the worker's Nemotron brain and replied.*
`/api/mesh/nodes|add|remove|ping|dispatch|whoami`. `fetchUrl` now takes a timeout.

### Secure local account + MCP surfacing
scrypt-hashed local sign-in (`/api/account/status|setup|login`). The Connect view also
lists MCP servers and one-click **imports the Claude Desktop config** (Desktop Commander
et al.) into ABUZ8's existing MCP client.

### Wake word — "Abuu" (always-listening, like Siri)
An offline VAD + Whisper loop in the chat bar: listens only on speech, detects the wake
word "Abuu", greets, and opens the hands-free conversation; steps aside during a
conversation and auto-resumes on reload. 100% offline.

## [1.5.0] — 2026-06-11 — Vision & spatial awareness (the Jarvis senses)

### On-device perception (100% offline)
A new **Vision** view turns the webcam into a perception layer via bundled
**MediaPipe Tasks Vision** (WASM) — no cloud, no API key, no frame leaves the machine.
- **Gesture control** — pre-trained hand gestures (open palm → wake, fist → stop,
  thumbs up → confirm, point → next, victory → screenshot, ILoveYou → chat) with a
  configurable `gesture→action` map; opt-in "gestures drive the app", debounced + confidence-gated.
- **Eye / gaze tracking** — gaze direction, blink, and an attention state from face blendshapes.
- **Spatial presence** — present/away, distance (near/medium/far), head orientation, with edge logging.
- **Presence-aware voice** — TTS only speaks while you're present and looking; pauses when you step away.
- API: `/api/presence` (GET/POST), `/api/vision/gestures(/set)`, `/vendor/*` static serving of the bundled wasm+models. Docs: `docs/VISION.md`.

## [1.4.0] — 2026-06-11 — Autonomy + durable missions + Operations dashboard

- **Durable mission graph** (JSON-backed) with approval gates: create → advance → pause-at-gate → approve → complete. `/api/missions/*`.
- **Autonomy scheduler** — `every_min`/`at_hour` schedules fire tasks/orchestrations/missions on a 60s tick. `/api/autonomy/*`.
- **Operations dashboard** — a UI to create missions, approve gates, and set up autonomous schedules visually.

## [1.3.0] — 2026-06-11 — Agent-first architecture + soul

### Agent-first reasoning (the Hermes/OpenClaw framework)
Chat is no longer a tool-dispatcher. A request that needs thinking is **understood → the agent gathers (tools + self-knowledge) → reasons over the results → synthesizes the real answer**, instead of dumping raw tool output.
- `isComplexTask()` routes reasoning/research/comparison/multi-step requests through `runTask()`; simple actions stay instant; voice stays fast.
- `selfDescription()` gives ABUZ8 honest self-knowledge (real capabilities + bottlenecks) so it can reflect on itself.

### The four agent phases (each verified)
1. **Vector memory / RAG** — a local nomic embedding model (port 8904) embeds memories; relevant ones are retrieved and injected into context. ABUZ8 remembers across sessions. (`/api/memory/index`, `/api/memory/recall`)
2. **Iterative ReAct loop** — `runTask` chains tools: plan → tool → observe → reason → repeat until done, then synthesizes. Dedup guard for small-model loops.
3. **Deep-read research** — `deepResearch()` decodes search redirects and fetches/reads the top source pages (full text, not snippets). (`deep_research` tool, `/api/research`)
4. **Self-reflection** — `reflectAndImprove()` critiques and tightens the draft answer before returning. (`/api/reflect`)

### Soul (Hermes-style)
A **name + 4 files** (`NAME.txt`, `SOUL.md`, `VOICE.md`, `MISSION.md`, `DIRECTIVES.md`) define who ABUZ8 is and how it speaks, loaded into **every** reply (typed and voice). Editable in Settings → Soul.

### Brains
Four local engines run in concert: **Nemotron 4B** (reasoning, :8902), **Qwen 0.5B** (instant voice, :8903), **nomic-embed** (memory, :8904), and the core (:8900). Lazy-loaded.

### Themes
Added **Sakīna** (Islamic green/blue/gold-lapis) and **Superman · Krypton** palettes (~12 total).

> Honest note: every phase is verified working, but quality and speed are capped by the local CPU models — they scale up dramatically with the GPU unlock (Pegasus/DGX) or a 7B+/cloud brain.

## [1.2.0] — 2026-06-10 — Jarvis: voice, automation, hardware-adaptive, installer

### Voice & speech (offline)
- **Piper neural TTS** attachment — 4 natural voices (US f/m, UK, Arabic) + presets (normal/calm/fast/narrator/cartoon).
- **whisper.cpp STT** attachment — offline hearing; multilingual model (~99 languages).
- **In-chat hands-free voice companion** — mic button starts a live loop (listen→Whisper→brain→Piper→repeat); window loads over `http://localhost` for a secure mic context; Electron media permission granted.
- **Dedicated fast voice brain** — Qwen2.5 0.5B on its own port (8903) → spoken replies in ~1-3 s (was ~20 s) while Nemotron handles deep reasoning.

### Brains & hardware
- **NVIDIA Nemotron 3 Nano 4B** is the primary brain (LFM brains removed to stay lean ~4 GB).
- **Hardware-adaptive launch** — uses ALL CPU cores, context scales with RAM, `-ngl` GPU offload when a CUDA runtime + NVIDIA GPU are present.
- **One-click GPU unlock** (`/api/brain/accelerate`) downloads the CUDA llama.cpp build on a GPU machine; `brain-cuda/` is preferred over the CPU runtime.
- **Richer probe** — per-GPU VRAM (nvidia-smi), monitor count, CPU/GPU acceleration mode, `can_unlock_gpu`; `/api/status` exposes `brain_alive`/`brain_error`. Tiers scale lightweight → DGX-class.

### Native control & agents
- **Real tool execution** — open browsers/apps/sites by name, run any command (`cmd_run`), draw (monkey **and unicorn**), tweet/post-to-X intent. Consent persists across launches.
- **Playwright** browser automation (drives system Edge — no bundled Chromium) + **PyAutoGUI** desktop control.
- **Autonomous agent loop** (`/api/agent/run`) with live-streaming steps; **live Activity feed** (`/api/activity`).

### UI & distribution
- **Cinematic boot/probe** screen (Claude-designed) reading real hardware.
- **Themes**: Claude Dark/Light + multi-hue cinematic (Nebula, Deep Ocean, Aurora, Sunset Dusk, Twilight), **Mythos**, **Fable**, **Sakīna** (Islamic green/blue/gold-lapis), **Superman · Krypton**.
- **Phone/LAN access** — serve dashboard over HTTP, PIN-gated, off by default.
- **One-click installer** (`scripts/make-installer.ps1` → `ABUZ8-Setup.exe`, ~4.4 GB) and **USB portable bundle** (`make-portable-bundle.ps1`) with the brain + voice + attachments.

### Crash-resilience
- `uncaughtException`/`unhandledRejection` guards, renderer auto-reload, hardware acceleration disabled (old iGPU stability).

## [1.1.0] — 2026-06-10 — Audit, repair, and executive expansion

### Phase 1 — Audit & repair (made it actually connect)
**Fixed**
- Removed `installOptionalProbeGuard()` port blackhole in `main.js` that redirected every optional connector port (1234/11434/8188/8910/9119/18789) to a stub answering HTTP 200 — it broke all external connections and showed false "Connected" states.
- Brain readiness: `lfmHealthy()` now requires HTTP **200** (llama-server returns 503 while loading); `waitForLfm` window raised to 150 s. Previously the app gave up and served canned keyword replies that looked like a broken brain.
- Provider errors now **throw** instead of being returned as chat text; added cloud failover.
- Implemented a **real MCP client** (JSON-RPC initialize/tools-list/tools-call over stdio) + endpoints `/api/mcp/servers/:name/tools` and `/api/mcp/call`. Previously MCP servers could be spawned but never used.
- UI live-probes Mission/Hermes/OpenClaw instead of hardcoded `wired:false`; chat fallback timeout 30 s → 180 s.
- Configs rebuilt: `providers.json` (OpenRouter + LM Studio + Ollama), junk settings removed, MCP catalog corrected (fetch/time/git are `uvx` Python packages, not npm).

### Phase 2 — Clean dashboard + capability expansion
**Added**
- `/api/system/scan` — netstat port map (+PID→process), CLI discovery, hardware, endpoint catalog.
- `/api/agents/roles` + role-aware chat (system prompt threaded through brain & providers).
- `cmd_run` tool + `/api/cmd/run` — full native shell/CLI execution, consent-gated.
**Changed**
- `renderer/index.html` **rewritten** as a clean Claude-Desktop-style SPA: lighter-green theme, fit-to-screen grid, sidebar nav (Chat/Agents/System Map/Tools/MCP/Memory/Settings), chat-first.
**Removed**
- All fake/price/personal UI (revenue/cost/souls/chimera/SHA-512 claims, Telegram tokens, hardcoded IDs).

### Phase 3 — Executive / growth suite
**Added**
- 5 executive roles: `ceo-operator`, `seo-strategist`, `x-growth-operator`, `content-producer`, `swarm-orchestrator` (prompts distilled from migrated Hermes operator-mode + x-growth playbooks).
- `/api/swarm/run` — real multi-agent fan-out + synthesis.
- `/api/content/generate` — carousel/thread/YouTube/blog/synthesis, saved to `exports/content`.
- `/api/x/post` — X API v2, key-gated, honest `needs_credentials`.
- `/api/growth/seed` — 25-problems weekly board + 7-day cadence.
- `/api/skills/installed` — reads migrated skill packs.
- Two-way Claude bridge: `/api/bridge/status` + `/api/bridge/reinstall`; `start()` self-heals the symbiote and imports Claude's MCP servers each launch.
- UI: theme palettes (7), and views Swarm, Kanban, Growth & Content, Skills, Claude Bridge; multi-model picker.
- Migrated real Hermes skill packs (`x-growth-monetization`, `kanban-video-orchestrator`) into the skills dir.

### Known follow-ups
- OpenRouter key on the build machine was dead (401) — replace in Settings.
- X posting needs an OAuth2 `tweet.write` token.
- Hermes/OpenClaw sibling gateways aren't auto-started.

## Backups produced
- `app.asar.audit-backup-20260610` — pre-audit original app.
- `renderer/index.html.prerewrite-backup` — pre-rewrite UI.
