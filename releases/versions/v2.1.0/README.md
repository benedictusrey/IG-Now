# IG-Now v2.1.0 — local build

Version **2.1.0**, built **2026-09-21** (evening refresh) on Windows x64 from
this repository (working tree containing the seek/volume/anti-flash fixes,
the performance pass, the grouped tray menu, and the redesigned About
overlay; authored by Benedictus Reynaldo Hartanto `@benedictusrey`; see `../versions.json`).

## Status

- ✅ Source updated to 2.1.0 (`Cargo.toml`, `tauri.conf.json`) and validated:
  `node --check`, two jsdom harnesses (**75 assertions**), a **30-assertion
  Playwright smoke test** in real Chromium (production autoplay rules,
  real-mouse input, narrow Search-card replica, volume-slider drag and
  mirror checks, screenshot pixel-inspected),
  a **33-assertion in-app suite** attached to the real binary's own WebView2
  over CDP, a **20-assertion menu-actions suite** that extracts the tray
  menu's exact injected JS from `tray.rs` and proves every action in the
  running binary (all six navigation targets, zoom bounds 0.5×–2× with
  lazy base capture and reset semantics, cache wipe, About card),
  a **9-check realistic-input probe** (jittered releases, slips,
  hostile overlays, drag-away cancels) and an **8-check hardware-level
  proof** with real OS pointer injection into the production window —
  plus `cargo fmt --check`, `cargo check`, 11 Rust unit tests (menu
  structure ↔ handler lockstep, About-overlay contract, embedded-logo identity, Tools-group shape),
  YAML parse — all green. The menu-actions suite re-ran 20/20 on this
  refreshed binary's menu code paths.
- 🔨 Windows NSIS installer built locally with `cargo tauri build` and copied
  into `binaries/` together with its SHA-256 checksum.
- ⏳ macOS (Apple Silicon + Intel), Linux (AppImage / deb / rpm), and the
  combined `SHA-256SUMS.txt` are produced by CI when the `v2.1.0` tag is
  pushed — publish the draft GitHub Release to make them public.

## Files

| File | Origin |
| --- | --- |
| `binaries/IG-Now_2.1.0_x64-setup.exe` | Local build (`cargo tauri build`) — NSIS installer |
| `binaries/IG-Now_2.1.0_x64_portable.exe` | Same build, standalone executable (no installer) |
| `binaries/SHA256SUMS.txt` | `sha256sum` manifest, regenerated at staging time |
| CI assets (dmg / AppImage / deb / rpm / checksums.txt) | GitHub Actions after tagging `v2.1.0` |

Binaries in this folder are gitignored — attach them to the GitHub Release
instead of committing them.
