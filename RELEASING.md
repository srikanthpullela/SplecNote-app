# Releasing Splec Note

This document describes how to build, sign, notarize and ship a Splec Note
release, plus how the auto-updater flow works. None of these secrets are stored
in the repo — they are provided at build time via environment variables.

> **What can be built without credentials:** the frontend (`npm run build`), the
> Rust binary, and the macOS **`.app`** bundle all build with a plain
> Command-Line-Tools toolchain. The **`.dmg`** additionally needs an interactive
> GUI (WindowServer) session — its Finder-window layout step uses AppleScript and
> fails with `AppleEvent timed out (-1712)` on a headless box. **Signing and
> notarization require an Apple Developer account.** CI (GitHub-hosted macOS
> runners, which have a GUI session) produces the `.dmg`.

## 1. Versioning

Bump the version in **both** places so the bundle and updater agree:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version` (and `src-tauri/Cargo.toml` if pinned)

Tag the release: `git tag v0.1.0 && git push --tags`.

## 2. Build the installers

```bash
npm ci
npm run tauri build           # → src-tauri/target/release/bundle/{macos,dmg}
```

Artifacts:

- `bundle/macos/Splec Note.app` — the application bundle.
- `bundle/dmg/Splec Note_<version>_<arch>.dmg` — the disk image (GUI session
  required, see note above).
- On Windows: `bundle/nsis/Splec Note_<version>_x64-setup.exe`.

For a universal macOS binary:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

## 3. Code signing (macOS)

Signing needs a **Developer ID Application** certificate in your login keychain.
Set these before `npm run tauri build`:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
# Optional: point Tauri at a specific keychain
export APPLE_CERTIFICATE="<base64 of the .p12>"          # for CI import
export APPLE_CERTIFICATE_PASSWORD="<p12 password>"
```

Tauri signs the `.app`/`.dmg` automatically when `APPLE_SIGNING_IDENTITY` is set.

## 4. Notarization (macOS)

After signing, notarize with an app-specific password or an App Store Connect API
key. Tauri can run this for you when these are set:

```bash
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="<app-specific-password>"          # appleid.apple.com
export APPLE_TEAM_ID="TEAMID"
# — or — API key auth:
export APPLE_API_ISSUER="<issuer-uuid>"
export APPLE_API_KEY="<key-id>"
export APPLE_API_KEY_PATH="/path/to/AuthKey_<keyid>.p8"
```

Manual equivalent (if not letting Tauri drive it):

```bash
xcrun notarytool submit "Splec Note_<version>_<arch>.dmg" \
  --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "Splec Note_<version>_<arch>.dmg"
```

## 5. Windows code signing

Without a code-signing certificate the NSIS installer triggers **Windows
Defender SmartScreen** ("Windows protected your PC") and enterprise IT policies
often block the download entirely.  Signing with a trusted certificate removes
both problems.

### Option A — Traditional OV/EV certificate (recommended for companies)

1. **Purchase a certificate** from DigiCert, Sectigo, or GlobalSign.
   - *OV (Organization Validated)* — $100–200/yr; SmartScreen reputation
     builds over a few installs.
   - *EV (Extended Validation)* — $300–500/yr; **immediately trusted** by
     SmartScreen; required if you want instant zero-warning downloads.
2. **Export as `.pfx`** (with a strong password).
3. **Base64-encode** it:
   ```bash
   # macOS / Linux
   base64 -i splecnote-sign.pfx | tr -d '\n' > cert_b64.txt

   # PowerShell (Windows)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("splecnote-sign.pfx")) | Set-Content cert_b64.txt
   ```
4. **Add two repository secrets** (Settings → Secrets and variables → Actions):
   | Secret name | Value |
   |---|---|
   | `WINDOWS_CERTIFICATE` | contents of `cert_b64.txt` |
   | `WINDOWS_CERTIFICATE_PASSWORD` | the PFX password |

