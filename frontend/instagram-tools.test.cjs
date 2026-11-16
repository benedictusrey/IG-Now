const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "instagram-tools.js"), "utf8");

function setRect(el, rect) {
  el.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top
  });
}

function createFixture(urlPath = "/reels/C9xTestReel/", { showComments = false, overflowHidden = false } = {}) {
  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <div class="sidebar-shell" data-ignow-sidebar>
          <nav aria-label="Main">
            <a href="/"><span>Home</span></a>
            <a href="/reels/"><span>Reels</span></a>
          </nav>
          <!-- Live Instagram puts More + Also from Meta outside nav in a sibling cluster -->
          <div class="bottom-nav">
            <div class="more-row">
              <div role="button" tabindex="0">
                <svg aria-label="Settings"><title>Settings</title><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                <span>More</span>
              </div>
            </div>
            <div class="meta-row"><a href="#meta"><span>Also from Meta</span></a></div>
          </div>
        </div>
        <main>
          <div class="stage-outer" style="overflow-x:${overflowHidden ? "hidden" : "visible"}">
            <article data-ignow-media-stage>
              <a href="/creator_one/">creator_one</a>
              <div class="video-wrap">
                <video width="420" height="720"></video>
              </div>
              <h1 data-ignow-caption>Golden hour across Tokyo streets</h1>
            </article>
            <!-- Real Instagram Reel right-side action bar with Comment icon button -->
            <div class="reel-actions" style="width:260px;height:400px">
              <button type="button" aria-label="Comment"><svg aria-label="Comment"></svg><span>7</span></button>
            </div>
          </div>
          ${showComments ? `
          <div class="popper-ancestor" style="transform: translate3d(10px, 20px, 0)">
            <div role="dialog" id="comments-popup" aria-label="Comments">
              <div><span>Comments</span></div>
              <textarea placeholder="Add a comment..."></textarea>
              <button type="button" aria-label="Close">Close</button>
            </div>
          </div>` : ""}
        </main>
      </body>
    </html>
  `;

  const dom = new JSDOM(html, {
    url: `https://www.instagram.com${urlPath}`,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  const win = dom.window;
  Object.defineProperty(win, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: 900, configurable: true });
  win.document.hasFocus = () => true;

  const calls = [];
  const openedUrls = [];
  win.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "download_media") {
          return `C:\\Users\\Test\\Downloads\\IG-Now\\${args.subfolder ? args.subfolder + "\\" : ""}${args.fileStem || "file"}.${args.mediaType === "video" ? "mp4" : "jpg"}`;
        }
        if (command === "save_media_bytes") {
          const ext = args.mediaType === "json" ? "json" : "txt";
          return `C:\\Users\\Test\\Downloads\\IG-Now\\${args.subfolder ? args.subfolder + "\\" : ""}${args.fileStem || "file"}.${ext}`;
        }
        if (command === "open_external_url") {
          openedUrls.push(args.url);
        }
        return "";
      }
    }
  };
  win.open = url => { openedUrls.push(url); };

  const sidebar = win.document.querySelector(".sidebar-shell");
  const nav = win.document.querySelector("nav");
  const moreRow = win.document.querySelector(".more-row [role='button']");
  const stage = win.document.querySelector("[data-ignow-media-stage]");
  const video = win.document.querySelector("video");
  const actions = win.document.querySelector(".reel-actions");
  setRect(sidebar, { left: 0, top: 0, width: 220, height: 900 });
  setRect(nav, { left: 0, top: 0, width: 220, height: 600 });
  setRect(moreRow, { left: 12, top: 760, width: 196, height: 48 });
  setRect(stage, { left: 430, top: 60, width: 420, height: 740 });
  setRect(video, { left: 430, top: 60, width: 420, height: 740 });
  setRect(actions, { left: 860, top: 420, width: 260, height: 400 });

  const popup = win.document.getElementById("comments-popup");
  if (popup) setRect(popup, { left: 450, top: 140, width: 360, height: 520 });

  // Attach React hook state (memoizedState) instead of just memoizedProps, matching Instagram Comet Reels.
  video.__reactFiber$test123 = {
    memoizedProps: {},
    memoizedState: {
      memoizedState: {
        media: {
          code: "C9xTestPost",
          pk: "3456789012345678901",
          user: { username: "creator_one" },
          caption: { text: "Golden hour across Tokyo streets #tokyo" },
          carousel_media: [
            {
              video_versions: [
                { url: "https://cdn.instagram.com/v/low.mp4", width: 480, height: 854 },
                { url: "https://cdn.instagram.com/v/hd.mp4", width: 1080, height: 1920 }
              ]
            },
            {
              image_versions2: {
                candidates: [
                  { url: "https://cdn.instagram.com/v/slide2.jpg", width: 1080, height: 1350 }
                ]
              }
            }
          ]
        }
      },
      next: null
    },
    return: null
  };

  win.eval(source);
  return { dom, win, calls, openedUrls, video, stage, popup };
}

test("resolves Instaloader shortcode-to-media-id math accurately", () => {
  const f = createFixture("/reels/C9xTestPost/");
  try {
    const id = f.win.__ignowTools.shortcodeToMediaId("B_k12345678");
    assert(id.length > 0);
    assert.equal(f.win.__ignowTools.mediaIdToShortcode(id), "B_k12345678");
  } finally {
    f.dom.window.close();
  }
});

test("downloads video natively from React hook memoizedState without redirecting to Cobalt", async () => {
  const f = createFixture("/reels/C9xTestPost/");
  try {
    const savedPath = await f.win.__ignowTools.saveMedia(f.video);
    assert(savedPath.endsWith(".mp4"));
    const downloadCall = f.calls.find(c => c.command === "download_media");
    assert(downloadCall, "download_media should be invoked");
    assert.equal(downloadCall.args.mediaType, "video");
    assert.equal(downloadCall.args.url, "https://cdn.instagram.com/v/hd.mp4");
    assert.match(
      downloadCall.args.fileStem,
      /^creator_one-\d{8}-[0-9a-f]{8}$/,
      `expected source_username-date-hash stem, got ${downloadCall.args.fileStem}`
    );
    assert.equal(f.openedUrls.some(u => /cobalt\.tools/i.test(u)), false, "must never open Cobalt");
  } finally {
    f.dom.window.close();
  }
});

