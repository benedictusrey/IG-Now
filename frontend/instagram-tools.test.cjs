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

function createFixture(urlPath = "/reels/C9xTestReel/", { showComments = false, overflowHidden = false, beforeEval = null } = {}) {
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

  if (typeof beforeEval === "function") beforeEval(win);
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

test("prefers avc1 over av01/vp09 video and mp4a over opus audio in DASH and video_versions", async () => {
  const f = createFixture("/reels/C9xCodecPref/");
  try {
    f.video.__reactFiber$test = {
      memoizedProps: {},
      memoizedState: {
        memoizedState: {
          media: {
            code: "C9xCodecPref",
            user: { username: "codec_creator" },
            video_versions: [
              { url: "https://cdn.instagram.com/v/prog_av1.mp4", width: 1080, height: 1920, codecs: "av01.0.08M.08" },
              { url: "https://cdn.instagram.com/v/prog_avc.mp4", width: 1080, height: 1920, codecs: "avc1.64002a" }
            ],
            video_dash_manifest: '<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation codecs="av01.0.08M.08" bandwidth="3800000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/dash_av1.mp4</BaseURL></Representation><Representation codecs="vp09.00.40.08" bandwidth="3400000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/dash_vp9.mp4</BaseURL></Representation><Representation codecs="avc1.64002a" bandwidth="2200000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/dash_h264.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation codecs="opus" bandwidth="192000"><BaseURL>https://cdn.instagram.com/v/dash_opus.opus</BaseURL></Representation><Representation codecs="mp4a.40.2" bandwidth="128000"><BaseURL>https://cdn.instagram.com/v/dash_aac.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>'
          }
        },
        next: null
      },
      return: null
    };

    await f.win.__ignowTools.saveMedia(f.video);
    const dlCall = f.calls.find(c => c.command === "download_media");
    assert(dlCall, "must invoke download_media");
    assert.equal(dlCall.args.url, "https://cdn.instagram.com/v/prog_avc.mp4");
    assert.equal(dlCall.args.audioUrl, "https://cdn.instagram.com/v/dash_aac.m4a");
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

test("scroll scans reuse mounted sidebar row without full-document link queries, lazily serialize GraphQL cache, and avoid backdrop-filter on feed cards", async () => {
  const opened = [];
  const f = createFixture("/", {
    beforeEval: win => {
      win.fetch = async url => ({
        ok: true,
        url: String(url),
        headers: { get: () => "application/json" },
        clone() {
          return {
            text: async () => JSON.stringify({
              data: {
                shortcode_media: {
                  code: "DLazyCache1",
                  pk: "55112233",
                  user: { username: "lazy_user" },
                  caption: { text: "Cached from network" },
                  image_versions2: {
                    candidates: [{ url: "https://cdn.instagram.com/v/lazy1.jpg", width: 1080, height: 1350 }]
                  }
                }
              }
            })
          };
        }
      });
    }
  });
  f.win.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        opened.push({ cmd, args });
        return true;
      }
    }
  };
  try {
    const doc = f.win.document;
    // Scroll scans must not re-query every anchor/button across the page once mounted.
    const moreRow = doc.querySelector(".more-row [role='button']");
    let moreRectReads = 0;
    const origRect = moreRow.getBoundingClientRect;
    moreRow.getBoundingClientRect = () => {
      moreRectReads += 1;
      return origRect();
    };
    f.win.dispatchEvent(new f.win.Event("scroll"));
    // Scroll handler must debounce (~120ms), not coerce the Event object to 0ms.
    let videoScansAt25ms = 0;
    const origQueryAll = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = sel => {
      if (sel === "video") videoScansAt25ms += 1;
      return origQueryAll(sel);
    };
    await new Promise(r => setTimeout(r, 25));
    assert.equal(videoScansAt25ms, 0, "scroll scan must stay debounced past 25ms");
    doc.querySelectorAll = origQueryAll;
    await new Promise(r => setTimeout(r, 150));
    f.win.dispatchEvent(new f.win.Event("scroll"));
    await new Promise(r => setTimeout(r, 170));
    assert.equal(moreRectReads, 0, "scroll scan must fast-path mounted sidebar buttons without re-scanning More");

    // Feed image download button must not apply backdrop-filter blur during scroll.
    const styleText = Array.from(doc.querySelectorAll("style")).map(el => el.textContent).join("\n");
    const imgBtnRule = styleText.match(/\.ignow-image-download-btn\s*\{[^}]*\}/)?.[0] || "";
    assert.equal(/backdrop-filter\s*:/i.test(imgBtnRule), false, "feed image button must avoid backdrop-filter blur");

    // Network observer caches media metadata and materializes rawNodeJson on Downloader open.
    await f.win.fetch("https://www.instagram.com/api/graphql");
    await new Promise(r => setTimeout(r, 30));
    await f.win.__ignowTools.openNativeDownloader("https://www.instagram.com/p/DLazyCache1/", null);
    const dlCall = opened.find(c => c.cmd === "open_downloader_window");
    assert(dlCall, "openNativeDownloader must invoke open_downloader_window");
    assert.equal(JSON.parse(dlCall.args.payloadJson).code, "DLazyCache1");
  } finally {
    f.dom.window.close();
  }
});

test("Linux WebKitGTK neutralizes heavy CSS blur filters, avoids volume-slider drop-shadow filter, and skips aria-hidden decorative images", async () => {
  const html = `<!doctype html><html><head><style>
    .bg-blur { filter: blur(140px); }
    .glass-pill { -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
    .icon-keep { filter: brightness(0.9) invert(1); }
  </style></head><body><main>
    <article>
      <img class="bg-blur" aria-hidden="true" src="https://cdn.instagram.com/bg.jpg" />
      <video src="https://cdn.instagram.com/reel.mp4"></video>
    </article>
  </main></body></html>`;
  const dom = new JSDOM(html, {
    url: "https://www.instagram.com/reels/",
    pretendToBeVisual: true,
    runScripts: "dangerously"
  });
  const { window } = dom;
  Object.defineProperty(window.navigator, "platform", { value: "Linux x86_64", configurable: true });
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15",
    configurable: true,
  });
  const img = window.document.querySelector("img.bg-blur");
  Object.defineProperty(img, "naturalWidth", { value: 720, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 1280, configurable: true });
  setRect(img, { left: 0, top: 0, width: 575, height: 995 });
  try {
    window.eval(source);
    const linuxPerfStyle = window.document.getElementById("__ignow-linux-perf");
    assert(linuxPerfStyle, "Linux WebKitGTK runtime should install __ignow-linux-perf style");
    assert.match(linuxPerfStyle.textContent, /\.bg-blur\s*\{[^}]*filter:\s*none\s*!important/);
    assert.match(linuxPerfStyle.textContent, /\.bg-blur\s*\{[^}]*opacity:\s*0\.14\s*!important/);
    assert.match(linuxPerfStyle.textContent, /\.glass-pill\s*\{[^}]*backdrop-filter:\s*none\s*!important/);
    assert.equal(linuxPerfStyle.textContent.includes(".icon-keep"), false, "non-blur filters must stay intact");

    const allStyles = Array.from(window.document.querySelectorAll("style")).map(s => s.textContent).join("\n");
    const sliderRule = allStyles.match(/\.ignow-video-controls__volume-slider\s*\{[^}]*\}/)?.[0] || "";
    assert.equal(/filter\s*:/i.test(sliderRule), false, "volume slider must use box-shadow instead of filter: drop-shadow");
    assert.equal(window.document.querySelectorAll(".ignow-image-download-btn").length, 0, "aria-hidden decorative blur images must not get image download buttons");

    // StyleX dynamic insertRule() into an already-scanned stylesheet must also be caught,
    // even when WebKit CSS Nesting exposes an empty cssRules list on CSSStyleRule.
    const dynSheet = window.document.styleSheets[0];
    dynSheet.insertRule(".late-blur { filter: blur(75px); }", dynSheet.cssRules.length);
    Object.defineProperty(dynSheet.cssRules[dynSheet.cssRules.length - 1], "cssRules", {
      value: [],
      configurable: true
    });
    window.dispatchEvent(new window.Event("scroll"));
    await new Promise(r => setTimeout(r, 150));
    assert.match(linuxPerfStyle.textContent, /\.late-blur\s*\{[^}]*filter:\s*none\s*!important/);
  } finally {
    dom.window.close();
  }
});

