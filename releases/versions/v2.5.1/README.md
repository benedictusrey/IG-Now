# IG-Now v2.5.1 — local build

Version **2.5.1**, built **2026-11-25** on Windows x64 from this repository (`v2.5.0 -> v2.5.1`, resolving [issue #6](https://github.com/benedictusrey/IG-Now/issues/6) Linux Wayland/WebKitGTK launch freezes and video/scroll stuttering, hardening Wayland window visibility/positioning/minimized-state checks, and optimizing DOM scroll scanning, single-pass lazy GraphQL caching, and compositor paint performance; see `../versions.json`).

## Validation

- `npm test` (`frontend/links.test.js`, `frontend/direct-messages.test.cjs`, `frontend/instagram-tools.test.cjs`, `frontend/downloader.test.cjs`): **38/38 passed** (includes scroll sidebar fast-path, lazy GraphQL `rawNodeJson` caching, and zero-`backdrop-filter` feed image button assertions).
- `node --check` (`frontend/instagram-tools.js`, `frontend/direct-messages.js`, `frontend/downloader.js`): **passed**.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: **passed**.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`: **43/43 passed** (includes `unsupported_minimized_query_does_not_force_window_hidden`).
- Windows installers (`IG-Now_2.5.1_x64-setup.exe`, `IG-Now_2.5.1_x64_en-US.msi`) and standalone `IG-Now.exe` built via `npx tauri build` and synced into `binaries/` with SHA-256 manifests (`SHA256SUMS.txt` and `local-Windows-SHA256SUMS.txt`).

## Files

| File | Origin | SHA-256 |
| --- | --- | --- |
| `binaries/IG-Now_2.5.1_x64-setup.exe` | Local build (`npx tauri build`) — NSIS installer (2,487,122 bytes) | `720e051cd7dda65fe8dd6ace7e9a27043633039d4e07eaa0563799ade11172e8` |
| `binaries/IG-Now_2.5.1_x64_en-US.msi` | Local build (`npx tauri build`) — MSI installer (3,477,504 bytes) | `808a0311a0479d85ad3d19bccbb50f4b688c3c7b7a7d9bb6690e1df475461a82` |
| `binaries/IG-Now.exe` | Local build (`npx tauri build`) — standalone executable (7,279,616 bytes) | `a52fa9ac4a1bd34129b3cf28214055e2e17f929e9dc9a7ba5e340d3bea84482f` |
| `binaries/SHA256SUMS.txt` | SHA-256 manifest | — |
| `binaries/local-Windows-SHA256SUMS.txt` | Windows SHA-256 manifest copy | — |

Binaries in `binaries/` are gitignored; tag and push `v2.5.1` to build and publish Windows, macOS Universal, and Linux (`.AppImage`, `.deb`, `.rpm`) packages via `.github/workflows/release.yml`.
