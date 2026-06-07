## Step 3 — Jarvis polish

### 2026-06-07 — final polish
- Fixed voice parser: Edge-TTS 7.x emits multi-line voice records (Name on one line, Gender on next). New parser handles both formats.
- Fixed findPython: prioritize C:\Program Files\Python311\python.exe over 'py' launcher.
- Added /api/jarvis/speak/audio?id=... so browsers can play TTS WAV directly.
- Added /api/jarvis/listen/upload — accepts WebM blob from MediaRecorder API.
- Added /api/jarvis/see/upload — accepts JPEG from getUserMedia canvas capture.
- Renderer overlay rewritten with real browser mic + camera capture.
- Brain pill auto-tags chat replies with via=Lite/Standard/Pro.
- Synced renderer to tauri/dist.

### Tags
- jarvis-baseline-20260607-132650
- jarvis-step-1-multi-brain
- jarvis-step-2-voice-vision-skills
- jarvis-step-3-jarvis-polish-326-voices (this commit)