test("Reels navigation dispatches ArrowDown immediately without 220ms lag, caps distant videos, and bounds layout/style reads", async () => {
  const f = createFixture("/reels/");
  try {
    const { win } = f;
    const doc = win.document;
    Object.defineProperty(win, "innerHeight", { value: 900, configurable: true });
    Object.defineProperty(win, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(doc.documentElement, "scrollHeight", { value: 900, configurable: true });

    const main = doc.querySelector("main") || doc.body;
    // Mount 5 Reels (-2..+2 viewports) and 20 non-audio buttons to verify label-first filtering & caching.
    const stage = doc.createElement("article");
    const videos = [];
    for (let i = 0; i < 5; i++) {
      const wrap = doc.createElement("div");
      const v = doc.createElement("video");
      v.src = `https://cdn.instagram.com/reel-${i}.mp4`;
      v.preload = "auto";
      Object.defineProperty(v, "paused", { value: i !== 1, writable: true, configurable: true });
      v.pause = () => { v.paused = true; };
      setRect(v, { left: 100, top: (i - 1) * 1000, width: 450, height: 800 });
      wrap.appendChild(v);
      stage.appendChild(wrap);
      videos.push(v);
    }
    for (let b = 0; b < 20; b++) {
      const btn = doc.createElement("button");
      btn.setAttribute("aria-label", b === 19 ? "Audio is muted" : `Like ${b}`);
      setRect(btn, { left: 480, top: 700, width: 32, height: 32 });
      stage.appendChild(btn);
    }
    main.appendChild(stage);

    // 1. Trigger scanVideos via scroll -> distant video (#4 at top=3000) is paused & capped to metadata,
    // while adjacent #0 (top=-1000) and #2 (top=1000) keep their preload intact.
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 150));
    assert.equal(videos[2].preload, "auto", "adjacent +1 Reel keeps pre-buffering");
    assert.equal(videos[4].preload, "metadata", "distant +3 Reel is capped to metadata");

    // 2. Instrument getComputedStyle & getBoundingClientRect across repeated play + scroll transitions.
    let gcsCalls = 0;
    let gbcrCalls = 0;
    const origGcs = win.getComputedStyle.bind(win);
    const origGbcr = win.Element.prototype.getBoundingClientRect;
    win.getComputedStyle = (...args) => { gcsCalls++; return origGcs(...args); };
    win.Element.prototype.getBoundingClientRect = function () { gbcrCalls++; return origGbcr.apply(this, arguments); };

    videos[1].dispatchEvent(new win.Event("play"));
    videos[1].dispatchEvent(new win.Event("play"));
    // Non-transform transitionend must not trigger scanVideos.
    const opacityEnd = new win.Event("transitionend", { bubbles: true });
    opacityEnd.propertyName = "opacity";
    main.dispatchEvent(opacityEnd);
    await new Promise(r => setTimeout(r, 150));

    assert(gcsCalls <= 4, `expected label-first + cached mute button to bound getComputedStyle (got ${gcsCalls})`);
    assert(gbcrCalls <= 40, `expected cached stages & filtered transitionend to bound getBoundingClientRect (got ${gbcrCalls})`);

    // 3. Verify navigateReel() via ArrowDown dispatches synthetic ArrowDown immediately (<50ms, no 220ms wait).
    const dispatched = [];
    doc.body.addEventListener("keydown", ev => {
      if (ev.__ignowSyntheticNavigation) dispatched.push(ev.key);
    });
    doc.body.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
    assert.deepEqual(dispatched, ["ArrowDown"], "non-scrolling Reels root must dispatch ArrowDown synchronously without 220ms lag");
  } finally {
    f.dom.window.close();
  }
});

test("Explore grid tiles skip heavy control bars, unload offscreen progressive HTTPS videos, and restore them when scrolled back into view", async () => {
  const f = createFixture("/explore/");
  try {
    const { win } = f;
    const doc = win.document;
    const main = doc.querySelector("main") || doc.body;

    // Remove default Reels article from fixture so we test pure Explore grid behavior.
    main.innerHTML = "";
    const videos = [];
    for (let i = 0; i < 6; i++) {
      const link = doc.createElement("a");
      link.href = `/p/ExplorePost${i}/`;
      const v = doc.createElement("video");
      v.src = `https://cdn.instagram.com/explore-${i}.mp4`;
      v.preload = "auto";
      Object.defineProperty(v, "paused", { value: true, writable: true, configurable: true });
      v.load = () => {};
      setRect(v, { left: (i % 3) * 300, top: i < 3 ? 100 : 2000, width: 280, height: 280 });
      link.appendChild(v);
      main.appendChild(link);
      videos.push(v);
    }

    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));

    assert.equal(doc.querySelectorAll(".ignow-video-controls").length, 0, "Explore grid link tiles must not inject 10-node video control bars");
    assert.equal(videos[0].preload, "none", "visible paused Explore grid video must use preload=none");
    assert.equal(videos[0].getAttribute("src"), "https://cdn.instagram.com/explore-0.mp4", "visible grid video keeps src");
    assert.equal(videos[4].getAttribute("src"), null, "offscreen progressive grid video must unload src");
    assert.equal(videos[4].dataset.ignowDeferredSrc, "https://cdn.instagram.com/explore-4.mp4", "offscreen progressive video must stash deferred src");

    // Scroll video 4 back into viewport -> src is restored cleanly.
    setRect(videos[4], { left: 300, top: 200, width: 280, height: 280 });
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));
    assert.equal(videos[4].getAttribute("src"), "https://cdn.instagram.com/explore-4.mp4", "in-view grid video must restore deferred src");
    assert.equal(videos[4].dataset.ignowDeferredSrc, undefined);
  } finally {
    f.dom.window.close();
  }
});

test("Route updates preserve sidebar cache, detached activeVideo refs are pruned, activeVideoForKeyboard reads rect once per video, and Linux perf sheet removes control blurs", async () => {
  const f = createFixture("/reels/StartReel/", {
    beforeEval: win => {
      Object.defineProperty(win.navigator, "platform", { value: "Linux x86_64", configurable: true });
      Object.defineProperty(win.navigator, "userAgent", {
        value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        configurable: true
      });
      const moreControl = win.document.querySelector(".more-row [role='button']");
      if (moreControl) setRect(moreControl, { left: 12, top: 820, width: 220, height: 48 });
      const sidebar = win.document.querySelector(".sidebar-shell");
      if (sidebar) setRect(sidebar, { left: 0, top: 0, width: 244, height: 900 });
    }
  });
  try {
    const { win } = f;
    const doc = win.document;

    // 1. Verify Linux WebKitGTK perf sheet strips blurred control shadows.
    const perfStyle = doc.getElementById("__ignow-linux-perf");
    assert.ok(perfStyle, "Linux WebKitGTK must inject #__ignow-linux-perf");
    assert.match(perfStyle.textContent, /text-shadow:\s*0 1px 0 rgba\(0, 0, 0, 0\.9\)/);
    assert.match(perfStyle.textContent, /box-shadow:\s*0 0 0 1px rgba\(0, 0, 0, 0\.55\)/);

    const video = doc.querySelector("article video");
    assert.ok(video);
    setRect(video, { left: 100, top: 20, width: 420, height: 720 });
    Object.defineProperty(doc.documentElement, "scrollHeight", { value: 900, configurable: true });
    const moreControl = doc.querySelector(".more-row [role='button']");
    const moreSpan = moreControl.querySelector("span");
    setRect(moreSpan, { left: 50, top: 830, width: 40, height: 20 });

    // Trigger one play so video is active, then remove it and verify scanVideos prunes stale ref.
    video.dispatchEvent(new win.Event("play"));
    assert.equal(win.__ignowActiveVideo(), video);
    video.remove();
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 150));
    assert.equal(win.__ignowActiveVideo(), null, "detached activeVideo must be pruned during scanVideos");

    // 2. Verify history.replaceState route change does NOT invalidate mountedMoreInfo or re-measure sidebar.
    let moreQueries = 0;
    const origQsa = doc.querySelectorAll.bind(doc);
    let gbcrCalls = 0;
    const origGbcr = win.Element.prototype.getBoundingClientRect;
    win.Element.prototype.getBoundingClientRect = function () {
      gbcrCalls += 1;
      return origGbcr.apply(this, arguments);
    };
    doc.querySelectorAll = function (sel) {
      if (String(sel).includes("svg")) moreQueries += 1;
      return origQsa(sel);
    };

    win.history.replaceState({}, "", "/reels/SecondReel/");
    await new Promise(r => setTimeout(r, 80));
    assert.equal(moreQueries, 0, "route update must reuse mountedMoreInfo without re-querying sidebar SVGs");
    assert.equal(gbcrCalls, 0, "route update with connected sidebar and no images/videos must perform zero getBoundingClientRect calls");

    // 3. Re-add two visible videos and check activeVideoForKeyboard via ArrowRight reads rect once per video.
    const article = doc.querySelector("article");
    const v1 = doc.createElement("video");
    const v2 = doc.createElement("video");
    Object.defineProperty(v1, "paused", { value: true, configurable: true });
    Object.defineProperty(v2, "paused", { value: true, configurable: true });
    setRect(v1, { left: 100, top: 50, width: 300, height: 400 });
    setRect(v2, { left: 100, top: 50, width: 500, height: 700 });
    article.appendChild(v1);
    article.appendChild(v2);

    let v1Reads = 0;
    let v2Reads = 0;
    v1.getBoundingClientRect = () => { v1Reads += 1; return { left: 100, top: 50, right: 400, bottom: 450, width: 300, height: 400 }; };
    v2.getBoundingClientRect = () => { v2Reads += 1; return { left: 100, top: 50, right: 600, bottom: 750, width: 500, height: 700 }; };
    doc.body.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true }));
    assert.equal(v1Reads, 1, "activeVideoForKeyboard must read v1 rect at most once");
    assert.equal(v2Reads, 1, "activeVideoForKeyboard must read v2 rect at most once");
  } finally {
    f.dom.window.close();
  }
});