test("opens native IG-Now Downloader window with post URL and cached payload instead of injecting IG website modal", async () => {
  const f = createFixture("/reels/C9xTestPost/");
  try {
    const dlBtn = f.win.document.querySelector(".ignow-sidebar-downloader");
    assert(dlBtn, "Downloader sidebar button must exist");
    dlBtn.click();
    await new Promise(resolve => setTimeout(resolve, 40));

    assert.equal(f.win.document.querySelector(".ignow-downloader-card"), null, "must not inject modal overlay into instagram.com");
    const openCall = f.calls.find(c => c.command === "open_downloader_window");
    assert(openCall, "must invoke open_downloader_window");
    assert.equal(openCall.args.url, "https://www.instagram.com/reels/C9xTestPost/");
    assert(openCall.args.payloadJson && openCall.args.payloadJson.includes("C9xTestPost"), "must forward cached raw node payload");
  } finally {
    f.dom.window.close();
  }
});

test("passes paired DASH audioUrl to download_media when post node uses video_dash_manifest", async () => {
  const f = createFixture("/reels/C9xDashPost/");
  try {
    f.video.__reactFiber$test = {
      memoizedProps: {},
      memoizedState: {
        memoizedState: {
          media: {
            code: "C9xDashPost",
            user: { username: "dash_creator" },
            caption: { text: "DASH reel" },
            video_dash_manifest: '<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation bandwidth="2400000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/dash_1080.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation bandwidth="128000"><BaseURL>https://cdn.instagram.com/v/dash_audio.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>'
          }
        },
        next: null
      },
      return: null
    };

    const savedPath = await f.win.__ignowTools.saveMedia(f.video);
    assert(savedPath.endsWith(".mp4"));
    const dlCall = f.calls.find(c => c.command === "download_media");
    assert(dlCall, "must invoke download_media");
    assert.equal(dlCall.args.url, "https://cdn.instagram.com/v/dash_1080.mp4");
    assert.equal(dlCall.args.audioUrl, "https://cdn.instagram.com/v/dash_audio.m4a");
  } finally {
    f.dom.window.close();
  }
});

test("probes signed-in post metadata for Downloader window via submit_downloader_probe", async () => {
  const f = createFixture("/reels/");
  try {
    f.win.fetch = async url => {
      if (String(url).includes("/api/v1/media/")) {
        return {
          ok: true,
          url: String(url),
          headers: { get: () => "application/json" },
          text: async () => JSON.stringify({
            items: [{
              code: "C9xApiPost",
              user: { username: "instaloader_user" },
              caption: { text: "Saved through Instaloader API engine" },
              video_versions: [
                { url: "https://cdn.instagram.com/v/api_hd.mp4", width: 1080, height: 1920 }
              ]
            }]
          })
        };
      }
      return { ok: false, status: 404, text: async () => "" };
    };

    await f.win.__ignowTools.probePostForDownloader("probe-99", "https://www.instagram.com/reel/C9xApiPost/");
    const probeCall = f.calls.find(c => c.command === "submit_downloader_probe");
    assert(probeCall, "must invoke submit_downloader_probe");
    assert.equal(probeCall.args.requestId, "probe-99");
    assert(probeCall.args.payloadJson.includes("api_hd.mp4"));
  } finally {
    f.dom.window.close();
  }
});

test("injects Downloader, Forward, and Back buttons directly above More even when More is outside nav", () => {
  const f = createFixture("/");
  try {
    f.win.history.pushState({}, "", "/explore/");
    const backBtn = f.win.document.querySelector(".ignow-sidebar-back");
    const fwdBtn = f.win.document.querySelector(".ignow-sidebar-forward");
    const dlBtn = f.win.document.querySelector(".ignow-sidebar-downloader");
    const moreRow = f.win.document.querySelector(".more-row");
    assert(backBtn, "Back button must be injected");
    assert(fwdBtn, "Forward button must be injected");
    assert(dlBtn, "Downloader button must be injected");
    assert.equal(dlBtn.nextElementSibling, fwdBtn, "Downloader sits above Forward");
    assert.equal(fwdBtn.nextElementSibling, backBtn, "Forward sits above Back");
    assert.equal(backBtn.nextElementSibling, moreRow, "Back button sits directly above More");
    assert.equal(backBtn.getAttribute("aria-disabled"), "false");
    assert.equal(fwdBtn.getAttribute("aria-disabled"), "true");

    let backCalls = 0;
    let forwardCalls = 0;
    f.win.history.back = () => { backCalls += 1; };
    f.win.history.forward = () => { forwardCalls += 1; };

    // Clicking disabled Forward at head of history is a no-op
    fwdBtn.click();
    assert.equal(forwardCalls, 0);

    backBtn.click();
    assert.equal(backCalls, 1);
    assert.equal(fwdBtn.getAttribute("aria-disabled"), "false", "Forward enables after stepping back");

    fwdBtn.click();
    assert.equal(forwardCalls, 1);
    assert.equal(fwdBtn.getAttribute("aria-disabled"), "true", "Forward disables again at head of history");

    f.win.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true }));
    assert.equal(backCalls, 2);

    f.win.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    assert.equal(forwardCalls, 2);
  } finally {
    f.dom.window.close();
  }
});

test("preserves original Instagram Comments panel without shifting stage or external action icons", () => {
  const open = createFixture("/reels/C9xTestPost/", { showComments: true });
  try {
    open.win.dispatchEvent(new open.win.Event("resize"));
    assert.equal(open.popup.classList.contains("ignow-comments-docked-panel"), false, "must leave native IG comments panel unmodified");
    assert.equal(open.stage.classList.contains("ignow-media-shifted-for-comments"), false, "must never translate or displace video stage");
    assert.equal(open.win.document.querySelectorAll(".ignow-media-shifted-for-comments").length, 0, "must never displace external action icons");
    assert.equal(open.win.document.querySelectorAll(".ignow-comments-portal-ancestor").length, 0, "must not strip portal transforms");
  } finally {
    open.dom.window.close();
  }
});

