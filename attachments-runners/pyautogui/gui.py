# ABUZ8 PyAutoGUI runner. Reads a JSON spec (argv[1] or stdin); controls the
# real mouse/keyboard/screen; prints a JSON result.
import sys, json
try:
    import pyautogui
except Exception as e:
    print(json.dumps({"ok": False, "error": "pyautogui not installed: " + str(e)})); sys.exit(0)

pyautogui.FAILSAFE = True
try:
    spec = json.loads(sys.argv[1]) if len(sys.argv) > 1 else json.load(sys.stdin)
except Exception as e:
    print(json.dumps({"ok": False, "error": "bad spec: " + str(e)})); sys.exit(0)

out = {"ok": True}
# Resolution-independent coords: nx/ny are 0..1000 normalized; convert to real pixels
# using PyAutoGUI's own screen size (ground truth, DPI-correct) for vision-grounded clicks.
try:
    _W, _H = pyautogui.size()
    if "nx" in spec: spec["x"] = int(float(spec["nx"]) / 1000.0 * _W)
    if "ny" in spec: spec["y"] = int(float(spec["ny"]) / 1000.0 * _H)
except Exception:
    pass
try:
    a = (spec.get("action") or "").lower()
    if a == "move": pyautogui.moveTo(spec["x"], spec["y"], duration=0.2)
    elif a == "click": pyautogui.click(spec.get("x"), spec.get("y"))
    elif a in ("doubleclick", "double_click"): pyautogui.doubleClick(spec.get("x"), spec.get("y"))
    elif a in ("rightclick", "right_click"): pyautogui.rightClick(spec.get("x"), spec.get("y"))
    elif a == "type": pyautogui.write(spec.get("text", ""), interval=0.01)
    elif a == "press": pyautogui.press(spec.get("key"))
    elif a == "hotkey": pyautogui.hotkey(*spec.get("keys", []))
    elif a == "scroll": pyautogui.scroll(int(spec.get("amount", -300)))
    elif a == "screenshot":
        p = spec.get("path", "shot.png"); pyautogui.screenshot(p); out["path"] = p
    elif a == "position": out["pos"] = list(pyautogui.position())
    elif a == "size": out["size"] = list(pyautogui.size())
    else: out = {"ok": False, "error": "unknown action: " + a}
except Exception as e:
    out = {"ok": False, "error": str(e)}
print(json.dumps(out))