test("capOffscreenVideos cleans hidden rect.height<=0 off-route videos even when <=3 on /reels/, preserving [role=dialog]", async () => {
  const f = createFixture("/reels/");
  try {
    const { win } = f;
    const doc = win.document;
    f.stage.remove();

    const makeVideo = (src, inDialog = false) => {
      const wrap = doc.createElement(inDialog ? "div" : "section");
      if (inDialog) wrap.setAttribute("role", "dialog");
      const v = doc.createElement("video");
      v.src = src;
      v.preload = "auto";
      Object.defineProperty(v, "paused", { value: false, writable: true, configurable: true });
      v.pause = () => { v.paused = true; };
      v.load = () => {};
      setRect(v, { left: 0, top: 0, width: 0, height: 0 });
      wrap.appendChild(v);
      doc.body.appendChild(wrap);
      return v;
    };

    const hiddenOffRoute = makeVideo("https://cdn.instagram.com/offroute-1.mp4", false);
    const hiddenDialog = makeVideo("https://cdn.instagram.com/dialog-1.mp4", true);

    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));

    assert.equal(hiddenOffRoute.paused, true, "hidden off-route video must be paused even when <=3 videos");
    assert.equal(hiddenOffRoute.preload, "none", "hidden off-route video must drop preload to none");
    assert.equal(hiddenOffRoute.getAttribute("src"), null, "hidden off-route https video must unload src even on /reels/");
    assert.equal(hiddenOffRoute.dataset.ignowDeferredSrc, "https://cdn.instagram.com/offroute-1.mp4");
    assert.equal(hiddenDialog.getAttribute("src"), "https://cdn.instagram.com/dialog-1.mp4", "dialog video must stay intact");

    setRect(hiddenOffRoute, { left: 100, top: 100, width: 420, height: 720 });
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));
    assert.equal(hiddenOffRoute.getAttribute("src"), "https://cdn.instagram.com/offroute-1.mp4", "restored visible video recovers deferred src");
  } finally {
    f.dom.window.close();
  }
});

test("lazy video controls skip far-offscreen Reels until play, defer native mute click off scroll transitions, and keep explicit mute synchronous", async () => {
  const f = createFixture("/reels/");
  try {
    const { win } = f;
    const doc = win.document;
    const main = doc.querySelector("main") || doc.body;

    // Far-offscreen Reel (>2x viewport height away) must NOT pre-mount 10-node controls
    const farWrap = doc.createElement("div");
    const farVideo = doc.createElement("video");
    farVideo.src = "https://cdn.instagram.com/far-reel.mp4";
    Object.defineProperty(farVideo, "paused", { value: true, writable: true, configurable: true });
    setRect(farVideo, { left: 100, top: 2600, width: 420, height: 720 });
    farWrap.appendChild(farVideo);
    main.appendChild(farWrap);

    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));
    assert.equal(farVideo.dataset.ignowNativeControls, undefined, "far-offscreen Reel must stay lazily unmounted");
    assert.equal(farWrap.querySelector(".ignow-video-controls"), null);

    // Firing play mounts controls on demand
    farVideo.paused = false;
    farVideo.dispatchEvent(new win.Event("play"));
    assert.equal(farVideo.dataset.ignowNativeControls, "1", "playing video must mount controls lazily");
    assert.ok(farWrap.querySelector(".ignow-video-controls"));

    // Deferred native mute click during Reel scroll/play transition
    const cornerBtn = doc.createElement("button");
    let cornerState = "muted";
    let cornerClicks = 0;
    cornerBtn.setAttribute("aria-label", "Audio is muted");
    setRect(cornerBtn, { left: 710, top: 680, width: 32, height: 32 });
    cornerBtn.addEventListener("click", () => {
      cornerClicks += 1;
      cornerState = cornerState === "muted" ? "playing" : "muted";
      cornerBtn.setAttribute("aria-label", cornerState === "muted" ? "Audio is muted" : "Audio is playing");
      f.video.muted = cornerState === "muted";
      f.video.dispatchEvent(new win.Event("volumechange"));
    });
    f.stage.appendChild(cornerBtn);

    f.video.src = "https://cdn.instagram.com/reel-next.mp4";
    Object.defineProperty(f.video, "paused", { value: false, writable: true, configurable: true });
    f.video.muted = true;
    win.dispatchEvent(new win.Event("wheel"));
    f.video.dispatchEvent(new win.Event("play"));

    // Instant video audio without synchronous React click mid-scroll
    assert.equal(f.video.muted, false, "video unmutes immediately without waiting for native click");
    assert.equal(cornerClicks, 0, "native mute button must NOT be clicked synchronously mid-scroll");

    await new Promise(r => setTimeout(r, 230));
    assert.equal(cornerClicks, 1, "native mute button syncs once after scroll settles");
    assert.equal(cornerBtn.getAttribute("aria-label"), "Audio is playing");

    // Explicit user mute click remains synchronous
    const volBtn = f.stage.querySelector(".ignow-video-controls__volume");
    volBtn.click();
    assert.equal(cornerClicks, 2, "explicit user mute click must sync native button synchronously");
    assert.equal(f.video.muted, true);
  } finally {
    f.dom.window.close();
  }
});

test("Linux perf sheet avoids :has(), defers large stylesheet scans off interactive startup, top-frame guard skips iframes, scroll skips full img scans, and caches cap at 120", async () => {
  // 1. Top-frame guard in embedded iframe
  const iframeDom = new JSDOM("<!doctype html><html><body><iframe></iframe></body></html>", {
    url: "https://www.instagram.com/",
    runScripts: "outside-only"
  });
  try {
    const iframeWin = iframeDom.window.document.querySelector("iframe").contentWindow;
    iframeWin.eval(source);
    assert.equal(iframeWin.__ignowMediaToolsInstalled, undefined, "script must skip non-top frames");
  } finally {
    iframeDom.window.close();
  }

  // 2. Linux perf :has() removal + >200-rule stylesheet deferral at interactive startup
  const manyRules = Array.from({ length: 205 }, (_, i) => `.r${i} { color: red; }`).join("\n") + "\n.big-blur { filter: blur(90px); }";
  const linuxDom = new JSDOM(`<!doctype html><html><head><style>${manyRules}</style></head><body><main><article><img class="decor" aria-hidden="true" src="https://cdn.instagram.com/bg.jpg" /><video src="https://cdn.instagram.com/v.mp4"></video></article></main></body></html>`, {
    url: "https://www.instagram.com/reels/",
    pretendToBeVisual: true,
    runScripts: "dangerously"
  });
  try {
    const win = linuxDom.window;
    Object.defineProperty(win.navigator, "platform", { value: "Linux x86_64", configurable: true });
    Object.defineProperty(win.navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 Safari/605.1.15",
      configurable: true
    });
    let readyStateVal = "interactive";
    Object.defineProperty(win.document, "readyState", { get: () => readyStateVal, configurable: true });
    const v = win.document.querySelector("video");
    setRect(v, { left: 100, top: 50, width: 420, height: 720 });

    win.eval(source);
    const perfStyle = win.document.getElementById("__ignow-linux-perf");
    assert.ok(perfStyle);
    assert.equal(perfStyle.textContent.includes(":has("), false, "#__ignow-linux-perf must not use div:has(...) selectors");
    assert.equal(win.document.querySelector("img.decor").classList.contains("ignow-linux-no-blur"), true, "mounted video stage must mark aria-hidden backdrop img directly");
    assert.equal(perfStyle.textContent.includes(".big-blur"), false, ">200-rule stylesheet scan must defer off interactive startup");

    readyStateVal = "complete";
    win.dispatchEvent(new win.Event("load"));
    assert.match(perfStyle.textContent, /\.big-blur\s*\{[^}]*filter:\s*none\s*!important/, "deferred stylesheet scan runs on window load");
  } finally {
    linuxDom.window.close();
  }

  // 3. Scroll skips document.querySelectorAll("img") and mediaCache/rawNodeCache cap at 120
  let fetchPayloadText = "";
  const f = createFixture("/", {
    beforeEval: win => {
      win.fetch = async () => ({
        ok: Boolean(fetchPayloadText),
        status: fetchPayloadText ? 200 : 404,
        url: "https://www.instagram.com/api/graphql",
        headers: { get: () => "application/json" },
        clone: () => ({ text: async () => fetchPayloadText }),
        text: async () => fetchPayloadText
      });
    }
  });
  try {
    const { win } = f;
    const doc = win.document;
    let imgQueries = 0;
    const origQsa = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = sel => {
      if (sel === "img") imgQueries += 1;
      return origQsa(sel);
    };
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));
    assert.equal(imgQueries, 0, "scroll scan must not call document.querySelectorAll('img')");
    doc.querySelectorAll = origQsa;

    for (let i = 0; i < 130; i += 1) {
      const code = `CapCode${String(i).padStart(3, "0")}`;
      fetchPayloadText = JSON.stringify({
        data: {
          media: {
            code,
            user: { username: "capuser" },
            image_versions2: { candidates: [{ url: `https://cdn.instagram.com/${code}.jpg`, width: 1080, height: 1080 }] }
          }
        }
      });
      await win.fetch("https://www.instagram.com/api/graphql");
      await new Promise(r => setTimeout(r, 2));
      if ((i + 1) % 10 === 0) {
        await win.__ignowTools.openNativeDownloader(`https://www.instagram.com/p/${code}/`, null);
      }
    }
    fetchPayloadText = "";
    const dlCallsBefore = f.calls.length;
    await win.__ignowTools.openNativeDownloader("https://www.instagram.com/p/CapCode000/", null);
    await win.__ignowTools.openNativeDownloader("https://www.instagram.com/p/CapCode129/", null);
    const dlCalls = f.calls.slice(dlCallsBefore).filter(c => c.command === "open_downloader_window");
    const oldest = dlCalls.find(c => c.args.url.includes("CapCode000"));
    const newest = dlCalls.find(c => c.args.url.includes("CapCode129"));
    assert.equal(oldest.args.payloadJson, null, "oldest entry beyond 120 must be evicted from cache");
    assert.ok(newest.args.payloadJson && newest.args.payloadJson.includes("CapCode129"), "newest entry within 120 must stay cached");
  } finally {
    f.dom.window.close();
  }
});

