# 🔒 Security & Privacy Policy

The security, privacy, and integrity of **IG-Now** and its users are top priorities.

---

## 🛡️ Supported Versions

| Version | Supported | Security Maintenance |
| :--- | :---: | :--- |
| **`2.0.x`** | ✅ | Active security support & bug fixes (current release) |
| `1.0.x` | ⚠️ | Legacy — maintained only for critical security issues |
| `< 1.0.0` | ❌ | Pre-release / superseded versions |

---

## 🔐 Core Security & Privacy Guarantees

- **No analytics, no tracking, no remote database.** IG-Now does not collect, transmit, or store any of your Instagram activity. There is no telemetry, no ad SDK, and no account database.
- **Your session stays local.** The signed-in session lives in WebView2's on-disk profile on *your* computer. IG-Now has no profile manager and never sees your password — you sign in through Instagram's own official page inside the app.
- **Minimal native bridge.** The app exposes only a handful of narrow capabilities: opening safe external HTTP(S) URLs in the default browser, preparing the download folder, saving media bytes, and handing off a media URL that Instagram itself has already exposed. Every command validates its input.
- **External links are routed safely.** Only `http`/`https` URLs (with no CR/LF injection) are ever opened externally; everything else stays in-app or is denied.
- **Media saving is opt-in and local.** Downloads go only to `Downloads\IG-Now` (or your OS's equivalent download folder). Nothing is uploaded anywhere.
- **Cobalt hand-off is a browser redirect.** Video downloads go through the external [Cobalt](https://cobalt.tools/) service in your default browser; IG-Now does not bypass Instagram access controls and does not store the copied post link.

## 🧪 Security-Conscious Development

- Rust + Tauri v2 with a minimal dependency set; the only Windows-specific dependency is target-gated and used solely for the audio-session mute guarantee.
- Repository checks validate JavaScript syntax, Rust formatting, dependency compilation, and package generation.
- Release builds are reproducible through the GitHub Actions pipeline (`release.yml`) and ship with SHA-256 `checksums.txt`.

## 📋 What to Treat as Private

- WebView session data and your signed-in account state.
- Downloaded media in `Downloads\IG-Now`.
- Any copied Instagram post URL.
- Cobalt results and any third-party downloader response.

---

## 🐛 Reporting a Vulnerability

We take security reports seriously. To report a vulnerability:

1. **Do not** open a public issue with exploit details or account data.
2. Email the maintainer privately via the GitHub profile: [@benedictusrey](https://github.com/benedictusrey) — or open a GitHub issue *without* sensitive details and ask for a secure channel.
3. Include: affected version, platform, a minimal description of the issue, and steps to reproduce (no credentials, no session data, no private media).

You will receive an acknowledgement within a few days and a status update as the issue is investigated. Public disclosure happens only after a fix ships.

---

*Authored and maintained with ❤️ by [@benedictusrey](https://github.com/benedictusrey)*
