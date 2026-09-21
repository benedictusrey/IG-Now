# 🚀 Release Notes — IG-Now 2.1.0

<p align="center">
  <img src="frontend/logo.png" width="96" height="96" alt="IG-Now Icon"><br>
  <strong>IG-Now v2.1.0 — The Desktop-First Milestone, refined</strong><br>
  <em>Everything since v1.0.0, wrapped into the Instagram desktop experience it should have been.</em>
</p>

---

🎉 **IG-Now 2.1.0** keeps the desktop-first momentum of 2.0.0 and fixes the details that matter daily: the seek bar is now genuinely **clickable with the mouse on every video** (immune to Instagram's own overlay handlers), dedicated **−5s / +5s and previous / next buttons** sit in the control bar, the volume toggle moved so it never covers the total time, launches no longer flash white/black, and several hot pipelines got leaner. Same official Instagram, dramatically better wrapping.

---

## ✨ What's New in 2.1.0

### 🎚️ Media controls — click, drag, skip
- **The seek bar finally answers the mouse.** Root cause found: Instagram registers capture-phase pointer handlers that swallow clicks before they ever reach the seek line. IG-Now now handles seeking at the **window capture level**, ahead of every page handler — click or drag the white line on Reels, feed videos and Search cards, with pointer capture so drags keep tracking outside the line.
- **Dedicated −5s / +5s buttons** flank the seek line — the mouse/touch equivalent of the Left/Right arrow keys, so seeking never depends on the keyboard.
- **Previous / next buttons** (⏪-style ⏮/⏭ glyphs) live in the **left cluster**, past the volume toggle — the mouse equivalent of the Up/Down arrows for reel navigation and page scrolling — and the bar reserves its right edge so nothing ever sits on Instagram's own corner controls.
- **Volume toggle repositioned — and it actually sticks.** The 🔊/🔇 button now lives in the **left cluster next to the play button**, far from the total-time label it used to overlap. It flips only the element's mute flag, and a **bidirectional audio guard** keeps your choice: the page player can neither re-mute what you unmuted nor silently un-mute what you muted (the "muted icon but the reel keeps playing" bug is gone).
- **Volume is now fully synchronized — with a real level slider.** The video element is the single source of truth: the mute button, a **hover-expand level track**, and Instagram's own vertical volume slider always agree, in both directions. Hover or drag the speaker button to reveal the slider; drag it to set the exact level (writes the video's volume, which Instagram's own UI reflects); drag it to zero for silence without touching your mute state; unmute restores your chosen level, not a default. The icon now shows the **audible level** (quiet / medium / loud) while the crossed-out icon carries the muted state, and arrow keys adjust the level when the track has focus — without stealing the global seek shortcuts. The slider is a pure overlay: opening it can never shift the seek line or any other control.
- **Every button answers the mouse, not just the seek line.** Buttons resolve presses **by point** (the element-stack scan that made the seek line bulletproof), so Instagram's overlay layers stacked above the bar can no longer swallow them, and a release that drifts a few pixels off the button still fires it (a release over a *different* control, or a real drag-away, cancels like a native button). All of it runs in the window capture phase — ahead of Instagram's intercepting handlers — with per-press dedupe (no double-fire), full support for rapid repeated presses, and keyboard activation (Enter/Space) untouched. Presses no longer cancel the browser's user activation (a production WebView2 subtlety that suppressed the play action's audio gesture). Verified with **real OS-level clicks** into the production window, not just synthetic events.
- **A bar that fits its video.** Compact mode re-measures as layout settles (no more dialogs stuck with the narrow-card bar, which made prev/next look missing), and Search cards show a clean ▶ 🔇 elapsed ▬▬▬ total lineup — the skip and navigation pairs yield their space so the seek line keeps over a third of the bar instead of being squeezed to a sliver.

### ⚡ Anti-flash & performance
- **No more white/black flash.** The webview paints Instagram's near-black from the very first frame (dark background color), and the window is revealed **only when the page has finished loading** — with an 8-second failsafe so an offline start can never leave you staring at nothing.
- **Leaner pipelines.** The pause watchdog's 2.5 s re-check no longer spawns a fresh thread per minimize (one in-flight re-check, guarded); video scanning stays observer-driven with no polling additions.

### 🪟 Window geometry
- **Default window: 1180 × 1032** (logical px), clamped to the monitor's work area and centered between the top system bar and the bottom taskbar. On displays too small for the default, the window shrinks gracefully instead of opening clipped.

### 🧭 Release pipeline (cross-platform)
- **macOS Universal DMG** — built in CI as a single universal binary running natively on both Apple Silicon and Intel Macs.
- **Rust caches keyed per platform and target** — fast, clean caching without collisions.
- **Homebrew sbin via `GITHUB_PATH`** — portable across the runners' default shells.
- **SHA-256 `checksums.txt`** ships with every release, covering all assets.
- Windows installers offer to fetch the **Edge WebView2 Runtime** automatically; the macOS bundle declares a minimum of 10.15.
- Tray help wording no longer assumes Windows paths ("your Downloads / IG-Now folder").