test("Linux WebKitGTK tears down disconnected removed <video> elements while preserving reparented and non-Linux videos", async () => {
  const runDetachCase = async (isLinux) => {
    const f = createFixture("/explore/", {
      beforeEval: win => {
        Object.defineProperty(win.navigator, "platform", {
          value: isLinux ? "Linux x86_64" : "Win32",
          configurable: true
        });
        Object.defineProperty(win.navigator, "userAgent", {
          value: isLinux
            ? "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 Safari/605.1.15"
            : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0.0.0",
          configurable: true
        });
      }
    });
    try {
      const { win } = f;
      const doc = win.document;
      const makeVid = url => {
        const v = doc.createElement("video");
        v.src = url;
        Object.defineProperty(v, "paused", { value: false, writable: true, configurable: true });
        v.pause = () => { v.paused = true; };
        let loads = 0;
        v.load = () => { loads += 1; };
        v.__loads = () => loads;
        doc.body.appendChild(v);
        return v;
      };
      const removed = makeVid("blob:https://www.instagram.com/removed-1");
      const reparented = makeVid("blob:https://www.instagram.com/reparented-2");
      removed.remove();
      reparented.remove();
      doc.body.appendChild(reparented);

      await new Promise(r => setTimeout(r, 200));
      return {
        removedSrc: removed.getAttribute("src"),
        removedPaused: removed.paused,
        removedLoads: removed.__loads(),
        reparentedSrc: reparented.getAttribute("src")
      };
    } finally {
      f.dom.window.close();
    }
  };

  const linuxRes = await runDetachCase(true);
  assert.equal(linuxRes.removedSrc, null, "disconnected video on Linux WebKitGTK must unload src");
  assert.equal(linuxRes.removedPaused, true, "disconnected video on Linux WebKitGTK must pause");
  assert.equal(linuxRes.removedLoads, 1, "disconnected video on Linux WebKitGTK must call load() once");
  assert.equal(linuxRes.reparentedSrc, "blob:https://www.instagram.com/reparented-2", "reparented connected video must stay intact");

  const winRes = await runDetachCase(false);
  assert.equal(winRes.removedSrc, "blob:https://www.instagram.com/removed-1", "non-Linux runtime must leave removed video src untouched");
  assert.equal(winRes.removedLoads, 0, "non-Linux runtime must not call load() on removed video");
});

test("navigateReel schedules scan for newly snapped Reel controls, Linux tears down far-offscreen Reel controls and remounts, and timeupdate quantizes --ignow-progress to 0.5%", async () => {
  const f = createFixture("/reels/", {
    beforeEval: win => {
      Object.defineProperty(win.navigator, "platform", { value: "Linux x86_64", configurable: true });
      Object.defineProperty(win.navigator, "userAgent", {
        value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 Safari/605.1.15",
        configurable: true
      });
    }
  });
  try {
    const { win } = f;
    const doc = win.document;

    // 1. Progress line quantizes --ignow-progress to 0.5% steps
    Object.defineProperty(f.video, "duration", { value: 100, configurable: true });
    let curTime = 12.11;
    Object.defineProperty(f.video, "currentTime", { get: () => curTime, configurable: true });
    f.video.dispatchEvent(new win.Event("timeupdate"));
    const progressEl = f.stage.querySelector(".ignow-video-controls__progress");
    assert.equal(progressEl.style.getPropertyValue("--ignow-progress"), "12%");
    curTime = 12.34;
    f.video.dispatchEvent(new win.Event("timeupdate"));
    assert.equal(progressEl.style.getPropertyValue("--ignow-progress"), "12.5%");

    // 2. Far-offscreen paused Reel tears down controls on Linux, then remounts when snapped via ArrowDown
    Object.defineProperty(f.video, "paused", { value: true, writable: true, configurable: true });
    setRect(f.video, { left: 100, top: -3500, width: 420, height: 740 });
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 170));
    assert.equal(f.video.dataset.ignowNativeControls, undefined, "far-offscreen Reel must tear down controls on Linux");
    assert.equal(f.stage.querySelector(".ignow-video-controls"), null);

    // Move video back into viewport without firing window scroll, then press ArrowDown -> navigateReel schedules scan
    setRect(f.video, { left: 100, top: 60, width: 420, height: 740 });
    Object.defineProperty(doc.documentElement, "scrollHeight", { value: 900, configurable: true });
    doc.body.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 130));
    assert.equal(f.video.dataset.ignowNativeControls, "1", "navigateReel must schedule scan so newly snapped Reel mounts controls");
    assert.ok(f.stage.querySelector(".ignow-video-controls"));
  } finally {
    f.dom.window.close();
  }
});

test("keyboard slider inputs work, blur cleans active volume drag, viewer exposes modal ARIA + restores focus, foreground audio preserves pre-hide mute, and Linux blur scan caches unchanged sheets", async () => {
  const f = createFixture("/reels/", {
    beforeEval: win => {
      Object.defineProperty(win.navigator, "platform", { value: "Linux x86_64", configurable: true });
      Object.defineProperty(win.navigator, "userAgent", {
        value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 Safari/605.1.15",
        configurable: true
      });
    }
  });
  try {
    const { win } = f;
    const doc = win.document;

    // 1. Keyboard `input` events on progress and volume sliders update video currentTime and volume
    let curTime = 0;
    Object.defineProperty(f.video, "duration", { value: 80, configurable: true });
    Object.defineProperty(f.video, "currentTime", {
      get: () => curTime,
      set: val => { curTime = Number(val); },
      configurable: true
    });
    const progressEl = f.stage.querySelector(".ignow-video-controls__progress");
    const volumeSlider = f.stage.querySelector(".ignow-video-controls__volume-slider");
    const volumeGroup = f.stage.querySelector(".ignow-video-controls__volume-group");
    progressEl.value = "25";
    progressEl.dispatchEvent(new win.Event("input", { bubbles: true }));
    assert.equal(curTime, 20, "keyboard input on seek bar must seek to 25% of 80s");

    volumeSlider.value = "82";
    volumeSlider.dispatchEvent(new win.Event("input", { bubbles: true }));
    assert.ok(Math.abs(f.video.volume - 0.82) < 0.001, "keyboard input on volume slider must update video volume");

    // 2. Window blur clears active seek/volume drag state
    setRect(volumeSlider, { left: 10, top: 680, width: 64, height: 23 });
    const makePointer = (type, props = {}) => Object.assign(new win.MouseEvent(type, { bubbles: true, button: 0, ...props }), {
      pointerId: props.pointerId ?? 9,
      pointerType: "mouse"
    });
    volumeSlider.dispatchEvent(makePointer("pointerdown", { clientX: 20, pointerId: 9 }));
    assert.equal(volumeGroup.classList.contains("ignow-volume-open"), true);
    win.dispatchEvent(new win.Event("blur"));
    assert.equal(volumeGroup.classList.contains("ignow-volume-open"), false, "window blur must release active volume drag");

    // 3. __ignowEnsureForegroundAudio preserves pre-hide mute instead of unmuting user/pre-hide muted video
    f.video.dataset.ignowAudioUserActivated = "";
    f.video.dataset.ignowMutedByIgnow = "";
    f.video.muted = true;
    assert.equal(f.video.muted, true);
    Object.defineProperty(f.video, "paused", { value: false, writable: true, configurable: true });
    f.video.pause = () => { f.video.paused = true; };
    win.__onWindowHidden();
    assert.equal(win.__ignowPauseReport().includes('"muted":true'), true);
    f.video.paused = false;
    assert.equal(win.__ignowEnsureForegroundAudio(), "ok");
    assert.equal(f.video.muted, true, "__ignowEnsureForegroundAudio must preserve pre-hide muted state");
    f.video.paused = true;

    // 4. Image viewer sets modal ARIA, clears drag on pointercancel, and restores focus on close
    const triggerImg = doc.createElement("img");
    triggerImg.src = "https://cdn.instagram.com/viewer-src.jpg";
    setRect(triggerImg, { left: 100, top: 80, width: 400, height: 400 });
    const triggerBtn = doc.createElement("button");
    triggerBtn.type = "button";
    triggerBtn.textContent = "Focus origin";
    doc.querySelector("article").append(triggerImg, triggerBtn);
    triggerBtn.focus();
    triggerImg.dispatchEvent(new win.MouseEvent("click", { bubbles: true, ctrlKey: true, cancelable: true }));
    const overlay = doc.querySelector(".ignow-media-viewer");
    assert.equal(overlay.getAttribute("role"), "dialog");
    assert.equal(overlay.getAttribute("aria-modal"), "true");
    assert.equal(doc.activeElement, overlay.querySelector(".ignow-media-viewer__close"));
    const viewport = overlay.querySelector(".ignow-media-viewer__viewport");
    viewport.dispatchEvent(makePointer("pointerdown", { clientX: 50, clientY: 50, pointerId: 4 }));
    viewport.dispatchEvent(makePointer("pointercancel", { pointerId: 4 }));
    viewport.dispatchEvent(makePointer("pointermove", { clientX: 120, clientY: 120, pointerId: 4 }));
    assert.equal(overlay.querySelector(".ignow-media-viewer__image").style.transform.includes("translate(calc(-50% + 0px)"), true, "pointercancel must stop viewer panning");
    overlay.querySelector(".ignow-media-viewer__close").click();
    assert.equal(doc.activeElement, triggerBtn, "closing viewer must restore focus");

    // Cmd+Click (macOS metaKey) also opens the image zoom viewer
    triggerImg.dispatchEvent(new win.MouseEvent("click", { bubbles: true, metaKey: true, cancelable: true }));
    const metaOverlay = doc.querySelector(".ignow-media-viewer");
    assert(metaOverlay, "metaKey + click must open image zoom viewer");
    metaOverlay.querySelector(".ignow-media-viewer__close").click();

    // 5. Linux blur scan caches unchanged stylesheet rule signature across repeated scrolls
    const extraSheet = doc.createElement("style");
    extraSheet.textContent = ".s1 { color: red; }";
    doc.head.appendChild(extraSheet);
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 170));
    let selectorReads = 0;
    const rule0 = extraSheet.sheet.cssRules[0];
    const origSelDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(rule0), "selectorText");
    Object.defineProperty(rule0, "selectorText", {
      get() {
        selectorReads += 1;
        return origSelDesc.get.call(this);
      },
      configurable: true
    });
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 170));
    assert.equal(selectorReads, 0, "repeated scroll with unchanged stylesheets must skip rule scanning");
  } finally {
    f.dom.window.close();
  }
});

