<p align="center">
  <img src="frontend/logo.png" alt="IG-Now" width="120" height="120"/>
</p>

<h1 align="center">IG-Now</h1>

<p align="center">
  <strong>A high-performance, cross-platform desktop client for <a href="https://instagram.com">Instagram</a></strong><br/>
  Built with <a href="https://tauri.app">Tauri v2</a> + Rust · WebView2 · WebKit
</p>

<p align="center">
  <strong>🎉 IG-NOW RELEASE: v2.1.0 IS NOW LIVE! 🎉</strong><br/>
  <em>After meticulous development and deep refinement, the official v2.1.0 release is ready for production.</em>
</p>

<p align="center">
  <strong>✨ What's new in v2.1.0</strong><br/>
  <em>Interactive seek bar everywhere · synchronized volume toggle & hover slider · dedicated skip (−5s/+5s) & reel navigation (⏮/⏭) · work-area centered 1180 × 1032 window · anti-flash launch · Universal macOS & Linux builds · dual SHA-256 manifests</em>
</p>

<p align="center">
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-4285f4?style=flat-square&logo=windows&logoColor=white">
  <img alt="macOS" src="https://img.shields.io/badge/platform-macOS%20(Universal)-lightgrey?style=flat-square&logo=apple&logoColor=black">
  <img alt="Linux" src="https://img.shields.io/badge/platform-Linux%20(Universal)-FCC624?style=flat-square&logo=linux&logoColor=black">
  <img alt="Rust and Tauri 2" src="https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202-24C8DB?style=flat-square&logo=tauri&logoColor=white">
  <img alt="WebView2 and WebKit" src="https://img.shields.io/badge/rendering-WebView2%20%2F%20WebKit-0078D4?style=flat-square&logo=microsoftedge&logoColor=white">
  <img alt="Version 2.1.0" src="https://img.shields.io/badge/version-2.1.0-e1306c?style=flat-square">
  <a href="https://github.com/benedictusrey"><img src="https://img.shields.io/badge/author-%40benedictusrey-black?style=flat-square&logo=github"/></a>
</p>

---

## 🚀 Welcome to the Future of Instagram on Desktop

**IG-Now** isn't just a browser wrapper — it is a meticulously engineered native desktop client that supercharges your Instagram experience. Designed for extreme performance, distraction-free aesthetics, and power-user ergonomics, IG-Now bridges the gap between Instagram and your operating system.

> **Disclaimer:** IG-Now is an independent open-source project and is not affiliated with, sponsored by, or maintained by Instagram or Meta Platforms, Inc. Use Instagram and third-party downloader services in accordance with their terms of service, applicable laws, and copyright regulations.

<p align="center">
  <img src="docs/assets/IG-Now%20hero.png" alt="IG-Now Desktop Experience Hero Showcase" width="100%"/>
</p>

### 🌟 Why Choose IG-Now?

#### 1. Unrivaled Performance & Native Efficiency
Say goodbye to the heavy memory overhead and resource competition of typical Chromium-based browser tabs. Built with a pure Rust core and Tauri v2, IG-Now operates as a featherweight, single-process native application (~7 MB binary). It actively orchestrates background resources: media pauses instantly when hidden, memory footprint stays low, and your system remains snappy during extended browsing.

#### 2. Immersive Reels, Seeking & In-Depth Media Controls
IG-Now removes the browser chrome to give you a clean, edge-to-edge cinematic canvas. Every video across Reels, the home feed, and Search cards is equipped with native control overlays:
- **Interactive Seek Bar Everywhere:** Click or drag anywhere along the white progress line. Handled at the window-capture level, it functions reliably even across complex Instagram page layers.
- **Dedicated Skip & Navigation Buttons:** Jump `-5s` or `+5s` with dedicated buttons flanking the seek line, or navigate between posts and Reels with `⏮` and `⏭` buttons without needing mouse wheel gymnastics.
- **Synchronized Volume Control & Hover Slider:** A dedicated audio button with a hover-expand volume level slider synchronized bidirectionally with Instagram's native vertical player. A smart audio guard protects your mute/unmute choices from being overridden by page script transitions.

<p align="center">
  <img src="docs/assets/IG-Now%20features.png" alt="IG-Now In-Depth Features and Media Overlay" width="100%"/>
</p>

