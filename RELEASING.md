# Releasing Splec Note

Releases are **fully automated** — every push to `main` triggers
`.github/workflows/release.yml`, which builds, versions, publishes a GitHub
Release, and deploys the in-app updater manifest to GitHub Pages.
No manual tagging or local builds are required.

---

## How it works

```
push to main
    │
    ├─► build-macos  (macos-latest)
    │     • Bumps version to 0.1.<run_number>
    │     • Builds universal DMG (Apple Silicon + Intel)
    │     • Uploads: SplecNote-mac-universal.dmg
    │                SplecNote-mac-universal.app.tar.gz
    │                SplecNote-mac-universal.app.tar.gz.sig  (if key set)
    │
    ├─► build-windows  (windows-latest)
    │     • Bumps version to 0.1.<run_number>
    │     • Builds NSIS installer (x64)
    │     • Uploads: SplecNote-windows-setup.exe
    │                SplecNote-windows.nsis.zip
    │                SplecNote-windows.nsis.zip.sig  (if key set)
    │
    └─► publish  (ubuntu-latest)
          • Creates GitHub Release  →  v0.1.<run_number>
          • Generates pages/updates/latest.json  (Tauri updater manifest)
          • Generates pages/index.html  (download landing page)
          • Deploys both to GitHub Pages
```

**Versioning** is automatic: `0.1.<github_run_number>`.  No manual bumps needed.

---

## One-time GitHub setup

### 1. Enable GitHub Pages

Go to **Settings → Pages → Build and deployment → Source** and select
**GitHub Actions**.  This is required once; after that every push deploys
automatically.

### 2. Add the updater signing key (for in-app updates)

Generate a minisign key pair:

```bash
npm run tauri signer generate -- -w ~/.splec/updater.key
```

This prints the **public key**.  Add it to `src-tauri/tauri.conf.json` →
`plugins.updater.pubkey`.

Then add two **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | `$(cat ~/.splec/updater.key)` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | your key password (or leave empty) |

> Without the signing key the build still succeeds and installs work, but the
> in-app "Check for Updates" feature won't function.

> The `pubkey` currently in the repo is a **throwaway placeholder**.  Replace it
> with your real public key before shipping.

### 3. Apple code signing (optional)

Set these repository secrets if you have an Apple Developer account:

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | base64-encoded `.p12` certificate |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID |
| `APPLE_PASSWORD` | app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character team ID |

Without these, the DMG is unsigned (Gatekeeper will warn on first open).

---

## Download URLs for splecdevelopers.com

Point your website download buttons at these permanent "latest release" URLs:

| Platform | URL |
|----------|-----|
| macOS (Universal) | `https://github.com/srikanthpullela/SplecNote-app/releases/latest/download/SplecNote-mac-universal.dmg` |
| Windows (x64) | `https://github.com/srikanthpullela/SplecNote-app/releases/latest/download/SplecNote-windows-setup.exe` |

These always redirect to the latest release automatically.

---

## In-app updater endpoint

`plugins.updater.endpoints` in `tauri.conf.json` now points at:

```
https://srikanthpullela.github.io/SplecNote-app/updates/latest.json
```

The manifest at that URL is regenerated and deployed on every push to `main` by
`.github/scripts/gen-pages.js`.  The format is:

```json
{
  "version": "0.1.42",
  "notes": "Automated build v0.1.42",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "…", "url": "https://…/SplecNote-mac-universal.app.tar.gz" },
    "darwin-x86_64":  { "signature": "…", "url": "https://…/SplecNote-mac-universal.app.tar.gz" },
    "windows-x86_64": { "signature": "…", "url": "https://…/SplecNote-windows.nsis.zip" }
  }
}
```

---

## CI (non-release)

`.github/workflows/ci.yml` runs on every PR and on `main` pushes alongside the
release workflow.  It compiles and tests the code but does **not** create
releases or upload artifacts.  Signing/notarization secrets are not referenced.

---

## Manual build (local)

```bash
npm ci

# macOS universal
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin

# Windows (from Windows machine)
npm run tauri build
```

> Building the `.dmg` requires a GUI session (WindowServer).  GitHub-hosted
> macOS runners have one; headless boxes do not (DMG layout fails with
> `AppleEvent timed out -1712`).

