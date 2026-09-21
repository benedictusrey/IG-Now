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
    volumeGuardSuppressed: false
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
      min-width: 230px;
      padding: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      background: rgba(30, 30, 34, 0.97);
      box-shadow: 0 16px 45px rgba(0, 0, 0, 0.35);
      font: 13px "Segoe UI", Arial, sans-serif;
    }

    .ignow-media-menu button {
      display: block;
      width: 100%;
      padding: 9px 11px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #fff;
      text-align: left;
      cursor: pointer;
    }

    .ignow-media-menu button:hover {
      background: rgba(255, 255, 255, 0.12);
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
      gap: 6px !important;
      min-height: 28px !important;
      /* 104px right reserve: Instagram floats its own mute / fullscreen
         buttons over the video's bottom-right corner. Our controls flex
         inside the remaining space so the two never overlap (v2.1.0). */
      padding: 0 104px 12px 12px !important;
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
      width: 28px !important;
      height: 26px !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 4px !important;
      background: transparent !important;
      color: #fff !important;
      cursor: pointer !important;
      font: 16px/1 "Segoe UI Symbol", "Segoe UI", Arial, sans-serif !important;
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
      min-width: 38px !important;
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
      left: 32px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      flex: 0 0 auto !important;
      width: 0 !important;
      min-width: 0 !important;
      height: 23px !important;
      min-height: 23px !important;
      margin: 0 !important;
      padding: 0 !important;
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
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.75) !important;
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
      min-width: 30px !important;
      padding: 0 5px !important;
      font: 600 11px/1 "Segoe UI", Arial, sans-serif !important;
      letter-spacing: 0.02em !important;
    }

    /* Dedicated previous / next buttons — the mouse/touch equivalent of the
       Up/Down arrow keys (reel navigation, page scroll elsewhere). */
    .ignow-video-controls__nav {
      flex: 0 0 auto !important;
      width: 28px !important;
      height: 26px !important;
      font-size: 14px !important;
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

    .ignow-toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      max-width: min(460px, calc(100vw - 36px));
      padding: 11px 14px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      background: rgba(25, 25, 29, 0.96);
      color: #fff;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
      font: 13px "Segoe UI", Arial, sans-serif;
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
    const direct = elementFromTarget(target)?.closest?.(".ignow-video-controls button") || null;
    if (direct && controlActions.has(direct)) return direct;
    // Same overlay-proofing as the seek line: find our button beneath a
    // covering page layer at the click point.
    if (typeof x === "number" && typeof y === "number" && document.elementsFromPoint) {
      for (const element of document.elementsFromPoint(x, y)) {
        const button = element?.closest?.(".ignow-video-controls button");
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
      if (!element?.closest?.(".ignow-video-controls")) return;
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
    Promise.resolve(action()).catch(error => {
      console.warn("IG-Now video control action failed:", error);
    });
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
      || (elementFromTarget(event.target)?.closest?.(".ignow-video-controls"));
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
    if (!elementFromTarget(event.target)?.closest?.(".ignow-video-controls")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = controlButtonFromTarget(event.target, event.clientX, event.clientY);
    if (button) runControlAction(button); // keyboard clicks (Enter/Space) land here
  }, true);

  window.addEventListener("dblclick", event => {
    if (!elementFromTarget(event.target)?.closest?.(".ignow-video-controls")) return;
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
    const rect = image.getBoundingClientRect();
    const hasPostContext = Boolean(image.closest("article, [role=dialog]"));
    return (hasPostContext || (rect.width >= 260 && rect.height >= 260))
      && rect.width >= 120
      && rect.height >= 120
      && !image.closest("header, nav, aside");
  }

  function isPostVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    const rect = video.getBoundingClientRect();
    const hasPostContext = Boolean(video.closest("article, [role=dialog]"));
    return (hasPostContext || (rect.width >= 260 && rect.height >= 260))
      && rect.width >= 120
      && rect.height >= 120
      && !video.closest("header, nav, aside");
  }

  function mediaFromTarget(target) {
    const element = elementFromTarget(target);
    const media = element?.closest?.("img, video");
    if (media instanceof HTMLImageElement && isPostImage(media)) return media;
    if (media instanceof HTMLVideoElement && isPostVideo(media)) return media;
    return null;
  }

  function mediaAtPoint(x, y) {
    const elements = document.elementsFromPoint?.(x, y) || [];
    for (const element of elements) {
      const media = mediaFromTarget(element);
      if (media) return media;
    }

    const article = elements.find(element => element.closest?.("article"))?.closest?.("article");
    if (!article) return null;
    const candidates = article.querySelectorAll("img, video");
    for (const media of candidates) {
      const rect = media.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        if (media instanceof HTMLImageElement && isPostImage(media)) return media;
        if (media instanceof HTMLVideoElement && isPostVideo(media)) return media;
      }
    }
    return null;
  }

  window.addEventListener("pointerdown", event => {
    if (elementFromTarget(event.target)?.closest?.(".ignow-video-controls")) return;
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
    if (level < 0.34) return "\uD83D\uDD08"; // speaker with one wave
    if (level < 0.67) return "\uD83D\uDD09"; // speaker with medium waves
    return "\uD83D\uDD0A";                    // speaker with three waves
  }

  function applyDefaultVideoAudio(video) {
    if (!(video instanceof HTMLVideoElement)) return;
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

  function activateVideoAudio(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    try {
      state.videoAudioUnlocked = true;
      // An element the user explicitly muted stays muted — auto-unlock must
      // never override the user's own volume-button choice.
      if (video.dataset.ignowAudioUserActivated === "1") return;
      video.volume = defaultVolumeForVideo(video);
      setVideoMuted(video, false);
      video.dataset.ignowAudioUserActivated = "1";
      video.dataset.ignowMutedByIgnow = "";
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
      if (!/^\/(?:p|reel|reels|tv)\/[^/?#]+/i.test(url.pathname)) return "";
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
      if (links.length === 1) return links[0].url;
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

  function videoUrlsFromText(text) {
    const matches = normalizeMediaUrl(text).match(/https?:\/\/[^"'\s]+/g) || [];
    return Array.from(new Set(matches.reverse().filter(url => /^https?:\/\//i.test(url)
      && !isLikelyMediaSegment(url)
      && (/\.mp4(?:[?#]|$)/i.test(url) || /\/v\/t50\./i.test(url)))));
  }

  function mediaUrlsFromResources(media) {
    const isVideo = media instanceof HTMLVideoElement;
    const resources = performance.getEntriesByType("resource")
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
      .filter(url => !isVideo || !isLikelyMediaSegment(url));
    return Array.from(new Set(resources.reverse()));
  }

  async function mediaUrlFromPost(postUrl) {
    if (!postUrl) return "";
    try {
      const response = await fetch(postUrl, { credentials: "include" });
      if (!response.ok) return "";
      const html = await response.text();
      const documentFragment = new DOMParser().parseFromString(html, "text/html");
      const metadataUrls = Array.from(documentFragment.querySelectorAll(
        "meta[property='og:video'], meta[property='og:video:secure_url'], meta[property='og:video:url']"
      )).map(meta => normalizeMediaUrl(meta.content));
      return [...metadataUrls, ...videoUrlsFromText(html)]
        .find(url => /^https?:\/\//i.test(url)
          && !isLikelyMediaSegment(url)
          && (/\.mp4(?:[?#]|$)/i.test(url) || /\/v\/t50\./i.test(url))) || "";
    } catch (error) {
      console.warn("IG-Now could not inspect the Instagram post link:", error);
      return "";
    }
  }

  async function mediaUrlsFromNetworkData(media) {
    if (!(media instanceof HTMLVideoElement)) return [];
    const networkUrls = Array.from(new Set(performance.getEntriesByType("resource")
      .map(entry => entry.name)
      .filter(url => /^https?:\/\//i.test(url)
        && url.startsWith(window.location.origin)
        && /\/(?:api|graphql|ajax|reels?|feed|web)\//i.test(url))
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

  async function mediaUrlCandidates(media) {
    const directUrl = sourceUrl(media);
    const candidates = [];
    const addCandidate = url => {
      if (!url || candidates.includes(url)) return;
      candidates.push(url);
    };

    if (media instanceof HTMLVideoElement) {
      (await mediaUrlsFromNetworkData(media)).forEach(addCandidate);
      addCandidate(await mediaUrlFromPost(postUrlForMedia(media)));
      mediaUrlsFromResources(media).forEach(addCandidate);
      addCandidate(directUrl);
    } else {
      addCandidate(directUrl);
      mediaUrlsFromResources(media).forEach(addCandidate);
      addCandidate(await mediaUrlFromPost(postUrlForMedia(media)));
    }
    return candidates;
  }

  async function resolveMediaUrl(media) {
    return (await mediaUrlCandidates(media))[0] || "";
  }

  function openDefaultBrowser(url) {
    if (!/^https?:\/\//i.test(url || "")) return;
    if (typeof invoke === "function") {
      invoke("open_external_url", { url }).catch(() => {
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

  async function saveBytesInApp(buffer, kind) {
    if (typeof invoke !== "function") throw new Error("IG-Now native bridge is unavailable.");
    const bytes = Array.from(new Uint8Array(buffer));
    return invoke("save_media_bytes", { data: bytes, mediaType: kind });
  }

  async function downloadFromSignedInPage(url, kind) {
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
    return saveBytesInApp(buffer, kind);
  }

  async function openCobaltWeb(media) {
    const postUrl = postUrlForMedia(media);
    if (!postUrl) {
      showToast("Instagram did not expose a post link. Use More > Copy link, then open cobalt.tools.");
      return;
    }

    try {
      await navigator.clipboard?.writeText(postUrl);
    } catch (error) {
      console.warn("IG-Now could not copy the Instagram post link:", error);
    }

    let downloadFolder = "your Downloads/IG-Now folder";
    if (typeof invoke === "function") {
      try {
        downloadFolder = await invoke("prepare_download_folder");
      } catch (error) {
        console.warn("IG-Now could not prepare the download folder:", error);
      }
    }

    const cobaltUrl = `https://cobalt.tools/?u=${encodeURIComponent(postUrl)}`;
    openDefaultBrowser(cobaltUrl);
    showToast(`Copied the post link and opened Cobalt. Choose Save and use ${downloadFolder}.`);
  }

  async function saveMedia(media) {
    const kind = media instanceof HTMLVideoElement ? "video" : "image";
    if (kind === "video") {
      await openCobaltWeb(media);
      return;
    }

    const postUrl = postUrlForMedia(media);
    const referer = postUrl || "https://www.instagram.com/";

    const sources = await mediaUrlCandidates(media);
    if (!sources.length) {
      showToast("Instagram did not expose a direct image URL; try opening the post in your browser.");
      return;
    }

    if (typeof invoke === "function") {
      for (const source of sources) {
        if (/^https?:\/\//i.test(source)) {
          try {
            const savedPath = await invoke("download_media", {
              url: source,
              mediaType: kind,
              referer
            });
            showToast(`Saved ${kind} to ${savedPath}`);
            return;
          } catch (error) {
            console.warn("IG-Now native URL media download failed; trying the next source:", error);
          }
        }
        try {
          const savedPath = await downloadFromSignedInPage(source, kind);
          showToast(`Saved ${kind} to ${savedPath}`);
          return;
        } catch (error) {
          console.warn("IG-Now signed-in media save failed; trying the next source:", error);
        }
      }
    }

    showToast("Instagram blocked this image download. Open the post in your browser and try again.");
  }

  async function openMediaInBrowser(media) {
    const postUrl = postUrlForMedia(media);
    if (postUrl) {
      openDefaultBrowser(postUrl);
      return;
    }
    const currentReelUrl = normalizeInstagramPostUrl(window.location.href);
    if (currentReelUrl) {
      openDefaultBrowser(currentReelUrl);
      return;
    }
    const mediaUrl = await resolveMediaUrl(media);
    if (mediaUrl) {
      openDefaultBrowser(mediaUrl);
      return;
    }
    showToast("IG-Now could not resolve the exact video post link.");
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
    items.forEach(({ label, action }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        await action();
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

    toolbar.append(saveButton, zoomOut, zoomInput, zoomLabel, zoomIn, reset, close);

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

  function closeInstagramVideo() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch?.(() => {});
      return true;
    }

    const closeButton = Array.from(document.querySelectorAll("button, [role=button]"))
      .find(button => isVisible(button) && /close|dismiss|back/i.test(
        `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`
      ));
    if (closeButton) {
      closeButton.click();
      return true;
    }

    const path = window.location.pathname;
    if (/^\/(reel|reels)(\/|$)/i.test(path)) {
      window.location.href = "https://www.instagram.com/";
      return true;
    }

    if (document.querySelector("[role=dialog]")) {
      if (window.history.length > 1) window.history.back();
      else window.location.href = "https://www.instagram.com/";
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
            ? "Copy link and open Cobalt"
            : "Save image to your Downloads/IG-Now folder",
          action: () => saveMedia(media)
        },
        {
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
      videoControllers.get(video)?.refresh?.();
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
    const volumeButton = createButton("\uD83D\uDD0A", "Mute video (drag or hover for volume slider)");
    volumeButton.className = "ignow-video-controls__volume";
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
    if (!video.paused && isStandaloneVideo(video)) {
      if (state.videoAudioUnlocked) activateVideoAudio(video);
      pauseOtherVideos(video);
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
    const sync = () => {
      // The seek line's aria-label is CONSTANT — set it once (below), not on
      // every timeupdate (~4×/s per video): sync must not write attributes
      // that never change (v2.1.0 perf fix).
      applyDefaultVideoAudio(video);
      const duration = effectiveDuration();
      const progress = duration > 0
        ? Math.max(0, Math.min(1, video.currentTime / duration))
        : 0;
      progressLine.value = String(progress * 100);
      progressLine.style.setProperty("--ignow-progress", `${progress * 100}%`);
      progressLine.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
      elapsedLabel.textContent = formatVideoTime(video.currentTime);
      totalLabel.textContent = formatVideoTime(duration);
      playButton.textContent = video.paused ? "\u25B6" : "\u23F8";
      playButton.title = video.paused ? "Play video" : "Pause video";
      playButton.setAttribute("aria-label", playButton.title);
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
    const volumeSliderSync = () => {
      const level = video.muted ? 0 : video.volume;
      const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
      volumeSlider.value = String(pct);
      volumeSlider.setAttribute("aria-valuenow", String(pct));
      volumeSlider.setAttribute("aria-valuetext", `${pct}%`);
      volumeSlider.style.setProperty("--ignow-volume", `${pct}%`);
    };
    const syncVolume = () => {
      const muted = video.muted;
      volumeButton.textContent = muted ? "\uD83D\uDD07" : audibleIconForVolume(video.volume);
      volumeButton.title = muted ? "Unmute video" : "Mute video";
      volumeButton.setAttribute("aria-label", volumeButton.title);
      volumeButton.setAttribute("aria-pressed", String(!muted));
      volumeButton.classList.toggle("ignow-video-controls__volume--muted", muted);
      volumeSliderSync();
    };
    controlActions.set(volumeButton, () => {
      state.activeVideo = video;
      try {
        // Route through setVideoMuted: the muted setter fires `volumechange`
        // SYNCHRONOUSLY, and without the suppression flag our own guard would
        // revert this assignment before the bookkeeping below runs (that was
        // the "muted icon but sound keeps playing" bug).
        setVideoMuted(video, !video.muted);
        markAudioUserControlled(video);
        if (!video.muted) {
          state.videoAudioUnlocked = true;
          video.dataset.ignowMutedByIgnow = "";
          if (video.volume < 0.1) video.volume = defaultVolumeForVideo(video);
          if (video.paused && !isSearchCardVideo(video)) video.play().catch(() => {});
        } else {
          video.dataset.ignowMutedByIgnow = "1";
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
      updateCompactMode();
      sync();
    });
    video.addEventListener("durationchange", sync);
    video.addEventListener("playing", updateCompactMode);
    video.addEventListener("volumechange", () => {
      try {
        // BIDIRECTIONAL guard (v2.1.0): once the USER has taken control of
        // this element's audio, Instagram's player may neither re-mute it
        // (the old fight-back) nor silently UNMUTE it after the user pressed
        // our mute button (observed in the field: the reel kept playing sound
        // with a muted icon — the player controller un-muted right back).
        // IG-Now's own assignments are exempt via the suppression flag, and
        // site-muted neighbours / untouched autoplay elements are never
        // touched.
        if (!state.volumeGuardSuppressed && !isSearchCardVideo(video)) {
          const userControlled = video.dataset.ignowAudioUserActivated === "1";
          if (userControlled) {
            if (video.muted && video.dataset.ignowMutedByIgnow !== "1") {
              video.muted = false; // page re-muted what the user had unmuted
            } else if (!video.muted && video.dataset.ignowMutedByIgnow === "1") {
              video.muted = true; // page un-muted what the user had muted
            }
          }
        }
      } catch (error) {
        console.warn("IG-Now could not keep the video audio as the user set it:", error);
      }
      // Mirror ALWAYS: this event fires for every source — our mute button,
      // our slider, Instagram's native vertical slider, the page player —
      // so the icon + track can never drift from the audible state. This is
      // the "synchronize the volume control" core (v2.1.0).
      syncVolume();
    });
    video.addEventListener("play", () => {
      const isSearchCardHovered = host.matches(":hover") || video.matches(":hover");
      if (isSearchCardVideo(video) && !isSearchCardHovered) {
        video.pause();
        return;
      }
      if (state.videoAudioUnlocked && isStandaloneVideo(video)) activateVideoAudio(video);
      pauseOtherVideos(video);
      state.activeVideo = video;
      sync();
    });
    video.addEventListener("pause", sync);
    syncVolume();
    sync();
  }

  function scanVideos() {
    document.querySelectorAll("video").forEach(installNativeVideoControls);
  }

  function observeVideoChanges() {
    if (!document.documentElement) return;
    scanVideos();

    let scanTimer = null;
    const scheduleScan = () => {
      if (scanTimer !== null) return;
      scanTimer = window.setTimeout(() => {
        scanTimer = null;
        scanVideos();
      }, 120);
    };
    const nodeContainsVideo = node => {
      if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return false;
      return (node instanceof Element && node.matches("video"))
        || Boolean(node.querySelector("video"));
    };

    new MutationObserver(mutations => {
      const videoWasAdded = mutations.some(mutation => mutation.type === "childList"
        && Array.from(mutation.addedNodes).some(nodeContainsVideo));
      if (videoWasAdded) scheduleScan();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    let lastRoute = window.location.href;
    window.setInterval(() => {
      const currentRoute = window.location.href;
      if (currentRoute === lastRoute) return;
      lastRoute = currentRoute;
      scheduleScan();
    }, 500);
  }

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
        setVideoMuted(_ignowMutedVideo, _ignowMutedByHide);
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
