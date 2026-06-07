# Learnings

Corrections, insights, and knowledge gaps captured during development.

---

## 2026-06-07 — Correction: Jarvis release must be all-in-one, not Lite/Standard/Pro split

**Category:** correction

The user corrected the release strategy: ABUZ8/Jarvis should not ship as separate Lite, Standard, and Pro variants because the system requires all three brains together. The release target must bundle and run Lite + Standard + Pro simultaneously through the multi-brain router. Variant builds can exist as old artifacts, but they are not the final Jarvis/Hermes Super OS target.

**Action:** Build and verify a single all-in-one portable/setup artifact with all three GGUF models present in `electron/brain`, and prove `/api/brains/pool` starts all three.