test("Esc returns to pre-click view via svg Close or history.back instead of dumping to Home", () => {
  const f = createFixture("/reel/C9xPreClickTest/");
  try {
    f.win.history.pushState({}, "", "/some_creator/");
    f.win.history.pushState({}, "", "/reel/C9xPreClickTest/");
    let backCalls = 0;
    f.win.history.back = () => { backCalls += 1; };

    f.win.document.body.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(backCalls, 1, "Esc on clicked Reel route must step back to pre-click view");

    // Also test child svg[aria-label="Close"] button takes priority when present
    const closeBtn = f.win.document.createElement("div");
    closeBtn.setAttribute("role", "button");
    closeBtn.innerHTML = '<svg aria-label="Close"></svg>';
    setRect(closeBtn, { left: 1200, top: 24, width: 32, height: 32 });
    let closeClicked = false;
    closeBtn.addEventListener("click", () => { closeClicked = true; });
    f.win.document.body.appendChild(closeBtn);

    f.win.document.body.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(closeClicked, true, "Esc must detect Instagram close button with child svg[aria-label='Close']");
  } finally {
    f.dom.window.close();
  }
});

test("video control bar download icon opens native Downloader window to auto-inspect", async () => {
  const f = createFixture("/reels/C9xIconOpen/");
  try {
    const dlIcon = f.win.document.querySelector(".ignow-video-controls__download");
    assert(dlIcon, "video download icon button must exist");
    dlIcon.click();
    await new Promise(resolve => setTimeout(resolve, 40));

    assert(
      f.calls.some(c => c.command === "open_downloader_window" && c.args.url.includes("C9xIconOpen")),
      "clicking video download icon must open native Downloader window with video URL"
    );
    assert.equal(
      f.calls.some(c => c.command === "download_media"),
      false,
      "clicking video download icon must not silently trigger raw download_media"
    );
  } finally {
    f.dom.window.close();
  }
});

test("foreground audio recovery unmutes active video while respecting explicit user mute", () => {
  const f = createFixture("/reels/C9xAudio/");
  try {
    Object.defineProperty(f.video, "paused", { value: false, configurable: true });
    f.video.muted = true;
    f.video.volume = 0.05;
    assert.equal(f.win.__ignowEnsureForegroundAudio(), "unmuted:1");
    assert.equal(f.video.muted, false);
    assert(f.video.volume >= 0.4);

    // Unfocused window behind another app does not trigger foreground audio unmute
    f.win.document.hasFocus = () => false;
    assert.equal(f.win.__ignowEnsureForegroundAudio(), "hidden");
    f.win.document.hasFocus = () => true;

    // Explicit user mute remains muted
    f.video.muted = true;
    f.video.dataset.ignowMutedByIgnow = "1";
    assert.equal(f.win.__ignowEnsureForegroundAudio(), "ok");
    assert.equal(f.video.muted, true);
  } finally {
    f.dom.window.close();
  }
});

test("mute/unmute icon accurately reflects muted=true, volume=0, and external native mute clicks", () => {
  const f = createFixture("/reels/C9xMuteSync/");
  try {
    const volBtn = f.win.document.querySelector(".ignow-video-controls__volume");
    assert(volBtn, "volume button must exist");

    f.video.muted = false;
    f.video.volume = 0.5;
    f.video.dispatchEvent(new f.win.Event("volumechange"));
    assert.equal(volBtn.dataset.ignowMutedState, "audible");

    // Zero volume even with muted=false must display muted icon
    f.video.volume = 0;
    f.video.dispatchEvent(new f.win.Event("volumechange"));
    assert.equal(volBtn.dataset.ignowMutedState, "muted");

    // Restoring volume displays audible icon again
    f.video.volume = 0.6;
    f.video.dispatchEvent(new f.win.Event("volumechange"));
    assert.equal(volBtn.dataset.ignowMutedState, "audible");

    // Clicking a native Instagram corner mute button does not trigger automatic unmute fight-back
    const igCornerMute = f.win.document.createElement("button");
    igCornerMute.setAttribute("aria-label", "Audio is playing");
    setRect(igCornerMute, { left: 710, top: 680, width: 32, height: 32 });
    let cornerState = "playing";
    igCornerMute.addEventListener("click", () => {
      cornerState = cornerState === "playing" ? "muted" : "playing";
      igCornerMute.setAttribute("aria-label", cornerState === "muted" ? "Audio is muted" : "Audio is playing");
      f.video.muted = cornerState === "muted";
      f.video.dispatchEvent(new f.win.Event("volumechange"));
    });
    f.stage.appendChild(igCornerMute);

    // 1) Left IG-Now button clicks -> syncs right IG native button
    volBtn.click();
    assert.equal(volBtn.dataset.ignowMutedState, "muted");
    assert.equal(f.video.muted, true);
    assert.equal(igCornerMute.getAttribute("aria-label"), "Audio is muted", "right native icon must sync to muted when left button mutes");

    // 2) Right IG native button clicks -> syncs left IG-Now button cleanly with zero fight-back
    igCornerMute.dispatchEvent(new f.win.MouseEvent("pointerdown", { button: 0, bubbles: true }));
    igCornerMute.click();
    assert.equal(f.video.muted, false, "native corner unmute click must not be reverted by IG-Now");
    assert.equal(volBtn.dataset.ignowMutedState, "audible", "left IG-Now icon must sync to audible");

    // 3) Left IG-Now button unmutes cleanly after native corner mute
    igCornerMute.dispatchEvent(new f.win.MouseEvent("pointerdown", { button: 0, bubbles: true }));
    igCornerMute.click();
    assert.equal(volBtn.dataset.ignowMutedState, "muted");
    volBtn.click();
    assert.equal(f.video.muted, false);
    assert.equal(volBtn.dataset.ignowMutedState, "audible");
    assert.equal(igCornerMute.getAttribute("aria-label"), "Audio is playing", "right native icon must sync to playing when left button unmutes");
  } finally {
    f.dom.window.close();
  }
});

