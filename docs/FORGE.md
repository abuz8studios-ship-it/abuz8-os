# The Forge — holographic CAD / world builder

A real-time 3D workspace (bundled **Three.js**) where you build engines, reactors,
rockets, labs, towers and whole **cities** — and command it by **voice, hands, and click**,
Stark-style. The classic Iron-Man move is built in: **assemble → explode → keep/delete
parts → recombine.**

## What's real
- **Parametric assembly library** — V8 engine, arc reactor, rocket, tower, building, city,
  gear train, lab, atom, molecule — each a named, multi-part 3D assembly you can take apart.
- **Build / add** — buttons or natural language ("build a V8 engine", "add a gear", "make a city").
- **Exploded view** — "blow it up" animates every part outward along its offset so you see each
  piece separately; a slider scrubs the explosion 0–100%; "collapse" reassembles.
- **Select → keep / delete / isolate / duplicate** — click (or pinch) a part to select it,
  then delete it, isolate it, or clone it. This is the arc-reactor-rebuild interaction.
- **Orbit / zoom** — drag to orbit, scroll to zoom; or **Hands** mode (MediaPipe): one hand
  orbits, two hands zoom.
- **Voice commands** — the mic button records, transcribes offline (Whisper), and runs the
  command. `/api/forge/interpret` maps language → scene op (verified across build/explode/
  delete/add/scale/city).
- **Photo → 3D** — "Scan a photo": ABUZ8 analyzes the image and builds an **editable 3D
  reconstruction**. With a connected vision model (Providers → gpt-4o / Gemini) it identifies
  the object and its visible parts; otherwise it reconstructs from a label. `/api/forge/analyze`.

## Honest limits (no movie-fakery)
- A 2D photo shows only the **outside**. No tool can reveal an object's hidden internal gears
  from a picture — that needs the CAD source or an X-ray/scan. So "scan → full internal teardown"
  is a *reconstruction/approximation*, clearly labeled, not a real X-ray.
- A **true mesh from your photo** (not a parametric stand-in) needs an image-to-3D model —
  e.g. Tripo/Meshy/Luma (cloud API) or a local TripoSR/Trellis on a GPU. That's a connector
  slot for the Pegasus/DGX tier, not bundled on the CPU build.
- The "create a new element / Möbius" theatrics are delivered as the **interaction** (shrink,
  explode, strip parts, recombine into a new assembly) — real and it looks the part; the
  "new element" is a creative build, not real physics.

## API
```
POST /api/forge/interpret {text}            → { op: {action, assembly|part|value} }
POST /api/forge/analyze   {image_base64,hint} → { assembly, label, parts, note, source }
```
Actions: build · add · explode · collapse · delete · isolate · duplicate · scale · rotate · clear.
