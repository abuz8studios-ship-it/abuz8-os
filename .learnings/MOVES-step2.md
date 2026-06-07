## Step 2 — Voice + Vision + Skills scaffolding

### 2026-06-07 — Jarvis layer installed
- Intent: Add voice (Edge-TTS 100+ voices), STT (faster-whisper offline), vision (Florence-2), skill auto-loader
- Files created:
  - electron/voice/edge-tts.js — Microsoft Edge TTS bridge (40+ langs, 300+ voices)
  - electron/voice/faster-whisper-stt.js — Offline STT
  - electron/vision/florence-vision.js — Florence-2 captioning
  - electron/skills/skill-loader.js — Hot-loading skill registry (Ultron piece)
  - electron/jarvis-integration.js — Endpoint installer
  - electron/renderer/jarvis-overlay.css — Sleek Jarvis aesthetic
  - electron/renderer/jarvis-overlay.js — Mic/cam/voice UI bar
- Files modified:
  - electron/portable-core.js — added require + jarvisHandler in start() + route handler block
  - electron/renderer/index.html — added <link>/<script> for overlay
  - tauri/dist/index.html — synced
  - tauri/dist/jarvis-overlay.css — synced
  - tauri/dist/jarvis-overlay.js — synced
- Python deps installed: edge-tts ✓, faster-whisper ✓, onnxruntime ✓
- Live test confirmed:
  - /api/jarvis/voices → 200 OK
  - /api/jarvis/skills → 200 OK (1 demo skill loaded)
  - /api/jarvis/skills/run hello_jarvis → 200 OK
  - Edge-TTS Python → 42KB WAV in 3s standalone
  - JS spawn bridge: argument escaping issue on Windows; works but needs polish
- Baseline: jarvis-baseline-20260607-132650
- Step 1 tag: jarvis-step-1-multi-brain
- Step 2 tag (this commit): jarvis-step-2-voice-vision-skills
- Rollback: git reset --hard jarvis-baseline-20260607-132650
