# 🤝 Contributing to IG-Now

Thanks for your interest in **IG-Now**! This project is a focused, dependency-light Tauri v2 + Rust wrapper around Instagram. This guide covers building from source on **Windows, macOS and Linux**, the project layout, and how to contribute.

---

## 🧰 Prerequisites

### All platforms
- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 18+ (only used for JS syntax checks and the Tauri CLI helpers)

### Windows 10 / 11
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (preinstalled on Windows 11)
- Build tools: **Visual Studio Build Tools** with the "Desktop development with C++" workload (MSVC), or the Visual Studio Build Tools C++ workload from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Optional: [Tauri CLI](https://tauri.app/start/cli/) (`cargo install tauri-cli`)

### macOS (Apple Silicon or Intel)
- **Xcode Command Line Tools**: `xcode-select --install`
- Optional: Xcode from the App Store (needed for full signing/notarization workflows)
- macOS 10.15+

### Linux (x64)
```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```
- Tray support on GNOME needs an appindicator extension (e.g. *AppIndicator and KStatusNotifierItem Support*).

---

## 🚧 Project Layout

```
IG-Now/
├── frontend/            # Assets embedded by Tauri (logo) + injected page tools
│   └── instagram-tools.js   # Init script injected into EVERY Instagram page
│                           # (media tools, video controls, pause/resume helpers)
├── src-tauri/          # The Rust application
│   ├── src/lib.rs      # Window setup, playback watchdog, close-to-tray, commands
│   ├── src/tray.rs     # System-tray menu, show/hide toggle, About overlay
│   ├── src/audio.rs    # Windows-only: OS audio-session mute guarantee
│   ├── capabilities/   # Tauri permission capabilities
│   └── tauri.conf.json # App config (product name, version, bundle)
├── docs/assets/        # README showcase screenshots
├── .github/workflows/release.yml  # Cross-platform release pipeline
└── README.md, RELEASE_NOTES.md, CHANGELOG.md, SECURITY.md
```

### Where things live
- **Rust core** (`src-tauri/src/`): window creation, the tray, the pause-on-minimize watchdog, media download commands, and the Windows audio-session muting.
- **Page-side logic** (`frontend/instagram-tools.js`): injected into every page of the Instagram window — media viewer, video controls, keyboard shortcuts, and the `window.__onWindowHidden` / `window.__resumeIfNeeded` helpers that the Rust watchdog calls.
- **About overlay** (`tray.rs`): an in-page, Instagram-branded card eval'd into the window — keep it self-contained (no external assets).

---

## 🔨 Building & Checking

```bash
# 1. JS syntax (always green before touching Rust)
node --check frontend/instagram-tools.js

# 2. Rust formatting + compilation (fast check first)
cd src-tauri
cargo fmt --all -- --check
cargo check

# 3. Full release build (production binary)
cargo build --release
# Windows output: src-tauri/target/release/IG-Now.exe

# 4. Installers (optional — needs the Tauri CLI)
cargo tauri build --ci
```

> **Windows note:** keep the build target inside the repo (`src-tauri/target/` is gitignored). On other shells, pass Windows-style paths to native tools (MSYS `/c/...` paths break Node/cargo).

### Verification checklist (before submitting)
1. `node --check frontend/instagram-tools.js` passes.
2. `cargo build --release` compiles with no new warnings.
3. The pause-on-minimize helpers still pass their jsdom regression harness (see below).
4. Manual smoke test on your platform: login → play a Reel → minimize → audio stops → restore → audio resumes → close (✕) → app stays in tray → tray click restores.

### jsdom regression harness
The injected script is tested headlessly with jsdom (the same harness pattern used across the *-Now apps):

```bash
mkdir -p /tmp/ignow-verify && cd /tmp/ignow-verify
npm init -y && npm i jsdom
# verify-ignow-helpers.js: 30+ assertions on pause/resume/mute/on-screen rules
node /tmp/ignow-verify/verify-ignow-helpers.js
```

---

## 🧭 How to Contribute

1. **Open an issue first** for bugs or feature ideas — reproducible bug reports are welcome as long as they contain **no credentials, no session data, and no private downloaded media**.
2. **Branch, then pull request**: `git checkout -b fix/your-fix`, commit with a clear message, push, and open a PR against `main`.
3. **Keep changes focused** — one fix per PR. Never mix formatting churn with behavior changes.
4. **Never break fixed behavior** — the pause-on-minimize layering, close-to-tray, media saving, and keyboard controls are regression-tested; re-run the checks above before submitting.

### Style conventions
- **Rust**: `cargo fmt` style; prefer small functions; `#[cfg(windows)]`-gate anything Windows-specific (the `windows` crate MUST stay under `[target.'cfg(windows)'.dependencies]` or macOS/Linux CI breaks).
- **JS**: ES2017+, no external dependencies, defensive `try/catch` around every injected handler (the site can change at any time), and expose page helpers on `window.*` for Rust `eval()` calls.
- **Docs**: keep visitor-facing language clear and concise; mention the author only as [@benedictusrey](https://github.com/benedictusrey) (hyperlinked).

---

## 📦 Release Process (maintainers)

1. Bump the version in `src-tauri/Cargo.toml` + `src-tauri/tauri.conf.json` (and docs), build, and update `CHANGELOG.md` / `RELEASE_NOTES.md` / `README.md`.
2. Commit and push to `main`.
3. Push a version tag: `git tag v2.0.0 && git push origin v2.0.0` — the `release.yml` workflow builds **Windows, macOS and Linux** in parallel and uploads installers + checksums to a draft GitHub Release.
4. Review the draft release, then **Publish** it. See the README's publishing guide for the GitHub Desktop walkthrough.

---

*Authored and maintained with ❤️ by [@benedictusrey](https://github.com/benedictusrey)*
