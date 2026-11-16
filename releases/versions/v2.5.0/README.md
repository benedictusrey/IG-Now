# IG-Now v2.5.0 — local build

Version **2.5.0**, built **2026-11-17** on Windows x64 from this repository (`v2.2.0 -> v2.5.0`, `issue #5` milestone: standalone native `.mp4` H.264 + AAC, `Audio Only (.m4a)` & caption Downloader workbench with clipboard/URL auto-inspect, `source_username-date-hash` file naming, sidebar Back, Forward & Downloader controls above `More`, Windows Core Audio grouped `"IG-Now"` session registration across active render endpoints, foreground unmute + bidirectional two-icon mute sync, `Esc` pre-click return, redesigned About sheet, and centered `1588 × 1025` desktop window preserving Instagram's original native Comments panel; see `../versions.json`).

## Validation

- `npm test` (`frontend/links.test.js`, `frontend/direct-messages.test.cjs`, `frontend/instagram-tools.test.cjs`, `frontend/downloader.test.cjs`): **37/37 passed** (includes `formatReadyStatus` singular/plural counts + live slide status update + outer scroll lock CSS contract, cross-origin `Window` proxy guard in `extractFromReactFiber`/`scanObjectForBundles` preventing `SecurityError` on `.video_versions` + synchronous `runControlAction` error catch, 20-slide mixed photo+video carousel corner photo button across active/offscreen `<video>` slides + navigation transitions, all 5 right-click context-menu actions across carousel slides & blob videos + `execCommand` clipboard fallback, Downloader `.slide-strip` + initial `slideIndex`/`slideHint` jump + live `downloader-progress` events, collaboration `/<user>/p/<code/>` URL normalization, clipped carousel viewport climbing, avatar-free viewport feed selection, Fiber shortcode recovery, image-only post/carousel bottom-right `.ignow-image-download-btn`, sidebar Downloader->Forward->Back order, and video bar audio/mute sync).
- Headless Chrome geometry check (`765×885`, `765×794`, `580×620`): **0 outer scroll, balanced `636px/636px` columns at `765×885`, `stripCentered = true`, `clippedBtns = []`** (`<textarea>` scrolls internally). Earlier Rev 5–6 check covered `1665×1138`, `500×700`, `1024×960`.
- `node --check` (`frontend/downloader.js`, `frontend/instagram-tools.js`, `frontend/direct-messages.js`, `frontend/downloader.test.cjs`, `frontend/instagram-tools.test.cjs`): **passed**.
- `impeccable detect --json frontend/downloader.html frontend/downloader.js frontend/instagram-tools.js`: **0 findings (`[]`)**.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: **passed**.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`: **42/42 passed** (includes non-Windows GUI FFmpeg fallback resolution, `curl --config -` stdin header escaping/sanitization, 20-item mixed carousel extraction + `pick_richer_inspected_post` multi-slide seed preference, `collect_item_fallback_candidates` fallback retries for both video and image items, pure `compute_centered_work_area_frame` `1588 × 1025` centering & taskbar work-area clamping, collaboration `coauthor_producers` fallback + `/username/p/CODE/` shortcode parsing, JPEG/PNG/WebP/HTML image-header validation + cleanup, GraphQL `edge_sidecar_to_children` / `display_resources` extraction, 6-way concurrent bundle downloads + `>=10` zero-padded `-slide-01` stems, real FFmpeg Opus -> AAC MP4 muxing, FFmpeg M4A extraction, STA COM + Core Audio polling, and tray/About contracts).
- Windows installers (`IG-Now_2.5.0_x64-setup.exe`, `IG-Now_2.5.0_x64_en-US.msi`) and standalone `IG-Now.exe` rebuilt via `npx tauri build` and synced into `binaries/` with matching SHA-256 digests (`SHA256SUMS.txt` and `local-Windows-SHA256SUMS.txt`).

## Files

| File | Origin | SHA-256 |
| --- | --- | --- |
| `binaries/IG-Now_2.5.0_x64-setup.exe` | Local build (`npx tauri build`) — NSIS installer (2,486,093 bytes) | `e2df77d8a28ce6763da0913a26354787dd86478bacd85a4daa7db0d51a454576` |
| `binaries/IG-Now_2.5.0_x64-en-US.msi` | Local build (`npx tauri build`) — MSI installer (3,473,408 bytes) | `70dcdf281591fc6ef0dc657e5be164f7122ded8aeaf6f7a670ef5ae3d22a904a` |
| `binaries/IG-Now.exe` | Local build (`npx tauri build`) — standalone executable (7,275,520 bytes) | `5d5d2724252ed9656d3f87eb4d214bcff441f130b83b404a96a586e6481b4f2b` |
| `binaries/SHA256SUMS.txt` | SHA-256 manifest | — |
| `binaries/local-Windows-SHA256SUMS.txt` | Windows SHA-256 manifest copy | — |

Binaries in `binaries/` are gitignored; attach installers to the GitHub Release instead of committing them.
