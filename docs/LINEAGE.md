# The ABUZ8 Lineage — a family of specialist agents on one chassis

You can't fuse Kali Linux + Claude Desktop + Kling + HeyGen + OSINT into one app — that's a bloated, fragile mess. The answer is the **Mercedes model**: one shared platform (the *chassis*), many specialist **classes** built on it. The S, G, and CL all share Mercedes' platform, electronics, and engineering — but each is a different specialist. ABUZ8 works the same way.

## The chassis (shared by every class)
The **ABUZ8 Portable Core** is the platform every agent rides:
- the HTTP API + agent-first loop (understand → remember → research → reason → reflect)
- the tool system (CLI, browser, desktop, MCP, web)
- voice (Piper/Whisper) + vector memory + self-learning
- the soul system + hardware-adaptive brains (Nemotron / Qwen / nomic)
- the two-way Claude Desktop bridge

A **class** is that same chassis loaded with a different **identity + toolset + brain bias + connectors**. `/api/classes/select` re-skins the running engine; nothing is forked.

## The classes (the lineage)
| Class | Agent | Specialty | Focus tools / connectors |
|---|---|---|---|
| **S** | ABUZ8 — Flagship Operator | general sovereign operator | everything; Claude bridge, MCP |
| **E** | Raqib — Intel & OSINT Analyst | research, OSINT, dossiers | deep_research, browser, OSINT |
| **CL** | Mubdi — Creator Studio | content, video, avatar | content_generate, Kling, HeyGen, X, YouTube |
| **G** | Haris — Sentinel | security, red-team, system ops | cmd/shell, recon, Kali, nmap |
| **GL** | Mudir — Ops & Growth | CEO/ops, SEO, marketing | mission board, X, Stripe, swarm |
| **C** | Anis — Companion | voice-first conversation | voice brain, web, apps |
| **A** | Kashif — Scout | lightweight / weak devices | tiny fast brain, the basics |
| **R** | Hakim — Biomedical Research | disease research, genomics, immunology | deep_research, PubMed/NCBI/ClinicalTrials/UniProt/Ensembl |
| **Q** | Faqih — Arabic & Quranic Thinker | Arabic-first reasoning, Quranic & Islamic scholarship | deep_research, Quran/Hadith/Tafsir |

`GET /api/classes` lists them; `POST /api/classes/select {id}` activates one (its name, voice, mission, and tool focus take over chat).

**Safety souls:** Hakim is a research-synthesis aid (never diagnoses, prescribes, or claims cures; cites peer-reviewed sources). Faqih is a study/thinking aid (never issues binding fatwas or fabricates verses; cites the Quran, authentic hadith, and recognized scholars, and defers rulings to qualified living scholars).

## The Orchestrator (the company-runner)
`POST /api/orchestrate {objective}` is the enterprise layer: it **decomposes** an objective into a mission, **assigns each step to the best specialist class**, **runs them as a fleet**, then **synthesizes a mission report**. One objective in → many specialists work → one report out. This is how the lineage runs a company, not just answers a chat.

## How the existing agents fit
The other builds on the USB are siblings in this lineage, each a different *chassis generation*:
- **ABUZ8 OS** (Electron + llama-server) — this chassis, the flagship line.
- **Al-Buraq** (Python: agent_loop + brain_router + mission_graph + self_learning) — its self-learning was migrated into ABUZ8.
- **QadirOS** (Python + llama-cpp-python + Google API) — an integrated office class.
- **OpenClaw / Zait** (Ollama mesh worker, soul "Pegasus") — the *federation* layer: worker nodes that join a control node.
- **Hermes** — the ops/company-runner class.
- **MalkiOS, Soloman** — further classes.

## Federation (the fleet)
OpenClaw already proves the next step: a **control node** dispatches tasks to **worker nodes** across a mesh. The lineage becomes a *fleet* — the S-Class flagship orchestrates; each specialist class (or a sibling agent on another machine) takes the task it's best at, and the swarm/mission-graph stitches the results. One brain commands; many specialists execute.

## Why this beats a mega-fusion
- **Focus** — each class carries only its specialist toolset, so it's lean and sharp.
- **Safety** — the G-Class (security) is guarded and read-only by default; you don't want that logic tangled into the Creator class.
- **Deployability** — ship just the class a machine needs (Scout on a weak laptop, Sentinel on a Kali box, Studio on a render rig).
- **Shared upgrades** — fix the chassis once (the agent loop, memory, voice) and every class inherits it.

> One platform. Many specialists. A true lineage — the Mercedes of sovereign agents.
