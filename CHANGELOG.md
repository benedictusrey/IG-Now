# 📜 Changelog

All notable changes to **IG-Now** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions, and versioning follows [Semantic Versioning](https://semver.org/).

---

## [2.1.0] — 2026-09-19

### 🎨 Changed (UI/UX polish round)
- **About overlay redesigned** — gradient banner header with the **IG-Now app logo** (the real `icon.png`, embedded byte-identical as a data URL — no network request, crisp on any DPI), pill version badge, a two-column feature grid, GitHub author + repo links (opened via the native bridge in the OS browser), a footer actions row (Got It! + GitHub ↗), smooth fade/scale entrance, and full dismissal paths: Esc, backdrop click, ×, and Got It!.
- **Tray menu polish** — Tools leads with a working **Open downloads folder** shortcut (same `Downloads/IG-Now` folder the media-saving pipeline uses, created on demand); terser truthful labels ("Developer tools", "Copy page URL", "Open page in browser", "Cobalt video downloader"); the autostart toggle is visually separated at the end of the group.
- **Regression locks grew to 11 Rust unit tests** — T9 asserts the About contract (logo data-URL marker, no stale Instagram-SVG) and T9b decodes the embedded base64 back to the exact 128×128 app icon (PNG magic + dimensions).

### 🚀 Added
- **Dedicated −5s / +5s seek buttons** flanking the progress line — the mouse/touch equivalent of the Left/Right arrow keys, on every video.
- **Dedicated previous / next buttons** at the right end of the control bar — the mouse equivalent of the Up/Down arrows for reel navigation and page scrolling.
- **Volume button in the video overlay** — a mute/unmute toggle that flips only the element's mute flag (never OS/session volume) and no longer gets auto-remuted by the page player.

### 🎨 Changed
- **The seek bar is now clickable with the mouse on every video.** Seeking is handled at the window capture phase, ahead of Instagram's own pointer handlers that previously swallowed the clicks; drags use pointer capture and keep tracking outside the line.
- **Volume toggle repositioned to the left cluster** next to the play button — it no longer sits on (or next to) the total-time label, and stays clear of Instagram's own right-side controls.
- **No launch/navigation flash** — the webview background is Instagram-dark from the first frame and the window is shown paint-ready (`on_page_load`) with an 8-second failsafe reveal.
- **Default window size is now 1180 × 1032** (logical px), clamped to the monitor's work area and centered between the top system bar and the bottom taskbar — never clipped, gracefully shrunk on small displays.
- **Leaner watchdog** — the 2.5 s pause re-check is guarded to one in-flight thread instead of spawning per minimize/restore cycle.
- **Cross-platform wording** — tray help items and docs say "your Downloads / IG-Now folder" instead of a Windows-only `Downloads\IG-Now` path.
- Packaged metadata no longer embeds the maintainer's personal display name; authorship is credited through the public `@benedictusrey` handle only.

### ⚡ Performance
- **Drag seeking is coalesced to one seek per animation frame.** Pointer moves can fire at 100+ Hz while the display repaints at ~60 Hz — every in-between move used to run a `getBoundingClientRect` + `fastSeek`/`currentTime` + full control-bar sync that was discarded before it could ever be painted. The drag path now records the latest position and seeks once per frame, at the newest position (locked in by harness scenario C37).
- **Control-bar sync no longer writes what never changes.** The seek line's constant `aria-label` was being re-set on every `timeupdate` (~4×/s per video) and `sync()` re-applied the audio default on every tick; both are now write-once / change-only (locked in by scenario C38).
- **Launch shows paint-ready.** The window is revealed only after the page finishes loading (`on_page_load`) with an 8 s failsafe — no white/black flash frames to composite on startup or in-app navigation (webview background = Instagram-dark from the first frame).
- **Watchdog cadence audited:** two cheap window-state reads every 800 ms with page evals only on hidden/visible transitions, and the 2.5 s pause re-check is guarded to at most one in-flight thread — no timers, observers, or threads accumulate.
- **No memory hot spots:** media scanning is debounced (120 ms), all registries are `WeakMap`s keyed by the page's own nodes, event listeners attach once per element, and the only Maps (`activePointerSeeks`) are bounded per pointerId and cleared on every release/cancel.

### 🔧 Fixed
- **Buttons survive real-hand input and page overlays** (the "only the seekbar is clickable" report, fully resolved). Root cause, reproduced live on the shipped binary: buttons gated activation on the event *target* being inside the control bar and re-resolved the action at the *release point*, while the seek line scanned the element stack at the pointer position — so Instagram's gradient scrims / portal overlays stacked above the bar silently killed every button press, and a 1–3px drift between press and release dropped it too. Buttons now use the seek line's proven model: point-scan resolution, press-then-slop release firing (24 px, safe because a release over any real button resolves to that button), drag-away cancels like a native button, a release over a different button never fires, and the synthetic click of a handled press is swallowed exactly once — even when it lands on a page overlay. Verified with **real OS-level clicks** (user32 pointer injection with mid-press jitter) into the production window: 8/8 hardware proof, 33/33 in-app, 30/30 Edge, 9/9 realistic-input, 75/75 jsdom.
- **Volume is now fully synchronized** (the mute icon could disagree with Instagram's own volume slider, and there was no level control in the bar). The video element is the single source of truth: every `volumechange` — our button, our slider, Instagram's native vertical slider, the page player — re-mirrors the audible state into the icon, a **hover-expand level track**, and the button itself, in both directions. New hover-expand **volume level slider** (absolute overlay — bar geometry, above all the seek line's width, is provably invariant to its open/closed state): drag writes `video.volume` through the same overlay-proof, rAF-coalesced pointer model as the seek line; dragging to zero silences without flipping the mute flag (mirroring Instagram's slider); a chosen mute survives level drags and unmute restores the pre-mute level; the speaker icon now reflects the *audible* level (three states) while the crossed-out icon carries the muted state; arrow keys adjust the level on a focused track without hijacking the global seek shortcuts. **30/30 Edge, 33/33 in-app on the shipped binary**, including real-mouse drags and pixel-proof of the icon flip.
- **All overlay buttons now activate reliably.** Button presses are handled in the window capture phase (immune to the page interception that killed the seek clicks), with per-press dedupe so the browser's synthetic click never double-fires an action — while rapid repeated presses and keyboard (Enter/Space) activation still work.
- **The volume mute now sticks.** The bidirectional audio guard defends the element in *both* directions once the user has pressed the volume button: the page player can neither re-mute what the user unmuted nor silently un-mute what the user muted (observed in the field: a muted reel whose sound kept playing). Mute-first users are now protected too, and IG-Now's own assignments are exempt via a suppression flag so the guard never fights the user's own click.
- **Nothing overlaps Instagram's corner controls.** Prev/next live in the left cluster and the bar reserves ~104 px of right padding, so the total-time label (and every IG-Now control) stays clear of Instagram's floating mute/fullscreen buttons on large players.
- **Compact mode now tracks reality.** It is re-evaluated whenever the video's size is known (metadata loaded, playback started, every sync) instead of being decided once before layout settles — a media dialog that mounts before measuring no longer gets stuck with the narrow-card bar (which made prev/next appear missing entirely).
- **Search cards get a clean lineup.** On narrow hosts the seek-skip pair and prev/next yield their space to the progress line (which keeps well over a third of the bar) and the time labels slim down — ▶ 🔇 elapsed ▬▬▬ total, nothing squeezed to a sliver.
- **Button presses no longer cancel browser activation.** The activation handlers stop isolating with `preventDefault`, which in production WebView2 suppressed the very user gesture the actions rely on (the reason play seemed dead while seek/volume — which need no gesture — kept working). Pointer capture now keeps presses that slide off a button working like real buttons.
- **Navigation works even when the wheel is swallowed.** If the view cannot scroll (Instagram's slide-based reel viewer), prev/next fall through to Instagram's own arrow-key handling — the exact path the Up/Down keys use — with a loop guard against re-entry.
- macOS (Intel) DMG returned to the release pipeline via the `macos-15-intel` runner (`macos-latest` is ARM-only, and the old `macos-13` image was retired in December 2025).
- Rust caches are keyed per platform **and** target, so the two macOS jobs no longer thrash each other's caches.
- Homebrew's `sbin` (glib tools) is added through `GITHUB_PATH` — portable across the runners' default shells.
- Every release now ships a **SHA-256 `checksums.txt`** covering all assets (built on Linux after all platforms finish).
- Windows installers offer to fetch the Edge WebView2 Runtime automatically (`downloadBootstrapper`); macOS bundle declares a minimum of 10.15.

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

*Conceived, authored, and maintained with ❤️ by [Benedictus Reynaldo Hartanto (@benedictusrey)](https://github.com/benedictusrey)*