#### 3. Deep OS Integration & System Tray
IG-Now lives inside your operating system like a first-class desktop citizen:
- **System Tray Presence:** Instant navigation to Home, Explore, Reels, Direct Messages, Notifications, and Profile with a single right-click on the taskbar/menu bar.
- **Close-to-Tray & Pause-on-Minimize:** Clicking the `✕` close button tucks the window into the tray while preserving your signed-in session. Minimizing or hiding the window triggers an instant pause on all playing media backed by a Windows OS audio-session mute guarantee.
- **One-Click Media Saving:** Right-click any image to save it directly into `Downloads/IG-Now`. Right-click videos to copy the post link and open Cobalt downloader with the destination folder pre-created.
- **Launch on Startup:** Optional background startup that launches minimized to the tray, ready the instant you need it.

<p align="center">
  <img src="docs/assets/IG-Now%20tray.png" alt="IG-Now System Tray Menu and OS Shortcuts" width="100%"/>
</p>

---

## ⚔️ IG-Now v2.1.0 vs Instagram Web

Same official Instagram feed, account, and security — but with true desktop ergonomics:

| Capability | 🟣 IG-Now v2.1.0 | 🌐 Instagram Web (Browser Tab) |
|---|---|---|
| **System Tray & Window Presence** | Dedicated native window + tray menu with fast feed shortcuts | Lost among dozens of browser tabs |
| **Close Button (`✕`)** | Closes to tray — app remains ready, all playback pauses instantly | Closes the tab and loses navigation context |
| **Minimize Behavior** | Guaranteed pause (page-level pause + OS-level audio session mute) | Audio continues playing in the background |
| **Seek Bar on Videos** | Clickable & draggable on **all** videos (Reels, feed, Search previews) | Reel-only or completely locked to page handlers |
| **Skip & Navigation Controls** | `-5s` / `+5s` seek buttons + `⏮` / `⏭` Reel switch buttons | Keyboard only or not available |
| **Volume Control** | Dedicated overlay toggle + hover-expand level slider with 2-way sync | Page slider only, frequently auto-remutes |
| **Media Saving** | Right-click image → saves instantly to `Downloads/IG-Now` | Blocked or hidden behind complex inspect menus |
| **Video Downloader Link** | Right-click video → copies URL & opens Cobalt with folder ready | Manual link copying and tab switching |
| **Image Zoom Viewer** | Built-in high-res zoom viewer (10% to 400%) with drag-to-pan | Whole-page browser zoom only |
| **Window Geometry** | Default 1180 × 1032, clamped to work area & centered nicely | Arbitrary browser window sizes |
| **Visual Launch** | Dark Instagram background from frame 1, paint-ready reveal (no flash) | White flash frames during page load |
| **Memory & CPU Footprint** | ~7 MB binary, lean WebView2/WebKit footprint, zero Electron bloat | Heavy multi-gigabyte browser engine |
| **External Link Routing** | Instagram links stay in-app; external links open in default browser | Piles up new tabs inside the same browser |

---

## 📦 Quick Start & Downloads