test("sidebar Back, Forward, and Downloader buttons adapt cleanly to light and dark surfaces", () => {
  const f = createFixture("/reels/C9xTestPost/");
  try {
    f.win.document.body.style.backgroundColor = "rgb(255, 255, 255)";
    const moreSpan = f.win.document.querySelector(".more-row span");
    moreSpan.style.color = "rgb(15, 20, 25)";
    f.win.__ignowTools.installSidebarBackButton();
    const backBtn = f.win.document.querySelector(".ignow-sidebar-back");
    const fwdBtn = f.win.document.querySelector(".ignow-sidebar-forward");
    const dlBtn = f.win.document.querySelector(".ignow-sidebar-downloader");
    assert.equal(backBtn.style.color, "rgb(15, 20, 25)");
    assert.equal(fwdBtn.style.color, "rgb(15, 20, 25)");
    assert.equal(dlBtn.style.color, "rgb(15, 20, 25)");
  } finally {
    f.dom.window.close();
  }
});

test("Toggle audio corner button syncs via SVG geometry when aria-label is static", () => {
  const f = createFixture("/reels/C9xToggleAudio/");
  try {
    const volBtn = f.win.document.querySelector(".ignow-video-controls__volume");
    const igCornerMute = f.win.document.createElement("button");
    igCornerMute.setAttribute("aria-label", "Toggle audio");
    setRect(igCornerMute, { left: 710, top: 680, width: 32, height: 32 });
    const renderSvg = muted => muted
      ? '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
    let cornerMuted = false;
    igCornerMute.innerHTML = renderSvg(cornerMuted);
    igCornerMute.addEventListener("click", () => {
      cornerMuted = !cornerMuted;
      igCornerMute.innerHTML = renderSvg(cornerMuted);
      f.video.muted = cornerMuted;
      f.video.dispatchEvent(new f.win.Event("volumechange"));
    });
    f.stage.appendChild(igCornerMute);

    f.video.muted = false;
    f.video.volume = 0.5;
    volBtn.click();
    assert.equal(f.video.muted, true);
    assert.equal(volBtn.dataset.ignowMutedState, "muted");
    assert.equal(igCornerMute.querySelectorAll("line").length, 2, "static-label corner SVG must switch to muted cross lines");

    volBtn.click();
    assert.equal(f.video.muted, false);
    assert.equal(volBtn.dataset.ignowMutedState, "audible");
    assert.equal(igCornerMute.querySelectorAll("line").length, 0, "static-label corner SVG must switch back to audible wave paths");
  } finally {
    f.dom.window.close();
  }
});

test("reused Reel video element clears stale mute state when src changes", () => {
  const f = createFixture("/reels/C9xReuse/");
  try {
    const volBtn = f.win.document.querySelector(".ignow-video-controls__volume");
    f.video.src = "https://scontent.cdninstagram.com/v/reel1.mp4";
    Object.defineProperty(f.video, "paused", { value: false, configurable: true });
    f.video.dispatchEvent(new f.win.Event("play"));
    assert.equal(f.video.muted, false);

    // Mute Reel 1 explicitly
    volBtn.click();
    assert.equal(f.video.muted, true);
    assert.equal(f.video.dataset.ignowMutedByIgnow, "1");

    // Instagram swaps src on the same DOM <video> for Reel 2
    f.video.src = "https://scontent.cdninstagram.com/v/reel2.mp4";
    f.video.dispatchEvent(new f.win.Event("play"));
    assert.equal(f.video.dataset.ignowMutedByIgnow, "");
    assert.equal(f.video.muted, false, "new Reel on reused <video> must unmute automatically in foreground");
  } finally {
    f.dom.window.close();
  }
});

test("floating sidebar fallback mounts cleanly without throwing when More row is absent", () => {
  const f = createFixture("/reels/C9xNoMore/");
  try {
    f.win.document.querySelector(".bottom-nav")?.remove();
    f.win.document.querySelector(".ignow-sidebar-back")?.remove();
    f.win.document.querySelector(".ignow-sidebar-forward")?.remove();
    f.win.document.querySelector(".ignow-sidebar-downloader")?.remove();

    assert.doesNotThrow(() => f.win.__ignowTools.installSidebarBackButton());
    const floating = f.win.document.querySelector(".ignow-sidebar-floating-nav");
    assert(floating, "floating nav container must mount when More row is absent");
    const dlBtn = floating.querySelector(".ignow-sidebar-downloader");
    const fwdBtn = floating.querySelector(".ignow-sidebar-forward");
    const backBtn = floating.querySelector(".ignow-sidebar-back");
    assert(dlBtn, "Downloader button must mount in floating fallback");
    assert(fwdBtn, "Forward button must mount in floating fallback");
    assert(backBtn, "Back button must mount in floating fallback");
    assert.equal(dlBtn.nextElementSibling, fwdBtn, "Downloader sits above Forward in floating fallback");
    assert.equal(fwdBtn.nextElementSibling, backBtn, "Forward sits above Back in floating fallback");
  } finally {
    f.dom.window.close();
  }
});

test("foreground audio recovery preserves explicit user zero-volume slider level", () => {
  const f = createFixture("/reels/C9xZeroVol/");
  try {
    Object.defineProperty(f.video, "paused", { value: false, configurable: true });
    f.video.muted = false;
    f.video.volume = 0;
    f.video.dataset.ignowAudioUserActivated = "1";
    assert.equal(f.win.__ignowEnsureForegroundAudio(), "ok");
    assert.equal(f.video.volume, 0, "explicit user zero-volume must not be overwritten on focus");
  } finally {
    f.dom.window.close();
  }
});

