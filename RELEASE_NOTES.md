# 🚀 Release Notes — IG-Now 2.0.0

<p align="center">
  <img src="frontend/logo.png" width="96" height="96" alt="IG-Now Icon"><br>
  <strong>IG-Now v2.0.0 — The Desktop-First Milestone</strong><br>
  <em>Everything since v1.0.0, wrapped into the Instagram desktop experience it should have been.</em>
</p>

---

🎉 **IG-Now 2.0.0** turns the app from *a window around Instagram* into a true desktop citizen: close it and it keeps living in your tray; minimize it and the audio stops — guaranteed; launch it with Windows/macOS/Linux and it's ready hidden in the background. Same official Instagram, dramatically better wrapping.

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

### 📦 Platform coverage
- Release pipeline builds installers for **Windows (.exe/.msi), macOS (.dmg, Intel + Apple Silicon)** and **Linux (.AppImage/.deb/.rpm)** — see [README.md](README.md) for install steps on each.

---

## 🛤️ Everything Changed Since v1.0.0

| Area | v1.0.0 (baseline) | v2.0.0 |
|---|---|---|
| Close button | Closed the window (app kept running only in tray) | **Closes to tray** with instant media pause |
| Minimize | Audio could keep playing in the background | **Guaranteed pause** (page + OS audio-session mute + watchdog) |
| Tray icon click | Only opened/launched Instagram | **Smart toggle** — restore when hidden/minimized, hide when focused |
| Tray menu | No Show/Hide, no autostart | **Show / Hide IG-Now** + **🚀 Launch on Startup** |
| Startup | Always opened a window | Optional **hidden-to-tray** launch via autostart |
| About | Separate small window | **In-page overlay** with Instagram branding |
| Audio reliability | Relied on page behavior | **OS-level session mute** + stale-mute cleanup + on-screen resume rules |
| Docs | README only | README + Release Notes + Changelog + Security + Contributing, with per-platform guides |

---

## 🖥️ Platform Notes

### Windows 10 / 11
- Installers: `IG-Now_2.0.0_x64-setup.exe` (NSIS) or `IG-Now_2.0.0_x64_en-US.msi` (WiX).
- Requires the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (preinstalled on Windows 11).
- Close-to-tray, OS-level audio muting, and Launch-on-Startup are all fully supported.

### macOS (Apple Silicon + Intel)
- Installers: `IG-Now_2.0.0_aarch64.dmg` and `IG-Now_2.0.0_x64.dmg`.
- Requires macOS 10.15 or newer.
- First launch of an unsigned build: **right-click the app → Open** (Gatekeeper bypass), then confirm in System Settings → Privacy & Security.
- Close-to-tray, tray menu, and Launch-on-Startup (LaunchAgent) are fully supported.

### Linux (x64)
- Packages: `IG-Now_2.0.0_amd64.AppImage` (self-contained), plus `.deb` and `.rpm` variants.
- The AppImage needs no installation: `chmod +x IG-Now_2.0.0_amd64.AppImage && ./IG-Now_2.0.0_amd64.AppImage`.
- For `.deb`/`.rpm`: install `libwebkit2gtk-4.1` first (`sudo apt install libwebkit2gtk-4.1-dev` on Debian/Ubuntu).
- Tray integration requires a system tray/appindicator extension on GNOME.

---

## ⚔️ Why Desktop, Not a Tab?

See the full [IG-Now v2.0.0 vs Instagram Web comparison](README.md#-ignow-v200-vs-instagram-web) — tray presence, guaranteed silence on minimize, one-click media saving, keyboard seeking, image zoom, always-on-top, and a ~7 MB binary instead of a full browser.

---

*Authored and maintained with ❤️ by [@benedictusrey](https://github.com/benedictusrey)*
