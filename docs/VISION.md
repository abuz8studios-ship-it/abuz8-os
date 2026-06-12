# Vision & Spatial Awareness — the Jarvis senses

ABUZ8 can *see*. The **Vision** view turns your webcam into a perception layer for
hand gestures, eye/gaze tracking, and presence — **100% offline, on-device**.
No frame ever leaves the machine; there is no cloud call and no API key.

## How it works
- The renderer loads **Google MediaPipe Tasks Vision** (WASM) from the app's own
  bundled `/vendor/mediapipe/` — the JS bundle, the WASM runtime, and two
  pre-trained models (`gesture_recognizer.task`, `face_landmarker.task`).
- Each webcam frame is run through two recognizers locally:
  - **GestureRecognizer** → hand landmarks + a labeled gesture.
  - **FaceLandmarker** → 468 face landmarks, eye blendshapes, and a head-pose matrix.
- The renderer distills that into a compact **presence signal** and POSTs it to
  `POST /api/presence` ~3×/sec. The core keeps the live state so voice and
  autonomy can be presence-aware, and logs gestures/presence to the activity feed.

## The three senses
1. **Gesture control** — pre-trained, no training needed. Default map:
   | Gesture | Action |
   |---|---|
   | Open palm | wake & start listening |
   | Closed fist | stop / cancel |
   | Thumbs up | confirm (clicks the visible primary button) |
   | Thumbs down | dismiss |
   | Point up | next / scroll |
   | Victory ✌ | screenshot |
   | ILoveYou 🤟 | go to chat |

   Editable via `GET /api/vision/gestures` and `POST /api/vision/gestures/set {map}`.
   Gestures only drive the app when **"Let gestures drive the app"** is toggled on;
   dispatch is debounced (1.6 s) and requires >55 % confidence.

2. **Eye / gaze tracking** — from FaceLandmarker eye blendshapes: gaze direction
   (at screen / left / right / up / down), blink (eyes open/closed), and an
   **attention** state (present + eyes open + looking at the screen).

3. **Spatial presence** — face presence (here / away), rough **distance**
   (near / medium / far from face span), and **head orientation**
   (left / center / right). Transitions are logged ("User present",
   "User stepped away").

## Presence-aware behavior
Toggle **"Presence-aware voice"** and ABUZ8 will only speak replies while you're
actually present and looking — it pauses TTS the moment you step away, and
resumes when you return. The presence state is exposed for any consumer:

```
GET  /api/presence            → { present, attentive, presence:{gaze,distance,head,blink,gesture,...} }
POST /api/presence  {present,attentive,gaze,distance,head,blink,gesture}
GET  /api/vision/gestures     → { map }
POST /api/vision/gestures/set { map }
```

## Honest limits
- Needs a webcam and the user to grant camera permission (handled by the
  Electron media-permission handler; same path the in-chat voice mic uses).
- Gaze is **direction**, not pixel-precise eye-pointing — it's attention-grade,
  not a calibrated eye-tracker. Distance is a relative estimate from face size,
  not a measured range.
- Runs on the CPU/GPU of the host via WASM; on a weak laptop expect a lower
  frame rate. It is throttled and lightweight, but it is real computer vision.