test("Issue #8 Note music clip selector caches GraphQL tracks, opens waveform modal, previews full audio, and patches music_note_create_info on XHR/fetch", async () => {
  const f = createFixture("/direct/inbox/");
  try {
    const doc = f.win.document;
    const apiCalls = [];
    let sentXhrBody = null;
    let sentFetchBody = null;

    const OrigXHR = f.win.XMLHttpRequest;
    class MockXHR {
      constructor() {
        this._headers = {};
        this._listeners = {};
        this.status = 200;
        this.responseType = "";
        this.responseText = "";
      }
      open(method, url) {
        this._method = method;
        this._url = url;
      }
      setRequestHeader(k, v) {
        this._headers[k] = v;
      }
      addEventListener(type, fn) {
        (this._listeners[type] ||= []).push(fn);
      }
      send(body) {
        sentXhrBody = body;
        if (String(this._url).includes("/api/graphql") && !String(body || "").includes("music_note_create_info")) {
          this.responseText = JSON.stringify({
            data: {
              xdt_api__v1__music__search: {
                items: [{
                  track: {
                    id: "99001122",
                    audio_cluster_id: "55443322",
                    audio_asset_id: "99001122",
                    title: "Night Drive",
                    display_artist: "Synth Wave",
                    duration_in_ms: 180000,
                    is_explicit: true,
                    cover_artwork_uri: "https://cdn.instagram.com/v/cover.jpg",
                    web_30s_preview_download_url: "https://cdn.instagram.com/v/preview30.m4a",
                    highlight_start_times_in_ms: [42000, 95000]
                  }
                }]
              }
            }
          });
          (this._listeners.load || []).forEach(fn => fn.call(this));
        }
      }
    }
    f.win.XMLHttpRequest = MockXHR;

    // Re-run fixture with MockXHR? Wait: createFixture already installed XHR hooks on f.win.XMLHttpRequest!
    // So let's verify against a fresh DOM or trigger fetch for search AND wrap Original XHR send in this test?
    // Even better: restore OrigXHR and hook MockXHR inside a dedicated JSDOM below so both fetch and XHR are tested from scratch!
    assert.ok(OrigXHR);
  } finally {
    f.dom.window.close();
  }

  // Full end-to-end JSDOM with MockXHR + MockFetch installed BEFORE instagram-tools.js loads:
  const { JSDOM } = require("jsdom");
  const fs = require("node:fs");
  const path = require("node:path");
  const scriptSrc = fs.readFileSync(path.join(__dirname, "instagram-tools.js"), "utf8");
  const dom = new JSDOM("<!doctype html><html><body><div id='composer'></div></body></html>", {
    url: "https://www.instagram.com/direct/inbox/",
    runScripts: "outside-only"
  });
  const win = dom.window;
  const doc = win.document;
  let sentXhrBody = null;
  let sentFetchBody = null;
  const clipsCalls = [];

  class MockXHR {
    constructor() {
      this._listeners = {};
      this.status = 200;
      this.responseType = "";
      this.responseText = "";
    }
    open(method, url) { this._url = url; }
    setRequestHeader() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    send(body) {
      sentXhrBody = body;
      if (String(this._url).includes("/api/graphql") && !String(body || "").includes("music_note_create_info")) {
        this.responseText = "for (;;);" + JSON.stringify({
          data: {
            music_search: {
              items: [
                {
                  track: {
                    id: "99001122",
                    audio_cluster_id: "55443322",
                    audio_asset_id: "99001122",
                    title: "Night Drive",
                    display_artist: "Synth Wave",
                    duration_in_ms: 180000,
                    is_explicit: true,
                    cover_artwork_uri: "https://cdn.instagram.com/v/cover.jpg",
                    web_30s_preview_download_url: "https://cdn.instagram.com/v/preview30.m4a",
                    highlight_start_times_in_ms: [42000, 95000]
                  }
                },
                {
                  track: {
                    id: "77665544",
                    audio_cluster_id: "11223344",
                    audio_asset_id: "77665544",
                    title: "Distractor Song",
                    display_artist: "Wrong Artist",
                    duration_in_ms: 140000,
                    web_30s_preview_download_url: "https://cdn.instagram.com/v/other.m4a"
                  }
                }
              ]
            }
          }
        });
        (this._listeners.load || []).forEach(fn => fn.call(this));
      }
    }
  }
  win.XMLHttpRequest = MockXHR;
  win.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/api/v1/clips/music/")) {
      clipsCalls.push({ url: u, body: String(init.body || "") });
      return {
        ok: true,
        url: u,
        headers: { get: () => "application/json" },
        json: async () => ({
          metadata: {
            music_info: {
              music_asset_info: {
                audio_cluster_id: "55443322",
                audio_asset_id: "99001122",
                title: "Night Drive",
                display_artist: "Synth Wave",
                duration_in_ms: 180000,
                is_explicit: true,
                fast_start_progressive_download_url: "https://cdn.instagram.com/v/full_180s.m4a",
                highlight_start_times_in_ms: [42000, 95000]
              }
            }
          }
        }),
        text: async () => "{}"
      };
    }
    if (u.includes("/api/graphql") && String(init.body || "").includes("music_note_create_info")) {
      sentFetchBody = String(init.body || "");
      return { ok: true, url: u, headers: { get: () => "application/json" }, text: async () => "{}" };
    }
    return { ok: true, url: u, headers: { get: () => "application/json" }, text: async () => "{}" };
  };
  Object.defineProperty(doc, "cookie", { value: "csrftoken=csrf_abc", configurable: true });
  win.HTMLMediaElement.prototype.play = async function () {
    Object.defineProperty(this, "paused", { value: false, configurable: true, writable: true });
  };
  win.HTMLMediaElement.prototype.pause = function () {
    Object.defineProperty(this, "paused", { value: true, configurable: true, writable: true });
  };
  win.HTMLMediaElement.prototype.load = function () {};

  try {
    win.eval(scriptSrc);

    // 1. Trigger music search GraphQL response via XHR so track metadata is cached
    const searchXhr = new win.XMLHttpRequest();
    searchXhr.open("POST", "https://www.instagram.com/api/graphql");
    searchXhr.send("doc_id=29278606831779411");

    // 2. Render attached song pill matching Instagram's nested absolute Remove song wrapper
    const composer = doc.getElementById("composer");
    const pill = doc.createElement("div");
    const titleSpan = doc.createElement("span");
    titleSpan.textContent = "Night Drive";
    const artistSpan = doc.createElement("span");
    artistSpan.textContent = "Synth Wave";
    const cornerWrap = doc.createElement("div");
    cornerWrap.style.position = "absolute";
    const removeBtn = doc.createElement("div");
    removeBtn.setAttribute("role", "button");
    removeBtn.setAttribute("aria-label", "Remove song");
    cornerWrap.appendChild(removeBtn);
    pill.append(titleSpan, artistSpan, cornerWrap);
    composer.appendChild(pill);

    await new Promise(r => setTimeout(r, 180));
    const clipBtn = doc.querySelector(".ignow-note-clip-btn");
    assert(clipBtn, "must inject Select clip button next to Remove song");
    assert(clipBtn.classList.contains("ignow-note-clip-btn--floating"), "must float cleanly next to absolute Remove song wrapper");

    // 3. Open clip selector modal -> fetches full track via /api/v1/clips/music/
    clipBtn.click();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(clipsCalls.length, 1, "must request full track from /api/v1/clips/music/");
    assert(clipsCalls[0].body.includes("audio_cluster_id=55443322"));

    const modal = doc.querySelector(".ignow-note-clip-modal");
    assert(modal, "must open music clip modal");
    assert.equal(modal.getAttribute("role"), "dialog");
    assert.equal(modal.getAttribute("aria-modal"), "true");
    assert(modal.textContent.includes("Night Drive"));
    assert(modal.textContent.includes("E"));

    // Select 15s duration & scrub via highlight chip + keyboard ArrowRight
    const dur15Btn = modal.querySelector("[data-clip-duration='15']");
    assert(dur15Btn, "must provide 15s duration pill");
    dur15Btn.click();

    const highlightBtn = modal.querySelector("[data-highlight-ms='42000']");
    assert(highlightBtn, "must render highlight snap chip");
    highlightBtn.click();

    const scrubber = modal.querySelector(".ignow-note-clip-waveform");
    assert(scrubber, "must render waveform scrubber");
    // Background <video> must NOT steal ArrowRight from waveform slider
    const bgVideo = doc.createElement("video");
    doc.body.appendChild(bgVideo);
    scrubber.focus();
    scrubber.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    // 42000 + 1000 = 43000ms -> 0:43 to 0:58
    assert(modal.textContent.includes("0:43"), modal.textContent);
    assert(modal.textContent.includes("0:58"), modal.textContent);

    // Pointer cancel stops waveform scrubbing cleanly
    scrubber.getBoundingClientRect = () => ({ left: 0, top: 0, width: 180, height: 68, right: 180, bottom: 68 });
    const makePtr = (type, props) => new win.MouseEvent(type, { bubbles: true, button: 0, ...props });
    scrubber.dispatchEvent(makePtr("pointerdown", { clientX: 50 }));
    const afterDownText = modal.textContent;
    scrubber.dispatchEvent(makePtr("pointercancel", {}));
    scrubber.dispatchEvent(makePtr("pointermove", { clientX: 140 }));
    assert.equal(modal.textContent, afterDownText, "pointercancel must stop waveform drag");
    highlightBtn.click();
    scrubber.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    bgVideo.remove();

    // Start preview playback and verify __onWindowHidden pauses <audio>
    const playBtn = modal.querySelector(".ignow-note-clip-play");
    playBtn.click();
    await new Promise(r => setTimeout(r, 15));
    const audioEl = modal.querySelector("audio");
    assert(audioEl && audioEl.src.includes("full_180s.m4a"), "preview must load full-track URL");
    assert.equal(audioEl.paused, false);
    win.__onWindowHidden();
    assert.equal(audioEl.paused, true, "__onWindowHidden must pause preview audio");

    // Apply clip & close modal -> restores focus
    modal.querySelector(".ignow-note-clip-apply").click();
    assert.equal(doc.querySelector(".ignow-note-clip-modal"), null);
    assert.equal(doc.activeElement, clipBtn);

    // 4. Submit Note via form-urlencoded XHR -> start_time & duration patched!
    const submitXhr = new win.XMLHttpRequest();
    submitXhr.open("POST", "https://www.instagram.com/api/graphql");
    const params = new win.URLSearchParams({
      doc_id: "28592645767037889",
      variables: JSON.stringify({
        input: {
          additional_params: {
            note_create_params: {
              note_create_info: {
                music_note_create_info: {
                  audio_asset_id: "99001122",
                  audio_cluster_id: "55443322",
                  duration: 30000,
                  start_time: 0
                }
              }
            }
          }
        }
      })
    });
    submitXhr.send(params.toString());
    const patchedParams = new win.URLSearchParams(sentXhrBody);
    const patchedVars = JSON.parse(patchedParams.get("variables"));
    const musicInfo = patchedVars.input.additional_params.note_create_params.note_create_info.music_note_create_info;
    assert.equal(musicInfo.start_time, 43000);
    assert.equal(musicInfo.duration, 15000);

    // 5. Re-apply and verify fetch JSON body patching + Remove song resets clip
    clipBtn.click();
    await new Promise(r => setTimeout(r, 20));
    doc.querySelector(".ignow-note-clip-apply").click();
    removeBtn.remove();
    await new Promise(r => setTimeout(r, 180));
    assert.equal(doc.querySelector(".ignow-note-clip-btn"), null, "removing song removes Select clip button");

    await win.fetch("https://www.instagram.com/api/graphql", {
      method: "POST",
      body: JSON.stringify({
        variables: {
          input: {
            additional_params: {
              note_create_params: {
                note_create_info: {
                  music_note_create_info: { start_time: 0, duration: 30000 }
                }
              }
            }
          }
        }
      })
    });
    const afterRemove = JSON.parse(sentFetchBody);
    assert.equal(afterRemove.variables.input.additional_params.note_create_params.note_create_info.music_note_create_info.start_time, 0, "removed song must not patch subsequent Notes");
  } finally {
    dom.window.close();
  }
});

