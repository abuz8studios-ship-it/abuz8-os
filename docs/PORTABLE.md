# Portable / USB bundle — take ABUZ8 to another machine

ABUZ8 OS can be packaged into a **single self-contained folder** you copy to a USB stick and run on another Windows machine (e.g. a test/Pegasus server) — brain, voice, hearing, browser automation, config, and all.

## Make the bundle

On the machine that already has ABUZ8 working:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\make-portable-bundle.ps1 -Target "E:\ABUZ8-Portable"
```

(Point `-Target` at your USB drive or any folder.) The script copies:

| Piece | From | Into the bundle |
|---|---|---|
| App + bundled llama.cpp brain (LFM2) | `%LOCALAPPDATA%\Programs\ABUZ8 OS` | `ABUZ8 OS\` |
| NVIDIA Nemotron 4B + downloaded models | `%APPDATA%\abuz8-os\models` | `ABUZ8_OS_Data\models\` |
| Neural voices (Piper) + Whisper STT | `…\attachments` | `ABUZ8_OS_Data\attachments\` |
| Playwright runner | `…\attachments\playwright` | `ABUZ8_OS_Data\attachments\` |
| Playwright Chromium | `%LOCALAPPDATA%\ms-playwright` | `ms-playwright\` |
| Config, soul/mission, skills, memory, board | `%APPDATA%\abuz8-os\…` | `ABUZ8_OS_Data\…` |
| Launcher + README | generated | `Launch-ABUZ8.bat`, `README.txt` |

Total size is roughly **6–7 GB** (mostly the GGUF brains + Chromium).

## Run it on the target machine

Copy the whole folder over, then double-click **`Launch-ABUZ8.bat`**. The launcher sets:
- `ABUZ8_DATA_DIR` → the bundled `ABUZ8_OS_Data` (so it uses the bundled models/voices/config, not the new machine's empty AppData)
- `PLAYWRIGHT_BROWSERS_PATH` → the bundled `ms-playwright`

…then starts `ABUZ8 OS.exe`. Everything resolves from the bundle, so it runs the same as on the source machine.

## What's fully portable vs. needs one thing

- ✅ **Fully bundled & offline:** the app, the llama.cpp + LFM2 brains, the NVIDIA Nemotron tool-calling brain, Piper neural voices, Whisper STT, Playwright + Chromium, your config/soul/skills/memory.
- ⚠️ **PyAutoGUI desktop control** needs **Python 3 + `pip install pyautogui pillow`** on the target machine (it's the one component that isn't a standalone binary). Everything else needs nothing installed.
- Target OS: **Windows 10/11 x64**.

## Verifying on the target
```
# after launching:
curl http://127.0.0.1:8900/health
curl http://127.0.0.1:8900/api/attachments      # piper/whisper/playwright present
curl http://127.0.0.1:8900/api/brains/list       # Nemotron selectable
```
