# IG-Now v2.5.3

**Released 2026-11-27** — Cross-platform media compatibility & format normalization release, **Electron-for-Linux** desktop packaging (`.AppImage`, `.deb`, `.rpm`), Instagram Notes music clip selector ([issue #8](https://github.com/benedictusrey/IG-Now/issues/8)), and macOS Dock/tray/shortcut parity across Windows, macOS, and Linux.

---

## 🔧 What's New & Fixed in v2.5.3

### Instagram Notes Music Clip Selector (`frontend/instagram-tools.js`, Issue #8)
- **Waveform Clip Editor for Notes (`/direct/inbox/`):** Attaching a song in the `/direct/inbox/` Notes composer injects a floating **Select clip** button next to `Remove song` that opens a dark Instagram-style modal (`role="dialog"`, `aria-modal="true"`, `Esc`/`Tab` accessible) with album art, `[E]` explicit badge, adjustable `5s`–`30s` duration controls, highlight chips, `mm:ss` start/end timestamps, a 60-bar draggable + keyboard-scrubbable waveform, live audio preview (paused automatically on hide/minimize), and `music_note_create_info.start_time` / `duration` request patching on Share.

### Electron-for-Linux Release Client (`AppImage`, `deb`, `rpm`)
- **Electron-for-Linux Host (`electron-linux/`):** Linux builds now ship on **Electron (`electron-linux/`)** reusing IG-Now's shared `frontend/` scripts and Downloader UI directly (`persist:profile-personal` session, system tray & close-to-tray, DM unread alerts, XDG autostart with `APPIMAGE`-aware `Exec=` path, and bare-metal VA-API / WSLg compositing detection), eliminating WebKitGTK/GStreamer scroll stalls and decoder bloat while Windows and macOS continue on lightweight **Tauri v2 + Rust**.
- **Packaged Asset & Autostart Path Resolution:** Resolves packaged `frontend/` and `icons/` via `process.resourcesPath` cleanly alongside `electron .` development mode, and preserves the real `.AppImage` path in `IG-Now.desktop` autostart entries.

### Cross-Platform Media Codec & Image Extension Parity
- **Codec-Aware DASH & Track Selection (`downloader.rs`, `backend.js`, `instagram-tools.js`):** Prefers `avc1` > `hev1`/`hvc1` > `vp09`/`vp9` > `av01` video and `mp4a` > `opus` audio at equal resolution so native H.264 + AAC streams download without unnecessary re-encoding.
- **Universal `.mp4` Normalization:** Preserves native H.264 `yuv420p` + AAC `+faststart` MP4s byte-for-byte, remuxes fragmented or late-`moov` MP4s losslessly (`-movflags +faststart`), and transcodes only incompatible video/audio streams (including WebM inputs) to H.264 `yuv420p` + AAC when `ffmpeg` is available.
- **Magic-Byte Image Detection & Format Conversion:** Rejects non-image `ftyp` payloads (e.g., `ftypisom`), preserves authentic JPEG/PNG/GIF files under matching `.jpg`/`.png`/`.gif` extensions, converts WebP/AVIF/HEIC images to `.png` (lossless/alpha) or `-q:v 1` `.jpg`, and surfaces the actual saved file path in Downloader status.

### macOS & Cross-Platform UX Fixes
- **macOS Dock & Tray Integration (`lib.rs`, `tray.rs`):** Clicking the macOS Dock icon reopens the window after close-to-tray (`RunEvent::Reopen`), and left-clicking the macOS menu-bar icon opens the tray menu idiomatically.
- **Shortcuts & Typography (`instagram-tools.js`, `direct-messages.js`, `downloader.js`):** Adds `Cmd+Click` image zoom support and platform-aware `Cmd+L` / `Cmd+V` hints on macOS, updates `.ignow-dmlink` to the cross-platform system font stack, and resolves Linux helper `dead_code` warnings on Windows/macOS Rust builds.

---

## 📦 Universal Downloads (Windows, macOS & Linux)

| Platform | Package / Installer | Runtime & Notes |
| --- | --- | --- |
| **Windows 10 / 11** | `IG-Now_2.5.3_x64-setup.exe` (NSIS)<br>`IG-Now_2.5.3_x64_en-US.msi` (WiX) | Tauri v2 + Edge WebView2 (`downloadBootstrapper`; preinstalled on Windows 11) |
| **macOS 10.15+** | `IG-Now_2.5.3_universal.dmg`<br>`IG-Now_universal.app.tar.gz` | Tauri v2 Universal binary (`arm64` Apple Silicon + `x86_64` Intel); first run: right-click → **Open** |
| **Linux (Universal)** | `IG-Now_2.5.3_amd64.AppImage` | Electron-for-Linux portable x64 (`chmod +x IG-Now_2.5.3_amd64.AppImage && ./IG-Now_2.5.3_amd64.AppImage`) |
| **Linux (Packages)** | `IG-Now_2.5.3_amd64.deb`<br>`IG-Now-2.5.3-1.x86_64.rpm` | Native packages (`sudo apt install ./IG-Now_2.5.3_amd64.deb` / `sudo dnf install ./IG-Now-2.5.3-1.x86_64.rpm`) |

- **Verify Checksums:** Both `checksums.txt` and `SHA256SUMS.txt` are published with every release (`sha256sum -c checksums.txt` on macOS/Linux, or `Get-FileHash` in PowerShell on Windows).
- **Optional FFmpeg:** Having `ffmpeg` on `PATH` unlocks DASH H.264+AAC `.mp4` muxing, incompatible codec transcoding, WebP/AVIF/HEIC conversion, and `.m4a` extraction; compatible MP4s and JPEG/PNG/GIF images save with zero external tools.

---

Crafted with care by [@benedictusrey](https://github.com/benedictusrey).
