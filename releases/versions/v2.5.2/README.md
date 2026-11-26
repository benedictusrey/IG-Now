# IG-Now v2.5.2 — release notes & provenance

Version **2.5.2**, prepared **2026-11-26** (`v2.5.1 -> v2.5.2`), delivering the full Linux WebKitGTK / Wayland / XWayland performance & video pipeline overhaul (following up [issue #6](https://github.com/benedictusrey/IG-Now/issues/6) and [PR #7](https://github.com/benedictusrey/IG-Now/pull/7)), cross-platform Core Audio COM lifetime & Downloader atomicity fixes, and UI/accessibility hardening; see `../versions.json`.

## Verified Pre-Release Checks

- `npm test`: **50/50 passed** (`links.test.js`, `direct-messages.test.cjs`, `instagram-tools.test.cjs`, `downloader.test.cjs`).
- `node --check`: **passed** (`frontend/instagram-tools.js`, `frontend/direct-messages.js`, `frontend/downloader.js`).
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: **passed** on Windows & Arch Linux.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`: **47/47 passed** on Windows and **45/45 passed** on Arch Linux.
- `impeccable detect --json frontend/downloader.html`: **0 findings (`[]`)**.
- Arch Linux `cargo build --release --locked` & `bench-final.js`: verified Cold TTI (`2,380–2,469 ms`), Home wheel (`p50: 16 ms`, `p95: 26–50 ms`), Explore wheel (`avg: 15.0–15.5 ms`, `max: 42 ms`, `over50: 0`), and Reels entry (`963–1,032 MB` RSS, `62–99` threads).

## Release Packaging

Gitignored installers for this release belong under `binaries/` alongside `checksums.txt` / `SHA256SUMS.txt`. Tagging and pushing `v2.5.2` triggers `.github/workflows/release.yml` to build Windows (`.exe`, `.msi`), macOS Universal (`.dmg`, `.app.tar.gz`), and Linux (`.AppImage`, `.deb`, `.rpm`) packages with SHA-256 manifests.
