# Issue #3: native layout preservation

## Confirmed defect and focused repair

The media stylesheet forced every video parent to `position: relative !important`.
A controlled Chromium/Edge fixture reproduced changes to absolute, fixed and
sticky video hosts and the surrounding profile-sidebar geometry after the helper
was installed. The regression test failed on the v2.2.0 implementation.

The repair leaves already positioned parents untouched. Only a statically
positioned parent receives an overlay-anchor fallback. That CSS uses zero
selector specificity and no `!important`, allowing later Instagram positioning
rules to take precedence. No sidebar offsets, display resolution, window size,
DM styles, audio defaults or video interaction handlers are changed.

## Verification

- `npm run test:layout`: 18 real-browser cases across six viewport/DPR settings
  and three body-zoom levels. Checks native host/sidebar geometry, unpositioned
  anchoring, later native style changes and fixed positioning during scrolling.
- `npm test`: all 7 DM/link tests passed.
- `cargo test --locked --lib`: all 13 Rust tests passed.
- Existing Edge media smoke suite: all 30 checks passed, including mouse seek,
  drag, compact cards, playback, mute/volume and event isolation.
- Additional notification polling/backoff/disposal and DM inner-scroll checks
  passed. JavaScript syntax, Rust formatting and Git whitespace checks passed.
- Windows release-mode candidate built successfully. This is an unreleased
  candidate based on v2.2.0, not a replacement for the published release.

Local browser command: set `PLAYWRIGHT_CHANNEL=msedge`, then `npm run test:layout`.
CI installs Chromium and runs the same suite on Ubuntu. DPR emulation is not a
physical Windows multi-monitor/DPI-transition test.

## Remaining report-specific uncertainty

The issue screenshot alone does not prove that this override caused the
reporter's clipping. Their app version, viewport, zoom, scroll position and
reproduction steps have not been supplied. The maintainer's screenshot shows
normal layout on a 1920x1080 display at 100% Windows scaling. Do not close issue
#3 as verified on the reporter's account until their reproduction is checked.
