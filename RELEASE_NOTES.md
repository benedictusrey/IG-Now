# IG-Now v2.5.2

**Released 2026-11-26** — Linux performance, Reels fluidity, and cross-platform stability release building on [PR #7](https://github.com/benedictusrey/IG-Now/pull/7) / [issue #6](https://github.com/benedictusrey/IG-Now/issues/6), alongside Core Audio, Downloader, keyboard accessibility, and UI polish across Windows, macOS, and Linux.

---

## 🔧 What's New & Fixed in v2.5.2

### Linux Wayland / XWayland & WebKitGTK Performance Overhaul
- **Pre-Navigation WebKitGTK Configuration & DRI3 DMA-BUF Probing (`main.rs`, `lib.rs`):** Routes Wayland sessions with `DISPLAY` cleanly via XWayland (`GDK_BACKEND=x11`) when unset, checks `/dev/dri/renderD*` + X11 `DRI3` (`x11_supports_dri3`) so capable Mesa GPUs keep hardware DMA-BUF enabled, and configures safe CPU/SHM fallback (`WEBKIT_DISABLE_DMABUF_RENDERER=1`, `GST_PLUGIN_FEATURE_RANK` NVDEC demotion, `WEBKIT_SKIA_CPU_PAINTING_THREADS`, `WEBKIT_FORCE_VBLANK_TIMER=1`) where needed (WSLg / NVIDIA / non-DRI3). Boots Linux onto `about:blank` to apply `CacheModel::WebBrowser` and smooth scrolling before initial `instagram.com` navigation, and removes the permanent `800 ms` watchdog polling loop in favor of event-driven focus/tray restore (`__resumeIfNeeded()`).
- **Off-Route `<video>` & Detached GStreamer Cleanup (`instagram-tools.js`):** Cleans hidden/off-route `rect.height <= 0` videos in `capOffscreenVideos()` regardless of total video count and tears down removed route `<video>` pipelines on Linux (`queueDetachedVideosInNode()`).
- **Lazy Reels Controls & Deferred Mute Sync (`instagram-tools.js`):** Mounts `.ignow-video-controls` lazily when videos enter or approach the viewport (and tears down far-offscreen Reel bars on Linux), while coalescing automatic post-scroll native mute-button clicks (`scheduleNativeMuteSync`) off the active scroll transition.
- **CSSOM Blur Signature Cache & Delta Observers (`instagram-tools.js`, `direct-messages.js`):** Replaces `div:has(...)` selectors with direct `.ignow-linux-no-blur` marking, defers `>200`-rule blur scans off startup and caches `linuxStyleSheetSignature()` on scroll, adds top-frame/`about:` guards, moves image buttons & Explore grid tiles to `IntersectionObserver` deltas, and caps caches at `120` LRU entries.

### Cross-Platform Reliability & Accessibility Fixes
- **Windows Core Audio COM Lifetime (`audio.rs`):** Ensures `AudioSessionKeepAlive` always drops COM session proxies before `CoUninitialize()`.
- **Downloader Atomicity & Hardening (`downloader.rs`, `lib.rs`, `downloader.html`, `downloader.js`):** Same-directory temp remuxes + rollback-safe `replace_file_atomically()`, `--proto =http,https --proto-redir =http,https --max-redirs 5` curl hardening, dark `<select>` options, accurate `setBusy()` button states, and `aria-busy`.
- **Keyboard, Focus & Overlay Polish (`instagram-tools.js`, `tray.rs`):** Adds keyboard `input` handlers on seek/volume sliders, `blur`/`pointercancel` drag cleanup, visible `:focus-visible` outlines, dialog ARIA + focus restoration in the viewer/context menu, blur-free Linux About modal with `Tab` trapping, pre-hide mute preservation in `__ignowEnsureForegroundAudio`, and `copy_url` fallback.

---

## ⚡ Arch Linux (WSLg / WebKitGTK 2.54.3) Benchmark Comparison

| Scenario | Before (`v2.5.1` / early pass) | `v2.5.2` Measured | Improvement |
|---|---|---|---|
| **Cold Startup (`TTI`)** | `~2,500–5,082 ms` | **`2,380 – 2,469 ms`** | Pre-nav `WebBrowser` cache + deferred CSSOM scan |
| **Idle Reels CSS Blur Spikes** | `200 – 942 ms` (`6–11 FPS`) | **Neutralized (`p50: 16 ms`)** | Zero `SkBlurEngine` main-thread stalls |
| **Home Feed Real Wheel** | `p95: 99 ms`, `max: 121–164 ms`, `userGbcr: 104` | **`p50: 16 ms`, `avg: 18.35–19.72 ms`, `p95: 26–50 ms`, `userGbcr: 54`** | **~2x–3.8x tighter `p95`**, ~50% fewer layout reads |
| **Explore Real Wheel** | `max: 77 ms`, `userGbcr: 293`, `1,239 MB` RSS | **`avg: 15.0–15.5 ms`, `max: 42 ms` (`over50: 0`), `userGbcr: 15–18`, `961–1,094 MB`** | **94% fewer layout reads**, zero >50 ms stalls |
| **Reels Entry (post-Explore)** | `1,628–2,191 MB`, `319–448` thr, `43–60` `av:h264`, `9/9` controls | **`963–1,032 MB`, `62–99` thr, `4–10` `av:h264`, `4/11–5/9` lazy controls** | **~50% less RAM & 69–80% fewer decoder threads** |

---

## 📦 Universal Downloads (Windows, macOS & Linux)

| Platform | Package / Installer | Architecture & Runtime Notes |
| --- | --- | --- |
| **Windows 10 / 11** | `IG-Now_2.5.2_x64-setup.exe` (NSIS)<br>`IG-Now_2.5.2_x64_en-US.msi` (WiX) | x64 with Edge WebView2 `downloadBootstrapper` (WebView2 preinstalled on Windows 11) |
| **macOS 10.15+** | `IG-Now_2.5.2_universal.dmg`<br>`IG-Now.app.tar.gz` | Single Universal binary (`arm64` Apple Silicon + `x86_64` Intel); first run: right-click → **Open** |
| **Linux (Universal)** | `IG-Now_2.5.2_amd64.AppImage` | Portable x64 binary (`chmod +x IG-Now_2.5.2_amd64.AppImage && ./IG-Now_2.5.2_amd64.AppImage`) |
| **Linux (Packages)** | `IG-Now_2.5.2_amd64.deb`<br>`IG-Now_2.5.2_x86_64.rpm` | Native packages (`sudo apt install` / `sudo dnf install`; requires `libwebkit2gtk-4.1` and GStreamer plugins `gst-plugins-good` / `gst-plugins-bad` / `gst-libav` for HTML5 video) |

- **Verify Checksums:** Both `checksums.txt` and `SHA256SUMS.txt` are published with every release (`sha256sum -c checksums.txt` on macOS/Linux, or `Get-FileHash` in PowerShell on Windows).
- **Optional FFmpeg:** Having `ffmpeg` on `PATH` unlocks DASH H.264+AAC `.mp4` muxing and `.m4a` extraction; progressive MP4s and full-res images save with zero external tools.

---

## ✅ Validation Summary

- `npm test`: **50 / 50 passed** (`links.test.js`, `direct-messages.test.cjs`, `instagram-tools.test.cjs`, `downloader.test.cjs`) + `node --check` clean across all frontend scripts.
- `cargo fmt --check` passed on both Windows and Arch Linux.
- `cargo test --locked --lib`: **47 / 47 passed** on Windows (Rust + Core Audio COM lifetime + FFmpeg mux/extract + Downloader atomicity) and **45 / 45 passed** on Arch Linux.
- `impeccable detect --json frontend/downloader.html`: **0 issues (`[]`)**.
- Arch Linux `cargo build --release --locked` built cleanly and passed `bench-final.js` real X11 wheel/keyboard profiling.

Crafted with care by [@benedictusrey](https://github.com/benedictusrey). Thanks to [@berhendsma-bot](https://github.com/berhendsma-bot) for reporting the Arch Linux / GNOME Wayland freeze & stuttering in [issue #6](https://github.com/benedictusrey/IG-Now/issues/6).