test("Esc closes About overlay via __ignowClose lifecycle hook without leaking styles or listeners", () => {
  const f = createFixture("/reels/C9xAboutEsc/");
  try {
    const about = f.win.document.createElement("div");
    about.id = "__ignow_about";
    let closedViaHook = false;
    about.__ignowClose = () => {
      closedViaHook = true;
      about.remove();
    };
    f.win.document.body.appendChild(about);

    f.win.document.body.dispatchEvent(new f.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(closedViaHook, true, "Esc must invoke __ignowClose() when present on About overlay");
    assert.equal(f.win.document.getElementById("__ignow_about"), null);
  } finally {
    f.dom.window.close();
  }
});

test("popstate back navigation across duplicate URLs tracks exact navIndex for Forward", () => {
  const f = createFixture("/");
  try {
    f.win.history.pushState({}, "", "/explore/");
    f.win.history.pushState({}, "", "/");
    f.win.history.pushState({}, "", "/reels/");

    const backBtn = f.win.document.querySelector(".ignow-sidebar-back");
    const fwdBtn = f.win.document.querySelector(".ignow-sidebar-forward");

    // Step back from /reels/ -> / -> /explore/ -> /
    f.win.history.back = () => {};
    backBtn.click();
    f.win.history.replaceState({}, "", "/");
    f.win.dispatchEvent(new f.win.PopStateEvent("popstate"));

    backBtn.click();
    f.win.history.replaceState({}, "", "/explore/");
    f.win.dispatchEvent(new f.win.PopStateEvent("popstate"));

    backBtn.click();
    f.win.history.replaceState({}, "", "/");
    f.win.dispatchEvent(new f.win.PopStateEvent("popstate"));

    // At root index 0: Forward must go to /explore/, NOT jump back to index 2!
    let forwardCalls = 0;
    f.win.history.forward = () => { forwardCalls += 1; };
    assert.equal(fwdBtn.getAttribute("aria-disabled"), "false");
    fwdBtn.click();
    assert.equal(forwardCalls, 1);
    assert.equal(fwdBtn.getAttribute("aria-disabled"), "false", "stepping forward from index 0 -> 1 still leaves / and /reels/ ahead");

    const styleText = Array.from(f.win.document.querySelectorAll("style")).map(el => el.textContent).join("\n");
    assert.match(styleText, /\.ignow-video-controls__volume-slider\s*\{[^}]*bottom:\s*100%\s*!important/);
    assert.match(styleText, /\.ignow-sidebar-forward__label,\s*\n\s*\.ignow-sidebar-downloader__label\s*\{[^}]*white-space:\s*nowrap;/);
  } finally {
    f.dom.window.close();
  }
});

test("image-only carousel gets one corner Downloader button that preserves full carousel React Fiber payload", async () => {
  const f = createFixture("/");
  const opened = [];
  f.win.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        opened.push({ cmd, args });
        return null;
      }
    }
  };
  try {
    f.stage.remove();
    const doc = f.win.document;
    const article = doc.createElement("article");
    const postLink = doc.createElement("a");
    postLink.href = "https://www.instagram.com/p/C9xImageSeq/";
    postLink.textContent = "1d";
    const stage = doc.createElement("div");
    setRect(stage, { left: 100, top: 80, width: 470, height: 580 });
    const ul = doc.createElement("ul");
    setRect(ul, { left: 100, top: 80, width: 940, height: 580 });

    const li1 = doc.createElement("li");
    const img1 = doc.createElement("img");
    img1.src = "https://scontent.cdninstagram.com/v/slide1.jpg";
    setRect(img1, { left: 100, top: 80, width: 470, height: 580 });
    li1.appendChild(img1);

    const li2 = doc.createElement("li");
    const img2 = doc.createElement("img");
    img2.src = "https://scontent.cdninstagram.com/v/slide2.jpg";
    setRect(img2, { left: 570, top: 80, width: 470, height: 580 });
    li2.appendChild(img2);

    const nativeTagBtn = doc.createElement("button");
    nativeTagBtn.setAttribute("aria-label", "Audio/Tag");
    setRect(nativeTagBtn, { left: 530, top: 620, width: 28, height: 28 });

    ul.append(li1, li2);
    stage.append(ul, nativeTagBtn);
    article.append(stage, postLink);
    doc.body.appendChild(article);

    // Inner slide fiber has single child slide without shortcode; outer article fiber holds full 3-image carousel
    stage.__reactFiber$test = {
      memoizedProps: {
        post: {
          code: "C9xImageSeq",
          pk: "777",
          user: { username: "sunnyleepoetry" },
          caption: { text: "Sequence of 3 cards" },
          carousel_media: [
            { pk: "7771", image_versions2: { candidates: [{ url: "https://cdn.instagram.com/s1.jpg", width: 1080, height: 1350 }] } },
            { pk: "7772", image_versions2: { candidates: [{ url: "https://cdn.instagram.com/s2.jpg", width: 1080, height: 1350 }] } },
            { pk: "7773", image_versions2: { candidates: [{ url: "https://cdn.instagram.com/s3.jpg", width: 1080, height: 1350 }] } }
          ]
        }
      },
      return: null
    };
    img1.__reactFiber$test = {
      memoizedProps: {
        item: {
          pk: "7771",
          image_versions2: { candidates: [{ url: "https://cdn.instagram.com/s1.jpg", width: 1080, height: 1350 }] }
        }
      },
      return: stage.__reactFiber$test
    };

    // Wait for debounced MutationObserver scan (120ms)
    await new Promise(r => setTimeout(r, 170));

    const stageBtns = stage.querySelectorAll(".ignow-image-download-btn");
    assert.equal(stageBtns.length, 1, "carousel stage must receive exactly one corner Downloader button");
    assert.equal(stageBtns[0].classList.contains("ignow-image-download-btn--lifted"), true,
      "must lift above an existing bottom-right native button");

    // Keyboard activation (click inside window-capture isolation)
    stageBtns[0].dispatchEvent(new f.win.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 20));

    const call = opened.find(c => c.cmd === "open_downloader_window");
    assert(call, "clicking image Downloader button must invoke open_downloader_window");
    assert.equal(call.args.url, "https://www.instagram.com/p/C9xImageSeq/");
    const parsedSeed = JSON.parse(call.args.payloadJson);
    assert.equal(parsedSeed.carousel_media.length, 3, "must pass all 3 carousel slides to Downloader");
  } finally {
    f.dom.window.close();
  }
});

