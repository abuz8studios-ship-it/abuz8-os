"""ABUZ8 OS voice sidecar — native GPU STT (Whisper large-v3) + TTS (Kokoro-82M).

Loads both models once and keeps them resident, so /stt and /tts answer in
near-real-time on GPU. The Electron core auto-detects this service on
http://127.0.0.1:8921 and prefers it over the Piper/Windows/browser fallbacks.

Models are loaded from local disk only (HF_HUB_OFFLINE) — nothing downloads.
Override paths with env: ABUZ8_WHISPER_DIR, ABUZ8_KOKORO_DIR, ABUZ8_VOICE_PORT.
"""
import base64
import io
import os
import threading
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response

PORT = int(os.environ.get("ABUZ8_VOICE_PORT", "8921"))
WHISPER_DIR = os.environ.get("ABUZ8_WHISPER_DIR", r"E:\ABU\MODELS\whisper")
KOKORO_DIR = os.environ.get("ABUZ8_KOKORO_DIR", r"E:\ABU\MODELS\TTS\kokoro")
DEFAULT_VOICE = os.environ.get("ABUZ8_VOICE", "bm_fable")

app = FastAPI(title="abuz8-voice-sidecar")
_lock = threading.Lock()
_state = {"stt": None, "tts": None, "tts_model": None, "voices": {}, "device": "cpu",
          "stt_error": None, "tts_error": None}


def _load_stt():
    if _state["stt"] is not None or _state["stt_error"]:
        return
    try:
        import torch
        from transformers import pipeline
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        _state["device"] = device
        _state["stt"] = pipeline(
            "automatic-speech-recognition",
            model=WHISPER_DIR,
            torch_dtype=torch.float16 if device.startswith("cuda") else torch.float32,
            device=device,
        )
    except Exception as e:  # report honestly via /health, never crash the service
        _state["stt_error"] = str(e)[:400]


def _load_tts():
    if _state["tts"] is not None or _state["tts_error"]:
        return
    try:
        import torch
        from kokoro import KModel, KPipeline
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        _state["device"] = device
        model = KModel(
            config=os.path.join(KOKORO_DIR, "config.json"),
            model=os.path.join(KOKORO_DIR, "kokoro-v1_0.pth"),
        ).to(device).eval()
        _state["tts_model"] = model
        # lang_code: a=US English, b=British English — bm_fable is British.
        _state["tts"] = {
            "a": KPipeline(lang_code="a", model=model),
            "b": KPipeline(lang_code="b", model=model),
        }
    except Exception as e:
        _state["tts_error"] = str(e)[:400]


def _voice_tensor(name):
    import torch
    if name not in _state["voices"]:
        path = os.path.join(KOKORO_DIR, "voices", f"{name}.pt")
        if not os.path.exists(path):
            raise FileNotFoundError(f"voice '{name}' not found in {KOKORO_DIR}\\voices")
        _state["voices"][name] = torch.load(path, weights_only=True)
    return _state["voices"][name]


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "abuz8-voice-sidecar",
        "device": _state["device"],
        "stt_loaded": _state["stt"] is not None,
        "tts_loaded": _state["tts"] is not None,
        "stt_engine": "whisper-large-v3" if not _state["stt_error"] else None,
        "tts_engine": "kokoro-82M" if not _state["tts_error"] else None,
        "stt_error": _state["stt_error"],
        "tts_error": _state["tts_error"],
        "default_voice": DEFAULT_VOICE,
    }


@app.post("/warmup")
def warmup():
    with _lock:
        _load_stt()
        _load_tts()
    return health()


@app.post("/stt")
async def stt(body: dict):
    t0 = time.time()
    with _lock:
        _load_stt()
    if _state["stt"] is None:
        return JSONResponse({"ok": False, "error": _state["stt_error"] or "stt unavailable"}, status_code=500)
    b64 = body.get("audio_base64") or body.get("wav_base64") or body.get("audio") or ""
    try:
        raw = base64.b64decode(b64)
        data, sr = sf.read(io.BytesIO(raw), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        if sr != 16000:
            # naive linear resample — avoids a librosa dependency in the hot path
            target = int(len(data) * 16000 / sr)
            data = np.interp(np.linspace(0, len(data) - 1, target), np.arange(len(data)), data).astype("float32")
        with _lock:
            out = _state["stt"]({"array": data, "sampling_rate": 16000})
        return {"ok": True, "transcript": (out.get("text") or "").strip(),
                "engine": "whisper-large-v3-gpu", "ms": int((time.time() - t0) * 1000)}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)[:400]}, status_code=500)


@app.post("/tts")
async def tts(body: dict):
    t0 = time.time()
    with _lock:
        _load_tts()
    if _state["tts"] is None:
        return JSONResponse({"ok": False, "error": _state["tts_error"] or "tts unavailable"}, status_code=500)
    text = (body.get("text") or body.get("raw") or "").strip()
    if not text:
        return JSONResponse({"ok": False, "error": "text required"}, status_code=400)
    voice = body.get("voice") or DEFAULT_VOICE
    speed = float(body.get("speed") or 1.0)
    try:
        tensor = _voice_tensor(voice)
        pipe = _state["tts"]["b" if voice.startswith("b") else "a"]
        chunks = []
        with _lock:
            for _gs, _ps, audio in pipe(text, voice=tensor, speed=speed):
                chunks.append(audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio))
        wav = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
        buf = io.BytesIO()
        sf.write(buf, wav, 24000, format="WAV", subtype="PCM_16")
        return Response(content=buf.getvalue(), media_type="audio/wav",
                        headers={"X-Engine": "kokoro-82M", "X-Voice": voice,
                                 "X-Ms": str(int((time.time() - t0) * 1000))})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)[:400]}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
