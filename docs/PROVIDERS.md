# Providers — the Noah's Ark of AI

ABUZ8 ships a **provider catalog** of 30+ AI providers preset and ready, exactly like
Antigravity / Continue / LiteLLM: the user picks a provider, pastes one key (or links a
local engine / their subscription), and the model is live. **Local-first and sovereign** —
the built-in llama.cpp engine runs any GGUF with no login at all.

Built on the existing OpenAI-compatible provider engine (`callProviderChat`,
`providers.json`), plus a new Anthropic `/v1/messages` adapter.

## The four lists
- **💵 Monthly / subscription brands** — OpenRouter (one key = 100+ models), OpenAI,
  Anthropic, Google Gemini, xAI Grok, DeepSeek, Moonshot/Kimi, Zhipu/GLM, MiniMax,
  Perplexity, Mistral.
- **🔑 API key (developer & fast inference)** — NVIDIA NIM, Cerebras, Groq, Together,
  Fireworks, DeepInfra, Inception/Mercury, SambaNova, Hyperbolic, Cohere, AWS Bedrock*, Azure OpenAI.
- **💻 Local engines (free, on-device)** — ABUZ8 native llama.cpp (already running),
  Ollama, LM Studio, vLLM, Jan, Text-Gen WebUI. **Auto-detected** on their localhost ports.
- **🔗 App bridges** — Claude Pro/Max via the **Claude Desktop MCP bridge** (the legit way
  to use a Claude *subscription* with no API charges).

\* Bedrock is listed for completeness; it needs AWS SigV4 signing (adapter on the roadmap).

## How it works
- `GET /api/providers` → catalog + per-provider configured status + the active brain.
- `POST /api/providers/connect {id, api_key?, model?, endpoint?}` → saves the key locally
  (in `providers.json`) and **live-tests** it with a one-word probe.
- `POST /api/providers/test {id}` → real connectivity test.
- `POST /api/providers/models {id}` → fetch the provider's live model list.
- `POST /api/providers/select {id, model}` → make it the **active brain**; chat now routes
  there. `POST /api/providers/use-native` → back to the sovereign local engine.
- `POST /api/providers/detect` → probe localhost for running Ollama/LM Studio/vLLM/Jan.

**Resilience:** if a selected cloud/local provider is unreachable, the reply ladder falls
straight back to the native engine — *verified: with a dead endpoint selected, chat still
answered on the native brain.* You never lose the assistant.

## Why one bridge, not five
Ollama, LM Studio, vLLM, Jan and llama.cpp **all speak the same OpenAI `/v1` API**, so the
catalog supports them with one client and per-engine presets. The native engine stays the
default; the bridges exist so ABUZ8 can **reuse models you already downloaded** and so
**vLLM can unlock big-GPU speed** on the Pegasus/DGX tiers.

## Honest notes
- A consumer **ChatGPT Plus / Claude Pro** subscription is *not* third-party API access.
  The legit paths are: OpenRouter, a paid API key, Google OAuth (Gemini), or the vendor's
  own app over MCP (Claude Desktop bridge). ABUZ8 does **not** reverse-engineer subscription
  endpoints — that violates ToS and gets users banned.
- Google access tokens expire ~1h; a refresh-token OAuth client is the next step for
  hands-off Gemini/Gmail/Calendar.
