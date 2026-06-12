# Honesty Policy — what's real, what needs a key, what can't exist

ABUZ8 OS is built on one rule: **nothing fake, nothing that lies.** A feature either works, or it tells you exactly what it needs. This page is the ground truth.

## ✅ Fully working, no external account required
- Offline chat brain (LFM2 GGUF via llama.cpp)
- Native desktop + CLI control (`cmd_run`, open app/url, screenshot, file write) — consent-gated
- System Map (real netstat port scan, PID→process, CLI detection)
- MCP client — enable/list/call tools on real MCP servers
- Agent roles + multi-agent swarm + synthesis
- Kanban board + delegation
- Content generation (carousel/thread/YouTube script/SEO outline/synthesis) — saved to disk
- X growth board seeding (25-problems protocol)
- Two-way Claude Desktop bridge (inbound symbiote + outbound shared MCP servers)
- Local memory, color palettes, Windows TTS/STT

## ⚠️ Real, but needs a credential you supply
- **Cloud model providers** (OpenRouter/OpenAI/etc.) — need a valid API key in Settings. The offline brain works without one.
- **X (Twitter) posting** — needs an OAuth2 user token with `tweet.write` scope (`x_access_token` in settings). Without it, `/api/x/post` returns `needs_credentials: true` instead of pretending to post.
- **Other social/SEO platform publishing** (YouTube upload, Instagram, etc.) — need each platform's API credentials.

## ❌ Cannot exist exactly as described (and is not faked)
- **Remote-controlling Claude Desktop's chat** — Claude Desktop is not an MCP server; no product can puppet its conversation. We provide shared tools + bidirectional tool calls instead.
- **Literal NotebookLM / proprietary "Kimi/MiniMax swarm" imports** — those are external products/methods, not importable code. We implement the *equivalent patterns* (source→media synthesis; decompose→parallel→verify→synthesize) locally.
- **Auto-growth that guarantees followers/revenue** — the protocol, content, and scheduling scaffolding are real; outcomes depend on you posting and the market.

## Things explicitly removed for being fake
The earlier build shipped fabricated UI: revenue/cost dashboards with invented numbers, fake "Connected" states for services that were blackholed, "SHA-512 ✓ / 14 systems wired" badges, fake "souls," and personal data baked into the UI. **All removed.** If a number appears in ABUZ8 OS, it comes from a real measurement or your own data.