The release workflow (`release.yml`) will automatically import the certificate,
extract its thumbprint, and pass it to Tauri via
`TAURI_WINDOWS_CERTIFICATE_THUMBPRINT` so the NSIS installer is signed at
bundle time.  Builds without the secrets set are still produced (unsigned) so
CI is not broken.

### Option B — Microsoft Azure Trusted Signing (~$10/month)

A cheaper, cloud-hosted option that also satisfies SmartScreen:

1. Create an Azure Trusted Signing account and resource.
2. Add the GitHub Action `azure/trusted-signing-action@v0` **after** the
   `Build Tauri app` step and point it at the built `.exe`:
   ```yaml
   - uses: azure/trusted-signing-action@v0
     with:
       azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
       azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
       endpoint: https://<your-region>.codesigning.azure.net/
       trusted-signing-account-name: <account>
       certificate-profile-name: <profile>
       files-folder: src-tauri/target/release/bundle/nsis
       files-folder-filter: exe
   ```
3. Skip the `Import Windows code-signing certificate` step by leaving the
   `WINDOWS_CERTIFICATE` secret unset.

### Option C — Interim end-user workaround

If you release before obtaining a certificate, include this note in the
release body:

> **Windows note:** Until our code-signing certificate is active, Windows
> Defender SmartScreen may show a warning.  Click **More info → Run anyway**
> to install.  Once the certificate has accumulated enough reputation, this
> warning will disappear automatically.

### Verifying the signature locally

```powershell
Get-AuthenticodeSignature "SplecNote-windows-setup.exe" | Select Status, SignerCertificate
```

The `Status` field must be `Valid` for SmartScreen to accept it silently.

## 6. Auto-update flow

Splec Note bundles **`tauri-plugin-updater`**. On launch (production builds only)
and from **Splec Note ▸ Check for Updates…**, the app asks the configured
endpoint whether a newer signed release exists, then downloads, verifies the
signature and relaunches.

### Updater signing key

Updates are verified with a **minisign** key pair (separate from the Apple
identity). The **public** key is committed in
`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`. The **private** key is a
release secret — never commit it.

> The pubkey currently in the repo is a **throwaway placeholder**. Generate a
> real pair before shipping and replace it:

```bash
npm run tauri signer generate -- -w ~/.splec/updater.key
# Put the printed PUBLIC key into tauri.conf.json → plugins.updater.pubkey
```

Sign updates at build time by exporting the private key:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.splec/updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<key password, if any>"
npm run tauri build
```

This emits a `.sig` next to each updater artifact.

### Update endpoint

`plugins.updater.endpoints` points at:

```
https://splecdevelopers.com/splec-note/updates/{{target}}/{{arch}}/{{current_version}}
```

The server must return **404** when up to date, or JSON like:

```json
{
  "version": "0.1.1",
  "notes": "Bug fixes",
  "pub_date": "2024-01-01T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of the .sig file>",
      "url": "https://splecdevelopers.com/splec-note/dl/Splec-Note_0.1.1_aarch64.app.tar.gz"
    }
  }
}
```

Update the endpoint host if you serve releases elsewhere (e.g. GitHub Releases).

## 7. CI

`.github/workflows/ci.yml` runs on every PR and on `main`:

- `npm ci`, `npm run build`, `cargo test --locked`
- `npm run tauri build -- --no-bundle` on **macOS** and **Windows**

Signing/notarization secrets are **not** referenced in CI; wire them into a
separate, tag-triggered release workflow using repository secrets when you are
ready to publish.

## 8. Release checklist

- [ ] Bump version in `package.json` + `tauri.conf.json`.
- [ ] Replace the placeholder updater pubkey with your real public key.
- [ ] `npm run tauri build` with signing + notarization env vars set.
- [ ] Verify the `.dmg` opens, the app launches, and Gatekeeper accepts it.
- [ ] Upload artifacts + `.sig` files and publish the updater JSON.
- [ ] Tag and push: `git tag vX.Y.Z && git push --tags`.
