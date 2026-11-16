# IG-Now v2.5.0

**Released 2026-11-17** (upgrading directly from `v2.2.0` to `v2.5.0`). Inspired in part by community feedback in [issue #5](https://github.com/benedictusrey/IG-Now/issues/5), **v2.5.0** replaces external Cobalt redirects with a standalone native **IG-Now Downloader** workbench, adds **Downloader / Forward / Back** sidebar navigation with `Esc` pre-click view return, introduces grouped Windows Core Audio `"IG-Now"` session awareness with synced mute icons, and centers the desktop window at `1588 × 1025` while preserving Instagram's original native Comments layout.

---

## ✨ What's New

### Built-In Downloader Workbench (`765 × 885` Centered) & 20-Slide Carousels
- **Multiple One-Click Triggers:** Launch **Downloader** directly from the left sidebar, click the bottom-right corner **Download** icon on any photo post (including every photo slide across image-only or up-to-20-slide mixed photo+video carousels), click the download button in any video bar, or pick any of the **5 right-click context actions** (*Save image/video*, *Download post (media + caption)*, *Copy caption text*, *Open IG-Now Downloader...*, *Open post in default browser*).
- **Zero Outer Scroll UI:** The `765 × 885` workbench opens centered on IG-Now's active monitor, automatically inspects links passed from Instagram or clipboard, displays a scrollable carousel thumbnail strip (`1..20`), and keeps only the `Caption (.txt)` box scrollable.
- **High-Res Formats & Naming:** Downloads DASH **H.264 + 192 kbps stereo AAC `.mp4`** (with optional FFmpeg muxing), **`Audio Only (.m4a)`**, MIME-validated full-resolution images, and **`Save Full Post`** batches (6-way concurrent downloads, zero-padded `-slide-01`..`-slide-20` on 10+ slide posts, `caption.txt`, and `metadata.json`) into `Downloads/IG-Now` using `source_username-YYYYMMDD-<8hex>` stems.
- **Collaboration & Image-Only Posts:** Supports collaboration URLs (`/{username}/p/{shortcode}/`, `coauthor_producers` fallback) and streamlines image-only posts/carousels with **`Save All N Images + Caption`** / **`Save Image + Caption`**.

### Sidebar Navigation, `Esc` Return & Original Instagram Comments
- **Sidebar Buttons Above `More`:** **Downloader**, **Forward**, and **Back** adapt cleanly across expanded, compact 72 px icon-rail, dark, and light themes with duplicate-URL `popstate` tracking.
- **Quick Return & Shortcuts:** Pressing `Esc` closes modals/overlays or returns to your pre-click view instead of dumping back to Home (`Alt+Left` / `Alt+Right` history shortcuts included).
- **Centered Desktop Geometry:** Main window opens centered at `1588 × 1025` logical px inside the monitor work area, preserving Instagram's native Comments panel cleanly without icon displacement.

### Windows Foreground Audio & Hardened Page Inspection
- **Grouped `"IG-Now"` Audio Session:** Windows Core Audio registers `"IG-Now"` across active render endpoints so **Volume mixer** displays the app clearly and auto-unmutes foreground playback.
- **Two-Way Mute Sync & Fiber Guard:** Left control-bar volume toggle and Instagram's native corner mute button stay bidirectionally synced; React Fiber extraction safely skips cross-origin `WindowProxy` frames without `SecurityError`.

---

## 📦 Universal Downloads (Windows, macOS & Linux)

| Platform | Package / Installer | Architecture & Runtime Notes |
| --- | --- | --- |
| **Windows 10 / 11** | `IG-Now_2.5.0_x64-setup.exe` (NSIS)<br>`IG-Now_2.5.0_x64_en-US.msi` (WiX) | x64 with Edge WebView2 `downloadBootstrapper` (WebView2 preinstalled on Windows 11) |
| **macOS 10.15+** | `IG-Now_2.5.0_universal.dmg`<br>`IG-Now.app.tar.gz` | Single Universal binary (`arm64` Apple Silicon + `x86_64` Intel); first run: right-click → **Open** |
| **Linux (Universal)** | `IG-Now_2.5.0_amd64.AppImage` | Portable x64 binary (`chmod +x IG-Now_2.5.0_amd64.AppImage && ./IG-Now_2.5.0_amd64.AppImage`) |
| **Linux (Packages)** | `IG-Now_2.5.0_amd64.deb`<br>`IG-Now_2.5.0_x86_64.rpm` | Native packages (`sudo apt install` / `sudo dnf install`; requires `libwebkit2gtk-4.1`) |

- **Verify Checksums:** Both `checksums.txt` and `SHA256SUMS.txt` are published with every release (`sha256sum -c checksums.txt` on macOS/Linux, or `Get-FileHash` in PowerShell / `local-Windows-SHA256SUMS.txt` locally on Windows).
- **Optional FFmpeg:** Having `ffmpeg` on `PATH` unlocks DASH H.264+AAC `.mp4` muxing and `.m4a` extraction; progressive MP4s and full-res images save with zero external tools.

---

## ✅ Validation Summary

- `npm test`: **37 / 37 passed** (`links.test.js`, `direct-messages.test.cjs`, `instagram-tools.test.cjs`, `downloader.test.cjs`) + `node --check` clean across all frontend scripts.
- `cargo fmt --check` passed; `cargo test --locked --lib`: **42 / 42 passed** (20-item mixed carousels, fallback retries, collaboration posts, header validation, non-Windows GUI FFmpeg candidate paths, stdin `curl --config -` auth header escaping, FFmpeg MP4 muxing / M4A extraction, Core Audio STA COM, multi-monitor centering).
- Headless Chrome geometry verification (`765×885`, `765×794`, `580×620` — zero outer scroll, balanced columns, zero clipped buttons), `impeccable detect --json` (`[]`), and compiled Windows x64 `npx tauri build` installers verified.

Crafted with care by [@benedictusrey](https://github.com/benedictusrey). Special thanks to [@SohaybKu](https://github.com/SohaybKu) for requesting the native video downloader and Back navigation in [issue #5](https://github.com/benedictusrey/IG-Now/issues/5).