test("collaboration post resolves /user/p/shortcode/, climbs wide carousel viewport, skips avatars, and recovers Fiber shortcode", async () => {
  const f = createFixture("/");
  const opened = [];
  f.win.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        opened.push({ cmd, args });
        return null;
      }
    }
  };
  try {
    f.stage.remove();
    const doc = f.win.document;
    // Sidebar must skip tiny avatar image and select visible feed collab card
    const article = doc.createElement("article");
    const avatar = doc.createElement("img");
    avatar.src = "https://scontent.cdninstagram.com/v/avatar.jpg";
    setRect(avatar, { left: 100, top: 40, width: 32, height: 32 });

    const collabUserLink = doc.createElement("a");
    collabUserLink.href = "https://www.instagram.com/alexaaubreypoetry/";
    collabUserLink.textContent = "alexaaubreypoetry";
    const postLink = doc.createElement("a");
    postLink.href = "https://www.instagram.com/alexaaubreypoetry/p/DCollabPost9/";
    postLink.textContent = "2d";

    // Outer clipped presentation viewport (470px wide) wrapping a 2820px horizontal slide track
    const viewport = doc.createElement("div");
    viewport.setAttribute("role", "presentation");
    setRect(viewport, { left: 100, top: 80, width: 470, height: 580 });
    const wideTrack = doc.createElement("div");
    setRect(wideTrack, { left: 100, top: 80, width: 2820, height: 580 });
    Object.defineProperty(wideTrack, "clientWidth", { value: 470, configurable: true });
    Object.defineProperty(wideTrack, "scrollWidth", { value: 2820, configurable: true });
    const ul = doc.createElement("ul");
    setRect(ul, { left: 100, top: 80, width: 2820, height: 580 });
    const li = doc.createElement("li");
    const img = doc.createElement("img");
    img.src = "https://scontent.cdninstagram.com/v/collab1.jpg";
    setRect(img, { left: 100, top: 80, width: 470, height: 580 });
    const nextBtn = doc.createElement("button");
    nextBtn.setAttribute("aria-label", "Next");
    setRect(nextBtn, { left: 530, top: 350, width: 30, height: 30 });

    li.appendChild(img);
    ul.appendChild(li);
    wideTrack.appendChild(ul);
    viewport.append(wideTrack, nextBtn);
    article.append(avatar, collabUserLink, postLink, viewport);
    doc.body.appendChild(article);

    viewport.__reactFiber$test = {
      memoizedProps: {
        post: {
          code: "DCollabPost9",
          pk: "99001122",
          coauthor_producers: [{ username: "poets" }],
          user: { username: "alexaaubreypoetry" },
          caption: { text: "Collab poetry carousel" },
          carousel_media: [
            { pk: "991", image_versions2: { candidates: [{ url: "https://cdn.instagram.com/c1.jpg", width: 1080, height: 1350 }] } },
            { pk: "992", image_versions2: { candidates: [{ url: "https://cdn.instagram.com/c2.jpg", width: 1080, height: 1350 }] } }
          ]
        }
      },
      return: null
    };

    await new Promise(r => setTimeout(r, 170));

    // Must mount on the 470px clipped viewport rather than inside the 2820px off-screen wideTrack!
    const btnInViewport = Array.from(viewport.children).find(el => el.classList?.contains("ignow-image-download-btn"));
    assert(btnInViewport, "must mount corner button on clipped 470px carousel viewport, not wide track");
    assert.equal(wideTrack.querySelector(".ignow-image-download-btn"), null);

    // Click corner button -> must resolve /alexaaubreypoetry/p/DCollabPost9/
    btnInViewport.click();
    await new Promise(r => setTimeout(r, 20));
    const call1 = opened[opened.length - 1];
    assert.equal(call1.args.url, "https://www.instagram.com/alexaaubreypoetry/p/DCollabPost9/");

    // Also remove DOM links completely + verify sidebar Downloader button skips avatar and recovers shortcode from Fiber!
    postLink.remove();
    doc.querySelector(".ignow-sidebar-downloader").click();
    await new Promise(r => setTimeout(r, 20));
    const call2 = opened[opened.length - 1];
    assert.equal(call2.args.url, "https://www.instagram.com/p/DCollabPost9/");
    assert.equal(JSON.parse(call2.args.payloadJson).carousel_media.length, 2);
  } finally {
    f.dom.window.close();
  }
});

