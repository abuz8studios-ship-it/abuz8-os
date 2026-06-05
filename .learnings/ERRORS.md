# Errors

Command failures and integration errors.

---

## 2026-06-05 - ASAR inspection module missing

- **Context:** Final Electron release audit.
- **Command class:** Node `require('asar')` package listing.
- **Failure:** Project did not have the `asar` module available for direct package listing.
- **Resolution:** Do not install a package solely for this audit. Use Electron Builder success plus portable artifact smoke test to prove `portable-core.js` and `backends.js` were included and working.


## [ERR-20260605-variant-hash] Windows PowerShell hash cmdlet unavailable

**Logged**: 2026-06-05T10:05:00-04:00
**Priority**: medium
**Context**: Variant build script completed all Electron Builder outputs, then failed writing SHA256SUMS because the invoked Windows PowerShell host did not expose Get-FileHash.
**Fix**: Patched scripts/build-brain-variants.ps1 to compute SHA-256 with System.Security.Cryptography.SHA256 directly, which avoids depending on Get-FileHash availability.

## [ERR-20260605-inline-powershell-dollar-expansion] Inline PowerShell syntax check expanded `$null`

**Logged**: 2026-06-05T15:25:00-04:00
**Priority**: low
**Context**: Release verification script syntax check was passed through a double-quoted shell string. `$null` was expanded before PowerShell parsed the command, producing stray `=` command errors even though the target scripts were valid.
**Fix**: Use a here-string piped into `powershell -Command -`, or run the script file directly, when checking PowerShell syntax from Codex.


## 2026-06-05 - PowerShell verifier variable collision

- Context: Extended action-tool verifier failed because a local variable was named $Host, which conflicts with PowerShell's read-only built-in $Host.
- Fix: Use non-reserved names such as $hostCall for command responses in verifier scripts.

