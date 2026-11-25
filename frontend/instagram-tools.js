// IG-Now — High-Performance Desktop Client for Instagram
// Sole Author & Creator: Benedictus Reynaldo Hartanto (@benedictusrey)
// Repository: https://github.com/benedictusrey/IG-Now
// All rights reserved. See LICENSE for details.

(function () {
  if (window.__ignowMediaToolsInstalled) return;
  window.__ignowMediaToolsInstalled = true;

  const invoke = window.__TAURI__?.core?.invoke;
  const state = {
    menu: null,
    toast: null,
    viewer: null,
    activeVideo: null,
    videoAudioUnlocked: false,
    // True while IG-Now itself is assigning `video.muted` — the volumechange
    // guard must not fight our own assignments (they fire synchronously).
    volumeGuardSuppressed: false,
    navHistory: [window.location.href],
    navIndex: 0,
    mediaCache: new Map(),
    rawNodeCache: new Map()
  };
  const controlActions = new WeakMap();
  const videoControllers = new WeakMap();

  const style = document.createElement("style");
  style.textContent = `
    .ignow-media-viewer {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 22px;
      background: rgba(0, 0, 0, 0.82);
      backdrop-filter: blur(12px);
      font: 13px "Segoe UI", Arial, sans-serif;
    }

    .ignow-media-viewer__panel {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(96vw, 1160px);
      height: min(94vh, 900px);
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 18px;
      background: rgba(18, 18, 22, 0.96);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
    }

    .ignow-media-viewer__toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 54px;
      padding: 9px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      color: #fff;
    }

    .ignow-media-viewer__toolbar button,
    .ignow-media-viewer__toolbar input {
      accent-color: #e1306c;
    }

    .ignow-media-viewer__toolbar button {
      min-width: 32px;
      height: 32px;
      padding: 0 9px;
      border: 0;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
      cursor: pointer;
    }

    .ignow-media-viewer__toolbar button:hover {
      background: rgba(255, 255, 255, 0.24);
    }

    .ignow-media-viewer__toolbar .ignow-media-viewer__close {
      margin-left: auto;
      font-size: 19px;
    }

    .ignow-media-viewer__zoom {
      width: 180px;
      cursor: pointer;
    }

    .ignow-media-viewer__zoom-label {
      min-width: 45px;
      color: #ddd;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .ignow-media-viewer__viewport {
      position: relative;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      cursor: grab;
      user-select: none;
    }

    .ignow-media-viewer__viewport:active {
      cursor: grabbing;
    }

    .ignow-media-viewer__image {
      position: absolute;
      top: 50%;
      left: 50%;
      max-width: none;
      max-height: none;
      transform-origin: center center;
      user-select: none;
      pointer-events: none;
    }

    .ignow-media-menu {
      position: fixed;
      z-index: 2147483647;
      min-width: 248px;
      padding: 6px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 10px;
      background: #141417;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.48);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }

    .ignow-media-menu button {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 9px 11px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #f5f5f5;
      text-align: left;
      cursor: pointer;
    }

    .ignow-media-menu button:hover,
    .ignow-media-menu button:focus-visible {
      background: rgba(255, 255, 255, 0.1);
      outline: none;
    }

    .ignow-media-menu__divider {
      height: 1px;
      margin: 4px 6px;
      background: rgba(255, 255, 255, 0.1);
    }

    .ignow-video-host {
      position: relative !important;
    }

    .ignow-video-controls {
      position: absolute !important;
      right: 0 !important;
      bottom: 0 !important;
      left: 0 !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
      min-height: 28px !important;
      /* 76px right reserve: Instagram floats its own mute / fullscreen
         buttons over the video's bottom-right corner. Our controls flex
         inside the remaining space so the two never overlap (v2.1.0). */
      padding: 0 76px 12px 10px !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: #fff !important;
      font: 12px "Segoe UI", Arial, sans-serif !important;
      opacity: 1 !important;
      /* Let Instagram's own mute/fullscreen controls receive clicks everywhere
         except the small IG-Now play and Search seek controls. */
      pointer-events: none !important;
      user-select: none !important;
      touch-action: none !important;
    }

    .ignow-video-controls button {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 auto !important;
      width: 24px !important;
      height: 26px !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 4px !important;
      background: transparent !important;
      color: #fff !important;
      cursor: pointer !important;
      font: 15px/1 "Segoe UI Symbol", "Segoe UI", Arial, sans-serif !important;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85) !important;
      pointer-events: auto !important;
    }

    .ignow-video-controls button:hover,
    .ignow-video-controls button:focus-visible {
      background: rgba(255, 255, 255, 0.18) !important;
      outline: none !important;
    }

    .ignow-video-controls__time {
      flex: 0 0 auto !important;
      min-width: 30px !important;
      color: rgba(255, 255, 255, 0.92) !important;
      font-variant-numeric: tabular-nums !important;
      text-align: left !important;
      white-space: nowrap !important;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85) !important;
    }

    .ignow-video-controls__time--total {
      text-align: right !important;
    }

    /* Mute toggle — lives in the LEFT cluster next to the play button so it
       can never sit on top of the total-time label (v2.1.0 fix), and so
       Instagram's own right-side controls (mute, fullscreen) are never
       overlapped either. It owns a hover-expand LEVEL slider: hover/focus
       the button (or drag the slider) to reveal a 64px horizontal volume
       track synchronized with Instagram's own vertical slider (both read
       and write the video element — single source of truth, v2.1.0). */
    .ignow-video-controls__volume {
      flex: 0 0 auto !important;
      width: 28px !important;
      height: 26px !important;
      font-size: 15px !important;
    }

    /* Level slider — an ABSOLUTE overlay anchored to the right of the mute
       button: it participates ZERO in flex layout, so the bar's geometry
       (and above all the seek line's width) is INVARIANT whether the track
       is open, closed, or mid-transition (a flex participant squeezed the
       seek line to its 28px minimum and shifted every control by ~56px
       whenever the track expanded — caught live by the Edge suite). Open
       state: group hover/focus, or the JS-open class while dragging. */
    .ignow-video-controls__volume-group {
      position: relative !important;
      display: inline-flex !important;
      align-items: center !important;
      flex: 0 0 auto !important;
      gap: 0 !important;
    }

    .ignow-video-controls__volume-group:hover .ignow-video-controls__volume-slider,
    .ignow-video-controls__volume-group.ignow-volume-open .ignow-video-controls__volume-slider {
      width: 64px !important;
      opacity: 1 !important;
    }

    .ignow-video-controls__volume-slider {
      position: absolute !important;
      left: 0 !important;
      bottom: 100% !important;
      top: auto !important;
      z-index: 2 !important;
      flex: 0 0 auto !important;
      width: 0 !important;
      min-width: 0 !important;
      height: 23px !important;
      min-height: 23px !important;
      margin: 0 !important;
      padding: 10px 0 !important;
      border: 0 !important;
      border-radius: 999px !important;
      opacity: 0 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      background: linear-gradient(
        to right,
        #fff 0%,
        #fff var(--ignow-volume, 50%),
        rgba(255, 255, 255, 0.42) var(--ignow-volume, 50%),
        rgba(255, 255, 255, 0.42) 100%
      ) !important;
      background-clip: content-box !important;
      filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.85)) !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      accent-color: #fff !important;
      transition: width 0.16s ease, opacity 0.16s ease !important;
    }

    .ignow-video-controls__volume-slider::-webkit-slider-runnable-track {
      height: 3px !important;
      border: 0 !important;
      border-radius: 999px !important;
      background: transparent !important;
    }

    .ignow-video-controls__volume-slider::-webkit-slider-thumb {
      width: 10px !important;
      height: 10px !important;
      margin-top: -3.5px !important;
      border: 0 !important;
      border-radius: 50% !important;
      background: #fff !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.8) !important;
    }

    .ignow-video-controls__volume-slider:focus-visible {
      width: 64px !important;
      opacity: 1 !important;
      outline: none !important;
    }

    /* Mute-first users: a muted element shows its audible level on the
       slider (matches Instagram's native slider behaviour) while the icon
       carries the muted state. */
    .ignow-video-controls__volume--muted {
      color: rgba(255, 255, 255, 0.72) !important;
    }

    /* Dedicated −5s / +5s seek buttons flanking the progress line — the
       mouse/touch equivalent of the Left/Right arrow keys. */
    .ignow-video-controls__skip {
      flex: 0 0 auto !important;
      width: auto !important;
      min-width: 24px !important;
      padding: 0 3px !important;
      font: 600 10px/1 "Segoe UI", Arial, sans-serif !important;
      letter-spacing: 0.01em !important;
    }

    /* Dedicated previous / next buttons — the mouse/touch equivalent of the
       Up/Down arrow keys (reel navigation, page scroll elsewhere). */
    .ignow-video-controls__nav {
      flex: 0 0 auto !important;
      width: 28px !important;
      height: 26px !important;
      font-size: 14px !important;
    }

    .ignow-video-controls__download {
      flex: 0 0 auto !important;
      width: 28px !important;
      height: 26px !important;
    }

    .ignow-sidebar-back,
    .ignow-sidebar-forward,
    .ignow-sidebar-downloader {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 100%;
      height: 48px;
      margin: 4px 0;
      padding: 12px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #f5f5f5;
      font: 400 16px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
      transition: background-color 140ms ease, opacity 140ms ease;
    }

    .ignow-sidebar-back:hover:not([aria-disabled="true"]),
    .ignow-sidebar-forward:hover:not([aria-disabled="true"]),
    .ignow-sidebar-downloader:hover {
      background: rgba(128, 128, 128, 0.16);
    }

    .ignow-sidebar-back:active:not([aria-disabled="true"]),
    .ignow-sidebar-forward:active:not([aria-disabled="true"]),
    .ignow-sidebar-downloader:active {
      transform: scale(0.98);
    }

    .ignow-sidebar-back:focus-visible,
    .ignow-sidebar-forward:focus-visible,
    .ignow-sidebar-downloader:focus-visible {
      outline: 2px solid #f5f5f5;
      outline-offset: 2px;
    }

    .ignow-sidebar-back[aria-disabled="true"],
    .ignow-sidebar-forward[aria-disabled="true"] {
      opacity: 0.42;
    }

    .ignow-sidebar-back__icon,
    .ignow-sidebar-forward__icon,
    .ignow-sidebar-downloader__icon {
      flex: 0 0 auto;
      width: 24px;
      height: 24px;
      transition: transform 140ms ease;
    }

    .ignow-sidebar-back:hover:not([aria-disabled="true"]) .ignow-sidebar-back__icon {
      transform: translateX(-2px);
    }

    .ignow-sidebar-forward:hover:not([aria-disabled="true"]) .ignow-sidebar-forward__icon {
      transform: translateX(2px);
    }

    .ignow-sidebar-back__label,
    .ignow-sidebar-forward__label,
    .ignow-sidebar-downloader__label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ignow-sidebar-back--compact,
    .ignow-sidebar-forward--compact,
    .ignow-sidebar-downloader--compact {
      width: 48px;
      justify-content: center;
      padding: 12px;
      gap: 0;
    }

    .ignow-sidebar-back--compact .ignow-sidebar-back__label,
    .ignow-sidebar-forward--compact .ignow-sidebar-forward__label,
    .ignow-sidebar-downloader--compact .ignow-sidebar-downloader__label {
      display: none;
    }

    .ignow-sidebar-floating-nav {
      position: fixed;
      left: 12px;
      bottom: 84px;
      z-index: 2147483640;
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: #f5f5f5;
    }

    /* Narrow hosts (Search cards, small embeds): there is no room for the
       navigation pair OR the seek-skip pair next to Instagram's own
       controls — hide both (the arrow keys still do both jobs) so the
       progress line gets the width instead of being squeezed to a sliver.
       Also drop the wide right reserve, which only exists to clear
       Instagram's floating corner buttons on large players. */
    .ignow-video-controls--compact {
      gap: 4px !important;
      padding-right: 12px !important;
    }

    .ignow-video-controls--compact .ignow-video-controls__nav {
      display: none !important;
    }

    .ignow-video-controls--compact .ignow-video-controls__skip {
      display: none !important;
    }

    /* Compact hosts have no width for a level slider either — the mute
       toggle and the Up/Down/Left/Right arrows keep doing the job. */
    .ignow-video-controls--compact .ignow-video-controls__volume-slider {
      display: none !important;
    }

    .ignow-video-controls--compact .ignow-video-controls__time {
      min-width: 30px !important;
      font-size: 11px !important;
    }

    .ignow-video-controls__progress {
      position: relative !important;
      flex: 1 1 auto !important;
      min-width: 28px !important;
      /* 3px visual line with a 23px pointer hit area (10px transparent
         padding, clipped from the background): easy to grab on every video,
         without growing the visible strip or stealing big page areas. */
      height: 23px !important;
      min-height: 23px !important;
      margin: -10px 0 !important;
      padding: 10px 0 !important;
      box-sizing: border-box !important;
      border: 0 !important;
      border-radius: 999px !important;
      background: linear-gradient(
        to right,
        #fff 0%,
        #fff var(--ignow-progress, 0%),
        rgba(255, 255, 255, 0.42) var(--ignow-progress, 0%),
        rgba(255, 255, 255, 0.42) 100%
      ) !important;
      background-clip: content-box !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.75) !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      accent-color: #fff !important;
    }

    .ignow-video-controls__progress::-webkit-slider-runnable-track {
      height: 3px !important;
      border: 0 !important;
      border-radius: 999px !important;
      background: transparent !important;
    }

    .ignow-video-controls__progress::-webkit-slider-thumb {
      width: 10px !important;
      height: 10px !important;
      margin-top: -3.5px !important;
      border: 0 !important;
      border-radius: 50% !important;
      background: #fff !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.75) !important;
      appearance: none !important;
      -webkit-appearance: none !important;
    }

    .ignow-video-controls__progress::-moz-range-track {
      height: 3px !important;
      border: 0 !important;
      border-radius: 999px !important;
      background: rgba(255, 255, 255, 0.42) !important;
    }

    .ignow-video-controls__progress::-moz-range-progress {
      height: 3px !important;
      border-radius: 999px !important;
      background: #fff !important;
    }

    .ignow-video-controls__progress::-moz-range-thumb {
      width: 10px !important;
      height: 10px !important;
      border: 0 !important;
      border-radius: 50% !important;
      background: #fff !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.75) !important;
    }

    .ignow-image-host {
      position: relative !important;
    }

    .ignow-image-download-btn {
      position: absolute !important;
      right: 12px !important;
      bottom: 12px !important;
      z-index: 2147483646 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 32px !important;
      height: 32px !important;
      padding: 0 !important;
      margin: 0 !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
      border-radius: 999px !important;
      background: rgba(16, 18, 23, 0.88) !important;
      color: #f4f5f7 !important;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4) !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      transition: background-color 140ms ease, border-color 140ms ease, transform 80ms ease !important;
    }

    .ignow-image-download-btn--lifted {
      bottom: 52px !important;
    }

    .ignow-image-download-btn:hover {
      background: rgba(24, 27, 34, 0.94) !important;
      border-color: rgba(255, 255, 255, 0.42) !important;
    }

    .ignow-image-download-btn:active {
      transform: scale(0.95) !important;
    }

    .ignow-image-download-btn:focus-visible {
      outline: 2px solid #f4f5f7 !important;
      outline-offset: 2px !important;
    }

    @media (prefers-reduced-motion: reduce) {
      .ignow-image-download-btn {
        transition: none !important;
      }
    }

    .ignow-toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      max-width: min(460px, calc(100vw - 36px));
      padding: 10px 14px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: #141417;
      color: #f5f5f5;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-variant-numeric: tabular-nums;
    }
  `;

  function appendStyle() {
    if (document.documentElement) document.documentElement.appendChild(style);
    else document.addEventListener("DOMContentLoaded", appendStyle, { once: true });
  }

  appendStyle();

  function elementFromTarget(target) {
    if (target instanceof Element) return target;
    return target?.parentElement instanceof Element ? target.parentElement : null;
  }

  // Mute changes made by IG-Now itself must not be "corrected" by our own
  // volumechange guard: the `muted` setter fires `volumechange` SYNCHRONOUSLY,
  // so a direct `video.muted = ...` assignment inside a control action is
  // observed by the guard BEFORE the surrounding bookkeeping runs — the guard
  // then immediately reverted the user's mute click (observed in v2.1.0: the
  // reel kept playing sound after pressing mute). Setting through this helper
  // suppresses the guard for exactly that one assignment.
  function setVideoMuted(video, muted) {
    state.volumeGuardSuppressed = true;
    try {
      video.muted = muted;
    } finally {
      state.volumeGuardSuppressed = false;
    }
  }

  // Trusted LEVEL change from IG-Now's volume slider. Writes only
  // `video.volume` — muted stays whatever it was (dragging to 0 equals
  // silence without touching the mute flag, mirroring Instagram's own
  // slider; the level icons keep meaning unmuted states).
  function setVideoVolume(video, volume) {
    state.volumeGuardSuppressed = true;
    try {
      video.volume = volume;
    } finally {
      state.volumeGuardSuppressed = false;
    }
  }

  // Once the user presses the volume button for the FIRST time — either
  // direction — this element's audio is user-owned and the guard defends it
  // against page-driven changes. (Marking only on unmute left mute-first
  // users unprotected: the page player un-muted their muted reel right
  // back — the reported "muted icon but sound keeps playing" bug.)
  function markAudioUserControlled(video) {
    video.dataset.ignowAudioUserActivated = "1";
  }

  function controlButtonFromTarget(target, x, y) {
    const selector = ".ignow-video-controls button, .ignow-image-download-btn";
    const direct = elementFromTarget(target)?.closest?.(selector) || null;
    if (direct && controlActions.has(direct)) return direct;
    // Same overlay-proofing as the seek line: find our button beneath a
    // covering page layer at the click point.
    if (typeof x === "number" && typeof y === "number" && document.elementsFromPoint) {
      for (const element of document.elementsFromPoint(x, y)) {
        const button = element?.closest?.(selector);
        if (button && controlActions.has(button)) return button;
      }
    }
    return null;
  }

  // Pointer events on the bar that we do not otherwise handle are isolated
  // at the window capture level so Instagram's gesture layers never see them.
  // NOTE: pointerdown/pointerup are deliberately NOT here — the activation
  // handlers below own them (a stopImmediatePropagation here would kill
  // every later window-capture listener, including the activation and seek
  // handlers — a real bug the regression harness caught).
  ["pointercancel", "mousedown", "mouseup"].forEach(type => {
    window.addEventListener(type, event => {
      const element = elementFromTarget(event.target);
      if (!element?.closest?.(".ignow-video-controls, .ignow-image-download-btn")) return;
      if (element.closest?.(".ignow-video-controls__progress")) return;
      if (element.closest?.(".ignow-video-controls__volume-slider")) return;
      event.stopImmediatePropagation();
    }, true);
  });

  // BUTTON ACTIVATION — window-capture pointer pair resolved by POINT, not
  // by event target (final v2.1.0 hardening; probed live on the binary).
  // The seek line always worked on real Instagram while every button died,
  // and the difference was resolution mode: the seek path scans the full
  // element stack at the pointer position, so gradient scrims / portal
  // overlays stacked ABOVE the bar never mattered — while the buttons gated
  // on `event.target` being inside the bar and re-resolved at the release
  // point. An overlay target (J4) or a real hand's 1–3px drift between
  // press and release (J3) silently dropped the press; pressing one button
  // and sliding to a neighbor even fired the WRONG one (J6). Buttons now
  // use the model that made the seek line bulletproof:
  //   pointerdown — isolate the press, remember the button resolved BY POINT
  //   pointerup   — fire the PRESSED button when the release stays on/next
  //                 to it (small slop for hand drift); a release over a
  //                 different button or a real drag-away cancels like a
  //                 native button; nothing leaks toward the page either way
  //   click       — the synthetic click of a handled press is swallowed
  //                 exactly once (it may target the bar, the gap, or a page
  //                 overlay above the bar — never Instagram). Keyboard
  //                 activation (Enter/Space — no pointer press) still runs.
  let pendingPointerPress = null; // { button, pointerId } while the finger is down
  let suppressedClick = null; // { at } arms ONE swallow for a handled press
  let pressOnOurBarId = null; // pointerId of a press that started on our bar

  // Release tolerance for hand drift. Safe to be generous: slop applies
  // ONLY when the release resolves to no button at all — a release over any
  // real button resolves to that button and must equal the pressed one, so
  // a wide slop can never fire the wrong control. 24px covers the bar's own
  // padding plus a few px past its edge (probed: a release 3px below the
  // bar is ~17px below the button).
  const PRESS_SLOP_PX = 24;
  // The UA generates a press's click synchronously in the input pipeline
  // (single-digit ms, even on janky pages — it is not subject to page JS).
  // 150ms is a safe upper bound for receiving it, and far below human
  // follow-up timing, so a stale swallow can never eat the user's NEXT
  // click (e.g. after a release outside the content area, which produces
  // no click at all — harness-verified failure mode).
  const CLICK_SWALLOW_WINDOW_MS = 150;

  // Our progress line / volume slider under the point (seek and volume
  // paths own them — never isolate their events here or the window-capture
  // delegation below dies).
  function progressBarFromPoint(x, y) {
    if (typeof x === "number" && typeof y === "number" && document.elementsFromPoint) {
      for (const element of document.elementsFromPoint(x, y)) {
        const input = element?.closest?.(".ignow-video-controls__progress");
        if (input && seekDelegates.has(input)) return input;
      }
    }
    return null;
  }

  function volumeSliderFromPoint(x, y) {
    if (typeof x === "number" && typeof y === "number" && document.elementsFromPoint) {
      for (const element of document.elementsFromPoint(x, y)) {
        const input = element?.closest?.(".ignow-video-controls__volume-slider");
        if (input && seekDelegates.has(input)) return input;
      }
    }
    return null;
  }

  function releaseWithinSlop(button, x, y) {
    const rect = button.getBoundingClientRect();
    return x >= rect.left - PRESS_SLOP_PX && x <= rect.right + PRESS_SLOP_PX
      && y >= rect.top - PRESS_SLOP_PX && y <= rect.bottom + PRESS_SLOP_PX;
  }

  function armClickSwallow() {
    suppressedClick = { at: Date.now() };
  }

  function runControlAction(button) {
    const action = controlActions.get(button);
    if (!action) return;
    try {
      Promise.resolve(action()).catch(error => {
        console.warn("IG-Now video control action failed:", error);
      });
    } catch (error) {
      console.warn("IG-Now video control action failed:", error);
    }
  }

  window.addEventListener("pointerdown", event => {
    // Seek and volume-slider paths own presses on their inputs — never
    // isolate them (a stopImmediatePropagation here would kill the
    // delegation below; the seek line taught us this in Round 2).
    // Target check first (works everywhere), point scan second (covers
    // page overlays sitting above the line in production).
    if (elementFromTarget(event.target)?.closest?.(".ignow-video-controls__progress, .ignow-video-controls__volume-slider")) return;
    if (progressBarFromPoint(event.clientX, event.clientY)) return;
    if (volumeSliderFromPoint(event.clientX, event.clientY)) return;
    // POINT resolution: find our button beneath whatever layer the pointer
    // is over — event.target may be a page overlay sitting above the bar.
    const button = controlButtonFromTarget(event.target, event.clientX, event.clientY);
    const overOurBar = button
      || (elementFromTarget(event.target)?.closest?.(".ignow-video-controls, .ignow-image-download-btn"));
    if (!overOurBar) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    // Isolate the press from Instagram's layers AND from our own later
    // listeners (nothing else may react to a press on our bar). We do
    // NOT preventDefault: canceling pointerdown suppresses the default
    // activation behavior in production WebView2 — the user gesture our
    // own action needs to resume audio (observed: seek/volume worked but
    // play never did; Playwright's relaxed autoplay flags masked it).
    event.stopImmediatePropagation();
    pressOnOurBarId = event.pointerId; // even a gap press stays ours end-to-end
    pendingPointerPress = button ? { button, pointerId: event.pointerId } : null;
  }, true);

  window.addEventListener("pointerup", event => {
    const barPressId = pressOnOurBarId;
    pressOnOurBarId = null;
    const press = pendingPointerPress;
    pendingPointerPress = null;
    if (barPressId === null || event.pointerId !== barPressId) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    // No preventDefault (same user-activation reason as pointerdown).
    event.stopImmediatePropagation();
    const releaseButton = controlButtonFromTarget(event.target, event.clientX, event.clientY);
    // Fire the PRESSED button: release over it, or drifted only a hand's
    // width off it. A different button under the release, or a real
    // drag-away, cancels — like a native button.
    if (press) {
      const fired = releaseButton === press.button
        || (!releaseButton && releaseWithinSlop(press.button, event.clientX, event.clientY));
      if (fired) runControlAction(press.button);
    }
    // The synthetic click lands on whatever is under the RELEASE point —
    // the bar, a gap, or a page overlay above the bar. Arm the swallow so
    // a handled press can never leak into Instagram (e.g. a scrim click
    // toggling playback under our button).
    armClickSwallow();
  }, true);

  window.addEventListener("pointercancel", event => {
    if (pendingPointerPress && event.pointerId === pendingPointerPress.pointerId) {
      pendingPointerPress = null;
    }
    if (event.pointerId === pressOnOurBarId) pressOnOurBarId = null;
  }, true);
  window.addEventListener("blur", () => {
    pendingPointerPress = null; // alt-tab mid-press: abandon like native
    pressOnOurBarId = null;
  });

  // Clicks inside the control bar are still fully isolated so Instagram's
  // video-area click handler never toggles playback. If the click belongs to
  // a pointer press we already activated, it is swallowed ONCE (consumed) as
  // the browser's synthetic duplicate; keyboard-activated clicks (Enter/
  // Space) have no pointer press and always run.
  window.addEventListener("click", event => {
    // First: the synthetic click of a press we just handled may target the
    // bar, the gap, or a page overlay above the bar — swallow it once.
    // Time-boxed: the UA generates a press's click within milliseconds, so
    // a swallow older than the window is stale (e.g. the press released
    // OUTSIDE the content area, which produces no click at all) and must
    // never eat a later, unrelated user click. A late click still clears
    // the stale state.
    if (suppressedClick) {
      const stale = Date.now() - suppressedClick.at > CLICK_SWALLOW_WINDOW_MS;
      suppressedClick = null; // exactly one swallow per handled press
      if (!stale) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (!elementFromTarget(event.target)?.closest?.(".ignow-video-controls, .ignow-image-download-btn")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = controlButtonFromTarget(event.target, event.clientX, event.clientY);
    if (button) runControlAction(button); // keyboard clicks (Enter/Space) land here
  }, true);

  window.addEventListener("dblclick", event => {
    if (!elementFromTarget(event.target)?.closest?.(".ignow-video-controls, .ignow-image-download-btn")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // ── Seek-line delegation (window capture phase) ─────────────────────────
  // ROOT CAUSE of the unclickable seek bar (v2.1.0): Instagram registers
  // capture-phase pointer handlers on document/window that call
  // stopPropagation(); capture runs BEFORE target-phase listeners, so any
  // listener attached to the seek line itself could be silently skipped.
  // Handling pointerdown/move/up/cancel HERE at the window capture level runs
  // ahead of every page handler and cannot be intercepted. The per-video
  // install registers its line in `seekDelegates`; these delegates resolve
  // the fraction from clientX and seek the owning video.
  const seekDelegates = new WeakMap();
  const activePointerSeeks = new Map();
  // Latest pointer position of an active seek drag — read inside the rAF
  // coalescer above (v2.1.0). Cleared with the drag in stopPointerSeek.
  const lastPointerSeekByPointerId = new Map();

  function seekInputFromTarget(target, x, y) {
    // Matches BOTH delegated inputs: the seek line and the volume level
    // slider share this window-capture pointer path (v2.1.0).
    const direct = elementFromTarget(target)?.closest?.(
      ".ignow-video-controls__progress, .ignow-video-controls__volume-slider"
    ) || null;
    if (direct && seekDelegates.has(direct)) return direct;
    // A page overlay (e.g. an Instagram gesture layer) may sit ABOVE the seek
    // line, making the event target the overlay instead of the line. Scan the
    // full element stack at the point to find our line beneath it. Runs only
    // on pointerdown (never per-move), so the cost is negligible.
    if (typeof x === "number" && typeof y === "number" && document.elementsFromPoint) {
      for (const element of document.elementsFromPoint(x, y)) {
        const input = element?.closest?.(
          ".ignow-video-controls__progress, .ignow-video-controls__volume-slider"
        );
        if (input && seekDelegates.has(input)) return input;
      }
    }
    return null;
  }

  function seekViaDelegate(input, clientX) {
    const delegate = seekDelegates.get(input);
    if (!delegate) return;
    const rect = input.getBoundingClientRect();
    if (!rect.width) return;
    delegate.activate();
    delegate.seek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  }

  window.addEventListener("pointerdown", event => {
    const input = seekInputFromTarget(event.target, event.clientX, event.clientY);
    if (!input) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      input.setPointerCapture?.(event.pointerId);
    } catch (error) {
      console.warn("IG-Now could not capture the pointer for seeking:", error);
    }
    activePointerSeeks.set(event.pointerId, input);
    lastPointerSeekByPointerId.set(event.pointerId, { input, clientX: event.clientX });
    seekViaDelegate(input, event.clientX);
  }, true);

  // Coalesce drag seeking to ONE seek per animation frame: pointermove can
  // fire at 100+ Hz while the display repaints at ~60 Hz, so every in-between
  // move did a getBoundingClientRect + fastSeek/currentTime + full sync() that
  // was discarded before it could ever be painted — measurable layout and
  // paint pressure on mid-range machines during seek drags (v2.1.0 perf fix).
  // rAF runs identically in jsdom (`pretendToBeVisual`), so the harnesses lock
  // the semantics in.
  let seekFramePending = false;
  window.addEventListener("pointermove", event => {
    const input = activePointerSeeks.get(event.pointerId);
    if (!input) return;
    // Record the LATEST position first, then coalesce: the rAF callback must
    // always read the most recent move, never a stale one (the first draft
    // scheduled the frame but never refreshed the entry — drags would have
    // re-seeked to the press position forever).
    lastPointerSeekByPointerId.set(event.pointerId, { input, clientX: event.clientX });
    if (seekFramePending) return;
    seekFramePending = true;
    requestAnimationFrame(() => {
      seekFramePending = false;
      const seek = lastPointerSeekByPointerId.get(event.pointerId);
      if (!seek) return;
      seekViaDelegate(seek.input, seek.clientX);
    });
  }, true);

  const stopPointerSeek = event => {
    const input = activePointerSeeks.get(event.pointerId);
    if (!input) return;
    activePointerSeeks.delete(event.pointerId);
    lastPointerSeekByPointerId.delete(event.pointerId);
    try {
      input.releasePointerCapture?.(event.pointerId);
    } catch (error) {
      console.warn("IG-Now could not release the seek pointer:", error);
    }
    // Optional per-delegate end hook (the volume slider collapses itself;
    // the seek delegate has none).
    seekDelegates.get(input)?.release?.();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("pointerup", stopPointerSeek, true);
  window.addEventListener("pointercancel", stopPointerSeek, true);

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
  }

  function isPostImage(image) {
    if (!(image instanceof HTMLImageElement)) return false;
    if (image.closest("header, nav, aside, .ignow-media-viewer, #__ignow_about")) return false;
    if (image.naturalWidth > 0 && (image.naturalWidth < 120 || image.naturalHeight < 120)) return false;
    const rect = image.getBoundingClientRect();
    const hasPostContext = Boolean(image.closest("article, [role=dialog]"));
    return (hasPostContext || (rect.width >= 260 && rect.height >= 260))
      && rect.width >= 120
      && rect.height >= 120;
  }

  function isPostVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    if (video.closest("header, nav, aside, .ignow-media-viewer, #__ignow_about")) return false;
    const rect = video.getBoundingClientRect();
    const hasPostContext = Boolean(video.closest("article, [role=dialog]"));
    return (hasPostContext || (rect.width >= 260 && rect.height >= 260))
      && rect.width >= 120
      && rect.height >= 120;
  }

  function mediaFromTarget(target) {
    const element = elementFromTarget(target);
    const media = element?.closest?.("img, video");
    if (media instanceof HTMLImageElement && isPostImage(media)) return media;
    if (media instanceof HTMLVideoElement && isPostVideo(media)) return media;
    return null;
  }

  function mediaVisibleAreaInViewport(media) {
    const r = media.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return 0;
    const viewport = media.closest("[role='presentation'], [role='dialog'], article");
    const vr = viewport ? viewport.getBoundingClientRect() : null;
    const minX = vr && vr.width > 0 ? Math.max(0, vr.left) : 0;
    const maxX = vr && vr.width > 0 ? Math.min(window.innerWidth, vr.right) : window.innerWidth;
    const minY = vr && vr.height > 0 ? Math.max(0, vr.top) : 0;
    const maxY = vr && vr.height > 0 ? Math.min(window.innerHeight, vr.bottom) : window.innerHeight;
    const w = Math.max(0, Math.min(r.right, maxX) - Math.max(r.left, minX));
    const h = Math.max(0, Math.min(r.bottom, maxY) - Math.max(r.top, minY));
    return w * h;
  }

  function mediaAtPoint(x, y) {
    const elements = document.elementsFromPoint?.(x, y) || [];
    for (const element of elements) {
      const media = mediaFromTarget(element);
      if (media) return media;
    }

    const container = elements
      .find(element => element.closest?.("article, [role=dialog], [data-ignow-media-stage]"))
      ?.closest?.("article, [role=dialog], [data-ignow-media-stage]") || null;
    if (!container) return null;
    const matches = Array.from(container.querySelectorAll("img, video"))
      .filter(media => {
        if (!(media instanceof HTMLVideoElement ? isPostVideo(media) : isPostImage(media))) return false;
        const rect = media.getBoundingClientRect();
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
        return getComputedStyle(media).opacity !== "0";
      })
      .map(media => ({
        media,
        score: mediaVisibleAreaInViewport(media) + (media instanceof HTMLVideoElement ? 500 : 0)
      }))
      .sort((a, b) => b.score - a.score);
    return matches[0]?.media || null;
  }

  function buttonAccessibleLabel(button) {
    if (!(button instanceof Element)) return "";
    return `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""} ${button.querySelector("svg[aria-label]")?.getAttribute("aria-label") || ""} ${button.querySelector("svg title")?.textContent || ""}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function isNativeAudioButton(button) {
    if (!(button instanceof Element) || !isVisible(button)) return false;
    if (button.closest(".ignow-video-controls, .ignow-sidebar-back, .ignow-sidebar-forward, .ignow-sidebar-downloader, .ignow-sidebar-floating-nav, #__ignow_about")) return false;
    const label = buttonAccessibleLabel(button);
    if (!label) return false;
    if (/(download|caption|comment|like|share|repost|save|bookmark|close|dismiss|next|prev|back|more|settings)/i.test(label)) return false;
    return /(audio\s+is\s+(?:muted|playing)|\b(?:un)?mute\b|toggle\s+audio|\bsound\b)/i.test(label);
  }

  function readNativeButtonMuted(button) {
    const label = buttonAccessibleLabel(button);
    if (!label) return null;
    if (/audio\s+is\s+muted|unmute|\bmuted\b/i.test(label)) return true;
    if (/audio\s+is\s+playing|\bmute\b|sound\s+on/i.test(label)) return false;
    const svg = button.querySelector("svg");
    if (svg) {
      if (svg.querySelectorAll("line").length >= 1) return true;
      if (svg.querySelectorAll("path").length >= 2) return false;
    }
    return null;
  }

  function findNativeMuteButton(video) {
    if (!(video instanceof HTMLVideoElement)) return null;
    const vRect = video.getBoundingClientRect();
    let bestBtn = null;
    let bestDist = Infinity;
    let scope = video.parentElement;
    for (let depth = 0; scope && scope !== document.body && scope !== document.documentElement && depth < 7; depth += 1, scope = scope.parentElement) {
      const candidates = Array.from(scope.querySelectorAll("button, [role='button']")).filter(isNativeAudioButton);
      if (candidates.length) {
        for (const btn of candidates) {
          const r = btn.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const tx = vRect.width > 0 ? vRect.right : cx;
          const ty = vRect.height > 0 ? vRect.bottom : cy;
          const dist = Math.hypot(cx - tx, cy - ty);
          if (dist < bestDist) {
            bestDist = dist;
            bestBtn = btn;
          }
        }
        if (bestBtn) return bestBtn;
      }
      if (scope.matches("[data-ignow-media-stage], article, [role='dialog'], main")) break;
    }
    return bestBtn;
  }

  function isWindowForeground() {
    return !document.hidden && (typeof document.hasFocus !== "function" || document.hasFocus());
  }

  function markNativeAudioInteraction(event) {
    const targetEl = elementFromTarget(event.target);
    const nativeAudioBtn = targetEl?.closest?.("button, [role='button']");
    if (!nativeAudioBtn || !isNativeAudioButton(nativeAudioBtn)) return false;
    const scope = nativeAudioBtn.closest("[data-ignow-media-stage], article, [role='dialog'], main") || document;
    const now = String(Date.now());
    scope.querySelectorAll("video").forEach(v => {
      v.dataset.ignowNativeToggleAt = now;
    });
    return true;
  }

  window.addEventListener("click", event => {
    markNativeAudioInteraction(event);
  }, true);

  window.addEventListener("pointerdown", event => {
    if (markNativeAudioInteraction(event)) return;
    const targetEl = elementFromTarget(event.target);
    if (targetEl?.closest?.(".ignow-video-controls, button, [role='button'], a, input, textarea, [contenteditable='true']")) return;
    if (event.button !== 0) return;
    const media = mediaFromTarget(event.target) || mediaAtPoint(event.clientX, event.clientY);
    if (!(media instanceof HTMLVideoElement)) return;
    state.activeVideo = media;
    if (isSearchCardVideo(media)) {
      state.videoAudioUnlocked = true;
      media.volume = 0.2;
      setVideoMuted(media, true);
    } else {
      activateVideoAudio(media);
    }
    pauseOtherVideos(media);
  }, true);

  function isStandaloneReelPage() {
    return /^\/(reel|reels)(\/|$)/i.test(window.location.pathname);
  }

  function isSearchPage() {
    return /^\/explore\/search(?:\/|$)/i.test(window.location.pathname);
  }

  function isStandaloneVideo(video) {
    return isStandaloneReelPage() || Boolean(video?.closest?.("[role=dialog]"));
  }

  function isSearchCardVideo(video) {
    return isSearchPage() && !isStandaloneVideo(video);
  }

  function defaultVolumeForVideo(video) {
    return isSearchCardVideo(video) ? 0.1 : 0.5;
  }

  // Speaker icon for an AUDIBLE state, by level — mirrors how Instagram's
  // own icon reacts to its native slider (muted is handled separately with
  // the crossed-out icon).
  function audibleIconForVolume(volume) {
    const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
    if (level <= 0.005) return "muted";
    if (level < 0.34) return "low";
    if (level < 0.67) return "mid";
    return "high";
  }

  function volumeSvgMarkup(levelKind) {
    if (levelKind === "muted") {
      return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>'
        + '<line x1="22" y1="9" x2="16" y2="15"/>'
        + '<line x1="16" y1="9" x2="22" y2="15"/></svg>';
    }
    if (levelKind === "low") {
      return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>'
        + '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>'
      + '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
      + '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  }

  function resetVideoStateOnSourceChange(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const currentUrl = video.currentSrc || video.src || "";
    if (!currentUrl) return;
    if (video.dataset.ignowSourceUrl && video.dataset.ignowSourceUrl !== currentUrl) {
      video.dataset.ignowMutedByIgnow = "";
      video.dataset.ignowAudioUserActivated = "";
      video.dataset.ignowAudioProfile = "";
    }
    video.dataset.ignowSourceUrl = currentUrl;
  }

  function applyDefaultVideoAudio(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    resetVideoStateOnSourceChange(video);
    const profile = isSearchCardVideo(video) ? "search-card" : "full-view";
    const profileKey = `${profile}:${defaultVolumeForVideo(video)}`;
    if (video.dataset.ignowAudioProfile === profileKey) return;
    try {
      video.volume = defaultVolumeForVideo(video);
      // Never clobber audio the user explicitly took control of.
      if (isSearchCardVideo(video) && video.dataset.ignowAudioUserActivated !== "1") {
        setVideoMuted(video, true);
      }
      video.dataset.ignowAudioProfile = profileKey;
    } catch (error) {
      console.warn("IG-Now could not apply the video audio default:", error);
    }
  }

  function setMediaMuteSynced(video, targetMuted, userExplicit = false) {
    if (!(video instanceof HTMLVideoElement) || video.dataset.ignowSyncingNative === "1") return;
    video.dataset.ignowSyncingNative = "1";
    try {
      const desiredMuted = Boolean(targetMuted);
      if (userExplicit) {
        markAudioUserControlled(video);
      } else if (!desiredMuted) {
        video.dataset.ignowAudioUserActivated = "";
      }
      video.dataset.ignowMutedByIgnow = desiredMuted ? "1" : "";

      const nativeBtn = findNativeMuteButton(video);
      if (nativeBtn) {
        const nativeMuted = readNativeButtonMuted(nativeBtn);
        if (nativeMuted !== null && nativeMuted !== desiredMuted) {
          video.dataset.ignowNativeToggleAt = String(Date.now());
          nativeBtn.click();
        }
      }
      if (video.muted !== desiredMuted) {
        setVideoMuted(video, desiredMuted);
      }
      if (!desiredMuted && (!Number.isFinite(video.volume) || video.volume < 0.1)) {
        setVideoVolume(video, defaultVolumeForVideo(video));
      }
      videoControllers.get(video)?.refresh?.();
    } finally {
      video.dataset.ignowSyncingNative = "";
    }
  }

  function activateVideoAudio(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    try {
      state.videoAudioUnlocked = true;
      if (video.dataset.ignowAudioUserActivated === "1" && video.dataset.ignowMutedByIgnow === "1") return;
      setMediaMuteSynced(video, false, false);
    } catch (error) {
      console.warn("IG-Now could not enable video audio after the user gesture:", error);
    }
  }

  function pauseOtherVideos(activeVideo) {
    document.querySelectorAll("video").forEach(video => {
      if (video !== activeVideo && !video.paused) video.pause();
    });
  }

  function isVideoOnScreen(video) {
    const rect = video.getBoundingClientRect();
    return rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth;
  }

  function visibleVideos() {
    return Array.from(document.querySelectorAll("video"))
      .filter(video => isVisible(video) && isVideoOnScreen(video) && isPostVideo(video));
  }

  function activeVideoForKeyboard() {
    if (state.activeVideo?.isConnected
      && isVisible(state.activeVideo)
      && isVideoOnScreen(state.activeVideo)) return state.activeVideo;
    const videos = visibleVideos();
    return videos.find(video => !video.paused) || videos
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      })[0] || null;
  }

  function seekVideo(video, seconds) {
    if (!(video instanceof HTMLVideoElement)) return;
    state.activeVideo = video;
    videoControllers.get(video)?.seek?.(seconds);
  }

  function reelPageStep() {
    return Math.max(400, window.innerHeight || 720);
  }

  function navigateReel(deltaY) {
    const video = activeVideoForKeyboard();
    const target = video || document.scrollingElement || document.body;
    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      deltaY
    });
    // Marker consumed by our own keydown capture below: the ArrowDown/Up
    // fallback we dispatch here must NOT re-enter navigateReel (loop guard).
    wheelEvent.__ignowSyntheticNavigation = true;
    target.dispatchEvent(wheelEvent);
    if (window.scrollBy && !wheelEvent.defaultPrevented) {
      const before = window.scrollY;
      window.scrollBy({ top: deltaY, behavior: "smooth" });
      // Synthetic wheel events cannot drive Instagram's slide-based reel
      // viewer (it reacts to real input or its own keyboard layer), and
      // scrollBy is a no-op when the viewer doesn't scroll. If the view did
      // not move, hand the navigation to Instagram's OWN arrow-key handling —
      // the exact path the Up/Down arrow keys use, which works everywhere
      // the user can navigate. Dispatched through the real pipeline so
      // capture and bubble listeners both see it.
      window.setTimeout(() => {
        if (Math.abs(window.scrollY - before) < 4) {
          const goingDown = deltaY > 0;
          const fallback = new KeyboardEvent("keydown", {
            key: goingDown ? "ArrowDown" : "ArrowUp",
            code: goingDown ? "ArrowDown" : "ArrowUp",
            bubbles: true,
            cancelable: true
          });
          fallback.__ignowSyntheticNavigation = true;
          const origin = document.activeElement instanceof Element
            ? document.activeElement
            : document.body;
          origin.dispatchEvent(fallback);
        }
      }, 220);
    }
  }

  function linkFromTarget(target) {
    const element = elementFromTarget(target);
    const link = element?.closest?.("a[href]");
    return link && /^https?:\/\//i.test(link.href) ? link : null;
  }

  function linkAtPoint(x, y) {
    const element = document.elementsFromPoint?.(x, y)?.find(item => item.closest?.("a[href]"));
    return linkFromTarget(element);
  }

  function sourceUrl(media) {
    const candidates = [
      media.currentSrc,
      media.src,
      media.getAttribute("src"),
      ...["data-src", "data-video-url", "data-media-url", "data-original"]
        .map(attribute => media.getAttribute(attribute)),
      ...Array.from(media.querySelectorAll?.("source[src]") || []).map(source => source.src)
    ];
    if (media instanceof HTMLImageElement) candidates.push(media.poster);
    return candidates.find(url => /^(https?:\/\/|blob:)/i.test(url || "")) || "";
  }

  function normalizeInstagramPostUrl(href) {
    if (!href) return "";
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return "";
      // Match both `/p/<code/>` and collaboration/profile-scoped `/<user>/p/<code/>` URLs.
      if (!/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/[^/?#]+/i.test(url.pathname)) return "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function postLinksInRoot(root) {
    return Array.from(root.querySelectorAll(
      "a[href*='/p/'], a[href*='/reel/'], a[href*='/reels/'], a[href*='/tv/']"
    )).map(link => ({ link, url: normalizeInstagramPostUrl(link.href) })).filter(item => item.url);
  }

  function closestPostLink(media) {
    for (let current = media; current instanceof Element; current = current.parentElement) {
      if (!current.matches("a[href]")) continue;
      const url = normalizeInstagramPostUrl(current.href);
      if (url) return url;
    }
    return "";
  }

  function bestPostLinkInRoot(root, media) {
    const candidates = postLinksInRoot(root);
    if (!candidates.length) return "";
    const containingLink = candidates.find(({ link }) => link.contains(media));
    if (containingLink) return containingLink.url;
    if (candidates.length === 1) return candidates[0].url;

    const mediaRect = media.getBoundingClientRect();
    const mediaCenterX = mediaRect.left + mediaRect.width / 2;
    const mediaCenterY = mediaRect.top + mediaRect.height / 2;
    return candidates
      .map(candidate => {
        const rect = candidate.link.getBoundingClientRect();
        const overlaps = rect.right >= mediaRect.left
          && rect.left <= mediaRect.right
          && rect.bottom >= mediaRect.top
          && rect.top <= mediaRect.bottom;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(centerX - mediaCenterX, centerY - mediaCenterY);
        return { ...candidate, score: (overlaps ? 1000000 : 0) - distance };
      })
      .sort((left, right) => right.score - left.score)[0]?.url || "";
  }

  function postUrlForMedia(media) {
    const directPostLink = closestPostLink(media);
    if (directPostLink) return directPostLink;

    const article = media.closest("article");
    if (article) {
      const articlePostLink = bestPostLinkInRoot(article, media);
      if (articlePostLink) return articlePostLink;
    }

    const dialog = media.closest("[role=dialog]");
    if (dialog) {
      const dialogPostLink = bestPostLinkInRoot(dialog, media);
      if (dialogPostLink) return dialogPostLink;
    }

    const roots = [];
    for (let current = media.parentElement, depth = 0;
      current instanceof Element && depth < 12;
      current = current.parentElement, depth += 1) {
      roots.push(current);
    }
    const seenRoots = new Set();
    for (const root of roots) {
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);
      if (root.matches?.("section")) break;
      const links = postLinksInRoot(root);
      const uniqueUrls = Array.from(new Set(links.map(item => item.url)));
      if (uniqueUrls.length === 1) return uniqueUrls[0];
    }

    const currentUrl = normalizeInstagramPostUrl(window.location.href);
    if (currentUrl) return currentUrl;

    const canonicalUrl = document.querySelector("link[rel='canonical']")?.href
      || document.querySelector("meta[property='og:url']")?.content;
    return normalizeInstagramPostUrl(canonicalUrl);
  }

  function mediaIndexForPost(media) {
    const container = media.closest("article, [role=dialog], section");
    const mediaElements = Array.from(container?.querySelectorAll?.("img, video") || [])
      .filter(element => element instanceof HTMLVideoElement
        ? isPostVideo(element)
        : isPostImage(element));
    const index = mediaElements.indexOf(media);
    return index >= 0 ? index : null;
  }

  function getInvoke() {
    return window.__TAURI__?.core?.invoke;
  }

  let sourceHashSeq = 1;

  function sanitizeSegment(raw) {
    return String(raw || "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 80);
  }

  function buildSourceFileStem(username = "", takenAt = "", shortcode = "") {
    const cleanUser = sanitizeSegment(username).slice(0, 40) || "instagram";
    const isoDigits = String(takenAt || "").slice(0, 10).replace(/\D+/g, "");
    const datePart = isoDigits.length === 8
      ? isoDigits
      : new Date().toISOString().slice(0, 10).replace(/\D+/g, "");
    const seed = `${cleanUser}|${datePart}|${shortcode || ""}|${Date.now()}|${sourceHashSeq++}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${cleanUser}-${datePart}-${hash.toString(16).padStart(8, "0")}`;
  }

  function shortcodeFromPostUrl(url) {
    const match = String(url || "").match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i);
    return match ? match[1] : "";
  }

  function stripMediaRangeParams(url) {
    if (!/^https?:\/\//i.test(url || "")) return "";
    try {
      const parsed = new URL(url);
      let changed = false;
      for (const param of ["bytestart", "byteend", "range", "segment", "chunk", "part"]) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.delete(param);
          changed = true;
        }
      }
      return changed ? parsed.toString() : url;
    } catch {
      return url;
    }
  }

  function isLikelyMediaSegment(url) {
    return /(?:[?&](?:range|bytestart|byteend|segment|chunk|part)=|\/(?:segment|chunk)(?:\/|$))/i.test(url || "");
  }

  function normalizeMediaUrl(url) {
    return String(url || "")
      .replaceAll("\\u0026", "&")
      .replaceAll("\\u003A", ":")
      .replaceAll("\\u002F", "/")
      .replaceAll("\\u003F", "?")
      .replaceAll("\\u003D", "=")
      .replaceAll("\\/", "/")
      .replaceAll("&amp;", "&");
  }

  function bestUrlsFromVersions(versions) {
    if (!Array.isArray(versions)) return [];
    return versions
      .filter(entry => entry && typeof entry.url === "string" && /^https?:\/\//i.test(entry.url))
      .slice()
      .sort((a, b) => ((Number(b.width) || 0) * (Number(b.height) || 0)) - ((Number(a.width) || 0) * (Number(a.height) || 0)))
      .map(entry => normalizeMediaUrl(entry.url))
      .filter(url => url && !isLikelyMediaSegment(url));
  }

  const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  function shortcodeToMediaId(shortcode) {
    const code = String(shortcode || "").trim();
    if (!code || code.length > 11) return "";
    let id = 0n;
    for (const ch of code) {
      const idx = IG_ALPHABET.indexOf(ch);
      if (idx < 0) return "";
      id = (id << 6n) + BigInt(idx);
    }
    return id > 0n ? id.toString() : "";
  }

  function mediaIdToShortcode(mediaId) {
    const raw = String(mediaId || "").split("_")[0].trim();
    if (!/^\d+$/.test(raw)) return "";
    let id = BigInt(raw);
    if (id <= 0n) return "";
    let out = "";
    while (id > 0n) {
      out = IG_ALPHABET[Number(id & 63n)] + out;
      id >>= 6n;
    }
    return out;
  }

  function getCookieValue(name) {
    try {
      const pairs = String(document.cookie || "").split(";");
      for (const pair of pairs) {
        const idx = pair.indexOf("=");
        if (idx > 0 && pair.slice(0, idx).trim() === name) {
          return decodeURIComponent(pair.slice(idx + 1).trim());
        }
      }
    } catch {
      // Ignore cookie read failures.
    }
    return "";
  }

  function instagramApiHeaders() {
    const headers = {
      "X-IG-App-ID": "936619743392459",
      "X-Requested-With": "XMLHttpRequest"
    };
    const csrf = getCookieValue("csrftoken");
    if (csrf) headers["X-CSRFToken"] = csrf;
    return headers;
  }

  function extractDashTracks(xmlText) {
    if (typeof xmlText !== "string" || !xmlText.includes("<BaseURL")) {
      return { videoUrls: [], audioUrl: "" };
    }
    const videoUrls = [];
    const audioUrls = [];
    const setRegex = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;
    let setMatch;
    while ((setMatch = setRegex.exec(xmlText)) !== null) {
      const attrs = setMatch[1] || "";
      const body = setMatch[2] || "";
      const isAudioSet = /contentType=["']audio|mimeType=["']audio\//i.test(attrs)
        || (/codecs=["']mp4a/i.test(body) && !/width=["']\d/i.test(body));
      const baseRegex = /<BaseURL[^>]*>([^<]+)<\/BaseURL>/gi;
      let baseMatch;
      while ((baseMatch = baseRegex.exec(body)) !== null) {
        const decoded = stripMediaRangeParams(normalizeMediaUrl(baseMatch[1].trim()));
        if (!/^https?:\/\//i.test(decoded) || isLikelyMediaSegment(decoded)) continue;
        if (isAudioSet) audioUrls.push(decoded);
        else videoUrls.push(decoded);
      }
    }
    if (!videoUrls.length && !audioUrls.length) {
      const matches = xmlText.matchAll(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/gi);
      for (const match of matches) {
        const decoded = stripMediaRangeParams(normalizeMediaUrl(match[1].trim()));
        if (/^https?:\/\//i.test(decoded) && !isLikelyMediaSegment(decoded)) {
          videoUrls.push(decoded);
        }
      }
    }
    return {
      videoUrls: Array.from(new Set(videoUrls)),
      audioUrl: audioUrls[0] || ""
    };
  }

  function serializeRawMediaNode(node) {
    try {
      const pk = String(node.pk || node.id || "").split("_")[0].replace(/\D+/g, "");
      const code = node.code || node.shortcode || mediaIdToShortcode(pk) || "";
      const raw = JSON.stringify({
        pk: node.pk || node.id || "",
        code: code || undefined,
        taken_at: node.taken_at || node.taken_at_timestamp || 0,
        user: node.user?.username ? { username: node.user.username } : undefined,
        owner: node.owner?.username ? { username: node.owner.username } : undefined,
        coauthor_producers: Array.isArray(node.coauthor_producers) ? node.coauthor_producers : undefined,
        caption: node.caption?.text ? { text: node.caption.text } : node.caption,
        edge_media_to_caption: node.edge_media_to_caption,
        video_versions: Array.isArray(node.video_versions) ? node.video_versions : undefined,
        video_url: node.video_url,
        video_dash_manifest: typeof node.video_dash_manifest === "string" ? node.video_dash_manifest : undefined,
        image_versions2: node.image_versions2,
        display_url: node.display_url,
        display_resources: Array.isArray(node.display_resources) ? node.display_resources : undefined,
        carousel_media: Array.isArray(node.carousel_media) ? node.carousel_media : undefined,
        edge_sidecar_to_children: node.edge_sidecar_to_children
      });
      return raw.length <= 2 * 1024 * 1024 ? raw : "";
    } catch {
      return "";
    }
  }

  function mediaItemFromNode(child) {
    if (!child || typeof child !== "object") return null;
    const dash = extractDashTracks(child.video_dash_manifest);
    const videoUrls = Array.from(new Set([
      ...bestUrlsFromVersions(child.video_versions),
      ...(typeof child.video_url === "string" ? [normalizeMediaUrl(child.video_url)] : []),
      ...dash.videoUrls
    ].filter(url => /^https?:\/\//i.test(url || "") && !isLikelyMediaSegment(url))));
    if (videoUrls.length) {
      const entry = { kind: "video", urls: videoUrls };
      if (dash.audioUrl && /^https?:\/\//i.test(dash.audioUrl)) entry.audioUrl = dash.audioUrl;
      return entry;
    }
    const imageUrls = [
      ...bestUrlsFromVersions(child.image_versions2?.candidates),
      ...(Array.isArray(child.display_resources)
        ? child.display_resources.slice().reverse().map(r => normalizeMediaUrl(r?.src))
        : []),
      ...(typeof child.display_url === "string" ? [normalizeMediaUrl(child.display_url)] : [])
    ].filter(url => /^https?:\/\//i.test(url || ""));
    const cleanImages = Array.from(new Set(imageUrls));
    return cleanImages.length ? { kind: "image", urls: cleanImages } : null;
  }

  function buildMediaBundleFromNode(node) {
    if (!node || typeof node !== "object") return null;
    const items = [];
    const pushItem = entry => {
      if (entry && Array.isArray(entry.urls) && entry.urls.length) items.push(entry);
    };

    if (Array.isArray(node.carousel_media) && node.carousel_media.length) {
      for (const child of node.carousel_media) {
        pushItem(mediaItemFromNode(child));
      }
    } else if (Array.isArray(node.edge_sidecar_to_children?.edges) && node.edge_sidecar_to_children.edges.length) {
      for (const edge of node.edge_sidecar_to_children.edges) {
        pushItem(mediaItemFromNode(edge?.node));
      }
    } else {
      pushItem(mediaItemFromNode(node));
    }

    if (!items.length) return null;
    const caption = String(
      node.caption?.text
      || node.edge_media_to_caption?.edges?.[0]?.node?.text
      || (typeof node.caption === "string" ? node.caption : "")
      || node.accessibility_caption
      || ""
    ).trim();
    const username = sanitizeSegment(
      node.user?.username
      || node.owner?.username
      || node.coauthor_producers?.[0]?.username
      || ""
    );
    const pk = String(node.pk || node.id || "").split("_")[0].replace(/\D+/g, "");
    const shortcode = sanitizeSegment(node.code || node.shortcode || mediaIdToShortcode(pk) || "");
    const takenEpoch = Number(node.taken_at || node.taken_at_timestamp || 0);
    const takenAt = Number.isFinite(takenEpoch) && takenEpoch > 0
      ? new Date(takenEpoch * 1000).toISOString()
      : "";
    let cachedRawNodeJson = null;
    const bundle = { items, caption, username, shortcode, pk, takenAt };
    Object.defineProperty(bundle, "rawNodeJson", {
      enumerable: true,
      get() {
        if (cachedRawNodeJson === null) cachedRawNodeJson = serializeRawMediaNode(node);
        return cachedRawNodeJson;
      }
    });
    return bundle;
  }

  function isSafeDataObject(value) {
    if (!value || typeof value !== "object") return false;
    try {
      if (value === window || value === document) return false;
      if (typeof Node === "function" && value instanceof Node) return false;
      if (typeof Event === "function" && value instanceof Event) return false;
      if (typeof value.self === "object" && value.self === value) return false;
      if (typeof value.window === "object" && value.window === value) return false;
      return true;
    } catch {
      return false;
    }
  }

  function isInstagramMediaNode(node) {
    if (!isSafeDataObject(node)) return false;
    try {
      return Boolean(
        Array.isArray(node.video_versions)
        || Array.isArray(node.carousel_media)
        || Array.isArray(node.edge_sidecar_to_children?.edges)
        || (typeof node.video_dash_manifest === "string" && node.video_dash_manifest.includes("<BaseURL"))
        || (Array.isArray(node.image_versions2?.candidates) && (node.code || node.pk || node.caption || node.user))
        || (typeof node.video_url === "string" && (node.shortcode || node.code || node.edge_media_to_caption))
        || (typeof node.display_url === "string" && (node.shortcode || node.code))
      );
    } catch {
      return false;
    }
  }

  function cacheMediaBundle(bundle) {
    if (!bundle || (!bundle.shortcode && !bundle.pk)) return;
    const shouldReplace = key => {
      const prev = state.mediaCache.get(key);
      return !prev || bundleRichnessScore(bundle) >= bundleRichnessScore(prev);
    };
    if (bundle.shortcode && shouldReplace(bundle.shortcode)) {
      state.mediaCache.set(bundle.shortcode, bundle);
      state.rawNodeCache.set(bundle.shortcode, bundle);
    }
    if (bundle.pk && shouldReplace(`pk:${bundle.pk}`)) {
      state.mediaCache.set(`pk:${bundle.pk}`, bundle);
      state.rawNodeCache.set(`pk:${bundle.pk}`, bundle);
    }
    while (state.mediaCache.size > 160) {
      state.mediaCache.delete(state.mediaCache.keys().next().value);
    }
    while (state.rawNodeCache.size > 160) {
      state.rawNodeCache.delete(state.rawNodeCache.keys().next().value);
    }
  }

  function bundleRichnessScore(bundle, targetShortcode = "") {
    if (!bundle) return -1;
    let score = (bundle.items?.length || 0) * 100;
    if (targetShortcode && bundle.shortcode === targetShortcode) score += 10000;
    if (bundle.username) score += 20;
    if (bundle.caption) score += 10;
    if (bundle.shortcode) score += 5;
    return score;
  }

  function scanObjectForBundles(root, targetShortcode, maxNodes = 12000, maxDepth = 24) {
    if (!isSafeDataObject(root)) return [];
    const results = [];
    const seen = new WeakSet();
    const stack = [{ value: root, depth: 0 }];
    let visited = 0;

    while (stack.length && visited < maxNodes) {
      const { value, depth } = stack.pop();
      if (!isSafeDataObject(value) || depth > maxDepth || seen.has(value)) continue;
      seen.add(value);
      visited += 1;

      try {
        if (isInstagramMediaNode(value)) {
          const bundle = buildMediaBundleFromNode(value);
          if (bundle) {
            cacheMediaBundle(bundle);
            if (targetShortcode && bundle.shortcode === targetShortcode) {
              return [bundle];
            }
            results.push(bundle);
            // Only stop early without a shortcode if we already captured a full carousel node;
            // a single-slide item may be nested inside the parent carousel object.
            if (!targetShortcode && bundle.items.length > 1) return [bundle];
          }
        }

        if (Array.isArray(value)) {
          for (let i = value.length - 1; i >= 0; i -= 1) {
            try {
              const item = value[i];
              if (isSafeDataObject(item)) stack.push({ value: item, depth: depth + 1 });
            } catch {
              // Skip unreadable array slots (e.g., cross-origin Window proxies).
            }
          }
        } else {
          const keys = Object.keys(value);
          for (let i = keys.length - 1; i >= 0; i -= 1) {
            const key = keys[i];
            if (
              key === "stateNode" || key === "_owner" || key === "return" || key === "child"
              || key === "sibling" || key === "alternate" || key === "window" || key === "frames"
              || key === "view" || key === "ownerDocument" || key === "parentNode"
            ) continue;
            try {
              const child = value[key];
              if (isSafeDataObject(child)) stack.push({ value: child, depth: depth + 1 });
            } catch {
              // Skip cross-origin frames or throwing getters inside React Fiber trees.
            }
          }
        }
      } catch {
        // Skip unreadable host objects without aborting the remaining traversal.
      }
    }
    results.sort((a, b) => bundleRichnessScore(b, targetShortcode) - bundleRichnessScore(a, targetShortcode));
    return results;
  }

  function cacheBundlesFromPayload(root) {
    if (!isSafeDataObject(root)) return;
    const seen = new WeakSet();
    const stack = [{ value: root, depth: 0 }];
    let visited = 0;
    while (stack.length && visited < 12000) {
      const { value, depth } = stack.pop();
      if (!isSafeDataObject(value) || depth > 24 || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      try {
        if (isInstagramMediaNode(value)) {
          cacheMediaBundle(buildMediaBundleFromNode(value));
        }
        const children = Array.isArray(value) ? value : Object.values(value);
        for (let i = children.length - 1; i >= 0; i -= 1) {
          if (isSafeDataObject(children[i])) stack.push({ value: children[i], depth: depth + 1 });
        }
      } catch {
        // Ignore unreadable host objects.
      }
    }
  }

  function extractFromReactFiber(media, targetShortcode) {
    let fallbackBundle = null;
    for (let el = media, steps = 0; el && steps < 22; el = el.parentElement, steps += 1) {
      let keys = [];
      try {
        keys = Object.keys(el).filter(k => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"));
      } catch {
        continue;
      }
      for (const key of keys) {
        let fiber = el[key];
        for (let hop = 0; fiber && hop < 36; hop += 1) {
          const candidates = [fiber.memoizedProps, fiber.pendingProps];
          let hookState = fiber.memoizedState;
          for (let h = 0; hookState && h < 20; h += 1) {
            try {
              if (isSafeDataObject(hookState.memoizedState)) {
                candidates.push(hookState.memoizedState);
              }
              hookState = hookState.next;
            } catch {
              break;
            }
          }
          candidates.push(fiber);
          for (const candidate of candidates) {
            if (!isSafeDataObject(candidate)) continue;
            try {
              const found = scanObjectForBundles(candidate, targetShortcode, 3000, 18);
              for (const bundle of found) {
                if (targetShortcode && bundle.shortcode === targetShortcode) return bundle;
                if (!fallbackBundle || bundleRichnessScore(bundle, targetShortcode) > bundleRichnessScore(fallbackBundle, targetShortcode)) {
                  fallbackBundle = bundle;
                }
              }
            } catch {
              // Keep climbing Fiber ancestors even if one candidate throws on host inspection.
            }
          }
          fiber = fiber.return;
        }
      }
    }
    return fallbackBundle;
  }

  function extractBundlesFromJsonText(text, targetShortcode, cacheOnly = false) {
    if (typeof text !== "string" || !text.trim() || text.length > 4 * 1024 * 1024) return null;
    const cleaned = text.replace(/^\s*for\s*\(;;\);/, "");
    for (const line of cleaned.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) continue;
      try {
        const parsed = JSON.parse(trimmed);
        cacheBundlesFromPayload(parsed);
        if (cacheOnly) continue;
        if (targetShortcode && state.mediaCache.has(targetShortcode)) {
          return state.mediaCache.get(targetShortcode);
        }
        const bundles = scanObjectForBundles(parsed, targetShortcode, 6000, 26);
        if (bundles.length) return bundles[0];
      } catch {
        // Ignore non-JSON lines.
      }
    }
    return null;
  }

  function extractFromPageScripts(targetShortcode) {
    if (targetShortcode && state.mediaCache.has(targetShortcode)) {
      return state.mediaCache.get(targetShortcode);
    }
    const scripts = document.querySelectorAll("script[type='application/json']");
    for (const script of scripts) {
      const bundle = extractBundlesFromJsonText(script.textContent || "", targetShortcode);
      if (bundle && (!targetShortcode || bundle.shortcode === targetShortcode)) return bundle;
    }
    return targetShortcode && state.mediaCache.has(targetShortcode)
      ? state.mediaCache.get(targetShortcode)
      : null;
  }

  function videoUrlsFromText(text) {
    const normalized = normalizeMediaUrl(text);
    const prioritized = [];
    const versionMatches = normalized.matchAll(/"video_versions"\s*:\s*\[([^\]]+)\]/g);
    for (const match of versionMatches) {
      const urls = match[1].match(/https?:\/\/[^"'\s\\]+/g) || [];
      prioritized.push(...urls);
    }
    const matches = normalized.match(/https?:\/\/[^"'\s]+/g) || [];
    return Array.from(new Set([...prioritized, ...matches.reverse()].filter(url => /^https?:\/\//i.test(url)
      && !isLikelyMediaSegment(url)
      && (/\.mp4(?:[?#]|$)/i.test(url) || /\/v\/t50\./i.test(url)))));
  }

  function encodeUtf8Bytes(text) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text);
    const utf8 = unescape(encodeURIComponent(String(text || "")));
    const bytes = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i += 1) bytes[i] = utf8.charCodeAt(i);
    return bytes;
  }

  function resourceEntries() {
    return typeof performance?.getEntriesByType === "function"
      ? performance.getEntriesByType("resource")
      : [];
  }

  function mediaUrlsFromResources(media) {
    const isVideo = media instanceof HTMLVideoElement;
    const rawEntries = resourceEntries()
      .filter(entry => /^https?:\/\//i.test(entry.name || ""))
      .filter(entry => {
        const url = entry.name || "";
        const initiatorType = String(entry.initiatorType || "").toLowerCase();
        if (isVideo && initiatorType === "video") return true;
        return isVideo
          ? /\.mp4(?:[?#]|$)/i.test(url) || /\/v\/t50\./i.test(url)
          : /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(url);
      })
      .map(entry => entry.name)
      .reverse();

    if (!isVideo) return Array.from(new Set(rawEntries));
    const complete = rawEntries.filter(url => !isLikelyMediaSegment(url));
    const stripped = rawEntries
      .filter(isLikelyMediaSegment)
      .map(stripMediaRangeParams)
      .filter(url => url && !isLikelyMediaSegment(url));
    return Array.from(new Set([...complete, ...stripped]));
  }

  async function fetchInstaloaderPost(inputOrShortcode) {
    if (typeof fetch !== "function") return null;
    const raw = String(inputOrShortcode || "").trim();
    if (!raw) return null;
    const shortcode = shortcodeFromPostUrl(raw) || (/^[A-Za-z0-9_-]{5,32}$/.test(raw) ? raw : "");
    if (!shortcode) return null;

    if (state.mediaCache.has(shortcode)) {
      return state.mediaCache.get(shortcode);
    }

    const headers = instagramApiHeaders();
    const mediaId = shortcodeToMediaId(shortcode);
    if (mediaId) {
      if (state.mediaCache.has(`pk:${mediaId}`)) {
        return state.mediaCache.get(`pk:${mediaId}`);
      }
      try {
        const infoRes = await fetch(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, {
          credentials: "include",
          headers
        });
        if (infoRes.ok) {
          const infoText = await infoRes.text();
          const bundle = extractBundlesFromJsonText(infoText, shortcode);
          if (bundle) return bundle;
        }
      } catch {
        // Fall through to GraphQL / HTML stages.
      }
    }

    try {
      const a1Res = await fetch(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
        credentials: "include",
        headers
      });
      if (a1Res.ok) {
        const bundle = extractBundlesFromJsonText(await a1Res.text(), shortcode);
        if (bundle) return bundle;
      }
    } catch {
      // Continue to GraphQL stage.
    }

    try {
      const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
      const gqlRes = await fetch(gqlUrl, { credentials: "include", headers });
      if (gqlRes.ok) {
        const bundle = extractBundlesFromJsonText(await gqlRes.text(), shortcode);
        if (bundle) return bundle;
      }
    } catch {
      // Continue to embed/HTML stage.
    }

    try {
      const csrf = getCookieValue("csrftoken");
      const form = new URLSearchParams({
        variables: JSON.stringify({ shortcode }),
        doc_id: "8845758582119845"
      });
      const postHeaders = {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded"
      };
      if (csrf) postHeaders["X-CSRFToken"] = csrf;
      const apiGqlRes = await fetch("https://www.instagram.com/api/graphql", {
        method: "POST",
        credentials: "include",
        headers: postHeaders,
        body: form.toString()
      });
      if (apiGqlRes.ok) {
        const bundle = extractBundlesFromJsonText(await apiGqlRes.text(), shortcode);
        if (bundle) return bundle;
      }
    } catch {
      // Continue to embed/HTML stage.
    }

    const htmlUrls = [
      `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
      /^https?:\/\//i.test(raw) ? raw : `https://www.instagram.com/p/${shortcode}/`
    ];
    for (const pageUrl of htmlUrls) {
      try {
        const response = await fetch(pageUrl, { credentials: "include" });
        if (!response.ok) continue;
        const html = await response.text();
        const documentFragment = new DOMParser().parseFromString(html, "text/html");
        for (const script of documentFragment.querySelectorAll("script[type='application/json'], script")) {
          const text = script.textContent || "";
          if (!text.includes("video_")
            && !text.includes("display_url")
            && !text.includes("image_versions2")
            && !text.includes("carousel_media")
            && !text.includes("edge_sidecar_to_children")) continue;
          const bundle = extractBundlesFromJsonText(text, shortcode);
          if (bundle) return bundle;
        }
        const metadataVideo = Array.from(documentFragment.querySelectorAll(
          "meta[property='og:video'], meta[property='og:video:secure_url'], meta[property='og:video:url']"
        )).map(meta => normalizeMediaUrl(meta.content))
          .concat(videoUrlsFromText(html))
          .find(url => /^https?:\/\//i.test(url)
            && !isLikelyMediaSegment(url)
            && (/\.mp4(?:[?#]|$)/i.test(url) || /\/v\/t50\./i.test(url)));
        const metadataImage = documentFragment.querySelector("meta[property='og:image'], img.EmbeddedMediaImage")?.getAttribute("content")
          || documentFragment.querySelector("img.EmbeddedMediaImage")?.getAttribute("src")
          || "";
        const caption = documentFragment.querySelector(".Caption, meta[property='og:description'], meta[name='description']")?.textContent?.trim()
          || documentFragment.querySelector("meta[property='og:description'], meta[name='description']")?.getAttribute("content")?.trim()
          || "";
        const items = [];
        if (metadataVideo) items.push({ kind: "video", urls: [metadataVideo] });
        else if (metadataImage) items.push({ kind: "image", urls: [normalizeMediaUrl(metadataImage)] });
        if (items.length) {
          return { items, caption, username: "", shortcode, pk: mediaId, takenAt: "" };
        }
      } catch {
        // Try next URL.
      }
    }
    return null;
  }

  async function fetchPostBundle(postUrl) {
    return fetchInstaloaderPost(postUrl);
  }

  async function mediaUrlFromPost(postUrl) {
    const bundle = await fetchPostBundle(postUrl);
    return bundle?.items?.find(item => item.kind === "video")?.urls?.[0]
      || bundle?.items?.[0]?.urls?.[0]
      || "";
  }

  async function mediaUrlsFromNetworkData(media) {
    if (!(media instanceof HTMLVideoElement)) return [];
    const networkUrls = Array.from(new Set(resourceEntries()
      .map(entry => entry.name)
      .filter(url => /^https?:\/\//i.test(url)
        && url.startsWith(window.location.origin)
        && /\/(?:api\/v1\/|api\/graphql|graphql|ajax|reels?|feed|web)/i.test(url))
      .reverse()
      .slice(0, 8)));
    const responses = await Promise.all(networkUrls.map(async url => {
      try {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        return response.ok ? response.text() : "";
      } catch (error) {
        return "";
      }
    }));
    return Array.from(new Set(responses.flatMap(videoUrlsFromText)));
  }

  function extractCaptionFromDom(media) {
    const container = media.closest("article, [role=dialog], main, section") || document;
    let username = "";
    const links = Array.from(container.querySelectorAll("a[href^='/']"));
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (match && !/^(?:explore|reels?|direct|accounts|stories|p|tv)$/i.test(match[1])) {
        username = match[1];
        break;
      }
    }

    let caption = "";
    const captionCandidates = [
      container.querySelector("[data-ignow-caption]"),
      ...Array.from(container.querySelectorAll("[data-testid='post-comment-root'] span[dir='auto'], h1, span[dir='auto']"))
    ].filter(node => node && !node.closest("[role='presentation'], header, nav, button, [role='button']"));
    for (const node of captionCandidates) {
      const text = node.textContent?.trim() || "";
      if (text && text !== username && text.length > 1) {
        caption = text;
        break;
      }
    }
    if (!caption) {
      const alt = container.querySelector("img[alt]")?.getAttribute("alt")?.trim() || "";
      if (alt && !/^(?:Photo|Image|Video) by /i.test(alt)) {
        caption = alt;
      } else {
        caption = document.querySelector("meta[property='og:description']")?.content?.trim() || "";
      }
    }
    return { username: sanitizeSegment(username), caption };
  }

  function urlBasenameToken(url) {
    try {
      return new URL(String(url || "")).pathname.split("/").pop()?.toLowerCase() || "";
    } catch {
      return "";
    }
  }

  function hasCarouselInDom(media) {
    const container = media?.closest?.("article, [role=dialog], [data-ignow-media-stage]") || null;
    if (!container) return false;
    if (container.querySelector("[aria-label*='Next' i], [aria-label*='Go Back' i]")) return true;
    const ul = container.querySelector("ul");
    return Boolean(ul && ul.querySelectorAll("li").length > 1);
  }

  function resolveSlideMatchForMedia(media, bundle) {
    const items = bundle?.items || [];
    if (!items.length) return { index: -1, item: null };
    if (items.length === 1) return { index: 0, item: items[0] };

    const directUrl = sourceUrl(media);
    const directToken = urlBasenameToken(directUrl);
    if (directUrl && !directUrl.startsWith("blob:")) {
      const byUrl = items.findIndex(item => item.urls.some(u => (
        u === directUrl || (directToken && urlBasenameToken(u) === directToken)
      )));
      if (byUrl >= 0) return { index: byUrl, item: items[byUrl] };
    }

    const postHref = postUrlForMedia(media) || window.location.href;
    const imgIdxMatch = String(postHref || "").match(/[?&]img_index=(\d+)/i);
    if (imgIdxMatch) {
      const parsed = Number(imgIdxMatch[1]) - 1;
      if (parsed >= 0 && parsed < items.length) return { index: parsed, item: items[parsed] };
    }

    const ul = media?.closest?.("ul");
    const li = media?.closest?.("li");
    if (ul && li) {
      const slideItems = Array.from(ul.children).filter(child => child.querySelector("img, video"));
      if (slideItems.length === items.length) {
        const idx = slideItems.indexOf(li);
        if (idx >= 0) return { index: idx, item: items[idx] };
      }
    }

    const isVideo = media instanceof HTMLVideoElement;
    const stage = media?.closest?.("[role='presentation'], article, [role='dialog']") || null;
    if (stage) {
      const containerRect = stage.getBoundingClientRect();
      const stageMedia = Array.from(stage.querySelectorAll(isVideo ? "video" : "img"))
        .filter(el => (el instanceof HTMLVideoElement ? isPostVideo(el) : isPostImage(el)));
      const visibleIdx = stageMedia.findIndex(el => el === media);
      if (visibleIdx >= 0 && stageMedia.length === items.filter(i => i.kind === (isVideo ? "video" : "image")).length) {
        let count = -1;
        for (let i = 0; i < items.length; i += 1) {
          if (items[i].kind === (isVideo ? "video" : "image")) {
            count += 1;
            if (count === visibleIdx) return { index: i, item: items[i] };
          }
        }
      }
      if (containerRect.width > 0) {
        const liParent = media?.closest?.("li");
        const liRect = liParent?.getBoundingClientRect();
        if (liParent && ul && liRect && liRect.width > 0) {
          const idxGuess = Math.round((liRect.left - ul.getBoundingClientRect().left) / Math.max(1, containerRect.width));
          if (idxGuess >= 0 && idxGuess < items.length && items[idxGuess].kind === (isVideo ? "video" : "image")) {
            return { index: idxGuess, item: items[idxGuess] };
          }
        }
      }
    }
    return { index: -1, item: null };
  }

  async function extractPostBundle(media) {
    const rawPostUrl = postUrlForMedia(media) || normalizeInstagramPostUrl(window.location.href) || "";
    let shortcode = shortcodeFromPostUrl(rawPostUrl);
    const fiberBundle = extractFromReactFiber(media, shortcode);
    if (!shortcode && fiberBundle?.shortcode) shortcode = fiberBundle.shortcode;
    const scriptBundle = (!fiberBundle || (shortcode && fiberBundle.shortcode !== shortcode))
      ? extractFromPageScripts(shortcode)
      : null;
    if (!shortcode && scriptBundle?.shortcode) shortcode = scriptBundle.shortcode;
    let primary = (fiberBundle && (!shortcode || fiberBundle.shortcode === shortcode))
      ? fiberBundle
      : (scriptBundle || fiberBundle || null);
    const resolvedPostUrl = rawPostUrl || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : "");
    if ((!primary || (hasCarouselInDom(media) && (primary.items?.length || 0) <= 1)) && (resolvedPostUrl || shortcode)) {
      const apiBundle = await fetchInstaloaderPost(resolvedPostUrl || shortcode);
      if (apiBundle && (!primary || bundleRichnessScore(apiBundle, shortcode) > bundleRichnessScore(primary, shortcode))) {
        primary = apiBundle;
      }
    }

    const domMeta = extractCaptionFromDom(media);
    const kind = media instanceof HTMLVideoElement ? "video" : "image";
    const items = primary?.items?.length
      ? primary.items
      : [{ kind, urls: await mediaUrlCandidates(media) }];

    return {
      postUrl: resolvedPostUrl,
      shortcode: primary?.shortcode || shortcode,
      pk: primary?.pk || shortcodeToMediaId(primary?.shortcode || shortcode),
      username: primary?.username || domMeta.username,
      takenAt: primary?.takenAt || "",
      caption: primary?.caption || domMeta.caption,
      items
    };
  }

  async function resolvePlayableSources(media) {
    const directUrl = sourceUrl(media);
    const candidates = [];
    let pairedAudioUrl = "";
    let metaUsername = "";
    let metaTakenAt = "";
    let matchedSlideIndex = -1;
    let itemCount = 0;
    const addCandidate = url => {
      if (!url || candidates.includes(url)) return;
      candidates.push(url);
    };
    const isVideo = media instanceof HTMLVideoElement;
    const postUrl = postUrlForMedia(media);
    let shortcode = shortcodeFromPostUrl(postUrl);
    let bundle = extractFromReactFiber(media, shortcode) || extractFromPageScripts(shortcode);
    const targetForApi = postUrl || shortcode || (bundle?.shortcode ? `https://www.instagram.com/p/${bundle.shortcode}/` : "");
    if ((!bundle || (hasCarouselInDom(media) && (bundle.items?.length || 0) <= 1)) && targetForApi) {
      const apiBundle = await fetchInstaloaderPost(targetForApi);
      if (apiBundle && (!bundle || bundleRichnessScore(apiBundle, shortcode) > bundleRichnessScore(bundle, shortcode))) {
        bundle = apiBundle;
      }
    }
    if (bundle) {
      if (!shortcode && bundle.shortcode) shortcode = bundle.shortcode;
      if (bundle.username) metaUsername = bundle.username;
      if (bundle.takenAt) metaTakenAt = bundle.takenAt;
      itemCount = bundle.items?.length || 0;
      const match = resolveSlideMatchForMedia(media, bundle);
      if (match.item && match.item.kind === (isVideo ? "video" : "image")) {
        matchedSlideIndex = match.index;
        match.item.urls.forEach(addCandidate);
        if (isVideo && match.item.audioUrl) pairedAudioUrl = match.item.audioUrl;
      } else if (itemCount <= 1 || isVideo) {
        for (const item of bundle.items) {
          if ((isVideo && item.kind === "video") || (!isVideo && item.kind === "image")) {
            item.urls.forEach(addCandidate);
            if (isVideo && !pairedAudioUrl && item.audioUrl) pairedAudioUrl = item.audioUrl;
            break;
          }
        }
      }
    }

    if (isVideo) {
      if (!candidates.length) {
        (await mediaUrlsFromNetworkData(media)).forEach(addCandidate);
        if (!candidates.length && targetForApi) addCandidate(await mediaUrlFromPost(targetForApi));
      }
      mediaUrlsFromResources(media).forEach(addCandidate);
      addCandidate(directUrl);
    } else {
      addCandidate(directUrl);
      mediaUrlsFromResources(media).forEach(addCandidate);
      if (!candidates.length && targetForApi) addCandidate(await mediaUrlFromPost(targetForApi));
    }
    if (!metaUsername) {
      metaUsername = extractCaptionFromDom(media).username || "";
    }
    return {
      urls: candidates,
      audioUrl: pairedAudioUrl,
      username: metaUsername,
      takenAt: metaTakenAt,
      shortcode,
      matchedSlideIndex,
      itemCount
    };
  }

  async function mediaUrlCandidates(media) {
    return (await resolvePlayableSources(media)).urls;
  }

  async function resolveMediaUrl(media) {
    return (await mediaUrlCandidates(media))[0] || "";
  }

  function openDefaultBrowser(url) {
    if (!/^https?:\/\//i.test(url || "")) return;
    const invokeFn = getInvoke();
    if (typeof invokeFn === "function") {
      invokeFn("open_external_url", { url }).catch(() => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function showToast(message) {
    state.toast?.remove();
    const toast = document.createElement("div");
    toast.className = "ignow-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    state.toast = toast;
    window.setTimeout(() => {
      if (state.toast === toast) {
        toast.remove();
        state.toast = null;
      }
    }, 5000);
  }
  // Exposed for Rust-side evals (tray menu feedback, watchdog reports).
  window.showToast = showToast;

  async function saveBytesInApp(buffer, kind, subfolder = null, fileStem = null) {
    const invokeFn = getInvoke();
    if (typeof invokeFn !== "function") throw new Error("IG-Now native bridge is unavailable.");
    const bytes = Array.from(new Uint8Array(buffer));
    return invokeFn("save_media_bytes", {
      data: bytes,
      mediaType: kind,
      subfolder: subfolder || null,
      fileStem: fileStem || null
    });
  }

  async function downloadFromSignedInPage(url, kind, subfolder = null, fileStem = null) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (/text\/html|application\/json/i.test(contentType)) {
      throw new Error(`Instagram returned ${contentType} instead of media.`);
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error("Instagram returned an empty media response.");
    return saveBytesInApp(buffer, kind, subfolder, fileStem);
  }

  async function saveMediaSources(sources, kind, referer, subfolder = null, fileStem = null, audioUrl = null) {
    const invokeFn = getInvoke();
    if (typeof invokeFn !== "function") {
      throw new Error("IG-Now native bridge is unavailable.");
    }
    const cookies = String(document.cookie || "");
    const userAgent = String(navigator.userAgent || "");
    for (const source of sources) {
      if (/^https?:\/\//i.test(source)) {
        try {
          return await invokeFn("download_media", {
            url: source,
            mediaType: kind,
            referer,
            subfolder: subfolder || null,
            fileStem: fileStem || null,
            cookies: cookies || null,
            userAgent: userAgent || null,
            audioUrl: (kind === "video" && audioUrl) ? audioUrl : null
          });
        } catch (error) {
          console.warn("IG-Now native URL media download failed; trying the next source:", error);
        }
      }
      try {
        return await downloadFromSignedInPage(source, kind, subfolder, fileStem);
      } catch (error) {
        console.warn("IG-Now signed-in media save failed; trying the next source:", error);
      }
    }
    return "";
  }

  async function saveMedia(media, options = {}) {
    const kind = options.kind || (media instanceof HTMLVideoElement ? "video" : "image");
    const postUrl = postUrlForMedia(media);
    const referer = postUrl || "https://www.instagram.com/";
    if (!options.quiet) {
      showToast(kind === "video" ? "Downloading video..." : "Saving image...");
    }

    let sources = Array.isArray(options.urls) && options.urls.length ? options.urls : null;
    let audioUrl = options.audioUrl || null;
    let matchedSlideIndex = -1;
    let itemCount = 0;
    let meta = {
      username: options.username || "",
      takenAt: options.takenAt || "",
      shortcode: options.shortcode || shortcodeFromPostUrl(postUrl)
    };
    if (!sources) {
      const resolved = await resolvePlayableSources(media);
      sources = resolved.urls;
      if (!audioUrl) audioUrl = resolved.audioUrl || null;
      matchedSlideIndex = Number.isInteger(resolved.matchedSlideIndex) ? resolved.matchedSlideIndex : -1;
      itemCount = Number(resolved.itemCount) || 0;
      meta = {
        username: meta.username || resolved.username || "",
        takenAt: meta.takenAt || resolved.takenAt || "",
        shortcode: meta.shortcode || resolved.shortcode || ""
      };
    } else if (!meta.username) {
      const domMeta = extractCaptionFromDom(media);
      meta.username = domMeta.username || "";
    }
    const resolvedPostUrl = postUrl
      || (meta.shortcode ? `https://www.instagram.com/p/${meta.shortcode}/` : "")
      || window.location.href;
    if (!sources.length) {
      if (!options.quiet) {
        showToast("Opening IG-Now Downloader...");
        openNativeDownloader(resolvedPostUrl, media);
      }
      return "";
    }

    let fileStem = options.fileStem || buildSourceFileStem(meta.username, meta.takenAt, meta.shortcode);
    if (!options.fileStem && matchedSlideIndex > 0 && itemCount > 1) {
      const slideNum = itemCount >= 10
        ? String(matchedSlideIndex + 1).padStart(2, "0")
        : String(matchedSlideIndex + 1);
      fileStem = `${fileStem}-slide-${slideNum}`;
    }

    try {
      const savedPath = await saveMediaSources(
        sources,
        kind,
        postUrl || resolvedPostUrl || "https://www.instagram.com/",
        options.subfolder || null,
        fileStem,
        audioUrl
      );
      if (savedPath) {
        if (!options.quiet) showToast(`Saved ${kind} to ${savedPath}`);
        return savedPath;
      }
    } catch (error) {
      console.warn("IG-Now media save failed:", error);
    }

    if (!options.quiet) {
      showToast("Opening IG-Now Downloader...");
      openNativeDownloader(resolvedPostUrl, media);
    }
    return "";
  }

  async function saveResolvedBundle(bundle, onStatus) {
    const invokeFn = getInvoke();
    if (typeof invokeFn !== "function") {
      showToast("IG-Now native download bridge is unavailable.");
      return { savedCount: 0, total: 0, captionPath: "", metadataPath: "", subfolder: "" };
    }
    const items = Array.isArray(bundle?.items) ? bundle.items : [];
    const postStem = buildSourceFileStem(bundle.username, bundle.takenAt, bundle.shortcode);
    const subfolder = postStem;
    const referer = bundle.postUrl || "https://www.instagram.com/";

    let savedCount = 0;
    let completed = 0;
    const savedFiles = new Array(items.length).fill("");
    let nextIndex = 0;
    const workerCount = Math.min(4, Math.max(1, items.length));
    const reportProgress = () => {
      const statusMsg = `Downloading post (${completed}/${items.length})...`;
      if (onStatus) onStatus(statusMsg);
      else showToast(statusMsg);
    };
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const i = nextIndex;
        nextIndex += 1;
        const item = items[i];
        const slideNum = items.length >= 10
          ? String(i + 1).padStart(2, "0")
          : String(i + 1);
        const stem = items.length > 1
          ? `${postStem}-slide-${slideNum}`
          : postStem;
        try {
          const savedPath = await saveMediaSources(item.urls, item.kind, referer, subfolder, stem, item.audioUrl || null);
          if (savedPath) {
            savedCount += 1;
            savedFiles[i] = savedPath;
          }
        } catch (error) {
          console.warn("IG-Now post item save failed:", error);
        }
        completed += 1;
        reportProgress();
      }
    });
    await Promise.all(workers);
    const finalSavedFiles = savedFiles.filter(Boolean);

    const headerLines = [];
    if (bundle.username) headerLines.push(`Author: @${bundle.username}`);
    if (bundle.postUrl) headerLines.push(`URL: ${bundle.postUrl}`);
    if (bundle.takenAt) headerLines.push(`Date: ${bundle.takenAt}`);
    if (headerLines.length) headerLines.push("");
    headerLines.push(bundle.caption || "(No caption text available for this post)");

    let captionPath = "";
    try {
      const encoded = encodeUtf8Bytes(headerLines.join("\n"));
      captionPath = await saveBytesInApp(encoded, "text", subfolder, "caption");
    } catch (error) {
      console.warn("IG-Now caption save failed:", error);
    }

    let metadataPath = "";
    try {
      const metadataPayload = JSON.stringify({
        shortcode: bundle.shortcode || "",
        pk: bundle.pk || "",
        username: bundle.username || "",
        postUrl: bundle.postUrl || "",
        takenAt: bundle.takenAt || "",
        caption: bundle.caption || "",
        mediaCount: items.length
      }, null, 2);
      metadataPath = await saveBytesInApp(encodeUtf8Bytes(metadataPayload), "json", subfolder, "metadata");
    } catch (error) {
      console.warn("IG-Now metadata save failed:", error);
    }

    const doneMsg = (savedCount > 0 || captionPath)
      ? `Saved post (${savedCount}/${items.length} media + caption.txt) to Downloads/IG-Now/${subfolder}`
      : "Could not download media or caption for this post.";
    if (onStatus) onStatus(doneMsg);
    showToast(doneMsg);
    return { savedCount, total: items.length, savedFiles: finalSavedFiles, captionPath, metadataPath, subfolder };
  }

  async function savePostBundle(media) {
    showToast("Preparing post download...");
    const bundle = await extractPostBundle(media);
    return saveResolvedBundle(bundle);
  }

  async function downloadPostByUrl(postUrlOrShortcode, mode = "bundle", onStatus) {
    const input = String(postUrlOrShortcode || "").trim();
    if (!input) {
      const msg = "Paste an Instagram post or Reel URL first.";
      if (onStatus) onStatus(msg);
      showToast(msg);
      return null;
    }
    if (onStatus) onStatus("Resolving post metadata via IG-Now Instaloader engine...");
    let bundle = await fetchInstaloaderPost(input);
    if (!bundle) {
      const activeMedia = pickActiveFeedMedia();
      if (activeMedia) {
        const extracted = await extractPostBundle(activeMedia);
        if (extracted.items?.length) bundle = extracted;
      }
    }
    if (!bundle || !bundle.items?.length) {
      const msg = "Could not resolve media for that URL. Ensure you are signed in and the link is valid.";
      if (onStatus) onStatus(msg);
      showToast(msg);
      return null;
    }

    if (mode === "single") {
      const first = bundle.items[0];
      const referer = bundle.postUrl || (input.startsWith("http") ? input : "https://www.instagram.com/");
      const stem = buildSourceFileStem(bundle.username, bundle.takenAt, bundle.shortcode);
      const savedPath = await saveMediaSources(first.urls, first.kind, referer, null, stem, first.audioUrl || null);
      const msg = savedPath
        ? `Saved ${first.kind} to ${savedPath}`
        : `Could not download ${first.kind} from this URL.`;
      if (onStatus) onStatus(msg);
      showToast(msg);
      return { savedPath, bundle };
    }

    return saveResolvedBundle({
      ...bundle,
      postUrl: bundle.postUrl || (input.startsWith("http") ? input : `https://www.instagram.com/p/${bundle.shortcode}/`)
    }, onStatus);
  }

  function pickActiveFeedMedia() {
    if (state.activeVideo && state.activeVideo.isConnected && isVisible(state.activeVideo)) {
      const vr = state.activeVideo.getBoundingClientRect();
      if (vr.bottom > 40 && vr.top < window.innerHeight - 40) return state.activeVideo;
    }
    const candidates = Array.from(document.querySelectorAll("video, img")).filter(el => (
      el instanceof HTMLVideoElement ? isPostVideo(el) : isPostImage(el)
    ));
    if (!candidates.length) return null;
    const viewMid = window.innerHeight / 2;
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const visibleH = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      const dist = Math.abs((r.top + r.height / 2) - viewMid);
      const score = (visibleH > 40 ? 100000 : 0) + visibleH - dist;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function rawNodePayloadForTarget(initialUrl, targetMedia) {
    const code = shortcodeFromPostUrl(initialUrl);
    if (code && state.rawNodeCache.has(code)) {
      const cached = state.rawNodeCache.get(code);
      return typeof cached === "string" ? cached : (cached?.rawNodeJson || "");
    }
    if (targetMedia) {
      const bundle = extractFromReactFiber(targetMedia, code);
      if (bundle?.rawNodeJson) return bundle.rawNodeJson;
    }
    return "";
  }

  async function openNativeDownloader(initialUrl = "", targetMedia = null) {
    closeMenu();
    let detectedUrl = normalizeInstagramPostUrl(initialUrl)
      || (targetMedia ? postUrlForMedia(targetMedia) : "")
      || normalizeInstagramPostUrl(window.location.href)
      || "";
    const codeHint = shortcodeFromPostUrl(detectedUrl);
    const matchedBundle = targetMedia
      ? (extractFromReactFiber(targetMedia, codeHint) || (codeHint ? state.mediaCache.get(codeHint) : null))
      : (codeHint ? state.mediaCache.get(codeHint) : null);
    const payloadJson = rawNodePayloadForTarget(detectedUrl, targetMedia) || matchedBundle?.rawNodeJson || "";
    if (!shortcodeFromPostUrl(detectedUrl) && payloadJson) {
      try {
        const parsed = JSON.parse(payloadJson);
        const recoveredCode = sanitizeSegment(
          parsed?.code
          || parsed?.shortcode
          || mediaIdToShortcode(parsed?.pk || parsed?.id || "")
          || ""
        );
        if (recoveredCode) detectedUrl = `https://www.instagram.com/p/${recoveredCode}/`;
      } catch {
        // Leave detectedUrl empty if seed payload is non-JSON.
      }
    }
    const slideMatch = targetMedia && matchedBundle
      ? resolveSlideMatchForMedia(targetMedia, matchedBundle)
      : { index: -1, item: null };
    const rawHintSrc = targetMedia ? sourceUrl(targetMedia) : "";
    const slideHint = rawHintSrc && !rawHintSrc.startsWith("blob:") ? rawHintSrc : "";
    const slideIndex = slideMatch.index >= 0 ? slideMatch.index : null;
    const invokeFn = getInvoke();
    if (typeof invokeFn !== "function") {
      showToast("IG-Now Downloader native bridge is unavailable.");
      return false;
    }
    try {
      await invokeFn("open_downloader_window", {
        url: detectedUrl || null,
        payloadJson: payloadJson || null,
        slideIndex,
        slideHint: slideHint || null
      });
      return true;
    } catch (error) {
      console.warn("IG-Now could not open Downloader window:", error);
      showToast("Could not open IG-Now Downloader window.");
      return false;
    }
  }

  async function probePostForDownloader(requestId, targetUrl) {
    const invokeFn = getInvoke();
    if (!requestId || typeof invokeFn !== "function") return false;
    let payloadJson = "";
    const code = shortcodeFromPostUrl(targetUrl);
    if (code && state.rawNodeCache.has(code)) {
      const cached = state.rawNodeCache.get(code);
      payloadJson = typeof cached === "string" ? cached : (cached?.rawNodeJson || "");
    }
    if (!payloadJson && typeof fetch === "function") {
      const headers = instagramApiHeaders();
      const mediaId = code ? shortcodeToMediaId(code) : "";
      if (mediaId) {
        try {
          const infoRes = await fetch(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, {
            credentials: "include",
            headers
          });
          if (infoRes.ok) {
            const infoText = await infoRes.text();
            if (extractBundlesFromJsonText(infoText, code)) {
              payloadJson = infoText;
            }
          }
        } catch {
          // Try next probe source.
        }
      }
      if (!payloadJson && code) {
        try {
          const csrf = getCookieValue("csrftoken");
          const form = new URLSearchParams({
            variables: JSON.stringify({ shortcode: code }),
            doc_id: "8845758582119845"
          });
          const postHeaders = { ...headers, "Content-Type": "application/x-www-form-urlencoded" };
          if (csrf) postHeaders["X-CSRFToken"] = csrf;
          const gqlRes = await fetch("https://www.instagram.com/api/graphql", {
            method: "POST",
            credentials: "include",
            headers: postHeaders,
            body: form.toString()
          });
          if (gqlRes.ok) payloadJson = await gqlRes.text();
        } catch {
          // Final fallback handled in submit call.
        }
      }
    }
    try {
      await invokeFn("submit_downloader_probe", {
        requestId,
        payloadJson: payloadJson || ""
      });
      return true;
    } catch {
      return false;
    }
  }

  async function copyTextReliable(text) {
    const value = String(text || "");
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fall through to execCommand fallback when WebView transient activation expired.
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = Boolean(document.execCommand?.("copy"));
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function copyCaptionText(media) {
    const bundle = await extractPostBundle(media);
    if (!bundle.caption) {
      showToast("No caption text found on this post.");
      return false;
    }
    if (await copyTextReliable(bundle.caption)) {
      showToast("Copied post caption to clipboard.");
      return true;
    }
    showToast("Could not access clipboard for caption text.");
    return false;
  }

  async function openMediaInBrowser(media) {
    const isVideo = media instanceof HTMLVideoElement;
    const postUrl = postUrlForMedia(media);
    if (postUrl) {
      openDefaultBrowser(postUrl);
      return;
    }
    const fiberBundle = extractFromReactFiber(media, "") || extractFromPageScripts("");
    if (fiberBundle?.shortcode) {
      openDefaultBrowser(`https://www.instagram.com/p/${fiberBundle.shortcode}/`);
      return;
    }
    const currentReelUrl = normalizeInstagramPostUrl(window.location.href);
    if (currentReelUrl) {
      openDefaultBrowser(currentReelUrl);
      return;
    }
    const candidates = await mediaUrlCandidates(media);
    const httpMediaUrl = candidates.find(u => /^https?:\/\//i.test(u || ""));
    if (httpMediaUrl) {
      openDefaultBrowser(httpMediaUrl);
      return;
    }
    showToast(`IG-Now could not resolve the exact ${isVideo ? "video " : ""}post link.`);
  }

  function closeMenu() {
    state.menu?.remove();
    state.menu = null;
  }

  function showMenu(items, x, y) {
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "ignow-media-menu";
    menu.setAttribute("role", "menu");
    items.forEach(({ label, action, divider }) => {
      if (divider) {
        const sep = document.createElement("div");
        sep.className = "ignow-media-menu__divider";
        menu.appendChild(sep);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = label;
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        try {
          await action();
        } catch (err) {
          console.warn("IG-Now context menu action failed:", err);
          showToast(err?.message || "IG-Now menu action failed.");
        }
      });
      menu.appendChild(button);
    });
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
    document.body.appendChild(menu);
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    state.menu = menu;
  }

  function updateViewerTransform() {
    if (!state.viewer) return;
    const { image, zoomInput, zoomLabel, scale, offsetX, offsetY } = state.viewer;
    image.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${scale})`;
    zoomInput.value = String(Math.round(scale * 100));
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  function setViewerScale(scale) {
    if (!state.viewer) return;
    state.viewer.scale = Math.max(0.1, Math.min(4, scale));
    updateViewerTransform();
  }

  function fitViewer() {
    if (!state.viewer || !state.viewer.image.naturalWidth || !state.viewer.image.naturalHeight) return;
    const availableWidth = Math.max(1, state.viewer.viewport.clientWidth - 32);
    const availableHeight = Math.max(1, state.viewer.viewport.clientHeight - 32);
    const fitScale = Math.min(
      4,
      availableWidth / state.viewer.image.naturalWidth,
      availableHeight / state.viewer.image.naturalHeight
    );
    state.viewer.fitScale = fitScale;
    state.viewer.scale = fitScale;
    state.viewer.offsetX = 0;
    state.viewer.offsetY = 0;
    updateViewerTransform();
  }

  function closeViewer() {
    state.viewer?.overlay.remove();
    state.viewer = null;
  }

  window.addEventListener("resize", () => {
    if (state.viewer && Math.abs(state.viewer.scale - state.viewer.fitScale) < 0.02) fitViewer();
    installSidebarBackButton(true);
  });

  function showViewer(image) {
    closeMenu();
    const overlay = document.createElement("div");
    overlay.className = "ignow-media-viewer";
    const panel = document.createElement("section");
    panel.className = "ignow-media-viewer__panel";
    const toolbar = document.createElement("div");
    toolbar.className = "ignow-media-viewer__toolbar";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", () => saveMedia(image));

    const savePostButton = document.createElement("button");
    savePostButton.type = "button";
    savePostButton.textContent = "Download Post";
    savePostButton.addEventListener("click", () => savePostBundle(image));

    const zoomOut = document.createElement("button");
    zoomOut.type = "button";
    zoomOut.textContent = "-";
    zoomOut.setAttribute("aria-label", "Zoom out");
    zoomOut.addEventListener("click", () => setViewerScale((state.viewer?.scale || 1) - 0.1));

    const zoomInput = document.createElement("input");
    zoomInput.className = "ignow-media-viewer__zoom";
    zoomInput.type = "range";
    zoomInput.min = "10";
    zoomInput.max = "400";
    zoomInput.value = "100";
    zoomInput.setAttribute("aria-label", "Image zoom");
    zoomInput.addEventListener("input", () => setViewerScale(Number(zoomInput.value) / 100));

    const zoomLabel = document.createElement("span");
    zoomLabel.className = "ignow-media-viewer__zoom-label";
    zoomLabel.textContent = "100%";

    const zoomIn = document.createElement("button");
    zoomIn.type = "button";
    zoomIn.textContent = "+";
    zoomIn.setAttribute("aria-label", "Zoom in");
    zoomIn.addEventListener("click", () => setViewerScale((state.viewer?.scale || 1) + 0.1));

    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Fit";
    reset.addEventListener("click", fitViewer);

    const close = document.createElement("button");
    close.className = "ignow-media-viewer__close";
    close.type = "button";
    close.textContent = "\u00D7";
    close.setAttribute("aria-label", "Close image viewer");
    close.addEventListener("click", closeViewer);

    toolbar.append(saveButton, savePostButton, zoomOut, zoomInput, zoomLabel, zoomIn, reset, close);

    const viewport = document.createElement("div");
    viewport.className = "ignow-media-viewer__viewport";
    const enlarged = document.createElement("img");
    enlarged.className = "ignow-media-viewer__image";
    enlarged.src = sourceUrl(image);
    enlarged.alt = image.alt || "Instagram image";
    enlarged.draggable = false;
    viewport.appendChild(enlarged);
    panel.append(toolbar, viewport);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    state.viewer = {
      overlay,
      viewport,
      image: enlarged,
      zoomInput,
      zoomLabel,
      scale: 1,
      fitScale: 1,
      offsetX: 0,
      offsetY: 0
    };
    updateViewerTransform();
    enlarged.addEventListener("load", fitViewer, { once: true });
    if (enlarged.complete) fitViewer();

    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeViewer();
    });
    viewport.addEventListener("wheel", event => {
      event.preventDefault();
      setViewerScale((state.viewer?.scale || 1) + (event.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });

    let dragging = false;
    let startX = 0;
    let startY = 0;
    viewport.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !state.viewer) return;
      dragging = true;
      startX = event.clientX - state.viewer.offsetX;
      startY = event.clientY - state.viewer.offsetY;
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener("pointermove", event => {
      if (!dragging || !state.viewer) return;
      state.viewer.offsetX = event.clientX - startX;
      state.viewer.offsetY = event.clientY - startY;
      updateViewerTransform();
    });
    viewport.addEventListener("pointerup", event => {
      dragging = false;
      viewport.releasePointerCapture?.(event.pointerId);
    });
  }

  function isMoreControl(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest(".ignow-sidebar-back, .ignow-sidebar-forward, .ignow-sidebar-downloader, .ignow-video-controls")) return false;
    const aria = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`.trim();
    if (/^(?:more|settings|options)$/i.test(aria)) return true;
    const svgAria = element.querySelector("svg[aria-label]")?.getAttribute("aria-label") || "";
    const svgTitle = element.querySelector("svg title")?.textContent?.trim() || "";
    if (/^(?:more|settings|options)$/i.test(svgAria.trim()) || /^(?:more|settings|options)$/i.test(svgTitle)) return true;

    const leafTexts = Array.from(element.querySelectorAll("span, div"))
      .filter(node => !node.closest("svg") && node.children.length === 0)
      .map(node => node.textContent?.trim() || "")
      .filter(Boolean);
    if (leafTexts.some(t => /^more$/i.test(t))) return true;

    const fullText = Array.from(element.childNodes)
      .filter(n => n.nodeType === 3 || (n instanceof Element && !n.matches("svg")))
      .map(n => n.textContent?.trim() || "")
      .join(" ")
      .trim();
    if (/^more$/i.test(fullText)) return true;

    const svg = element.querySelector("svg");
    if (svg) {
      const lines = svg.querySelectorAll("line, path");
      const rect = element.getBoundingClientRect();
      if (lines.length === 3 && rect.height > 0 && rect.top >= window.innerHeight * 0.5
        && !/meta|threads|create|home|search|explore|reels|messages|notifications/i.test(element.textContent || "")) {
        return true;
      }
    }
    return false;
  }

  function findSidebarContainer() {
    const navs = Array.from(document.querySelectorAll("nav, [role='navigation'], [data-ignow-sidebar]"));
    for (const nav of navs) {
      const rect = nav.getBoundingClientRect();
      if (rect.width >= 44 && rect.width <= 360 && rect.left <= 60 && rect.height >= 240) {
        return nav;
      }
    }
    return navs[0] || null;
  }

  function findSidebarMoreRow() {
    const candidates = Array.from(document.querySelectorAll("a, button, [role='button'], [role='link']"))
      .filter(el => {
        if (el.closest("main, article, [role='dialog'], .ignow-sidebar-back, .ignow-sidebar-forward, .ignow-sidebar-downloader, .ignow-video-controls")) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          return Boolean(el.closest("nav, [role='navigation'], [data-ignow-sidebar]"));
        }
        return rect.left >= 0 && rect.left <= 120 && rect.width <= 320 && rect.top >= window.innerHeight * 0.35;
      });
    const match = candidates.find(isMoreControl);
    if (!match) return null;

    let row = match;
    for (let i = 0; i < 6 && row.parentElement && row.parentElement !== document.body; i += 1) {
      const parent = row.parentElement;
      const interactiveCount = parent.querySelectorAll("a, button, [role='button'], [role='link']").length;
      if (interactiveCount > 1) break;
      const rect = parent.getBoundingClientRect();
      if (rect.height > 76) break;
      row = parent;
    }
    return { control: match, row };
  }

  function recordNavUrl(url, replace = false) {
    const normalized = String(url || window.location.href);
    if (!normalized) return;
    if (replace) {
      state.navHistory[state.navIndex] = normalized;
    } else if (state.navHistory[state.navIndex] !== normalized) {
      state.navHistory = state.navHistory.slice(0, state.navIndex + 1);
      state.navHistory.push(normalized);
      if (state.navHistory.length > 60) state.navHistory.shift();
      state.navIndex = state.navHistory.length - 1;
    }
    updateSidebarBackButtonState();
  }

  function canGoBack() {
    return Boolean(
      state.viewer
      || state.menu
      || state.navIndex > 0
      || window.history.length > 1
    );
  }

  function canGoForward() {
    return state.navIndex < state.navHistory.length - 1;
  }

  function updateSidebarBackButtonState() {
    const backBtn = document.querySelector(".ignow-sidebar-back");
    if (backBtn) backBtn.setAttribute("aria-disabled", canGoBack() ? "false" : "true");
    const fwdBtn = document.querySelector(".ignow-sidebar-forward");
    if (fwdBtn) fwdBtn.setAttribute("aria-disabled", canGoForward() ? "false" : "true");
  }

  function navigateBack() {
    if (state.viewer) {
      closeViewer();
      updateSidebarBackButtonState();
      return true;
    }
    if (state.menu) {
      closeMenu();
      updateSidebarBackButtonState();
      return true;
    }
    if (state.navIndex > 0) {
      state.navIndex -= 1;
      if (window.history.length > 1) {
        window.history.back();
      } else if (state.navHistory[state.navIndex]) {
        window.location.href = state.navHistory[state.navIndex];
      }
      updateSidebarBackButtonState();
      return true;
    }
    if (window.history.length > 1) {
      window.history.back();
      updateSidebarBackButtonState();
      return true;
    }
    if (document.querySelector("[role=dialog]")) {
      return closeInstagramVideo();
    }
    if (window.location.pathname !== "/") {
      window.location.href = "https://www.instagram.com/";
      return true;
    }
    return false;
  }

  function navigateForward(fromButton = false) {
    if (fromButton && !canGoForward()) return false;
    if (canGoForward()) {
      state.navIndex += 1;
    }
    if (window.history.length > 1 || typeof window.history.forward === "function") {
      window.history.forward?.();
    } else if (state.navHistory[state.navIndex]) {
      window.location.href = state.navHistory[state.navIndex];
    }
    updateSidebarBackButtonState();
    return true;
  }

  function createSidebarButtons() {
    let dlBtn = document.querySelector(".ignow-sidebar-downloader");
    if (!dlBtn) {
      dlBtn = document.createElement("button");
      dlBtn.type = "button";
      dlBtn.className = "ignow-sidebar-downloader";
      dlBtn.setAttribute("aria-label", "IG-Now Downloader");
      dlBtn.title = "Open IG-Now Downloader (Paste link)";
      dlBtn.innerHTML =
        '<svg class="ignow-sidebar-downloader__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 3v12"></path><path d="M7 10l5 5 5-5"></path><path d="M5 20h14"></path></svg>' +
        '<span class="ignow-sidebar-downloader__label">Downloader</span>';
      dlBtn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openNativeDownloader("", pickActiveFeedMedia());
      });
    }

    let fwdBtn = document.querySelector(".ignow-sidebar-forward");
    if (!fwdBtn) {
      fwdBtn = document.createElement("button");
      fwdBtn.type = "button";
      fwdBtn.className = "ignow-sidebar-forward";
      fwdBtn.setAttribute("aria-label", "Forward");
      fwdBtn.title = "Forward (Alt+Right)";
      fwdBtn.innerHTML =
        '<svg class="ignow-sidebar-forward__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>' +
        '<span class="ignow-sidebar-forward__label">Forward</span>';
      fwdBtn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        navigateForward(true);
      });
    }

    let backBtn = document.querySelector(".ignow-sidebar-back");
    if (!backBtn) {
      backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "ignow-sidebar-back";
      backBtn.setAttribute("aria-label", "Back");
      backBtn.title = "Back (Alt+Left)";
      backBtn.innerHTML =
        '<svg class="ignow-sidebar-back__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>' +
        '<span class="ignow-sidebar-back__label">Back</span>';
      backBtn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        navigateBack();
      });
    }
    return { dlBtn, fwdBtn, backBtn };
  }

  function resolveSidebarSurfaceColor(refEl) {
    const bodyBg = getComputedStyle(document.body || document.documentElement).backgroundColor || "";
    const bgMatch = bodyBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const lightSurface = bgMatch && ((Number(bgMatch[1]) + Number(bgMatch[2]) + Number(bgMatch[3])) / 3) > 160;
    if (!lightSurface) return "#f5f5f5";
    const refColor = refEl ? getComputedStyle(refEl).color : getComputedStyle(document.body || document.documentElement).color;
    return refColor && refColor !== "rgba(0, 0, 0, 0)" ? refColor : "#0f1419";
  }

  function applySidebarButtonsColor(buttons, refEl) {
    const resolvedColor = resolveSidebarSurfaceColor(refEl);
    for (const btn of buttons) {
      if (btn.style.color !== resolvedColor) btn.style.color = resolvedColor;
    }
  }

  function setSidebarButtonsCompact(dlBtn, fwdBtn, backBtn, compact) {
    dlBtn.classList.toggle("ignow-sidebar-downloader--compact", compact);
    fwdBtn.classList.toggle("ignow-sidebar-forward--compact", compact);
    backBtn.classList.toggle("ignow-sidebar-back--compact", compact);
  }

  let mountedMoreInfo = null;

  function installSidebarBackButton(forceMeasure = true) {
    if (!forceMeasure
      && mountedMoreInfo
      && mountedMoreInfo.row.isConnected
      && mountedMoreInfo.control.isConnected) {
      const backBtn = document.querySelector(".ignow-sidebar-back");
      const fwdBtn = document.querySelector(".ignow-sidebar-forward");
      const dlBtn = document.querySelector(".ignow-sidebar-downloader");
      if (backBtn && fwdBtn && dlBtn
        && backBtn.nextElementSibling === mountedMoreInfo.row
        && fwdBtn.nextElementSibling === backBtn
        && dlBtn.nextElementSibling === fwdBtn) {
        updateSidebarBackButtonState();
        return backBtn;
      }
    }

    const moreInfo = findSidebarMoreRow();
    const sidebar = findSidebarContainer();
    const { dlBtn, fwdBtn, backBtn } = createSidebarButtons();

    if (moreInfo && moreInfo.row.parentElement) {
      mountedMoreInfo = moreInfo;
      document.querySelector(".ignow-sidebar-floating-nav")?.remove();
      const container = moreInfo.row.parentElement;
      if (backBtn.nextElementSibling !== moreInfo.row) {
        container.insertBefore(backBtn, moreInfo.row);
      }
      if (fwdBtn.nextElementSibling !== backBtn) {
        container.insertBefore(fwdBtn, backBtn);
      }
      if (dlBtn.nextElementSibling !== fwdBtn) {
        container.insertBefore(dlBtn, fwdBtn);
      }

      const moreRect = moreInfo.control.getBoundingClientRect();
      const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().width : moreRect.width;
      const labelNodes = Array.from(moreInfo.control.querySelectorAll("span, div"))
        .filter(el => !el.closest("svg") && el.children.length === 0 && el.textContent?.trim());
      const moreTextVisible = labelNodes.some(el => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().width !== 0;
      }) || (moreRect.width === 0 && labelNodes.length > 0);
      const compact = (sidebarWidth > 0 && sidebarWidth < 120)
        || (moreRect.width > 0 && moreRect.width < 90)
        || (moreRect.width > 0 && !moreTextVisible);
      setSidebarButtonsCompact(dlBtn, fwdBtn, backBtn, compact);
      const refColorEl = labelNodes.find(el => getComputedStyle(el).color) || moreInfo.control;
      applySidebarButtonsColor([dlBtn, fwdBtn, backBtn], refColorEl);
      updateSidebarBackButtonState();
      return backBtn;
    }

    if (document.body) {
      let floating = document.querySelector(".ignow-sidebar-floating-nav");
      if (!floating) {
        floating = document.createElement("div");
        floating.className = "ignow-sidebar-floating-nav";
        document.body.appendChild(floating);
      }
      if (dlBtn.parentElement !== floating) floating.appendChild(dlBtn);
      if (fwdBtn.parentElement !== floating) floating.appendChild(fwdBtn);
      if (backBtn.parentElement !== floating) floating.appendChild(backBtn);
      const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().width : 0;
      const compact = sidebarWidth > 0 && sidebarWidth < 120;
      setSidebarButtonsCompact(dlBtn, fwdBtn, backBtn, compact);
      applySidebarButtonsColor([dlBtn, fwdBtn, backBtn], null);
      updateSidebarBackButtonState();
      return backBtn;
    }
    return null;
  }

  function closeInstagramVideo() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch?.(() => {});
      return true;
    }

    const aboutEl = document.getElementById("__ignow_about");
    if (aboutEl) {
      if (typeof aboutEl.__ignowClose === "function") aboutEl.__ignowClose();
      else aboutEl.remove();
      return true;
    }

    const closeButton = Array.from(document.querySelectorAll("button, [role=button]"))
      .find(button => !button.closest(".ignow-sidebar-back, .ignow-sidebar-forward, .ignow-sidebar-downloader, .ignow-video-controls, .ignow-image-download-btn")
        && isVisible(button)
        && /close|dismiss/i.test(`${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""} ${button.querySelector("svg[aria-label]")?.getAttribute("aria-label") || ""} ${button.querySelector("svg title")?.textContent || ""}`));
    if (closeButton) {
      closeButton.click();
      return true;
    }

    const path = window.location.pathname;
    if (/^\/(?:(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)|stories)(?:\/|$)/i.test(path) || document.querySelector("[role=dialog]")) {
      if (state.navIndex > 0 || window.history.length > 1) {
        return navigateBack();
      }
      window.location.href = "https://www.instagram.com/";
      return true;
    }
    return false;
  }

  document.addEventListener("click", event => {
    const insideViewer = elementFromTarget(event.target)?.closest?.(".ignow-media-viewer");
    const insideMenu = elementFromTarget(event.target)?.closest?.(".ignow-media-menu");
    const insideVideoControls = elementFromTarget(event.target)?.closest?.(".ignow-video-controls");
    if (insideViewer || insideMenu || insideVideoControls) return;

    if (!event.ctrlKey) {
      closeMenu();
      return;
    }

    const media = mediaFromTarget(event.target) || mediaAtPoint(event.clientX, event.clientY);
    if (media instanceof HTMLImageElement) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showViewer(media);
      return;
    }
    closeMenu();
  }, true);

  document.addEventListener("contextmenu", event => {
    if (elementFromTarget(event.target)?.closest?.(".ignow-video-controls")) {
      event.preventDefault();
      return;
    }
    const media = mediaFromTarget(event.target) || mediaAtPoint(event.clientX, event.clientY);
    const link = media ? null : (linkFromTarget(event.target) || linkAtPoint(event.clientX, event.clientY));
    if (!media && !link) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (media) {
      const kind = media instanceof HTMLVideoElement ? "video" : "image";
      showMenu([
        {
          label: kind === "video"
            ? "Save video to Downloads/IG-Now"
            : "Save image to Downloads/IG-Now",
          action: () => saveMedia(media)
        },
        {
          label: "Download post (media + caption)",
          action: () => savePostBundle(media)
        },
        {
          label: "Copy caption text",
          action: () => copyCaptionText(media)
        },
        {
          label: "Open IG-Now Downloader...",
          action: () => openNativeDownloader(postUrlForMedia(media) || window.location.href, media)
        },
        {
          divider: true,
          label: kind === "video" ? "Open video post in default browser" : "Open post in default browser",
          action: () => openMediaInBrowser(media)
        }
      ], event.clientX, event.clientY);
    } else {
      showMenu([
        { label: "Open link in default browser", action: () => openDefaultBrowser(link.href) }
      ], event.clientX, event.clientY);
    }
  }, true);

  window.addEventListener("keydown", event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        navigateBack();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        navigateForward();
        return;
      }
    }

    const target = elementFromTarget(event.target);
    if (target?.matches?.("input, textarea, [contenteditable=true]")) {
      // Arrow keys belong to the volume slider while it has keyboard focus
      // (tabIndex -1 keeps it out of Tab order; the mute button stays the
      // focus entry). Guarded by class: Instagram's comment box, search box,
      // and every other host input keep the keys reserved for typing.
      if (target?.classList?.contains("ignow-video-controls__volume-slider")
        && (event.key === "ArrowLeft" || event.key === "ArrowRight"
          || event.key === "ArrowUp" || event.key === "ArrowDown")) {
        return;
      }
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const video = activeVideoForKeyboard();
      if (!video) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      seekVideo(video, event.key === "ArrowLeft" ? -5 : 5);
      return;
    }

    if (event.__ignowSyntheticNavigation) return; // our own fallback — never re-navigate
    if (isStandaloneReelPage() && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateReel(event.key === "ArrowUp" ? -reelPageStep() : reelPageStep());
    }
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const target = elementFromTarget(event.target);
    if (target?.matches?.("input, textarea, [contenteditable=true]")
      && !target.closest?.(".ignow-video-controls")) return;

    if (state.viewer) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeViewer();
      return;
    }
    if (state.menu) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu();
      return;
    }
    if (closeInstagramVideo()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  function installNativeVideoControls(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.dataset.ignowNativeControls === "1") {
      applyDefaultVideoAudio(video);
      if (!video.paused && isStandaloneVideo(video)) {
        if (state.videoAudioUnlocked) activateVideoAudio(video);
        pauseOtherVideos(video);
      }
      return;
    }
    const host = video.parentElement;
    if (!host) return;

    video.dataset.ignowNativeControls = "1";
    video.controls = false;
    host.classList.add("ignow-video-host");

    const controls = document.createElement("div");
    controls.className = "ignow-video-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Video controls");

    const createButton = (label, title) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      return button;
    };

    const playButton = createButton("\u25B6", "Play video");
    const volumeButton = createButton("", "Mute video (drag or hover for volume slider)");
    volumeButton.className = "ignow-video-controls__volume";
    volumeButton.innerHTML = volumeSvgMarkup("high");
    // Volume LEVEL slider (v2.1.0): hover/focus the mute button or drag the
    // track to reveal it; bidirectionally synchronized with Instagram's own
    // slider through the video element (single source of truth).
    const volumeGroup = document.createElement("div");
    volumeGroup.className = "ignow-video-controls__volume-group";
    const volumeSlider = document.createElement("input");
    volumeSlider.type = "range";
    volumeSlider.className = "ignow-video-controls__volume-slider";
    volumeSlider.min = "0";
    volumeSlider.max = "100";
    volumeSlider.step = "1";
    volumeSlider.value = "50";
    // Natively tabbable like the seek line (input default): a keyboard user
    // reaches it with Tab and adjusts with the arrows (the global keydown
    // seek handler deliberately yields to it — see the class guard there).
    volumeSlider.setAttribute("role", "slider");
    volumeSlider.setAttribute("aria-label", "Video volume level");
    volumeSlider.setAttribute("aria-valuemin", "0");
    volumeSlider.setAttribute("aria-valuemax", "100");
    volumeSlider.setAttribute("aria-valuenow", "50");
    volumeSlider.style.setProperty("--ignow-volume", "50%");
    volumeGroup.append(volumeButton, volumeSlider);
    const rewindButton = createButton("\u22125s", "Back 5 seconds (Left arrow)");
    rewindButton.className = "ignow-video-controls__skip";
    const forwardButton = createButton("+5s", "Forward 5 seconds (Right arrow)");
    forwardButton.className = "ignow-video-controls__skip";
    const prevButton = createButton("\u23EE", "Previous reel or scroll up (Up arrow)");
    prevButton.className = "ignow-video-controls__nav";
    const nextButton = createButton("\u23ED", "Next reel or scroll down (Down arrow)");
    nextButton.className = "ignow-video-controls__nav";
    const downloadButton = createButton("", "Open IG-Now Downloader (auto-inspect this video)");
    downloadButton.className = "ignow-video-controls__download";
    downloadButton.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3v12"></path><path d="M7 10l5 5 5-5"></path><path d="M5 20h14"></path></svg>';
    const elapsedLabel = document.createElement("span");
    elapsedLabel.className = "ignow-video-controls__time";
    elapsedLabel.textContent = "0:00";

    const progressLine = document.createElement("input");
    progressLine.type = "range";
    progressLine.className = "ignow-video-controls__progress";
    progressLine.min = "0";
    progressLine.max = "100";
    progressLine.step = "0.1";
    progressLine.value = "0";
    progressLine.setAttribute("role", "slider");
    progressLine.setAttribute(
      "aria-label",
      "Video progress; click or drag the white line to seek"
    );
    progressLine.setAttribute("aria-valuemin", "0");
    progressLine.setAttribute("aria-valuemax", "100");
    progressLine.setAttribute("aria-valuenow", "0");
    progressLine.style.setProperty("--ignow-progress", "0%");

    const totalLabel = document.createElement("span");
    totalLabel.className = "ignow-video-controls__time ignow-video-controls__time--total";
    totalLabel.textContent = "0:00";

    // Order: play + volume + previous / next (LEFT cluster) | elapsed | −5s |
    // seek | +5s | total. Every IG-Now control lives in the bar's left half —
    // Instagram floats its own mute/fullscreen buttons over the bottom-right
    // corner of the video, so the right edge is reserved (104px padding) and
    // never overlapped (v2.1.0 layout fix).
    controls.append(
      playButton,
      volumeGroup,
      prevButton,
      nextButton,
      downloadButton,
      elapsedLabel,
      rewindButton,
      progressLine,
      forwardButton,
      totalLabel
    );
    // Compact mode: Search cards (muted hover previews) and narrow players
    // have no room for the navigation and skip pairs — they are hidden and
    // the arrow keys keep doing both jobs, leaving the progress line the
    // width. Measured from the VIDEO's rect (clientWidth is 0 for un-laid-
    // out hosts and would falsely compact) and RE-EVALUATED on every sync:
    // Instagram mounts media before layout settles, so a width decided once
    // at install time sticks wrong (observed: a 542px dialog stuck with the
    // compact bar, prev/next missing entirely — reads as "buttons dead").
    host.appendChild(controls);
    const updateCompactMode = () => {
      const width = video.getBoundingClientRect().width;
      const shouldCompact = isSearchCardVideo(video) || (width > 0 && width < 380);
      controls.classList.toggle("ignow-video-controls--compact", shouldCompact);
    };
    updateCompactMode();

    const formatVideoTime = seconds => {
      if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
      const totalSeconds = Math.floor(seconds);
      const minutes = Math.floor(totalSeconds / 60);
      const remainingSeconds = totalSeconds % 60;
      if (minutes < 60) return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
      const hours = Math.floor(minutes / 60);
      return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
    };

    applyDefaultVideoAudio(video);
    if (!video.paused) {
      if (!isSearchCardVideo(video) && isWindowForeground() && video.dataset.ignowMutedByIgnow !== "1") {
        activateVideoAudio(video);
      }
      if (isStandaloneVideo(video)) pauseOtherVideos(video);
    }

    // Streams may report duration NaN/Infinity while buffered ranges already
    // know the playable end — fall back to seekable so the seek line keeps
    // working during those windows.
    const effectiveDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
      try {
        if (video.seekable && video.seekable.length > 0) {
          const end = video.seekable.end(video.seekable.length - 1);
          if (Number.isFinite(end) && end > 0) return end;
        }
      } catch (error) {
        console.warn("IG-Now could not read the buffered duration:", error);
      }
      return 0;
    };

    // The aria-label is already set once at construction above — sync never
    // rewrites constant attributes (v2.1.0 perf fix).
    let lastProgressStr = "";
    let lastProgressInt = "";
    let lastElapsedText = "";
    let lastTotalText = "";
    let lastPausedState = null;
    const sync = () => {
      // The seek line's aria-label is CONSTANT — set it once (below), not on
      // every timeupdate (~4×/s per video): sync must not write attributes
      // that never change (v2.1.0 perf fix).
      applyDefaultVideoAudio(video);
      const duration = effectiveDuration();
      const progress = duration > 0
        ? Math.max(0, Math.min(1, video.currentTime / duration))
        : 0;
      const pct = progress * 100;
      const pctStr = `${pct}%`;
      const pctInt = String(Math.round(pct));
      if (pctStr !== lastProgressStr) {
        lastProgressStr = pctStr;
        progressLine.value = String(pct);
        progressLine.style.setProperty("--ignow-progress", pctStr);
      }
      if (pctInt !== lastProgressInt) {
        lastProgressInt = pctInt;
        progressLine.setAttribute("aria-valuenow", pctInt);
      }
      const elapsedText = formatVideoTime(video.currentTime);
      if (elapsedText !== lastElapsedText) {
        lastElapsedText = elapsedText;
        elapsedLabel.textContent = elapsedText;
      }
      const totalText = formatVideoTime(duration);
      if (totalText !== lastTotalText) {
        lastTotalText = totalText;
        totalLabel.textContent = totalText;
      }
      const isPaused = Boolean(video.paused);
      if (isPaused !== lastPausedState) {
        lastPausedState = isPaused;
        playButton.textContent = isPaused ? "\u25B6" : "\u23F8";
        playButton.title = isPaused ? "Play video" : "Pause video";
        playButton.setAttribute("aria-label", playButton.title);
      }
      syncVolume();
    };

    const seekBy = seconds => {
      const duration = effectiveDuration();
      if (!(duration > 0)) return;
      const nextTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
      try {
        if (typeof video.fastSeek === "function") video.fastSeek(nextTime);
      } catch (error) {
        console.warn("IG-Now fast seeking is unavailable; using normal seeking:", error);
      }
      try {
        video.currentTime = nextTime;
      } catch (error) {
        console.warn("IG-Now could not seek this video with the arrow key:", error);
      }
      sync();
    };

    const seekToFraction = fraction => {
      const duration = effectiveDuration();
      if (!(duration > 0)) return;
      const nextTime = Math.max(0, Math.min(1, fraction)) * duration;
      try {
        if (typeof video.fastSeek === "function") video.fastSeek(nextTime);
      } catch (error) {
        console.warn("IG-Now fast seeking is unavailable; using normal seeking:", error);
      }
      try {
        video.currentTime = nextTime;
      } catch (error) {
        console.warn("IG-Now could not seek this video:", error);
      }
      sync();
    };

    // Volume: the video element is the SINGLE SOURCE OF TRUTH. The mute
    // button flips `muted`; the level slider writes `volume`; and every
    // `volumechange` — ours, Instagram's native slider, the page player —
    // re-mirrors the element state back into the UI. IG-Now's icon/track and
    // Instagram's own vertical slider can therefore never disagree, in
    // either direction (v2.1.0 synchronization).
    // The icon reflects the AUDIBLE level (muted counts as off), matching
    // how Instagram's own icon reacts to its native slider.
    let lastVolSignature = "";
    let lastSliderPct = -1;
    const volumeSliderSync = () => {
      const isSilenced = Boolean(video.muted || !Number.isFinite(video.volume) || video.volume <= 0.005);
      const level = isSilenced ? 0 : video.volume;
      const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
      if (pct === lastSliderPct) return;
      lastSliderPct = pct;
      volumeSlider.value = String(pct);
      volumeSlider.setAttribute("aria-valuenow", String(pct));
      volumeSlider.setAttribute("aria-valuetext", `${pct}%`);
      volumeSlider.style.setProperty("--ignow-volume", `${pct}%`);
    };
    const syncVolume = () => {
      const isMuted = Boolean(video.muted || !Number.isFinite(video.volume) || video.volume <= 0.005);
      const levelKind = isMuted ? "muted" : audibleIconForVolume(video.volume);
      const sig = `${levelKind}:${Math.round((isMuted ? 0 : video.volume) * 100)}`;
      if (sig !== lastVolSignature) {
        lastVolSignature = sig;
        volumeButton.innerHTML = volumeSvgMarkup(levelKind);
        volumeButton.title = isMuted ? "Unmute video" : "Mute video";
        volumeButton.setAttribute("aria-label", volumeButton.title);
        volumeButton.setAttribute("aria-pressed", String(!isMuted));
        volumeButton.dataset.ignowMutedState = isMuted ? "muted" : "audible";
        volumeButton.classList.toggle("ignow-video-controls__volume--muted", isMuted);
      }
      volumeSliderSync();
    };
    controlActions.set(volumeButton, () => {
      state.activeVideo = video;
      try {
        const wasSilenced = Boolean(video.muted || !Number.isFinite(video.volume) || video.volume <= 0.005);
        setMediaMuteSynced(video, !wasSilenced, true);
        if (wasSilenced) {
          state.videoAudioUnlocked = true;
          if (video.paused && !isSearchCardVideo(video)) video.play()?.catch?.(() => {});
        }
      } catch (error) {
        console.warn("IG-Now could not toggle the video mute:", error);
      }
      syncVolume();
    });

    // The volume slider shares the seek line's bulletproof pointer path:
    // the window-capture delegation resolves it BY POINT (overlay-proof),
    // captures the pointer, and rAF-coalesces drags (see the seek section).
    // Writes go through setVideoVolume — `muted` is never touched, so a
    // chosen mute state survives level adjustments; silent-at-zero behaves
    // exactly like Instagram's own slider (drag to the far left = silent,
    // drag back = audible again).
    seekDelegates.set(volumeSlider, {
      activate: () => {
        state.activeVideo = video;
        // Hold the track open for the whole drag: pointer capture can carry
        // the pointer off the group (hover ends, the class keeps it open).
        volumeGroup.classList.add("ignow-volume-open");
      },
      // Pointer drags end by BLURRING the slider: Chromium keeps :focus-visible
      // on range inputs after a mouse-initiated focus, which would otherwise
      // leave the track permanently expanded — squeezing the seek line and
      // shifting the bar layout until the next click elsewhere (observed in
      // the Edge suite: the seek line shrank to its 28px minimum after one
      // volume drag). Keyboard use never pointer-downs, so arrows users are
      // unaffected and keep the expanded track while focused.
      release: () => {
        volumeGroup.classList.remove("ignow-volume-open");
        try {
          volumeSlider.blur(); // drop :focus-visible so the track collapses
        } catch (error) {
          console.warn("IG-Now could not collapse the volume slider:", error);
        }
      },
      seek: fraction => {
        try {
          setVideoVolume(video, Math.max(0, Math.min(1, fraction)));
          markAudioUserControlled(video);
          state.videoAudioUnlocked = true;
        } catch (error) {
          console.warn("IG-Now could not set the video volume:", error);
        }
        syncVolume();
      }
    });

    const startSearchHoverPreview = () => {
      if (!isSearchCardVideo(video)) return;
      video.volume = 0.1;
      setVideoMuted(video, true);
      pauseOtherVideos(video);
      video.play().catch(() => {});
      sync();
    };

    const stopSearchHoverPreview = () => {
      if (!isSearchCardVideo(video)) return;
      if (!video.paused) video.pause();
      sync();
    };

    host.addEventListener("pointerenter", startSearchHoverPreview);
    host.addEventListener("pointerleave", stopSearchHoverPreview);

    const toggle = () => {
      state.activeVideo = video;
      if (isSearchCardVideo(video)) {
        video.volume = 0.1;
        setVideoMuted(video, true);
      } else {
        activateVideoAudio(video);
      }
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    };

    videoControllers.set(video, { seek: seekBy, toggle, refresh: sync });
    controlActions.set(playButton, toggle);
    controlActions.set(rewindButton, () => {
      state.activeVideo = video;
      seekBy(-5);
    });
    controlActions.set(forwardButton, () => {
      state.activeVideo = video;
      seekBy(5);
    });
    controlActions.set(prevButton, () => {
      state.activeVideo = video;
      navigateReel(-reelPageStep());
    });
    controlActions.set(nextButton, () => {
      state.activeVideo = video;
      navigateReel(reelPageStep());
    });
    controlActions.set(downloadButton, () => {
      state.activeVideo = video;
      const postUrl = postUrlForMedia(video) || normalizeInstagramPostUrl(window.location.href) || window.location.href;
      return openNativeDownloader(postUrl, video);
    });
    // The seek line itself gets NO element-level pointer listeners: the
    // window-capture delegation above is the single pointer path (see the
    // ROOT CAUSE note there). Registering here keeps the delegate paired
    // with this video even after Instagram re-parents the controls.
    seekDelegates.set(progressLine, {
      activate: () => {
        state.activeVideo = video;
      },
      seek: seekToFraction
    });

    ["click", "dblclick", "pointerdown", "pointermove", "pointerup", "pointercancel", "input", "change"]
      .forEach(type => {
      controls.addEventListener(type, event => event.stopPropagation());
    });
    controls.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
    });

    video.addEventListener("timeupdate", sync);
    video.addEventListener("loadedmetadata", () => {
      resetVideoStateOnSourceChange(video);
      updateCompactMode();
      sync();
    });
    video.addEventListener("durationchange", sync);
    video.addEventListener("playing", updateCompactMode);
    video.addEventListener("volumechange", () => {
      try {
        if (!state.volumeGuardSuppressed && !isSearchCardVideo(video)) {
          const fromNativeBtn = Date.now() - Number(video.dataset.ignowNativeToggleAt || 0) < 500;
          if (fromNativeBtn) {
            video.dataset.ignowMutedByIgnow = video.muted ? "1" : "";
            markAudioUserControlled(video);
          } else if (video.dataset.ignowAudioUserActivated === "1") {
            if (video.muted && video.dataset.ignowMutedByIgnow !== "1") {
              video.muted = false;
            } else if (!video.muted && video.dataset.ignowMutedByIgnow === "1") {
              video.muted = true;
            }
          }
        }
      } catch (error) {
        console.warn("IG-Now could not keep the video audio as the user set it:", error);
      }
      syncVolume();
    });
    video.addEventListener("play", () => {
      resetVideoStateOnSourceChange(video);
      const isSearchCardHovered = host.matches(":hover") || video.matches(":hover");
      if (isSearchCardVideo(video) && !isSearchCardHovered) {
        video.pause();
        return;
      }
      if (!isSearchCardVideo(video) && isWindowForeground() && video.dataset.ignowMutedByIgnow !== "1") {
        activateVideoAudio(video);
      }
      pauseOtherVideos(video);
      state.activeVideo = video;
      sync();
    });
    video.addEventListener("pause", sync);
    syncVolume();
    sync();
  }

  function elementInStageViewport(el, sr) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return cx >= sr.left - 8 && cx <= sr.right + 8 && cy >= sr.top - 8 && cy <= sr.bottom + 8;
  }

  function activeStageVideo(stage) {
    if (!(stage instanceof Element)) return null;
    const sr = stage.getBoundingClientRect();
    const videos = Array.from(stage.querySelectorAll("video"));
    if (!videos.length) return null;
    if (sr.width <= 0 || sr.height <= 0) return videos[0];
    return videos.find(video => isPostVideo(video) && elementInStageViewport(video, sr)) || null;
  }

  function findImageStageHost(image) {
    if (!isPostImage(image)) return null;
    const inPostContainer = Boolean(image.closest("article, [role='dialog']"));
    const imgRect = image.getBoundingClientRect();
    if (!inPostContainer && (image.closest("a[href]") || imgRect.width < 320 || imgRect.height < 260)) {
      return null;
    }

    let stage = image.closest("ul")?.parentElement || image.parentElement;
    while (stage instanceof Element && stage.matches("picture, a, li, ul")) {
      const parent = stage.parentElement;
      if (!parent || parent.matches("body, html, main, section")) break;
      stage = parent;
    }
    // Climb out of wide multi-slide carousel tracks, horizontal scroll wrappers, and
    // nested transform layers into the clipped viewport box (typically `[role="presentation"]`
    // alongside Instagram's Next/Tag controls) so the corner button stays visible onscreen.
    for (let hop = 0; stage instanceof Element && hop < 5; hop += 1) {
      const parent = stage.parentElement;
      if (!parent || parent.matches("article, [role='dialog'], body, html, main, section")) break;
      const sr = stage.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      const horizontalStrip = stage.scrollWidth > stage.clientWidth + 8
        || sr.width > imgRect.width * 1.25;
      const clippedViewportWrapper = Math.abs(pr.width - imgRect.width) <= 48
        && pr.height >= 120
        && pr.height <= imgRect.height + 72
        && (stage.getAttribute("role") !== "presentation"
          && (parent.getAttribute("role") === "presentation"
            || Boolean(parent.querySelector("[aria-label*='Next' i], [aria-label*='Go Back' i]"))));
      if (!horizontalStrip && !clippedViewportWrapper) break;
      stage = parent;
    }
    if (!(stage instanceof Element) || stage.matches("body, html, main, section, header, nav, aside")) {
      return null;
    }
    if (activeStageVideo(stage)) return null;
    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width < 120 || stageRect.height < 120) return null;
    return stage;
  }

  function hasBottomRightNativeButton(stage, stageRect = stage.getBoundingClientRect()) {
    const sr = stageRect;
    if (sr.width <= 0 || sr.height <= 0) return false;
    return Array.from(stage.querySelectorAll("button, [role='button']")).some(el => {
      if (el.closest(".ignow-image-download-btn, .ignow-video-controls")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right >= sr.right - 56 && r.bottom >= sr.bottom - 56;
    });
  }

  function activeStageImage(stage, fallbackImage, stageRect = stage.getBoundingClientRect()) {
    const sr = stageRect;
    const imgs = Array.from(stage.querySelectorAll("img")).filter(isPostImage);
    const inViewport = imgs.find(img => elementInStageViewport(img, sr));
    return inViewport || fallbackImage || imgs[0] || null;
  }

  function installNativeImageControls(image) {
    if (!(image instanceof HTMLImageElement)) return;
    if (image.closest("header, nav, aside, .ignow-video-controls, .ignow-media-viewer, #__ignow_about")) return;
    const stage = findImageStageHost(image);
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    if (!elementInStageViewport(image, stageRect)) return;
    if (!stage.classList.contains("ignow-image-host") && getComputedStyle(stage).position === "static") {
      stage.classList.add("ignow-image-host");
    }

    let btn = Array.from(stage.children).find(el => el.classList?.contains("ignow-image-download-btn")) || null;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ignow-image-download-btn";
      btn.setAttribute("aria-label", "Open IG-Now Downloader (save image or carousel)");
      btn.title = "Open IG-Now Downloader (save image or carousel)";
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 20h14"></path></svg>';
      btn.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      stage.appendChild(btn);
    }

    btn.classList.toggle("ignow-image-download-btn--lifted", hasBottomRightNativeButton(stage, stageRect));
    controlActions.set(btn, () => {
      const targetImg = activeStageImage(stage, image);
      const postUrl = postUrlForMedia(targetImg) || normalizeInstagramPostUrl(window.location.href) || "";
      return openNativeDownloader(postUrl, targetImg);
    });
  }

  function scanVideos() {
    document.querySelectorAll("video").forEach(installNativeVideoControls);
    document.querySelectorAll(".ignow-image-download-btn").forEach(btn => {
      const stage = btn.parentElement;
      if (!stage || activeStageVideo(stage) || !activeStageImage(stage, null)) btn.remove();
    });
    document.querySelectorAll("img").forEach(installNativeImageControls);
    installSidebarBackButton(false);
  }

  function installNetworkMediaObserver() {
    if (typeof window.fetch === "function") {
      const originalFetch = window.fetch;
      window.fetch = function (...args) {
        const pending = originalFetch.apply(this, args);
        Promise.resolve(pending).then(response => {
          const url = String(response?.url || "");
          if (!/\/(?:api\/v1\/|api\/graphql|graphql)/i.test(url)) return;
          const contentType = String(response.headers?.get?.("content-type") || "");
          if (contentType && !/json|text|javascript/i.test(contentType)) return;
          if (Number(response.headers?.get?.("content-length")) > 4 * 1024 * 1024) return;
          response.clone?.().text?.().then(text => extractBundlesFromJsonText(text, "", true)).catch(() => {});
        }).catch(() => {});
        return pending;
      };
    }
    if (typeof window.XMLHttpRequest === "function") {
      const originalOpen = window.XMLHttpRequest.prototype.open;
      const xhrUrls = new WeakMap();
      window.XMLHttpRequest.prototype.open = function (method, url) {
        if (!xhrUrls.has(this)) {
          this.addEventListener("load", () => {
            const reqUrl = String(xhrUrls.get(this) || "");
            if (!/\/(?:api\/v1\/|api\/graphql|graphql)/i.test(reqUrl)) return;
            try {
              if (this.responseType === "json") {
                if (this.response && typeof this.response === "object") cacheBundlesFromPayload(this.response);
              } else {
                extractBundlesFromJsonText(this.responseText, "", true);
              }
            } catch {
              // Ignore non-JSON responses.
            }
          });
        }
        xhrUrls.set(this, url);
        return originalOpen.apply(this, arguments);
      };
    }
  }

  function resolvePopstateIndex(currentUrl) {
    if (state.navHistory[state.navIndex] === currentUrl) return state.navIndex;
    if (state.navIndex > 0 && state.navHistory[state.navIndex - 1] === currentUrl) return state.navIndex - 1;
    if (state.navIndex < state.navHistory.length - 1 && state.navHistory[state.navIndex + 1] === currentUrl) {
      return state.navIndex + 1;
    }
    return state.navHistory.lastIndexOf(currentUrl);
  }

  function installHistoryHooks(onRouteChange) {
    for (const method of ["pushState", "replaceState"]) {
      const original = window.history[method];
      if (typeof original !== "function") continue;
      window.history[method] = function (...args) {
        const result = original.apply(this, args);
        recordNavUrl(window.location.href, method === "replaceState");
        onRouteChange(window.location.href);
        return result;
      };
    }
    window.addEventListener("popstate", () => {
      const matchIdx = resolvePopstateIndex(window.location.href);
      if (matchIdx >= 0) state.navIndex = matchIdx;
      updateSidebarBackButtonState();
      onRouteChange(window.location.href);
    });
  }

  function observeVideoChanges() {
    if (!document.documentElement) return;
    installNetworkMediaObserver();
    scanVideos();

    let scanTimer = null;
    const scheduleScan = (delay = 120) => {
      if (scanTimer !== null) return;
      const ms = typeof delay === "number" && delay >= 0 ? delay : 120;
      scanTimer = window.setTimeout(() => {
        scanTimer = null;
        scanVideos();
      }, ms);
    };
    let lastRoute = window.location.href;
    installHistoryHooks(route => {
      if (route) lastRoute = route;
      mountedMoreInfo = null;
      scheduleScan();
    });

    const isOwnNode = node => node instanceof Element
      && Boolean(
        node.closest?.(".ignow-sidebar-back, .ignow-sidebar-forward, .ignow-sidebar-downloader, .ignow-sidebar-floating-nav, .ignow-video-controls, .ignow-image-download-btn, .ignow-media-menu, .ignow-toast, .ignow-media-viewer")
      );

    new MutationObserver(mutations => {
      const relevant = mutations.some(mutation => {
        if (isOwnNode(mutation.target)) return false;
        if (mutation.type === "attributes") {
          return mutation.target instanceof Element && !mutation.target.closest?.("video, audio");
        }
        if (mutation.type !== "childList") return false;
        const addedExternal = Array.from(mutation.addedNodes).some(node => node instanceof Element && !isOwnNode(node));
        const removedExternalOrSidebar = Array.from(mutation.removedNodes).some(node => node instanceof Element
          && (!isOwnNode(node) || node.matches?.(".ignow-sidebar-back, .ignow-sidebar-forward, .ignow-sidebar-downloader")));
        return addedExternal || removedExternalOrSidebar;
      });
      if (relevant) scheduleScan();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden"]
    });
    window.addEventListener("scroll", () => scheduleScan(120), { capture: true, passive: true });
    document.addEventListener("transitionend", event => {
      if (!isOwnNode(event.target)) scheduleScan();
    }, { capture: true, passive: true });
    document.addEventListener("click", event => {
      const navBtn = elementFromTarget(event.target)?.closest?.("[aria-label*='Next' i], [aria-label*='Go Back' i], [aria-label*='Previous' i]");
      if (navBtn && !navBtn.closest(".ignow-video-controls, .ignow-sidebar-back, .ignow-sidebar-forward")) {
        scheduleScan(160);
      }
    }, true);
    document.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement) scheduleScan();
    }, true);
    window.setInterval(() => {
      const currentRoute = window.location.href;
      if (currentRoute === lastRoute) return;
      lastRoute = currentRoute;
      mountedMoreInfo = null;
      recordNavUrl(currentRoute, false);
      scheduleScan();
    }, 500);
  }

  window.__ignowTools = {
    saveMedia,
    savePostBundle,
    extractPostBundle,
    fetchInstaloaderPost,
    downloadPostByUrl,
    openNativeDownloader,
    probePostForDownloader,
    shortcodeToMediaId,
    mediaIdToShortcode,
    copyCaptionText,
    installSidebarBackButton,
    navigateBack,
    navigateForward,
    closeInstagramVideo,
    stripMediaRangeParams,
    buildSourceFileStem
  };

  // ── Pause-on-minimize / resume-on-restore helpers ────────────────────────
  // Driven by the Rust playback watchdog: it evals `__onWindowHidden` on every
  // hidden/visible transition of the host window (minimize, close-to-tray,
  // autostart-hidden) and `__resumeIfNeeded` on restore. Idempotent — the
  // visibilitychange handler below just mirrors the watchdog for pages where
  // the event DOES fire. The OS-level audio-session mute in Rust is the real
  // guarantee; these helpers give instant response and keep the site's own
  // player state in sync.
  var _ignowResumeOnVisible = false;
  var _ignowPlayingVideo = null;
  var _ignowPlayingAudio = null;
  var _ignowMutedVideo = null;
  var _ignowMutedByHide = false;

  window.__ignowActiveVideo = function () {
    if (state.activeVideo && state.activeVideo.isConnected) return state.activeVideo;
    const playing = Array.from(document.querySelectorAll("video")).find(v => !v.paused);
    return playing || document.querySelector("video") || null;
  };

  window.__onWindowHidden = function () {
    try {
      const videos = Array.from(document.querySelectorAll("video"));
      const audios = Array.from(document.querySelectorAll("audio"));
      const newlyPlaying = videos.find(v => !v.paused) || null;
      const newlyPlayingAudio = audios.find(a => !a.paused) || null;
      // Idempotent: the Resized fast-path AND the watchdog both call this on
      // one minimize — a second call must NEVER clear the first capture, or
      // restore would lose the resume intent (observed in E2E).
      if (newlyPlaying) _ignowPlayingVideo = newlyPlaying;
      if (newlyPlayingAudio) _ignowPlayingAudio = newlyPlayingAudio;
      _ignowResumeOnVisible = _ignowResumeOnVisible
        || Boolean(_ignowPlayingVideo)
        || Boolean(_ignowPlayingAudio);
      // Mute-backup applies ONLY to the video that was actually playing —
      // never to a paused element (a stale mute would silence a later
      // autoplay after restore). The OS session mute covers everything else.
      if (_ignowPlayingVideo && !_ignowMutedVideo) {
        _ignowMutedByHide = _ignowPlayingVideo.muted;
        _ignowMutedVideo = _ignowPlayingVideo;
        setVideoMuted(_ignowPlayingVideo, true); // instant silence; the OS session mute is the guarantee
      }
      videos.forEach(v => { if (!v.paused) v.pause(); });
      audios.forEach(a => { if (!a.paused) a.pause(); });
      return "paused";
    } catch (error) {
      console.warn("IG-Now pause-on-hide failed:", error);
      return "error";
    }
  };

  window.__resumeIfNeeded = function () {
    try {
      // 1. Always restore our own mute-backup on the exact element we muted —
      // independent of any resume decision below. Restores the ORIGINAL mute
      // state (we forced it to true at hide; undo that even if it was false).
      if (_ignowMutedVideo && _ignowMutedVideo.isConnected) {
        setMediaMuteSynced(_ignowMutedVideo, _ignowMutedByHide, false);
      }
      _ignowMutedVideo = null;
      _ignowMutedByHide = false;
      if (!_ignowResumeOnVisible) return "no-resume";
      _ignowResumeOnVisible = false;

      // 2. Resume following Instagram's own rules: only media that is still
      // ON SCREEN may play. Prefer the exact element that was playing; if it
      // is gone or scrolled away, hand control to the current in-view video
      // (Instagram's engine autoplays in-view media — we only nudge it, and
      // never fight it by replaying off-screen elements).
      const wasPlaying = _ignowPlayingVideo && _ignowPlayingVideo.isConnected
        ? _ignowPlayingVideo
        : null;
      _ignowPlayingVideo = null;
      const target = (wasPlaying && isVisible(wasPlaying) && isVideoOnScreen(wasPlaying))
        ? wasPlaying
        : (visibleVideos()[0] || null);
      if (!target) {
        if (_ignowPlayingAudio && _ignowPlayingAudio.isConnected) {
          _ignowPlayingAudio.play().catch(() => {});
          _ignowPlayingAudio = null;
          return "resumed-audio";
        }
        _ignowPlayingAudio = null;
        return "no-video";
      }
      _ignowPlayingAudio = null;
      applyDefaultVideoAudio(target);
      if (!isSearchCardVideo(target)) activateVideoAudio(target);
      target.play().catch(() => {});
      return "resumed";
    } catch (error) {
      console.warn("IG-Now resume-on-restore failed:", error);
      return "error";
    }
  };

  window.__ignowEnsureForegroundAudio = function () {
    try {
      if (!isWindowForeground()) return "hidden";
      const videos = Array.from(document.querySelectorAll("video"));
      let unmutedCount = 0;
      for (const v of videos) {
        if (!v.isConnected || isSearchCardVideo(v)) continue;
        if (v.dataset.ignowMutedByIgnow === "1") continue;
        if (v.dataset.ignowAudioUserActivated === "1" && v.volume <= 0.005) continue;
        const onScreen = !v.paused || (isVisible(v) && isVideoOnScreen(v));
        if (onScreen && (v.muted || v.volume <= 0.005 || readNativeButtonMuted(findNativeMuteButton(v)) === true)) {
          setMediaMuteSynced(v, false, false);
          unmutedCount += 1;
        }
      }
      if (_ignowMutedVideo && _ignowMutedVideo.isConnected && _ignowMutedVideo.dataset.ignowMutedByIgnow !== "1") {
        setMediaMuteSynced(_ignowMutedVideo, false, false);
        _ignowMutedVideo = null;
        _ignowMutedByHide = false;
      }
      return unmutedCount ? `unmuted:${unmutedCount}` : "ok";
    } catch {
      return "error";
    }
  };

  window.__ignowPauseReport = function () {
    try {
      const videos = Array.from(document.querySelectorAll("video"));
      const playing = videos.filter(v => !v.paused);
      const active = window.__ignowActiveVideo();
      return JSON.stringify({
        paused: videos.length > 0 && playing.length === 0,
        playing: playing.length,
        total: videos.length,
        activePaused: active ? active.paused : null,
        muted: active ? active.muted : null,
        volume: active ? active.volume : null,
        resumeFlag: _ignowResumeOnVisible
      });
    } catch (error) {
      return JSON.stringify({ error: String(error) });
    }
  };

  document.addEventListener("visibilitychange", () => {
    try {
      if (document.hidden) window.__onWindowHidden();
      else window.__resumeIfNeeded();
    } catch (error) {
      console.warn("IG-Now visibility handler failed:", error);
    }
  });


  if (document.documentElement) observeVideoChanges();
  else document.addEventListener("DOMContentLoaded", observeVideoChanges, { once: true });
})();