test("20-slide mixed photo+video carousel enables photo button on every photo slide and supports all 5 context-menu actions", async () => {
  const f = createFixture("/");
  const doc = f.win.document;
  let execCopiedText = "";
  doc.execCommand = cmd => {
    if (cmd === "copy") {
      const active = doc.activeElement;
      if (active && typeof active.value === "string") execCopiedText = active.value;
      return true;
    }
    return false;
  };
  Object.defineProperty(f.win.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("Document is not focused");
      }
    }
  });

  const openedDownloader = [];
  const origInvoke = f.win.__TAURI__.core.invoke;
  f.win.__TAURI__.core.invoke = async (command, args) => {
    if (command === "open_downloader_window") {
      openedDownloader.push(args);
      return true;
    }
    return origInvoke(command, args);
  };

  try {
    f.stage.remove();

    const slides = Array.from({ length: 20 }, (_, idx) => {
      const slideNum = idx + 1;
      const isVideo = slideNum === 5 || slideNum === 15;
      return isVideo
        ? {
            pk: String(9000 + slideNum),
            video_versions: [{ url: `https://cdn.instagram.com/v/mix-${slideNum}.mp4`, width: 1080, height: 1920 }],
            image_versions2: { candidates: [{ url: `https://cdn.instagram.com/v/mix-${slideNum}-thumb.jpg`, width: 1080, height: 1920 }] }
          }
        : {
            pk: String(9000 + slideNum),
            image_versions2: { candidates: [{ url: `https://cdn.instagram.com/v/mix-${slideNum}-full.jpg`, width: 1080, height: 1350 }] }
          };
    });

    const article = doc.createElement("article");
    const viewport = doc.createElement("div");
    viewport.setAttribute("role", "presentation");
    setRect(viewport, { left: 100, top: 80, width: 470, height: 580 });

    const ul = doc.createElement("ul");
    setRect(ul, { left: 100, top: 80, width: 470 * 20, height: 580 });
    Object.defineProperty(ul, "clientWidth", { value: 470, configurable: true });
    Object.defineProperty(ul, "scrollWidth", { value: 470 * 20, configurable: true });

    const slideNodes = [];
    for (let i = 0; i < 20; i += 1) {
      const li = doc.createElement("li");
      if (i === 4 || i === 14) {
        const v = doc.createElement("video");
        v.src = `blob:https://www.instagram.com/slide-${i + 1}`;
        setRect(v, { left: 100 + i * 470, top: 80, width: 470, height: 580 });
        li.appendChild(v);
        slideNodes.push(v);
      } else {
        const img = doc.createElement("img");
        img.src = `https://cdn.instagram.com/v/mix-${i + 1}-full.jpg`;
        setRect(img, { left: 100 + i * 470, top: 80, width: 470, height: 580 });
        li.appendChild(img);
        slideNodes.push(img);
      }
      ul.appendChild(li);
    }

    const nextBtn = doc.createElement("button");
    nextBtn.type = "button";
    nextBtn.setAttribute("aria-label", "Next");
    setRect(nextBtn, { left: 530, top: 350, width: 30, height: 30 });

    viewport.append(ul, nextBtn);
    // Notice NO <a> post link in DOM (Home feed card pattern): shortcode comes from React Fiber!
    const captionSpan = doc.createElement("span");
    captionSpan.setAttribute("dir", "auto");
    captionSpan.textContent = "Twenty slide autumn gallery";
    article.append(viewport, captionSpan);
    doc.body.appendChild(article);

    viewport.__reactFiber$mix20 = {
      memoizedProps: {
        post: {
          code: "D20MixPost",
          pk: "777888999",
          user: { username: "mixcreator" },
          caption: { text: "Twenty slide autumn gallery" },
          carousel_media: slides
        }
      },
      return: null
    };

    const setActiveSlide = targetIdx => {
      slideNodes.forEach((node, idx) => {
        setRect(node, { left: 100 + (idx - targetIdx) * 470, top: 80, width: 470, height: 580 });
      });
    };

    // 1. Slide 1 (photo) while offscreen <video> at Slide 5 exists in same stage -> corner button MUST mount!
    setActiveSlide(0);
    await new Promise(r => setTimeout(r, 170));
    let cornerBtn = Array.from(viewport.children).find(el => el.classList?.contains("ignow-image-download-btn"));
    assert(cornerBtn, "photo slide 1 in mixed carousel must render corner download button");

    // 2. Slide 5 (video active) -> corner photo button must hide while video controls own the slide
    setActiveSlide(4);
    nextBtn.click();
    await new Promise(r => setTimeout(r, 220));
    cornerBtn = Array.from(viewport.children).find(el => el.classList?.contains("ignow-image-download-btn"));
    assert.equal(cornerBtn, undefined, "corner photo button should remove when video slide is active");

    // 3. Slide 12 (photo active) -> corner button returns and passes slide 12 hint to Downloader
    setActiveSlide(11);
    nextBtn.click();
    await new Promise(r => setTimeout(r, 220));
    cornerBtn = Array.from(viewport.children).find(el => el.classList?.contains("ignow-image-download-btn"));
    assert(cornerBtn, "corner download button must re-appear on photo slide 12 after video slide");
    cornerBtn.click();
    await new Promise(r => setTimeout(r, 20));
    const dlOpen = openedDownloader[openedDownloader.length - 1];
    assert.equal(dlOpen.url, "https://www.instagram.com/p/D20MixPost/");
    assert.equal(dlOpen.slideIndex, 11);

    // 4. Right-click Slide 12 -> test all 5 menu items
    const slide12Img = slideNodes[11];
    const openContextMenuOn = el => {
      el.dispatchEvent(new f.win.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 250, clientY: 250 }));
      const items = Array.from(doc.querySelectorAll(".ignow-media-menu [role='menuitem']"));
      assert.equal(items.length, 5, "context menu must have 5 actions");
      return items;
    };

    // 4a. Item 1: Save image -> downloads Slide 12 URL with zero-padded -slide-12 stem (NOT Slide 1)
    let menuItems = openContextMenuOn(slide12Img);
    assert.equal(menuItems[0].textContent, "Save image to Downloads/IG-Now");
    menuItems[0].click();
    await new Promise(r => setTimeout(r, 30));
    const singleDl = f.calls.filter(c => c.command === "download_media").pop();
    assert.equal(singleDl.args.url, "https://cdn.instagram.com/v/mix-12-full.jpg");
    assert(singleDl.args.fileStem.endsWith("-slide-12"), `expected -slide-12 stem, got ${singleDl.args.fileStem}`);

    // 4b. Item 2: Download post (media + caption) -> downloads all 20 items + caption.txt + metadata.json
    const callsBeforeBundle = f.calls.length;
    menuItems = openContextMenuOn(slide12Img);
    assert.equal(menuItems[1].textContent, "Download post (media + caption)");
    menuItems[1].click();
    await new Promise(r => setTimeout(r, 60));
    const bundleCalls = f.calls.slice(callsBeforeBundle).filter(c => c.command === "download_media");
    assert.equal(bundleCalls.length, 20, "bundle download must save all 20 mixed carousel items");
    assert(bundleCalls.some(c => c.args.mediaType === "video" && c.args.url.endsWith("mix-5.mp4")));
    assert(bundleCalls.some(c => c.args.fileStem.endsWith("-slide-20")));
    assert(f.calls.slice(callsBeforeBundle).some(c => c.command === "save_media_bytes" && c.args.fileStem === "caption"));
    assert(f.calls.slice(callsBeforeBundle).some(c => c.command === "save_media_bytes" && c.args.fileStem === "metadata"));

    // 4c. Item 3: Copy caption text -> uses execCommand fallback when clipboard API throws
    menuItems = openContextMenuOn(slide12Img);
    assert.equal(menuItems[2].textContent, "Copy caption text");
    menuItems[2].click();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(execCopiedText, "Twenty slide autumn gallery");

    // 4d. Item 4: Open IG-Now Downloader... -> passes postUrl + 20-item payload + slideIndex 11
    menuItems = openContextMenuOn(slide12Img);
    assert.equal(menuItems[3].textContent, "Open IG-Now Downloader...");
    menuItems[3].click();
    await new Promise(r => setTimeout(r, 20));
    const menuOpenDl = openedDownloader[openedDownloader.length - 1];
    assert.equal(menuOpenDl.url, "https://www.instagram.com/p/D20MixPost/");
    assert.equal(menuOpenDl.slideIndex, 11);

    // 4e. Item 5 on Slide 12 (image) AND Slide 5 (blob video with no DOM link) -> opens exact HTTP post URL!
    menuItems = openContextMenuOn(slide12Img);
    assert.equal(menuItems[4].textContent, "Open post in default browser");
    menuItems[4].click();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(f.openedUrls[f.openedUrls.length - 1], "https://www.instagram.com/p/D20MixPost/");

    setActiveSlide(4);
    await new Promise(r => setTimeout(r, 20));
    menuItems = openContextMenuOn(slideNodes[4]);
    assert.equal(menuItems[0].textContent, "Save video to Downloads/IG-Now");
    assert.equal(menuItems[4].textContent, "Open video post in default browser");
    menuItems[4].click();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(f.openedUrls[f.openedUrls.length - 1], "https://www.instagram.com/p/D20MixPost/");
  } finally {
    f.dom.window.close();
  }
});

