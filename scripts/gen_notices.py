import glob
import json
import os
from collections import Counter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BUNDLE = os.path.abspath(os.path.join(SCRIPT_DIR, os.pardir))

rows = []
for pj in glob.glob(os.path.join(BUNDLE, "**", "package.json"), recursive=True):
    if "\\node_modules\\" in pj and "\\electron\\node_modules\\" not in pj:
        continue
    try:
        with open(pj, encoding="utf-8") as fh:
            d = json.load(fh)
    except Exception:
        continue
    name = d.get("name")
    if not name:
        continue
    ver = d.get("version", "")
    lic = d.get("license")
    if isinstance(lic, dict):
        lic = lic.get("type", "UNKNOWN")
    if not lic and d.get("licenses"):
        try:
            lic = d["licenses"][0].get("type", "UNKNOWN")
        except Exception:
            lic = "UNKNOWN"
    if not lic:
        lic = "UNKNOWN"
    repo = d.get("homepage", "")
    if not repo:
        r = d.get("repository", "")
        repo = r.get("url", "") if isinstance(r, dict) else (r if isinstance(r, str) else "")
    rows.append((name, ver, str(lic), repo))

uniq = sorted(set(rows), key=lambda x: x[0].lower())
c = Counter(r[2] for r in uniq)
flag_terms = ["GPL", "AGPL", "LGPL", "CC-BY-NC", "NONCOMMERCIAL", "NON-COMMERCIAL", "SSPL", "BUSL", "UNKNOWN"]
flagged = [r for r in uniq if any(t in r[2].upper() for t in flag_terms)]
out = os.path.join(BUNDLE, "THIRD_PARTY_NOTICES.txt")

with open(out, "w", encoding="utf-8") as f:
    f.write("ABUZ8 OS - THIRD-PARTY NOTICES AND ATTRIBUTION\n")
    f.write("This product includes third-party open-source software, each under its own license.\n")
    f.write("Full license texts are retained within each component's folder. Major components are credited in CREDITS.md.\n")
    f.write("=" * 70 + "\n\n")
    f.write("EMBEDDED MODEL:\n")
    f.write("  Liquid Foundation Models (LFM2) by Liquid AI\n")
    f.write("  License: LFM Open License v1.0 (Apache-2.0 based). Free commercial use under $10M annual revenue.\n")
    f.write("  https://www.liquid.ai/lfm-license\n\n")
    f.write("MICROSOFT VISUAL C++ RUNTIME:\n")
    f.write("  vcruntime140.dll, vcruntime140_1.dll, msvcp140.dll, concrt140.dll\n")
    f.write("  Bundled to allow llama.cpp runtime startup on clean Windows installs.\n\n")
    f.write("BUNDLED PACKAGES (" + str(len(uniq)) + "):\n")
    for n, v, l, h in uniq:
        f.write(f"  - {n} {v} | {l} | {h}\n")

print("PACKAGES:", len(uniq))
print("BREAKDOWN:", dict(c.most_common(15)))
print("FLAGGED_COUNT:", len(flagged))
for r in flagged[:40]:
    print("  FLAG:", r[0], "|", r[2])
print("WROTE:", out)
