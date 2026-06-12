# Agent-first architecture

ABUZ8 OS is an **agent-loop-first** system (like Hermes / OpenClaw / Felix), not a chatbot that returns one tool's output. A request that needs thinking flows:

```
understand → remember (RAG) → gather (tools + research) → reason/chain → draft → self-review → answer
```

## Routing
`agenticReply(prompt)`:
1. **Complex task?** `isComplexTask()` (compare/analyze/research/bottleneck/why/how-do-I, or 2+ chained actions) and not a fast voice turn → `runTask()`.
2. **Simple action?** `inferConsumerToolCall()` → execute one tool instantly (open app/site, run command…).
3. **Otherwise** → model-chosen tool or a direct reply.

Voice/brief turns always skip the heavy loop to stay ~1–3 s.

## runTask — the loop
1. **Self-knowledge** — for self-referential asks, `selfDescription()` injects ABUZ8's real, honest capabilities and bottlenecks.
2. **Deep research** — for lookups/comparisons, `deepResearch()` searches, decodes the redirect URLs, and **reads the top 3 source pages** (full text).
3. **Iterative ReAct** — up to 3–5 steps, the brain picks the next tool from the observations, executes it, observes, and repeats until it replies `{"done":true}`. A dedup guard stops small-model loops.
4. **Synthesis** — reasons over *all* observations to fulfil the goal (not a raw dump).
5. **Self-reflection** — `reflectAndImprove()` critiques the draft against the goal and tightens it before returning.

## The four phases (endpoints)
| Phase | What | Endpoint |
|---|---|---|
| Vector memory / RAG | nomic embeddings (:8904), `vectors.jsonl`, cosine retrieval injected into context | `/api/memory/index`, `/api/memory/recall` |
| Iterative ReAct | tool chaining in `runTask` | (in chat) |
| Deep-read research | fetch + read top source pages | `deep_research` tool, `/api/research` |
| Self-reflection | critique + rewrite the draft | `/api/reflect` |

## The brains
| Port | Engine | Role |
|---|---|---|
| 8900 | Portable Core | the HTTP API |
| 8902 | NVIDIA Nemotron 3 Nano 4B | reasoning / tasks |
| 8903 | Qwen2.5 0.5B | instant voice |
| 8904 | nomic-embed-text-v1.5 | memory embeddings |

All lazy-load and run on CPU (or GPU after the unlock — see [HARDWARE.md](HARDWARE.md)).

## The soul
`composeSystem()` builds every reply's system prompt from the soul files (`NAME.txt` + `SOUL.md` + `VOICE.md` + `MISSION.md` + `DIRECTIVES.md`) so ABUZ8 always answers in character. `voiceSystem()` is the compact in-character version for fast voice.

## Honest limits
The mechanisms are real and verified, but **quality and speed are capped by the local CPU models**. Deep tasks take ~1–3 min (multiple reasoning passes); reflection can occasionally invent a stat; ReAct planning is hit-or-miss on a 4B model. Unlocking the GPU or plugging in a 7B+/cloud brain makes the same loop frontier-grade.