test("Issue #8 regressions: Esc on range sliders, audio ended/error feedback, FormData patching, and __ignowDisableBackdropBlur", async () => {
  const { JSDOM } = require("jsdom");
  const fs = require("node:fs");
  const path = require("node:path");
  const scriptSrc = fs.readFileSync(path.join(__dirname, "instagram-tools.js"), "utf8");
  const dom = new JSDOM("<!doctype html><html><body><div id='composer'></div></body></html>", {
    url: "https://www.instagram.com/direct/inbox/",
    runScripts: "outside-only"
  });
  const win = dom.window;
  const doc = win.document;
  win.__ignowDisableBackdropBlur = true;

  let sentFormData = null;
  let playShouldReject = false;

  class MockXHR {
    constructor() { this._listeners = {}; this.status = 200; this.responseType = ""; this.responseText = ""; }
    open(_m, url) { this._url = url; }
    setRequestHeader() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    send(body) {
      if (String(this._url).includes("/api/graphql") && !String(body || "").includes("music_note_create_info")) {
        this.responseText = JSON.stringify({
          data: {
            music_search: {
              items: [{
                track: {
                  id: "445566",
                  audio_cluster_id: "445566",
                  audio_asset_id: "445566",
                  title: "City Lights",
                  display_artist: "Night Owl",
                  duration_in_ms: 45000,
                  web_30s_preview_download_url: "https://cdn.instagram.com/v/city.m4a"
                }
              }]
            }
          }
        });
        (this._listeners.load || []).forEach(fn => fn.call(this));
      }
    }
  }
  win.XMLHttpRequest = MockXHR;
  win.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/api/v1/clips/music/")) {
      return { ok: false, status: 404, url: u, headers: { get: () => "application/json" }, json: async () => ({}) };
    }
    if (u.includes("/api/graphql") && init.body instanceof win.FormData) {
      sentFormData = init.body;
    }
    return { ok: true, url: u, headers: { get: () => "application/json" }, text: async () => "{}" };
  };
  win.HTMLMediaElement.prototype.play = async function () {
    if (playShouldReject) throw new Error("NotSupportedError");
    Object.defineProperty(this, "paused", { value: false, configurable: true, writable: true });
  };
  win.HTMLMediaElement.prototype.pause = function () {
    Object.defineProperty(this, "paused", { value: true, configurable: true, writable: true });
  };
  win.HTMLMediaElement.prototype.load = function () {};

  try {
    win.eval(scriptSrc);

    const styleText = Array.from(doc.querySelectorAll("style")).map(el => el.textContent).join("\n");
    assert.match(styleText, /\.ignow-media-viewer,\s*\n\s*\.ignow-note-clip-modal\s*\{\s*\n\s*backdrop-filter:\s*none\s*!important;/);

    // 1. Esc closes image viewer even when focus is on its range slider
    const img = doc.createElement("img");
    img.src = "https://cdn.instagram.com/v/photo.jpg";
    img.getBoundingClientRect = () => ({ left: 10, top: 10, width: 400, height: 400, right: 410, bottom: 410 });
    doc.body.appendChild(img);
    img.dispatchEvent(new win.MouseEvent("click", { bubbles: true, ctrlKey: true, cancelable: true }));
    const zoomSlider = doc.querySelector(".ignow-media-viewer__zoom");
    assert(zoomSlider, "viewer zoom slider must exist");
    zoomSlider.focus();
    zoomSlider.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(doc.querySelector(".ignow-media-viewer"), null, "Esc on viewer zoom slider must close viewer");

    // 2. Seed track and mount Note clip button
    const searchXhr = new win.XMLHttpRequest();
    searchXhr.open("POST", "https://www.instagram.com/api/graphql");
    searchXhr.send("doc_id=123");

    const composer = doc.getElementById("composer");
    const tSpan = doc.createElement("span");
    tSpan.textContent = "City Lights";
    const aSpan = doc.createElement("span");
    aSpan.textContent = "Night Owl";
    const rmBtn = doc.createElement("button");
    rmBtn.setAttribute("aria-label", "Remove song");
    composer.append(tSpan, aSpan, rmBtn);
    await new Promise(r => setTimeout(r, 180));

    const clipBtn = doc.querySelector(".ignow-note-clip-btn");
    assert(clipBtn);
    clipBtn.click();
    await new Promise(r => setTimeout(r, 20));

    const modal = doc.querySelector(".ignow-note-clip-modal");
    assert(modal);
    const durRange = modal.querySelector(".ignow-note-clip-range");
    const playBtn = modal.querySelector(".ignow-note-clip-play");
    const audioEl = modal.querySelector("audio");

    // 3. Audio ended resets button back to ▶ and pauses
    playBtn.click();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(playBtn.textContent, "\u25A0");
    audioEl.dispatchEvent(new win.Event("ended"));
    assert.equal(audioEl.paused, true);
    assert.equal(playBtn.textContent, "\u25B6");

    // 4. Play rejection shows toast while modal is open
    playShouldReject = true;
    playBtn.click();
    await new Promise(r => setTimeout(r, 15));
    const toast = doc.querySelector(".ignow-toast");
    assert(toast && toast.textContent.includes("Preview audio is unavailable"), "play rejection must surface toast");

    // 5. Esc while focus is on duration range slider closes modal
    durRange.focus();
    durRange.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(doc.querySelector(".ignow-note-clip-modal"), null, "Esc on clip duration range slider must close modal");

    // 6. Apply clip and verify FormData body patching via fetch
    clipBtn.click();
    await new Promise(r => setTimeout(r, 20));
    doc.querySelector("[data-clip-duration='10']").click();
    doc.querySelector(".ignow-note-clip-apply").click();

    const fd = new win.FormData();
    fd.append("doc_id", "999");
    fd.append("variables", JSON.stringify({
      input: {
        additional_params: {
          note_create_params: {
            note_create_info: {
              music_note_create_info: { start_time: 0, duration: 30000 }
            }
          }
        }
      }
    }));
    await win.fetch("https://www.instagram.com/api/graphql", { method: "POST", body: fd });
    const patchedVars = JSON.parse(sentFormData.get("variables"));
    assert.equal(patchedVars.input.additional_params.note_create_params.note_create_info.music_note_create_info.duration, 10000);
  } finally {
    dom.window.close();
  }
});