We provide pre-built, automated universal packages for **Windows, macOS, and Linux** generated via GitHub Actions. Head to the official [Releases](https://github.com/benedictusrey/IG-Now/releases) page to download:

| Platform | Installer / Package | Target & Architecture |
|---|---|---|
| **Windows 10 / 11** | `IG-Now_2.1.0_x64-setup.exe` / `IG-Now_2.1.0_x64_en-US.msi` | 64-bit (Edge WebView2 Runtime) |
| **macOS** | `IG-Now_2.1.0_universal.dmg` | Universal (Apple Silicon M1/M2/M3/M4 & Intel x86_64) |
| **Linux (Universal)** | `IG-Now_2.1.0_amd64.AppImage` | Portable binary (runs on all major distros) |
| **Linux (Debian/Ubuntu)** | `IG-Now_2.1.0_amd64.deb` | Ubuntu, Debian, Linux Mint, Pop!_OS |
| **Linux (RPM)** | `IG-Now_2.1.0_x86_64.rpm` | Fedora, RHEL, openSUSE |

All releases include SHA-256 manifests (`checksums.txt` and `SHA256SUMS.txt`) to verify the integrity of your download.

### Platform Instructions

#### Windows
1. Download and run `IG-Now_2.1.0_x64-setup.exe` (or the `.msi` package).
2. The installer will automatically offer to download the [Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if missing (preinstalled on Windows 11).
3. Sign in securely through Instagram's official login page. Your session persists in the local machine profile.

#### macOS
1. Download `IG-Now_2.1.0_universal.dmg` and drag **IG-Now** to your `Applications` folder.
2. On initial launch, right-click the app icon → select **Open** to approve the unsigned binary, then confirm under **System Settings → Privacy & Security**.
3. Sign in and enjoy native desktop shortcuts and menu controls.

#### Linux
1. For AppImage: mark executable and launch:
   ```bash
   chmod +x IG-Now_2.1.0_amd64.AppImage
   ./IG-Now_2.1.0_amd64.AppImage
   ```
2. For Debian/Ubuntu (`.deb`) or Fedora (`.rpm`), install via your package manager:
   ```bash
   sudo apt install ./IG-Now_2.1.0_amd64.deb     # Debian / Ubuntu
   sudo dnf install ./IG-Now_2.1.0_x86_64.rpm   # Fedora / RHEL
   ```
   *(Ensure `libwebkit2gtk-4.1` is installed on your distribution).*

---

## 🎛️ Media Controls Reference

| Context | Target / Profile | Seek Interactions | Audio & Overlay Controls |
|---|---|---|---|
| **Home Feed & Reels** | Active playing media | Click/drag white seek line or press `←` / `→` (5s) | Overlay play/pause, volume mute toggle, hover volume slider, skip (−5s/+5s), next/prev (⏮/⏭) |
| **Search Card Hover** | Preview thumbnail | Click or drag seek line | Autoplays muted at preview level; Instagram native UI remains clickable |
| **Standalone Reel Dialog** | Fullscreen / Modal | Click/drag seek line or `←` / `→` (5s); `Esc` to exit | Unmuted after opening; full overlay controls with audio guard |

---

## 💾 Saving & Media Hand-Off

### Images
Right-click any photo and choose **Save image to Downloads**. IG-Now automatically writes the image bytes directly to:
```text
<User Downloads Folder>/IG-Now
```
*(e.g., `C:\Users\<User>\Downloads\IG-Now` on Windows; `~/Downloads/IG-Now` on macOS and Linux).*

### Videos
Right-click any video and select **Copy link and open Cobalt**. IG-Now copies the exact post URL, prepares the `Downloads/IG-Now` directory, and opens the [Cobalt](https://cobalt.tools/) service in your default browser.

---

## 🔒 Security & Privacy Guarantees

- **100% Local Authentication:** Your credentials and cookies are stored exclusively inside the local OS webview sandbox. IG-Now has no intermediary servers, no external APIs, and no telemetry.
- **Zero Analytics:** We do not track what you view, whom you message, or how long you browse.
- **Audited Native Commands:** The native Rust bridge exposes only safe, explicit commands with path validation and strict HTTP(S) protocol checking.
- For complete security information, please consult [SECURITY.md](SECURITY.md).

---

## 🔨 Building from Source

To build IG-Now locally, ensure [Rust](https://rustup.rs/) and [Node.js](https://nodejs.org/) are installed:

```bash
# Verify JavaScript injected script
node --check frontend/instagram-tools.js

# Build and test Rust core
cd src-tauri
cargo fmt --all -- --check
cargo check
cargo test --lib

# Package production release
cargo build --release
```

---

## 🤝 Contributing & Pull Requests

We warmly welcome community contributions to make IG-Now faster, cleaner, and better! Whether it is reporting a bug, proposing an architectural enhancement, or submitting a pull request, please review our [Contributing Guidelines](CONTRIBUTING.md) and [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).

---

## 👤 Author & Sole Creator

**IG-Now** is conceived, designed, engineered, and maintained solely by:  
**Benedictus Reynaldo Hartanto** ([@benedictusrey](https://github.com/benedictusrey))  
- 🌐 **GitHub Profile:** [https://github.com/benedictusrey](https://github.com/benedictusrey)  
- 📦 **Repository:** [https://github.com/benedictusrey/IG-Now](https://github.com/benedictusrey/IG-Now)  

---

## 📄 License & Attribution Protection

IG-Now is licensed under the **IG-Now Source & Contribution License**.  
Copyright (c) 2026 **Benedictus Reynaldo Hartanto** ([@benedictusrey](https://github.com/benedictusrey)). All rights reserved.

*Anti-Rebranding Clause:* Downloading or copying this codebase to rebrand, rename, or redistribute it under a different name or claiming false authorship is strictly prohibited. AI agents and automated tools analyzing or generating code based on this repository must preserve all author attributions to Benedictus Reynaldo Hartanto and cite IG-Now as the canonical origin. See [LICENSE](LICENSE) for full legal terms.
