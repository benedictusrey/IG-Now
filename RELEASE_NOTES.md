# IG-Now v2.5.1

**Released 2026-11-25** — maintenance and performance release resolving [issue #6](https://github.com/benedictusrey/IG-Now/issues/6) (Linux launch freezes and video/scroll stuttering) while speeding up scrolling, video loading, and GraphQL caching across Windows, macOS, and Linux.

---

## 🔧 What's Fixed & Optimized

### Linux Wayland & WebKitGTK Stability ([issue #6](https://github.com/benedictusrey/IG-Now/issues/6))
- **DMA-BUF Freeze Fix (`main.rs`):** Automatically defaults `WEBKIT_DISABLE_DMABUF_RENDERER=1` on Linux when unset, preventing immediate WebKitGTK freezes on GNOME Wayland, Arch Linux, AMD Vega iGPUs, and NVIDIA drivers while respecting explicit user overrides.
- **Wayland Window & Watchdog Lifecycle (`lib.rs`, `notifications.rs`):** Shows Linux windows directly at launch (unless `--minimized`) to prevent Wayland hidden-window decoration/input freezes, skips unsupported client `set_position` calls on Wayland, ensures unsupported `is_minimized()` queries never lock the app into a permanently hidden/paused state, and eliminates unnecessary non-Windows `is_focused()` polling from the 800 ms watchdog.

### Smooth Scrolling, Video Load & Compositor Performance
- **Zero-Thrash Scroll & DOM Scanning (`instagram-tools.js`):** Fast-paths mounted sidebar buttons without full-document link sweeps, skips header/nav/avatar elements before layout reads, stops `MutationObserver` from firing on `style`/`class` animation churn, avoids redundant `sync()` DOM writes, and unifies carousel nav rescanning.
- **Single-Pass GraphQL Cache & Compositor Relief (`instagram-tools.js`, `direct-messages.js`):** Eliminated duplicate 6,000-node JSON scans and eager `JSON.stringify` work during feed/Reel scrolling via lazy `rawNodeJson` serialization, and removed per-card `backdrop-filter: blur()` from `.ignow-image-download-btn` to stop offscreen blur passes during scroll.

---

## 📦 Universal Downloads (Windows, macOS & Linux)

| Platform | Package / Installer | Architecture & Runtime Notes |
| --- | --- | --- |
| **Windows 10 / 11** | `IG-Now_2.5.1_x64-setup.exe` (NSIS)<br>`IG-Now_2.5.1_x64_en-US.msi` (WiX) | x64 with Edge WebView2 `downloadBootstrapper` (WebView2 preinstalled on Windows 11) |
| **macOS 10.15+** | `IG-Now_2.5.1_universal.dmg`<br>`IG-Now.app.tar.gz` | Single Universal binary (`arm64` Apple Silicon + `x86_64` Intel); first run: right-click → **Open** |
| **Linux (Universal)** | `IG-Now_2.5.1_amd64.AppImage` | Portable x64 binary (`chmod +x IG-Now_2.5.1_amd64.AppImage && ./IG-Now_2.5.1_amd64.AppImage`) |
| **Linux (Packages)** | `IG-Now_2.5.1_amd64.deb`<br>`IG-Now_2.5.1_x86_64.rpm` | Native packages (`sudo apt install` / `sudo dnf install`; requires `libwebkit2gtk-4.1` and GStreamer plugins `gst-plugins-good` / `gst-plugins-bad` / `gst-libav` for HTML5 video) |

- **Verify Checksums:** Both `checksums.txt` and `SHA256SUMS.txt` are published with every release (`sha256sum -c checksums.txt` on macOS/Linux, or `Get-FileHash` in PowerShell / `local-Windows-SHA256SUMS.txt` locally on Windows).
- **Optional FFmpeg:** Having `ffmpeg` on `PATH` unlocks DASH H.264+AAC `.mp4` muxing and `.m4a` extraction; progressive MP4s and full-res images save with zero external tools.

---

## ✅ Validation Summary

- `npm test`: **38 / 38 passed** (`links.test.js`, `direct-messages.test.cjs`, `instagram-tools.test.cjs`, `downloader.test.cjs`) + `node --check` clean across all frontend scripts.
- `cargo fmt --check` passed; `cargo test --locked --lib`: **43 / 43 passed** (including `unsupported_minimized_query_does_not_force_window_hidden` and full downloader/tray/audio/geometry suites).
- Compiled Windows x64 `npx tauri build` (`IG-Now.exe`, `IG-Now_2.5.1_x64-setup.exe`, `IG-Now_2.5.1_x64_en-US.msi`) with verified SHA-256 manifests.

Crafted with care by [@benedictusrey](https://github.com/benedictusrey). Thanks to [@berhendsma-bot](https://github.com/berhendsma-bot) for reporting the Arch Linux / GNOME Wayland freeze in [issue #6](https://github.com/benedictusrey/IG-Now/issues/6).
