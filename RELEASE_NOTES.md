# IG-Now v2.2.0

Released 2026-10-04. This release addresses [issue #1](https://github.com/benedictusrey/IG-Now/issues/1) and incorporates [PR #2](https://github.com/benedictusrey/IG-Now/pull/2).

## Direct messages

- New unread messages produce a native desktop notification. Alerts contain no sender names or message previews. Existing unread messages do not trigger startup alerts, rapid updates are grouped, and alerts are suppressed while the visible inbox is focused.
- A signed-in inbox check every 30 seconds provides an uncapped unread count while the app is running, including in the tray. The navigation badge provides a fallback when the inbox endpoint is unavailable. Failed requests back off up to five minutes. Instagram access and OS notification settings still determine delivery.
- Tray → Tools → **Test message notification** sends a test alert. Allow IG-Now notifications in your OS settings; Windows Do Not Disturb and macOS Focus can suppress delivery. Windows notification registration is most reliable after installing the NSIS/MSI package.
- The duplicate outer DM scrollbar is removed. The conversation's own scrolling remains available.

## Automated DM links

Hidden link buttons supplied by Instagram are restored beneath their matching message. Links open in the default browser. The implementation is based on @yash-8923's PR #2 and adds thread matching, ambiguity checks, HTTP(S) URL validation, cache limits and observer cleanup. Link availability depends on Instagram's response format; the app does not invent a URL when Instagram supplies none.

## Existing media features

The v2.1.0 media controls remain: mouse seek/drag, -5s/+5s skip buttons, previous/next navigation, mute and volume controls, image zoom, browser link routing, Cobalt hand-off, close-to-tray and pause-on-minimize.

## Downloads

| Platform | Package |
| --- | --- |
| Windows x64 | `IG-Now_2.2.0_x64-setup.exe`, `IG-Now_2.2.0_x64_en-US.msi` |
| macOS Apple Silicon + Intel | `IG-Now_2.2.0_universal.dmg` |
| Linux x64 | `IG-Now_2.2.0_amd64.AppImage`, `IG-Now_2.2.0_amd64.deb`, RPM package |

`checksums.txt` and `SHA256SUMS.txt` cover the released packages. All supported platform builds and tests must succeed before the workflow publishes the release.

## Validation

Regression checks cover link extraction, unsafe URLs, route changes, duplicate buttons, observer stability, unread baselines and notification bursts. The existing headless Edge media suite checks seek, drag, playback, mute, volume, navigation, compact cards and overlay event isolation. Platform CI runs JavaScript and Rust tests before packaging.

Signed-in Instagram server responses, delivery timing and notification presentation can vary by account and OS settings. The checks above do not claim a live two-account message exchange on every platform.

Crafted with care by [@benedictusrey](https://github.com/benedictusrey). Thanks to @deathtn for the notification/scrollbar report and @yash-8923 for the hidden-link contribution.
