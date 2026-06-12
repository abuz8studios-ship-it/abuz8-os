# Hardware adaptivity & GPU unlock

ABUZ8 OS reads the machine it's on and scales to it — lean on a weak laptop, fast on a GPU rig, full power on a DGX. Same single build, no reconfiguration.

## What the probe sees
`GET /api/device/probe` / `GET /api/system/scan` report:
- CPU name + **all cores** (used for inference threads)
- Total RAM (drives context size)
- **Per-GPU VRAM** via `nvidia-smi` (accurate) with a CIM fallback
- **Monitor count** (`System.Windows.Forms.Screen`)
- `acceleration`: `{ mode: cpu|gpu, nvidia, total_vram_mb, cuda_runtime_installed, can_unlock_gpu, threads_used }`

`GET /api/status` also exposes `brain_alive` and `brain_error` for diagnosing a brain that won't load.

## Adaptive brain launch
`brainArgs()` builds the `llama-server` command per machine:
- **Threads** = every CPU core (e.g. all 32 on a 9950X; was capped at 8).
- **Context** scales with RAM: 2K (≤12 GB) → 4K → 8K → 16K (≥48 GB).
- **GPU offload**: `-ngl 999 --flash-attn on` **only when** a CUDA runtime is present *and* an NVIDIA GPU is detected; otherwise `-ngl 0` (CPU).

## Unlocking the GPU
The bundled `llama-server` is a **CPU build**. To use an NVIDIA GPU you need a CUDA build, which ABUZ8 fetches on demand:

- **UI:** System Map → **"⚡ Unlock GPU power"** (appears when `can_unlock_gpu` is true).
- **API:** `POST /api/brain/accelerate` → `unlockGpu()`:
  1. confirms an NVIDIA GPU is present,
  2. downloads the latest llama.cpp **CUDA Windows build** + **cudart** zips from GitHub,
  3. `Expand-Archive`s them into `attachments/brain-cuda/`,
  4. restarts the brains → next reply runs on the GPU.

`resolveBrainDir()` prefers `brain-cuda/` over the CPU `brain/`, and `brainIsCuda()` flips on GPU offload. To do it manually, drop any CUDA-enabled `llama-server.exe` + its dlls into `…/attachments/brain-cuda/`.

## Tiers
`lightweight` → `mobile edge` → `creator laptop` → `workstation` → `high-performance GPU rig` (≥16 GB VRAM) → `AI workstation / DGX-class` (≥128 GB RAM + ≥40 GB VRAM).

## Troubleshooting "the brain didn't load"
Check `GET /api/status` → `brain_error`. Most common on a fresh machine:
- **Windows Defender/SmartScreen** quarantining the unsigned `llama-server.exe` — allow it once (or code-sign for distribution).
- **Cold load** of the 2.9 GB Nemotron model on CPU takes ~30-60 s the first time — wait, or unlock the GPU.
- Using a **stale build** — rebuild the installer so the adaptive code ships.
