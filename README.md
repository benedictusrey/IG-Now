<p align="center">
  <img src="frontend/logo.png" alt="IG-Now" width="120" height="120"/>
</p>

<h1 align="center">IG-Now</h1>

<p align="center">
  <strong>A high-performance, cross-platform desktop client for <a href="https://instagram.com">Instagram</a></strong><br/>
  Built with <a href="https://tauri.app">Tauri v2</a> + Rust · WebView2 · WebKit
</p>

<p align="center">
  <strong>🎉 v2.5.0 IS NOW LIVE! 🎉</strong><br/>
  <em>Native Downloader workbench (`.mp4` H.264+AAC, `.m4a` audio, 20-slide carousels &amp; captions) · Sidebar Downloader, Forward &amp; Back navigation (`Esc` return) · Grouped `"IG-Now"` audio session + synced mute buttons · Centered `1588×1025` layout with original Instagram comments</em>
</p>

<p align="center">
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-4285f4?style=flat-square&logo=windows&logoColor=white">
  <img alt="macOS" src="https://img.shields.io/badge/platform-macOS%20(Universal)-lightgrey?style=flat-square&logo=apple&logoColor=black">
  <img alt="Linux" src="https://img.shields.io/badge/platform-Linux%20(Universal)-FCC624?style=flat-square&logo=linux&logoColor=black">
  <img alt="Rust and Tauri 2" src="https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202-24C8DB?style=flat-square&logo=tauri&logoColor=white">
  <img alt="WebView2 and WebKit" src="https://img.shields.io/badge/rendering-WebView2%20%2F%20WebKit-0078D4?style=flat-square&logo=microsoftedge&logoColor=white">
  <img alt="Version 2.5.0" src="https://img.shields.io/badge/version-2.5.0-e1306c?style=flat-square">
  <a href="https://github.com/benedictusrey"><img src="https://img.shields.io/badge/author-%40benedictusrey-black?style=flat-square&logo=github"/></a>
</p>

---

> **Disclaimer:** IG-Now is an independent open-source project and is not affiliated with, sponsored by, or maintained by Instagram or Meta Platforms, Inc. Use Instagram and media-saving tools in accordance with applicable laws and platform terms.

## ✨ Desktop Showcase

### 1. Native Performance & Centered Desktop Experience
Built on **Tauri v2 + Rust** (~7 MB binary, zero Electron overhead), IG-Now launches in a dark paint-ready frame sized at **`1588 × 1025`** centered on your active monitor work area. Instagram's official feed and original native **Comments** panel stay intact with zero overlapping action icons.

<p align="center">
  <img src="docs/assets/IG-Now%20hero.png" alt="IG-Now Desktop Experience Hero Showcase" width="100%"/>
</p>

### 2. Immersive Reels, Seeking & Synced Audio Controls
Every video across Reels, the home feed, and Search hover previews gets native playback controls handled cleanly above page overlays:
- **Interactive Seek Bar & Skip:** Click or drag anywhere along the seek line, jump `-5s` / `+5s`, or step Reels with `⏮` / `⏭`.
- **Two-Way Volume Sync & Foreground Guard:** Hover volume slider and mute toggle stay synchronized with Instagram's corner mute button, while protecting user mute choices across transitions.

<p align="center">
  <img src="docs/assets/IG-Now%20features.png" alt="IG-Now In-Depth Features and Media Overlay" width="100%"/>
</p>

### 3. System Tray, OS Audio Session & Smart Background Control
- **Tray Navigation & Close-to-Tray:** Jump straight to Home, Explore, Reels, Messages, Notifications, or Profile, or launch minimized on startup (`--minimized`). Closing `✕` tucks cleanly into the system tray.
- **Minimize Pause & Grouped `"IG-Now"` Mixer:** Hiding or minimizing pauses all active video and mutes OS audio immediately; on Windows, Core Audio registers a grouped **`IG-Now`** session visible in **Volume mixer** and auto-unmutes foreground playback.

<p align="center">
  <img src="docs/assets/IG-Now%20tray.png" alt="IG-Now System Tray Menu and OS Shortcuts" width="100%"/>
</p>

