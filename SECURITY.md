# 🔒 Security & Privacy Policy

The security, privacy, and integrity of **IG-Now** and its users are top priorities.

---

## 🛡️ Supported Versions

| Version | Supported | Security Maintenance |
| :--- | :---: | :--- |
| **`2.5.x`** | ✅ | Active security support & bug fixes (current release) |
| `2.2.x` | ⚠️ | Superseded by `v2.5.0` — security patches only if backported |
| `<= 2.1.x` | ❌ | End-of-life / superseded versions |

---

## 🔐 Core Security & Privacy Guarantees

- **No analytics, no tracking, no remote database.** IG-Now does not collect, transmit, or store any of your Instagram activity. There is no telemetry, no ad SDK, and no account database.
- **Your session stays local.** The signed-in session lives in WebView2/WebKit's on-disk profile on *your* computer. IG-Now has no profile manager and never sees your password — you sign in through Instagram's own official page inside the app.
- **Split, least-privilege native capabilities.**
  - `remote-instagram-com` (`capabilities/remote.json`, scoped strictly to `https://www.instagram.com/*`) exposes only explicit media saving, external HTTP(S) hand-off, unread DM count notifications, and native Downloader hand-off/probe submission.
  - `downloader-local` (`capabilities/downloader.json`, restricted to the local bundled `downloader.html` window) manages local post inspection, batch media/caption writing, and folder opening.
- **Strict URL, header, and binary validation.**
  - Only clean `http://` / `https://` URLs without control characters (`is_safe_http_url`) are allowed for external browser opening or downloads; `shortcode_from_url` rejects non-Instagram share URLs via `is_instagram_share_url`.
  - Session `Cookie:` and `X-CSRFToken:` headers are strictly gated to `.instagram.com` hosts (`is_instagram_app_host`) and never sent to third-party origins or CDN redirects.
  - Downloaded files validate MP4 `ftyp` or image headers (JPEG, PNG, GIF, WebP, HEIC/AVIF) before keeping output so HTML error/login responses are automatically deleted instead of saved.
- **Media saving is opt-in and local.** Everything is written locally under `<User Downloads>/IG-Now` using sanitized filenames (`sanitize_path_segment`), with optional local `ffmpeg` processing.

## 🧪 Security-Conscious Development

- Rust + Tauri v2 with a minimal dependency set; the `windows` crate is target-gated (`[target.'cfg(windows)'.dependencies]`) and used solely for Windows Core Audio session management (`audio.rs`).
- React Fiber DOM inspection in `frontend/instagram-tools.js` guards against cross-origin `WindowProxy` / host-object reads (`isSafeDataObject`).
- Release builds are produced across Windows, macOS Universal, and Linux in `.github/workflows/release.yml` and ship with SHA-256 `checksums.txt` and `SHA256SUMS.txt`.

## 📋 What to Treat as Private

- WebView session data and your signed-in account state.
- Downloaded media, `caption.txt`, and `metadata.json` files inside your `Downloads/IG-Now` folder.
- Any copied Instagram post URLs.

---

## 🐛 Reporting a Vulnerability

We take security reports seriously. To report a vulnerability:

1. **Do not** open a public issue with exploit details or account data.
2. Contact the maintainer privately via GitHub: [@benedictusrey](https://github.com/benedictusrey) — or open a GitHub issue *without* sensitive details and ask for a private channel.
3. Include: affected version, platform, a minimal description of the issue, and steps to reproduce (no credentials, no session data, no private media).

You will receive an acknowledgement within a few days and a status update as the issue is investigated. Public disclosure happens only after a fix ships.

---

*Conceived, authored, and maintained with ❤️ by [Benedictus Reynaldo Hartanto (@benedictusrey)](https://github.com/benedictusrey)*
