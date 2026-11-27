# IG-Now v2.5.3 — release notes & provenance

Version **2.5.3**, prepared **2026-11-27** (`v2.5.2 -> v2.5.3`), shipping the Electron-for-Linux release client (`.AppImage`, `.deb`, `.rpm`) reusing `frontend/` directly, cross-platform H.264+AAC `.mp4` and lossless/alpha `.png`/`.jpg`/`.gif` normalization (`src-tauri/` + `electron-linux/`), the Instagram Notes music clip waveform selector ([issue #8](https://github.com/benedictusrey/IG-Now/issues/8)), and macOS Dock/tray/shortcut parity; see `../versions.json`.

## Verified Pre-Release Checks

- `npm test` (root frontend suite): **57/57 passed** (`links.test.js`, `direct-messages.test.cjs`, `instagram-tools.test.cjs`, `downloader.test.cjs`).
- `node --check`: **passed** (`frontend/instagram-tools.js`, `frontend/direct-messages.js`, `frontend/downloader.js`).
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: **passed**.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked`: **passed** (0 `dead_code` warnings).
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`: **53/53 passed** on Windows and **51/51 passed** on Arch WSL (including real `ffmpeg` tests).
- `electron-linux/` `npm test` & `node --check` in Arch WSL: **22/22 passed**, syntax clean across `backend.js`, `main.js`, `preload-instagram.js`, `preload-downloader.js`, `test.cjs`, and `npx electron-builder --linux` built `IG-Now_2.5.3_amd64.AppImage` cleanly.
- `impeccable detect --json frontend/downloader.html`: **0 findings (`[]`)**.

## Release Packaging

Gitignored installers for this release belong under `binaries/` alongside `checksums.txt` / `SHA256SUMS.txt`. Tagging and pushing `v2.5.3` triggers `.github/workflows/release.yml` (`prepare` → `build` → `publish`) to build Windows (`.exe`, `.msi`) and macOS Universal (`.dmg`, `.app.tar.gz`) via Tauri v2, and Linux (`.AppImage`, `.deb`, `.rpm`) via `electron-linux/` (`electron-builder`) with unified SHA-256 manifests.

### Verified Local Artifacts
- **Windows NSIS (`IG-Now_2.5.3_x64-setup.exe`):** `2,534,522` bytes — SHA-256 `272d5acb34ca51e6d0ee1e716aac0283c3bbe121623412544a4cc2ac7f06b047`
- **Windows WiX (`IG-Now_2.5.3_x64_en-US.msi`):** `3,526,656` bytes — SHA-256 `f253db2173fb8636b087903d238ead13f97dc00603342dc32eda5b6601cf88c9`
- **Linux AppImage (`IG-Now_2.5.3_amd64.AppImage`):** `126.1 MB` built and verified in Arch WSL (`.deb`/`.rpm` + macOS Universal `.dmg`/`.app.tar.gz` are CI-only)

### Verification Caveats
- macOS Universal (`.dmg`, `.app.tar.gz`) and Linux `.deb` / `.rpm` packages were not built locally and rely on `.github/workflows/release.yml` (`prepare` → `build` → `publish`).
- Issue #8 live Note Share interception was verified up to request patching with network submission aborted (`Fetch.failRequest`) without publishing a live Note.
