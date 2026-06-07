# ABUZ8 OS — Jarvis Build Moves Log

Every entry: timestamp, intent, files touched, git hash before+after, rollback command.

## Plan (10 steps, each independently revertible)

1. ✅ Multi-brain pool + router + /api/route + /api/brains/pool
2. Canary STT bundle + mic hook
3. Piper TTS bundle + speak-back
4. Action consent toggle in HUD
5. Auto-import Claude MCP
6. Clean folder layout
7. Cloud brain register UI
8. Browse + read page tool
9. Mic → STT → chat
10. Skills as executable code

## Moves

### 2026-06-07 step-1 multi-brain pool
- Intent: Three LFM brains run in parallel on 8902/8903/8904, router classifies + dispatches
- Files touched:
  - `electron/portable-core.js`: added BRAIN_POOL_PORTS, BRAIN_POOL_FILES, brainPool state, startBrainTier, startBrainPool, refreshBrainPoolAlive, brainPoolStatus, classifyBrainTier, callBrainTier, routeRequest. New endpoints /api/brains/pool, /api/brains/pool/start, /api/route. Pool starts in background 1.5s after server boot. stop() now also stops pool brains.
- Baseline tag: jarvis-baseline-20260607-132650
- Commit tag: jarvis-step-1-multi-brain
- Rollback: `git reset --hard jarvis-baseline-20260607-132650`
- Smoke proof: live test showed all 3 brains alive (Lite/Standard/Pro), router classified "what is 2+2" → Lite (returned "4"), "explain quantum entanglement briefly" with tier:pro → Pro (returned full explanation).

## Safety rules

- `git tag jarvis-baseline-<stamp>` before any change
- Copy target files to `E:\output\abuz8-checkpoints\<stamp>\` before edit
- `git diff` shown after each edit
- `git commit` only after smoke test passes
- Each commit gets `jarvis-step-N-<slug>` tag for surgical revert