test("extractFromReactFiber skips cross-origin Window proxies without throwing SecurityError during download and context actions", async () => {
  const f = createFixture("/");
  const doc = f.win.document;
  const openedDownloader = [];
  const origInvoke = f.win.__TAURI__.core.invoke;
  f.win.__TAURI__.core.invoke = async (command, args) => {
    if (command === "open_downloader_window") {
      openedDownloader.push(args);
      return true;
    }
    return origInvoke(command, args);
  };

  try {
    f.stage.remove();
    const article = doc.createElement("article");
    const postLink = doc.createElement("a");
    postLink.href = "https://www.instagram.com/indozonetech/p/DIndozoneSlide2/";
    postLink.textContent = "6h";

    const viewport = doc.createElement("div");
    viewport.setAttribute("role", "presentation");
    setRect(viewport, { left: 100, top: 80, width: 470, height: 580 });
    const img = doc.createElement("img");
    img.src = "https://cdn.instagram.com/v/indozone-slide2.jpg";
    setRect(img, { left: 100, top: 80, width: 470, height: 580 });
    viewport.appendChild(img);
    article.append(postLink, viewport);
    doc.body.appendChild(article);

    const throwSecurity = () => {
      throw new f.win.DOMException(
        "Failed to read a named property 'video_versions' from 'Window': Blocked a frame with origin \"https://www.instagram.com\" from accessing a cross-origin frame.",
        "SecurityError"
      );
    };
    const crossOriginWindowProxy = new Proxy({}, {
      get: throwSecurity,
      has: throwSecurity,
      ownKeys: throwSecurity,
      getOwnPropertyDescriptor: throwSecurity
    });

    // Cross-origin Window sitting on inner child Fiber before outer post Fiber!
    img.__reactFiber$inner = {
      memoizedProps: { embedWindow: crossOriginWindowProxy, nested: { frameWin: crossOriginWindowProxy } },
      memoizedState: { memoizedState: { winRef: crossOriginWindowProxy }, next: null },
      return: {
        memoizedProps: {
          media: {
            code: "DIndozoneSlide2",
            pk: "88112233",
            user: { username: "indozonetech" },
            caption: { text: "Slide Kedua post caption" },
            carousel_media: [
              { image_versions2: { candidates: [{ url: "https://cdn.instagram.com/v/indozone-slide1.jpg", width: 1080, height: 1350 }] } },
              { image_versions2: { candidates: [{ url: "https://cdn.instagram.com/v/indozone-slide2.jpg", width: 1080, height: 1350 }] } }
            ]
          }
        },
        return: null
      }
    };

    await new Promise(r => setTimeout(r, 170));
    const btn = Array.from(viewport.children).find(el => el.classList?.contains("ignow-image-download-btn"));
    assert(btn, "corner button must mount on image stage");
    btn.click();
    await new Promise(r => setTimeout(r, 30));

    assert.equal(openedDownloader.length, 1, "Downloader must open cleanly instead of crashing on cross-origin Window");
    assert.equal(openedDownloader[0].url, "https://www.instagram.com/indozonetech/p/DIndozoneSlide2/");
    assert.equal(openedDownloader[0].slideIndex, 1);

    // Also test right-click "Download post (media + caption)" -> must save 2 slides + caption, NOT SecurityError toast!
    img.dispatchEvent(new f.win.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 250, clientY: 250 }));
    const items = Array.from(doc.querySelectorAll(".ignow-media-menu [role='menuitem']"));
    assert.equal(items.length, 5);
    items[1].click();
    await new Promise(r => setTimeout(r, 50));

    const dlCalls = f.calls.filter(c => c.command === "download_media");
    assert.equal(dlCalls.length, 2, "must download both carousel slides cleanly");
    const toastText = doc.querySelector(".ignow-toast")?.textContent || "";
    assert(!/SecurityError|Blocked a frame|video_versions/i.test(toastText), `unexpected toast error: ${toastText}`);
  } finally {
    f.dom.window.close();
  }
});
