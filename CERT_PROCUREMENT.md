# Code-Signing Cert — How to Buy + Validate

## Why you need this

Unsigned .exe files trigger Windows SmartScreen on first download. Users see:

> Windows protected your PC · Microsoft Defender SmartScreen prevented an unrecognized app from starting.

They have to click "More info" → "Run anyway" — a friction point that kills 60-90% of normal downloads. Signing fixes this.

## OV vs EV — pick one

| | OV (Organization Validation) | EV (Extended Validation) |
|---|---|---|
| **Cost** | $90–$200 / yr | $250–$400 / yr |
| **Validation time** | 1–3 business days | 3–7 business days |
| **SmartScreen reputation** | builds with each download (~3K installs to clear) | **instant** — clears SmartScreen day one |
| **Storage** | software-only (.pfx file on disk) | hardware token (USB key shipped to you) |
| **Best for** | personal projects, small distribution | commercial software, public downloads |

**Recommendation for ABUZ8 OS launch:** start with **OV** ($90/yr). EV is better but the USB token requirement complicates CI/CD signing. Move to EV when you're shipping to >1K users/month.

## Cheapest legit issuers (2026)

| Issuer | OV Price (Yr 1) | URL |
|---|---|---|
| **Sectigo** (via SSL.com or Comodo CA) | $90–$140 | ssl.com/code-signing or comodoca.com |
| **Certera** | $89 | certera.com |
| **DigiCert** | $400+ | digicert.com |
| **GlobalSign** | $329 | globalsign.com |

For 3-year deals: prices drop ~30%. SSL.com regularly runs $179 for 3-yr OV.

**Avoid:** "instant" or "$5" code-signing certs sold on sketchy reseller sites. They use revoked or shared CAs. Your binary will be flagged as malware.

## What you need to provide (OV validation)

The CA verifies the publishing organization.

1. **Business documents** — articles of organization/incorporation and tax records
2. **Phone verification** — they call a number on your business listing. Make sure ABUZ8 LLC has a verifiable D-U-N-S number or is in a business directory (D&B, ZoomInfo, LinkedIn Company Page). If not, get a D-U-N-S — free, 30 days at dnb.com.
3. **Physical address** — the registered business address
4. **Authorized contact** — a verified company manager/officer

**Pro tip:** Get your LinkedIn Company Page + D-U-N-S squared away **before** ordering the cert. CA validation hangs on these checks 80% of the time. With both ready, OV validation finishes in 24 hours.

## After purchase — getting the .pfx

1. CA emails you a download link OR a CSR/key pair process
2. Generate the CSR on Windows:
   ```powershell
   # Run as your normal user (not admin)
   $req = @"
   [NewRequest]
   Subject = "CN=ABUZ8 LLC, O=ABUZ8 LLC, L=<Ohio City>, S=Ohio, C=US"
   KeyLength = 3072
   KeyUsage = "CERT_DIGITAL_SIGNATURE_KEY_USAGE"
   ProviderName = "Microsoft Enhanced RSA and AES Cryptographic Provider"
   RequestType = PKCS10
   "@
   $req | Out-File -Encoding ASCII abuz8.inf
   certreq -new abuz8.inf abuz8.csr
   ```
3. Submit `abuz8.csr` to the CA portal
4. After approval, CA gives you a `.cer` or `.crt`
5. Install the cert into your local cert store:
   ```powershell
   certreq -accept abuz8.crt
   ```
6. Export with private key as PFX (for signing scripts):
   ```powershell
   $pwd = ConvertTo-SecureString -String "REPLACE_WITH_STRONG_PWD" -Force -AsPlainText
   Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -match 'ABUZ8' } |
     Export-PfxCertificate -FilePath "$env:USERPROFILE\Documents\abuz8-signing.pfx" -Password $pwd
   ```
7. **Back up** the .pfx to an encrypted USB + a password manager (Bitwarden, 1Password). If you lose it AND the password, you lose a year of cert reputation.

## Signing ABUZ8 OS

Once the .pfx is on disk:

```powershell
cd <repo-root>
.\sign-bundle.ps1 -CertPath "$env:USERPROFILE\Documents\abuz8-signing.pfx" -CertPassword (Read-Host -AsSecureString "PFX password")
```

Both artifacts are signed + timestamped in ~5 seconds. The script:
1. Loads + validates the cert
2. Detects OV vs EV (heuristic on Subject)
3. Signs with SHA-256 + RFC 3161 timestamp (free Sectigo server)
4. Verifies the signature
5. Outputs new SHA-256 hashes (publish these — signed binaries have different hashes)

## Smoke test after signing

Right-click signed .exe → **Properties** → **Digital Signatures** tab. You should see:
- Name of signer: `ABUZ8 LLC`
- Digest algorithm: `sha256`
- Timestamp: present (don't skip this — unstamped sigs expire when the cert does)

Right-click → **Run** with no SmartScreen warning. Or for OV, SmartScreen still warns until you accumulate reputation (~3K successful downloads). For EV, the warning is gone immediately.

## Total time to signed binary

| Step | Time |
|---|---|
| Get D-U-N-S (if you don't have one) | 30 days (free), or instant for paid |
| Order OV cert from SSL.com or Certera | 5 min |
| CA validation (with D-U-N-S ready) | 1-3 business days |
| Generate CSR, install, export PFX | 15 min |
| Run sign-bundle.ps1 | 5 sec |

**End-to-end: about 1 business week.** EV is 1 day longer.

Bismillah.
