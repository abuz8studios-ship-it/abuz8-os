# Voice & Attachments

ABUZ8 OS uses an **attachment** model: it runs fully without any add-on, and each detected attachment upgrades a capability. All attachments live under `%APPDATA%\abuz8-os\attachments\`.

## Voice — real, offline, non-robotic

### TTS: Piper (neural, offline)
- Engine: `attachments/piper/piper.exe` (Piper, ONNX neural voices).
- Voices in `attachments/piper/voices/` (each is `<id>.onnx` + `.onnx.json`):
  - `en_US-hfc_female-medium` — Aria (US female, natural)
  - `en_US-ryan-high` — Ryan (US male, hi-fi)
  - `en_GB-alan-medium` — Alan (British male)
  - `ar_JO-kareem-medium` — Kareem (**Arabic / عربي**)
- Delivery presets: `normal`, `calm`, `fast`, `narrator`, `cartoon` (mapped to Piper `--length_scale` / `--noise_w`).
- `POST /api/tts {text, voice, preset}` → WAV. Falls back to Windows SAPI if Piper is absent.
- Verified: generates real WAV audio in all voices; real-time factor ~0.09 (10× faster than realtime).

Add more voices: download any `<voice>.onnx` + `.onnx.json` from `huggingface.co/rhasspy/piper-voices` into the voices folder. They appear automatically.

### STT: whisper.cpp (neural, offline)
- Engine: `attachments/whisper/whisper-cli.exe` + a model in `attachments/whisper/models/` (`ggml-base.en.bin`).
- `POST /api/stt {audio_base64}` → transcript. Falls back to Windows System.Speech if absent.
- Verified round-trip: Piper spoke → Whisper transcribed it correctly.

### Status
`GET /api/voice/status` reports the active engine, neural flags, voices, and presets. `GET /api/attachments` lists all attachments and whether each is installed.

## LoRA specialist "brains" (attachment slot)
Drop `*.gguf` LoRA adapter files into `attachments/lora/`. They are detected by `listLoraAdapters()` and reported in `/api/attachments`. llama.cpp's `llama-server` supports `--lora`, so an adapter can specialize the base brain (e.g. an Arabic-reasoning or tool-calling LoRA) without replacing it — the "modular attachment" model. (Wiring the `--lora` flag into the brain spawn is the next step; the slot and detection are in place.)

## Reproducing on another machine
The attachments are downloaded assets, not in git. To restore:
- Piper: `github.com/rhasspy/piper` Windows release → `attachments/piper/`; voices from `huggingface.co/rhasspy/piper-voices`.
- Whisper: `github.com/ggml-org/whisper.cpp` release `whisper-bin-x64.zip` → `attachments/whisper/`; model `ggml-base.en.bin` from `huggingface.co/ggerganov/whisper.cpp`.

## Autonomous agent loop (Autopilot)
`POST /api/agent/run {goal, max_steps}` runs a ReAct loop: plan → call a tool → observe → repeat. Routed through the reply ladder, so it uses a configured cloud provider (much stronger at planning) when present; otherwise the local brain. **Honest note:** the bundled 2.6B brain is a weak autonomous planner — single-step tool calls in Chat are reliable, but multi-step Autopilot is dramatically better with a cloud key or a 7B+ model from the Models catalog.