---

## ✨ What's New in 2.0.0

### 🖱️ Tray, minimize & audio — the desktop superpowers
- **Close-to-tray.** The ✕ button no longer kills the app — the window hides to the system tray and **media pauses instantly**. The app keeps running, your session stays signed in, and one tray click brings it back.
- **True pause on minimize.** Reel audio stops the moment the window hides, through a **three-layer guarantee**: page-side pause, a Windows **OS-level audio-session mute** (even if the page misbehaves), and a watchdog that re-checks the real window state every 800 ms. Restore resumes exactly where you left off — at the same 50% volume — following Instagram's own rules (only on-screen media is resumed, never stale off-screen elements).
- **Show / Hide tray toggle.** The tray icon and the new **"Show / Hide IG-Now"** menu item restore the app whenever it is minimized, hidden, or unfocused — and hide it (pausing first) only when it's visible and focused.
- **🚀 Launch on Startup.** New tray toggle. When started by the OS it launches **hidden to the tray** — no window popping over your work.
- **Stale-silence fix.** Windows can persist an old audio-session mute across restarts; a startup watchdog clears it automatically, so a fresh launch is never mysteriously silent (verified with an OS audio peak meter).

### 🎨 Seamless in-app About
- Tray → **About IG-Now** now opens a polished overlay **inside the Instagram window** — Instagram-gradient branding, version, author link — no more separate window hop.
- **About, redesigned:** gradient banner header with the logo mark, version pill, a two-column feature grid, and GitHub author/repo links that open in your OS browser. Dismiss it any way you like — Esc, click outside, ×, or Got It! — with a smooth fade/scale entrance.

### 📦 Platform coverage
- Release pipeline builds installers for **Windows (.exe/.msi), macOS (.dmg, Intel + Apple Silicon)** and **Linux (.AppImage/.deb/.rpm)** — see [README.md](README.md) for install steps on each.

---

## 🛤️ Everything Changed Since v1.0.0

| Area | v1.0.0 (baseline) | v2.0.0 |
|---|---|---|
| Close button | Closed the window (app kept running only in tray) | **Closes to tray** with instant media pause |
| Minimize | Audio could keep playing in the background | **Guaranteed pause** (page + OS audio-session mute + watchdog) |
| Tray icon click | Only opened/launched Instagram | **Smart toggle** — restore when hidden/minimized, hide when focused |
| Tray menu | No Show/Hide, no autostart | **Show / Hide IG-Now** + **🚀 Launch on Startup** + grouped Places / View / Tools / How-to submenus with an **Open downloads folder** shortcut |
| Startup | Always opened a window | Optional **hidden-to-tray** launch via autostart |
| About | Separate small window | **In-page overlay** with Instagram branding |
| Audio reliability | Relied on page behavior | **OS-level session mute** + stale-mute cleanup + on-screen resume rules |
| Docs | README only | README + Release Notes + Changelog + Security + Contributing, with per-platform guides |

---

## 🖥️ Platform Notes

### Windows 10 / 11
- Installers: `IG-Now_2.1.0_x64-setup.exe` (NSIS) or `IG-Now_2.1.0_x64_en-US.msi` (WiX).
- Requires the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (preinstalled on Windows 11).
- Close-to-tray, OS-level audio muting, and Launch-on-Startup are all fully supported.

### macOS (Universal — Apple Silicon + Intel)
- Installer: `IG-Now_2.1.0_universal.dmg` (Universal binary running natively on Apple Silicon M1/M2/M3/M4 & Intel x86_64).
- Requires macOS 10.15 or newer.
- First launch of an unsigned build: **right-click the app → Open** (Gatekeeper bypass), then confirm in System Settings → Privacy & Security.
- Close-to-tray, tray menu, and Launch-on-Startup (LaunchAgent) are fully supported.

### Linux (x64)
- Packages: `IG-Now_2.1.0_amd64.AppImage` (self-contained), plus `.deb` and `.rpm` variants.
- The AppImage needs no installation: `chmod +x IG-Now_2.1.0_amd64.AppImage && ./IG-Now_2.1.0_amd64.AppImage`.
- For `.deb`/`.rpm`: install `libwebkit2gtk-4.1` first (`sudo apt install libwebkit2gtk-4.1-dev` on Debian/Ubuntu).
- Tray integration requires a system tray/appindicator extension on GNOME.

---

## ⚔️ Why Desktop, Not a Tab?

See the full [IG-Now v2.1.0 vs Instagram Web comparison](README.md#-ignow-v210-vs-instagram-web) — tray presence, guaranteed silence on minimize, one-click media saving, keyboard seeking, image zoom, always-on-top, and a ~7 MB binary instead of a full browser.

---

*Conceived, authored, and maintained with ❤️ by [Benedictus Reynaldo Hartanto (@benedictusrey)](https://github.com/benedictusrey)*