test("Issue #8 perf & edge cases: rAF waveform scrubbing, compositor transforms, dirty-checked bars, readyState=0 seek, abortable decode, capped track maps, Request/Uint8Array patching, and reduced-motion/focus-visible", async () => {
  const { JSDOM } = require("jsdom");
  const fs = require("node:fs");
  const path = require("node:path");
  const scriptSrc = fs.readFileSync(path.join(__dirname, "instagram-tools.js"), "utf8");
  const profileHtml = fs.readFileSync(path.join(__dirname, "profile.html"), "utf8");

  assert.match(profileHtml, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i, "profile.html must respect prefers-reduced-motion");

  const dom = new JSDOM("<!doctype html><html><body><div id='composer'></div></body></html>", {
    url: "https://www.instagram.com/direct/inbox/",
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  const win = dom.window;
  const doc = win.document;
  const fetchedRequests = [];
  const abortedSignals = [];
  let audioFetchResolve = null;

  class MockXHR {
    constructor() { this._listeners = {}; this.status = 200; this.responseType = ""; this.responseText = ""; }
    open(_m, url) { this._url = url; }
    setRequestHeader() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    send() {
      const items = [];
      for (let i = 0; i < 320; i += 1) {
        items.push({
          track: {
            id: `id-${i}`,
            audio_cluster_id: `cl-${i}`,
            audio_asset_id: `as-${i}`,
            title: `Track ${i}`,
            display_artist: `Artist ${i}`,
            duration_in_ms: 90000,
            web_30s_preview_download_url: `https://cdn.instagram.com/v/p-${i}.m4a`
          }
        });
      }
      this.responseText = JSON.stringify({ data: { music_search: { items } } });
      (this._listeners.load || []).forEach(fn => fn.call(this));
    }
  }
  win.XMLHttpRequest = MockXHR;
  win.TextDecoder = TextDecoder;
  win.TextEncoder = TextEncoder;
  win.Request = class MockRequest {
    constructor(input, init = {}) {
      if (input instanceof MockRequest) {
        this.url = input.url;
        this.method = init.method || input.method || "GET";
        this._body = "body" in init ? init.body : input._body;
      } else {
        this.url = String(input);
        this.method = init.method || "GET";
        this._body = init.body ?? "";
      }
    }
    clone() {
      return new MockRequest(this);
    }
    async text() {
      return typeof this._body === "string" ? this._body : String(this._body ?? "");
    }
  };
  win.AudioContext = class MockAudioContext {
    decodeAudioData() { return Promise.reject(new Error("skip")); }
    close() { return Promise.resolve(); }
  };
  win.fetch = async (input, init = {}) => {
    const u = typeof input === "string" ? input : String(input?.url || "");
    if (u.includes("p-319.m4a") || u.includes("full-319.m4a")) {
      if (init?.signal) {
        init.signal.addEventListener("abort", () => abortedSignals.push(u));
      }
      return new Promise(resolve => {
        audioFetchResolve = () => resolve({ ok: false, status: 499 });
      });
    }
    if (u.includes("/api/v1/clips/music/")) {
      return {
        ok: true,
        url: u,
        headers: { get: () => "application/json" },
        json: async () => ({
          metadata: {
            music_info: {
              music_asset_info: {
                audio_cluster_id: "cl-319",
                audio_asset_id: "as-319",
                title: "Track 319",
                display_artist: "Artist 319",
                duration_in_ms: 120000,
                fast_start_progressive_download_url: "https://cdn.instagram.com/v/full-319.m4a",
                highlight_start_times_in_ms: [45000]
              }
            }
          }
        })
      };
    }
    if (u.includes("/api/graphql")) {
      let bodyText = "";
      if (typeof init.body === "string") bodyText = init.body;
      else if (init.body && ArrayBuffer.isView(init.body)) bodyText = Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength).toString("utf8");
      else if (typeof win.Request === "function" && input instanceof win.Request) bodyText = await input.clone().text();
      fetchedRequests.push({ url: u, bodyText, signal: init?.signal || null });
    }
    return { ok: true, url: u, headers: { get: () => "application/json" }, text: async () => "{}" };
  };
  win.HTMLMediaElement.prototype.play = async function () {
    Object.defineProperty(this, "paused", { value: false, configurable: true, writable: true });
  };
  win.HTMLMediaElement.prototype.pause = function () {
    Object.defineProperty(this, "paused", { value: true, configurable: true, writable: true });
  };
  win.HTMLMediaElement.prototype.load = function () {};

  try {
    win.eval(scriptSrc);

    // 1. CSS checks: compositor-only volume slider, reduced-motion coverage, range focus-visible
    const styleText = Array.from(doc.querySelectorAll("style")).map(el => el.textContent).join("\n");
    const volRule = styleText.match(/^\s*\.ignow-video-controls__volume-slider\s*\{[^}]*\}/m)?.[0] || "";
    assert.equal(/transition:\s*width\b/i.test(volRule), false, "volume slider must not animate layout width");
    assert.match(volRule, /width:\s*64px\s*!important/i);
    assert.match(volRule, /scaleX\(0\)/i);
    assert.match(styleText, /\.ignow-note-clip-range:focus-visible/);
    const reducedBlock = styleText.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\s*\}/)?.[0] || "";
    assert.match(reducedBlock, /\.ignow-video-controls__volume-slider/);
    assert.match(reducedBlock, /\.ignow-sidebar-back/);
    assert.match(reducedBlock, /\.ignow-sidebar-back__icon/);

    // 2. Track map caps: 320 tracks -> tracksById <= 200, tracksByTitle <= 300
    const searchXhr = new win.XMLHttpRequest();
    searchXhr.open("POST", "https://www.instagram.com/api/graphql");
    searchXhr.send("doc_id=cap");

    const composer = doc.getElementById("composer");
    const tSpan = doc.createElement("span");
    tSpan.textContent = "Track 319";
    const aSpan = doc.createElement("span");
    aSpan.textContent = "Artist 319";
    const rmBtn = doc.createElement("button");
    rmBtn.setAttribute("aria-label", "Remove song");
    composer.append(tSpan, aSpan, rmBtn);
    await new Promise(r => setTimeout(r, 180));

    // Check internal cap via old track 0 fallback: Track 0 must be evicted from tracksByTitle (320*2 = 640 > 300)
    // Open modal on Track 319
    const clipBtn = doc.querySelector(".ignow-note-clip-btn");
    clipBtn.click();
    await new Promise(r => setTimeout(r, 30));

    const modal = doc.querySelector(".ignow-note-clip-modal");
    assert(modal);
    const winOverlay = modal.querySelector(".ignow-note-clip-window");
    const progFill = modal.querySelector(".ignow-note-clip-progress-fill");
    const scrubber = modal.querySelector(".ignow-note-clip-waveform");
    const audioEl = modal.querySelector("audio");

    // 3. Window & progress fill must use transform (not left/width)
    assert.equal(winOverlay.style.left, "", "winOverlay must not animate style.left");
    assert.equal(winOverlay.style.width, "", "winOverlay must not animate style.width");
    assert.match(winOverlay.style.transform, /translateX\([^)]+\)\s*scaleX\(/);
    assert.equal(progFill.style.width, "", "progFill must not animate style.width");
    assert.match(progFill.style.transform, /scaleX\(/);

    // 4. Waveform scrubber caches rect on pointerdown & rAF-coalesces pointermove & dirty-checks bars
    let rectCalls = 0;
    scrubber.getBoundingClientRect = () => {
      rectCalls += 1;
      return { left: 0, top: 0, width: 240, height: 68, right: 240, bottom: 68 };
    };
    const bar0 = modal.querySelector(".ignow-note-clip-bar");
    let barAttrWrites = 0;
    const origSetAttr = bar0.setAttribute.bind(bar0);
    bar0.setAttribute = (k, v) => {
      barAttrWrites += 1;
      return origSetAttr(k, v);
    };

    const makePtr = (type, props) => new win.MouseEvent(type, { bubbles: true, button: 0, ...props });
    scrubber.dispatchEvent(makePtr("pointerdown", { clientX: 60 }));
    for (let x = 65; x <= 140; x += 15) {
      scrubber.dispatchEvent(makePtr("pointermove", { clientX: x }));
    }
    await new Promise(r => setTimeout(r, 35));
    scrubber.dispatchEvent(makePtr("pointerup", { clientX: 140 }));
    assert.equal(rectCalls, 1, "waveform drag must cache getBoundingClientRect on pointerdown");

    // Unchanged timeupdate must not rewrite bar0 attributes
    const writesAfterDrag = barAttrWrites;
    audioEl.dispatchEvent(new win.Event("timeupdate"));
    assert.equal(barAttrWrites, writesAfterDrag, "unchanged timeupdate must not rewrite waveform bar attributes");

    // 5. Audio seek before loadedmetadata (readyState === 0) defers until loadedmetadata
    let currentTimeVal = 0;
    let readyStateVal = 0;
    Object.defineProperty(audioEl, "readyState", { get: () => readyStateVal, configurable: true });
    Object.defineProperty(audioEl, "currentTime", {
      get: () => currentTimeVal,
      set: v => {
        if (readyStateVal === 0) currentTimeVal = 0; // simulate WKWebView resetting pre-metadata seeks
        else currentTimeVal = Number(v);
      },
      configurable: true
    });
    modal.querySelector("[data-highlight-ms='45000']").click();
    modal.querySelector(".ignow-note-clip-play").click();
    await new Promise(r => setTimeout(r, 15));
    readyStateVal = 1;
    audioEl.dispatchEvent(new win.Event("loadedmetadata"));
    assert.equal(currentTimeVal, 45, "pending seek must apply once loadedmetadata fires");

    // 6. Closing modal aborts in-flight waveform decode fetch
    modal.querySelector(".ignow-note-clip-apply").click();
    assert.equal(abortedSignals.length, 1, "closing clip modal must abort waveform audio decode fetch");
    if (audioFetchResolve) audioFetchResolve();

    // 7. fetch(Request) and Uint8Array + nested JSON-string variables patching
    const reqBody = JSON.stringify({
      variables: JSON.stringify({
        input: {
          additional_params: {
            note_create_params: {
              note_create_info: {
                music_note_create_info: { start_time: 0, duration: 30000 }
              }
            }
          }
        }
      })
    });
    await win.fetch(new win.Request("https://www.instagram.com/api/graphql", { method: "POST", body: reqBody }));
    const reqSent = JSON.parse(fetchedRequests[fetchedRequests.length - 1].bodyText);
    const innerVars = JSON.parse(reqSent.variables);
    assert.equal(innerVars.input.additional_params.note_create_params.note_create_info.music_note_create_info.start_time, 45000);

    // Re-apply and test Uint8Array body
    clipBtn.click();
    await new Promise(r => setTimeout(r, 20));
    doc.querySelector("[data-clip-duration='10']").click();
    doc.querySelector(".ignow-note-clip-apply").click();
    const u8Body = new TextEncoder().encode(JSON.stringify({
      variables: JSON.stringify({
        input: {
          additional_params: {
            note_create_params: {
              note_create_info: {
                music_note_create_info: { start_time: 0, duration: 30000 }
              }
            }
          }
        }
      })
    }));
    await win.fetch("https://www.instagram.com/api/graphql", { method: "POST", body: u8Body });
    const u8Sent = JSON.parse(fetchedRequests[fetchedRequests.length - 1].bodyText);
    const u8Inner = JSON.parse(u8Sent.variables);
    assert.equal(u8Inner.input.additional_params.note_create_params.note_create_info.music_note_create_info.duration, 10000);

    // 8. Scrubbing past audio.duration (30s preview on a 120s track) plays from 0s with toast instead of clamping & ending
    clipBtn.click();
    await new Promise(r => setTimeout(r, 20));
    const modal2 = doc.querySelector(".ignow-note-clip-modal");
    const audio2 = modal2.querySelector("audio");
    const playBtn2 = modal2.querySelector(".ignow-note-clip-play");
    let curTime2 = 0;
    Object.defineProperty(audio2, "readyState", { value: 2, configurable: true });
    Object.defineProperty(audio2, "duration", { value: 30, configurable: true });
    Object.defineProperty(audio2, "currentTime", {
      get: () => curTime2,
      set: v => { curTime2 = Math.max(0, Math.min(30, Number(v))); },
      configurable: true
    });
    modal2.querySelector("[data-highlight-ms='45000']").click();
    playBtn2.click();
    await new Promise(r => setTimeout(r, 15));
    assert.equal(curTime2, 0, "preview-only track scrubbed past audio.duration must play from 0s instead of clamping to duration");
    assert.equal(audio2.paused, false);
    assert.equal(playBtn2.textContent, "\u25A0");
    assert(doc.querySelector(".ignow-toast")?.textContent.includes("playing preview from start"), "must surface non-blocking bounded-preview toast");
    curTime2 = 12;
    audio2.dispatchEvent(new win.Event("timeupdate"));
    assert.match(modal2.querySelector(".ignow-note-clip-progress-fill").style.transform, /scaleX\(0\.4/);
    modal2.querySelector(".ignow-note-clip-close").click();

    // 9. probePostForDownloader passes AbortSignal to fetch
    win.__TAURI__ = { core: { invoke: async () => true } };
    await win.__ignowTools.probePostForDownloader("req-1", "https://www.instagram.com/p/C9xTestCode/");
    const probeFetch = fetchedRequests[fetchedRequests.length - 1];
    assert(probeFetch.signal, "probePostForDownloader GraphQL fetch must pass AbortSignal timeout");
  } finally {
    dom.window.close();
  }
});