### 4. Built-In Downloader UI & Sidebar Back / Forward Navigation
- **Downloader Workbench (`765 × 885` Centered):** Open **Downloader** from the sidebar, click the corner circular download button on any photo (including every photo slide in up-to-20 mixed photo+video carousels), click the video bar download icon, or pick any of the **5 right-click context actions**. Auto-inspects links/clipboard, previews carousel thumbnails in a fixed non-scrolling shell (scrollable caption box), and saves H.264+AAC `.mp4`, **`Audio Only (.m4a)`**, or **`Save Full Post`** batches concurrently with `source_username-YYYYMMDD-<8hex>` names (`-slide-01`..`-slide-20` on 10+ slides) plus `caption.txt` and `metadata.json` under `Downloads/IG-Now`.
- **Sidebar Downloader, Forward & Back (`Esc` Return):** Native-styled **Downloader (`↓`)**, **Forward (`→`)**, and **Back (`←`)** buttons sit cleanly above **More** across dark, light, and compact rails — paired with `Esc` returning cleanly to your pre-click view (`Close` or `history.back()`) plus `Alt + Left` / `Alt + Right`.

<p align="center">
  <img src="docs/assets/IG-Now%20downloader.png" alt="IG-Now Native Downloader UI and Sidebar Back Forward Navigation" width="100%"/>
</p>

---

## ⚔️ IG-Now v2.5.0 vs Instagram Web

| Capability | 🟣 IG-Now v2.5.0 | 🌐 Instagram Web |
|---|---|---|
| **Tray & Window Lifecycle** | Dedicated centered `1588 × 1025` window, closes to tray, pauses/mutes on minimize | Lost in browser tabs; plays audio in background |
| **OS Audio Mixer & Mute Sync** | Grouped `"IG-Now"` Windows session + two-way mute icon sync | Generic browser tab audio |
| **Video Controls** | Click/drag seek bar on **all** videos + `-5s`/`+5s` + `⏮`/`⏭` + hover volume slider | Limited controls; locked on many feeds |
| **Media & Carousel Saving** | `765 × 885` native Downloader (MP4 AAC, M4A, up-to-20 carousels, collab posts, captions) | Unavailable natively |
| **Navigation & Comments** | Sidebar **Downloader**, **Forward**, **Back** + `Esc` pre-click return; original IG comments | Relies on full browser bar |
| **Footprint & Launch** | ~7 MB native Tauri v2 binary, dark WebView2/WebKit reveal | Heavy multi-process browser tabs |

---

## 📦 Downloads & Platform Setup

Pre-built universal packages and SHA-256 manifests (`checksums.txt`, `SHA256SUMS.txt`) are published on [GitHub Releases](https://github.com/benedictusrey/IG-Now/releases).

| Platform | Package / Installer | Architecture & Runtime Notes |
|---|---|---|
| **Windows 10 / 11** | `IG-Now_2.5.0_x64-setup.exe` / `IG-Now_2.5.0_x64_en-US.msi` | x64; auto-offers [Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if missing |
| **macOS 10.15+** | `IG-Now_2.5.0_universal.dmg` / `.app.tar.gz` | Universal (`arm64` Apple Silicon + `x86_64` Intel); first run: right-click → **Open** |
| **Linux (Universal)** | `IG-Now_2.5.0_amd64.AppImage` | Portable x64 binary (`chmod +x` then run; requires `libwebkit2gtk-4.1`) |
| **Linux (Packages)** | `IG-Now_2.5.0_amd64.deb` / `.rpm` | `sudo apt install ./IG-Now_2.5.0_amd64.deb` or `sudo dnf install ./IG-Now_2.5.0_x86_64.rpm` |

*Downloads save to `Downloads/IG-Now`. Optional `ffmpeg` on `PATH` unlocks DASH H.264+AAC `.mp4` muxing and `.m4a` extraction (progressive `.mp4` and full-res images work without it).*

---

## 🔒 Privacy, Building & License

- **Local & Private:** Credentials and cookies live strictly inside your OS webview profile with zero analytics, zero external APIs, and HTTP(S)-validated external links; see [SECURITY.md](SECURITY.md).
- **Build from Source:** Requires [Rust](https://rustup.rs/) + [Node.js](https://nodejs.org/) (plus platform prerequisites in [CONTRIBUTING.md](CONTRIBUTING.md)):
  ```bash
  npm ci && npm test
  node --check frontend/instagram-tools.js && node --check frontend/direct-messages.js && node --check frontend/downloader.js
  cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
  cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
  npx tauri build
  ```
- **Author & License:** Conceived, designed, engineered, and maintained solely by **Benedictus Reynaldo Hartanto** ([@benedictusrey](https://github.com/benedictusrey)). Licensed under the **IG-Now Source & Contribution License** (Anti-Rebranding Clause applies — preserve author credits and cite [benedictusrey/IG-Now](https://github.com/benedictusrey/IG-Now); see [LICENSE](LICENSE)).
