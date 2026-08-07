# 📜 Changelog

All notable changes to **IG-Now** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions, and versioning follows [Semantic Versioning](https://semver.org/).

---

## [2.0.0] — 2026-08-07

### 🚀 Added
- **Close-to-tray**: closing the Instagram window hides it to the system tray instead of destroying it; media pauses instantly on close.
- **Pause-on-minimize**: a Rust playback watchdog (800 ms poll + resize fast-path) pauses all video/audio the moment the window hides and resumes on restore — with a **Windows OS-level audio-session mute** as a hard guarantee even if the page misbehaves.
- **Smart tray toggle**: tray-icon click and the new **"Show / Hide IG-Now"** menu item restore the app whenever it is minimized/hidden/unfocused, and hide it (pausing first) only when visible and focused.
- **🚀 Launch on Startup** tray toggle — starts hidden to the tray (`--minimized`) so autostart never pops a window over your work.
- **Stale audio-session cleanup**: a startup watchdog clears any Windows-persisted session mute within seconds of launch, and reports OS session state (mute/volume/peak) for diagnostics.
- **Seamless About overlay**: tray → About now renders an in-app overlay inside the Instagram window (Instagram-gradient branding, version, author link) — no separate window.
- **Documentation suite**: `RELEASE_NOTES.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md` with per-platform (Windows/macOS/Linux) guides.

### 🎨 Changed
- **About UX**: replaced the separate hidden hub window + modal with the in-app overlay (hub window and its frontend files removed).
- **Tray menu structure**: "Show / Hide IG-Now" at the top, "Launch on Startup" under tools, tooltip "IG-Now Desktop".
- **Resume semantics follow Instagram**: restore replays only the element that was playing *and is still on-screen*; off-screen media is handed back to Instagram's own in-view autoplay engine.

### 🔧 Fixed
- Double-pause race: both the resize fast-path and the watchdog firing on one minimize no longer wipe the resume intent (restore silently stayed paused before).
- Mute-backup restore now always restores the original mute state of the exact element that was muted.
- Search-card videos keep their intended 20%-muted preview profile after restore.

### 🧹 Removed
- Hidden `main` hub window, `hide_about` command, and `frontend/index.html` / `main.js` / `style.css` (About now lives in the Instagram window itself).

---

## [1.0.0] — 2026-08-05

### 🚀 Initial release
- **Tauri v2 + Rust** desktop wrapper around [Instagram](https://www.instagram.com/) with a persistent signed-in WebView2 profile.
- **System-tray app** with navigation (Home, Explore, Reels, DMs, Notifications, Profile), refresh, zoom controls, always-on-top, memory compaction, dev tools, copy URL, open-in-browser, and Cobalt video-downloader hand-off.
- **Media tools** injected into every Instagram page:
  - Right-click images → save to `Downloads\IG-Now`; right-click videos → copy post link + open Cobalt.
  - Ctrl+click images → built-in zoom viewer (10%–400%) with drag-to-pan.
  - Keyboard: `←`/`→` seek 5 s, `↑`/`↓` between Reels, `Esc` to close viewer/leave a Reel.
  - Search-card hover previews with a draggable seek line at 20% volume; standalone Reels at 50% after your first interaction.
  - External links routed to the default browser; Instagram links stay in-app.
- **Hub window** with an About card (replaced in v2.0.0 by the in-app overlay).
- Cross-platform release pipeline (Windows `.exe`/`.msi`, macOS `.dmg`, Linux `.AppImage`/`.deb`/`.rpm`).

---

*Authored and maintained with ❤️ by [@benedictusrey](https://github.com/benedictusrey)*