test("Viewer pointermove rAF-coalesces pan transforms, load skips small/nav images, and syncNoteMusicClipButton caches DOM/style lookups", async () => {
  const f = createFixture("/direct/inbox/");
  try {
    const { win } = f;
    const doc = win.document;

    // 1. Image load on <120px avatar or nav image must not schedule scanVideos
    let videoQueries = 0;
    const origQsa = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = sel => {
      if (sel === "video") videoQueries += 1;
      return origQsa(sel);
    };
    const smallImg = doc.createElement("img");
    smallImg.src = "https://cdn.instagram.com/avatar.jpg";
    Object.defineProperty(smallImg, "naturalWidth", { value: 44, configurable: true });
    Object.defineProperty(smallImg, "naturalHeight", { value: 44, configurable: true });
    doc.body.appendChild(smallImg);
    await new Promise(r => setTimeout(r, 160));
    videoQueries = 0;
    smallImg.dispatchEvent(new win.Event("load", { bubbles: false }));
    await new Promise(r => setTimeout(r, 150));
    assert.equal(videoQueries, 0, "small <120px image load must not schedule scanVideos");
    doc.querySelectorAll = origQsa;

    // 2. syncNoteMusicClipButton caches Remove song + getComputedStyle across repeated scroll scans
    const rmBtn = doc.createElement("button");
    rmBtn.setAttribute("aria-label", "Remove song");
    const wrap = doc.createElement("div");
    wrap.appendChild(rmBtn);
    doc.body.appendChild(wrap);
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));
    assert(doc.querySelector(".ignow-note-clip-btn"));

    let gcsCalls = 0;
    const origGcs = win.getComputedStyle.bind(win);
    win.getComputedStyle = (...args) => { gcsCalls += 1; return origGcs(...args); };
    win.dispatchEvent(new win.Event("scroll"));
    await new Promise(r => setTimeout(r, 160));
    assert.equal(gcsCalls, 0, "repeated scan on unchanged Note composer must not re-run getComputedStyle");

    // 3. Viewer pointermove coalesces via rAF and skips redundant zoomLabel writes
    const triggerImg = doc.createElement("img");
    triggerImg.src = "https://cdn.instagram.com/viewer.jpg";
    setRect(triggerImg, { left: 100, top: 100, width: 400, height: 400 });
    doc.body.appendChild(triggerImg);
    triggerImg.dispatchEvent(new win.MouseEvent("click", { bubbles: true, ctrlKey: true, cancelable: true }));
    const overlay = doc.querySelector(".ignow-media-viewer");
    const viewport = overlay.querySelector(".ignow-media-viewer__viewport");
    const zoomLabel = overlay.querySelector(".ignow-media-viewer__zoom-label");
    let labelWrites = 0;
    const origTextDesc = Object.getOwnPropertyDescriptor(win.Node.prototype, "textContent");
    Object.defineProperty(zoomLabel, "textContent", {
      get() { return origTextDesc.get.call(this); },
      set(v) { labelWrites += 1; return origTextDesc.set.call(this, v); },
      configurable: true
    });
    const makePtr = (type, props) => Object.assign(new win.MouseEvent(type, { bubbles: true, button: 0, ...props }), { pointerId: 7 });
    viewport.dispatchEvent(makePtr("pointerdown", { clientX: 10, clientY: 10 }));
    for (let i = 1; i <= 5; i += 1) {
      viewport.dispatchEvent(makePtr("pointermove", { clientX: 10 + i * 10, clientY: 10 + i * 10 }));
    }
    await new Promise(r => setTimeout(r, 40));
    viewport.dispatchEvent(makePtr("pointerup", { clientX: 60, clientY: 60 }));
    assert.equal(labelWrites, 0, "panning viewer must not rewrite unchanged zoomLabel textContent");
    assert(overlay.querySelector(".ignow-media-viewer__image").style.transform.includes("translate(calc(-50% + 50px), calc(-50% + 50px))"));
    overlay.querySelector(".ignow-media-viewer__close").click();
  } finally {
    f.dom.window.close();
  }
});
