# 📦 IG-Now Releases

Local release area for **IG-Now** — conceived, authored, and maintained solely by
**Benedictus Reynaldo Hartanto** ([@benedictusrey](https://github.com/benedictusrey)).

Every version gets one structured folder under [`versions/`](versions/), and the
machine-readable index lives in [`versions.json`](versions.json). Binary
artifacts (`.exe`, `.msi`, `.dmg`, `.AppImage`, `.deb`, `.rpm`, checksum files)
are **gitignored** — GitHub Releases is the public distribution channel; this
tree is the local, organized mirror and staging area.

## 🗂️ Layout

```
releases/
├── README.md               # This guide + version history
├── versions.json           # Machine-readable version index (latest, dates, highlights)
└── versions/
    ├── v1.0.0/
    │   ├── README.md       # Provenance notes for that version
    │   └── binaries/       # gitignored: installers, packages, checksums
    └── v2.1.0/
        ├── README.md
        └── binaries/       # Local v2.1.0 build + SHA-256SUMS.txt
```

## 🏷️ Version history

| Version | Date | Status | Highlights |
| --- | --- | --- | --- |
| [v2.5.2](https://github.com/benedictusrey/IG-Now/releases/tag/v2.5.2) | 2026-11-26 | Current | Linux WebKitGTK & Wayland/XWayland performance overhaul (off-route `<video>` cleanup, lazy Reels controls, deferred mute sync, pre-nav `CacheModel::WebBrowser` & DRI3 DMA-BUF probing), Core Audio COM fix, atomic Downloader writes & a11y polish |
| [v2.5.1](https://github.com/benedictusrey/IG-Now/releases/tag/v2.5.1) | 2026-11-25 | Published | Linux Wayland/WebKitGTK freeze fix (issue #6), Wayland window/watchdog hardening, single-pass GraphQL cache & zero-thrash scroll/video performance pass |
| [v2.5.0](https://github.com/benedictusrey/IG-Now/releases/tag/v2.5.0) | 2026-11-17 | Published | Built-in native Downloader workbench (`765 × 885`, H.264+AAC `.mp4`, Audio `.m4a`, up-to-20-slide carousels, collab posts & captions), sidebar Downloader/Forward/Back + `Esc` return, `"IG-Now"` foreground audio session + 2-way mute icon sync, `1588 × 1025` centered layout with native IG comments |
| [v2.2.0](https://github.com/benedictusrey/IG-Now/releases/tag/v2.2.0) | 2026-10-04 | Published | Message notifications, hidden DM links, and DM scrollbar fix |
| [v2.1.0](https://github.com/benedictusrey/IG-Now/releases/tag/v2.1.0) | 2026-09-21 | Published | Seek bar works on every video, in-overlay volume toggle, 1180 × 1032 work-area window, universal cross-platform CI |
| [v2.0.0](https://github.com/benedictusrey/IG-Now/releases/tag/v2.0.0) | 2026-08-07 | Published | The Desktop-First Milestone — tray, pause-on-minimize, media saving |
| [v1.0.0](https://github.com/benedictusrey/IG-Now/releases/tag/v1.0.0) | 2026-08-05 | Published | Initial public release |

See [`versions.json`](versions.json) for the same data in structured form, and
[`../RELEASE_NOTES.md`](../RELEASE_NOTES.md) for v2.5.2 details.

## 🧾 Adding a new version

1. Bump the version (`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) and
   update `CHANGELOG.md` / `RELEASE_NOTES.md` / `README.md`.
2. Tag and push (`git tag vX.Y.Z && git push origin vX.Y.Z`) so
   `.github/workflows/release.yml` builds all platform targets.
3. Locally: `mkdir releases/versions/vX.Y.Z/binaries`, copy the CI-produced
   assets (plus their `checksums.txt` / `SHA256SUMS.txt`) into it, and drop a short
   `README.md` beside them noting provenance.
4. Add an entry to `versions.json` and a row to the table above.

## 🔐 Checksums

`v2.1.0` ships with a checksum job in CI that publishes SHA-256 manifests
covering **every** platform asset — verify your download before running it:

```bash
sha256sum -c checksums.txt
```

Pre-release 1.0.0-era Windows intermediates in `versions/v1.0.0/binaries/` are
kept for reference only — never attach them to a release.
