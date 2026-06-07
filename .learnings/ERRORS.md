# Errors

Command failures and integration errors.

---

## 2026-06-07 — NSIS cannot package all-in-one 3-brain Jarvis archive

**Context:** After correcting release strategy from separate Lite/Standard/Pro to a single all-in-one Jarvis build carrying all three GGUFs, both `nsis` setup and `portable` targets failed in Electron Builder.

**Failure:** `makensis.exe process failed ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` with `File: failed creating mmap of ... abuz8-os-1.0.0-x64.nsis.7z`.

**Cause:** The bundled all-in-one app archive is approximately 2.95GB (`APP_64_UNPACKED_SIZE=2955040 KB`). NSIS/portable target cannot mmap/embed this archive.

**Correct workaround:** Ship the verified `win-unpacked` folder as the USB/all-in-one folder package, or use a different installer technology that supports >3GB payloads (WiX/MSIX/custom bootstrapper/7z SFX 64-bit). Do not split the brains into Lite/Standard/Pro as the release target, because the user explicitly requires all three brains together.

**Verified working artifact:** `E:\ABU\ABUZ8_OS_DIST\electron\out-jarvis-all\win-unpacked\ABUZ8 OS.exe` with all three GGUFs present and `/api/brains/pool` proving 3/3 live.
