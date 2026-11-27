const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const htmlPath = path.join(__dirname, "downloader.html");
const scriptPath = path.join(__dirname, "downloader.js");

const SAMPLE_POST = {
  shortcode: "C9xTokyoNight",
  pk: "3456789012345678901",
  username: "derinjapan1",
  postUrl: "https://www.instagram.com/p/C9xTokyoNight/",
  takenAt: "2026-11-16T00:00:00Z",
  caption: "Tokyo winter illuminations #tokyo",
  ffmpegAvailable: true,
  items: [
    {
      index: 0,
      kind: "video",
      thumbnailUrl: "https://cdn.instagram.com/v/thumb0.jpg",
      formats: [
        {
          id: "dash-0",
          label: "1080p MP4 (DASH Muxed)",
          width: 1080,
          height: 1920,
          bandwidth: 3200000,
          ext: "mp4",
          requiresMux: true,
          videoUrl: "https://cdn.instagram.com/v/dash_1080.mp4",
          audioUrl: "https://cdn.instagram.com/v/dash_audio.m4a"
        },
        {
          id: "prog-0",
          label: "720p MP4 (Video + Audio)",
          width: 720,
          height: 1280,
          bandwidth: 921600,
          ext: "mp4",
          requiresMux: false,
          videoUrl: "https://cdn.instagram.com/v/prog_720.mp4",
          audioUrl: null
        }
      ]
    },
    {
      index: 1,
      kind: "image",
      thumbnailUrl: "https://cdn.instagram.com/v/slide2.jpg",
      formats: [
        {
          id: "img-0",
          label: "1080x1350 JPG",
          width: 1080,
          height: 1350,
          bandwidth: 1458000,
          ext: "jpg",
          requiresMux: false,
          videoUrl: "https://cdn.instagram.com/v/slide2.jpg",
          audioUrl: null
        }
      ]
    }
  ]
};

function setupDownloaderDom(pendingContext = null) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const script = fs.readFileSync(scriptPath, "utf8");
  const calls = [];
  const dom = new JSDOM(html, {
    url: "https://tauri.localhost/downloader.html",
    runScripts: "outside-only"
  });
  const win = dom.window;
  win.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "take_pending_downloader_context") {
          return pendingContext;
        }
        if (command === "inspect_instagram_post") {
          return SAMPLE_POST;
        }
        if (command === "download_post_selection") {
          if (args.mode === "audio") {
            return {
              savedPaths: ["C:\\Users\\User\\Downloads\\IG-Now\\derinjapan1-20261116-9b3e7c1a.m4a"],
              captionPath: null,
              metadataPath: null,
              subfolder: null,
              warning: null
            };
          }
          if (args.mode === "single") {
            return {
              savedPaths: ["C:\\Users\\User\\Downloads\\IG-Now\\IG-Now-derinjapan1-C9xTokyoNight.mp4"],
              captionPath: null,
              metadataPath: null,
              subfolder: null,
              warning: null
            };
          }
          return {
            savedPaths: [
              "C:\\Users\\User\\Downloads\\IG-Now\\IG-Now-Post-derinjapan1-C9xTokyoNight\\01-video.mp4",
              "C:\\Users\\User\\Downloads\\IG-Now\\IG-Now-Post-derinjapan1-C9xTokyoNight\\02-image.jpg"
            ],
            captionPath: "C:\\Users\\User\\Downloads\\IG-Now\\IG-Now-Post-derinjapan1-C9xTokyoNight\\caption.txt",
            metadataPath: "C:\\Users\\User\\Downloads\\IG-Now\\IG-Now-Post-derinjapan1-C9xTokyoNight\\metadata.json",
            subfolder: "IG-Now-Post-derinjapan1-C9xTokyoNight",
            warning: null
          };
        }
        if (command === "save_caption_file") {
          return "C:\\Users\\User\\Downloads\\IG-Now\\IG-Now-Caption-derinjapan1-C9xTokyoNight.txt";
        }
        return null;
      }
    }
  };
  win.eval(script);
  return { dom, win, calls };
}

test("inspects pasted URL, populates MP4 formats + caption, and executes single/bundle/caption downloads", async () => {
  const f = setupDownloaderDom(null);
  try {
    await new Promise(r => setTimeout(r, 30));
    const urlInput = f.win.document.getElementById("url-input");
    const inspectBtn = f.win.document.getElementById("inspect-btn");
    urlInput.value = "https://www.instagram.com/reel/C9xTokyoNight/";
    inspectBtn.click();
    await new Promise(r => setTimeout(r, 40));

    const inspectCall = f.calls.find(c => c.command === "inspect_instagram_post");
    assert(inspectCall, "must invoke inspect_instagram_post");
    assert.equal(inspectCall.args.url, "https://www.instagram.com/reel/C9xTokyoNight/");

    const formatSelect = f.win.document.getElementById("format-select");
    assert.equal(formatSelect.options.length, 2);
    assert(formatSelect.options[0].textContent.includes("MP4"));

    const outputPreview = f.win.document.getElementById("output-name-preview");
    const audioSpec = f.win.document.getElementById("audio-spec-preview");
    const previewThumb = f.win.document.getElementById("preview-thumb");
    assert(outputPreview.textContent.includes("derinjapan1-20261116-<hash>-slide-1.mp4"), outputPreview.textContent);
    assert(audioSpec.textContent.includes("AAC"), audioSpec.textContent);
    assert.equal(previewThumb.getAttribute("src"), "https://cdn.instagram.com/v/thumb0.jpg");

    const captionBox = f.win.document.getElementById("caption-input");
    assert.equal(captionBox.value, "Tokyo winter illuminations #tokyo");

    // Pick second MP4 format and trigger single download
    formatSelect.value = "prog-0";
    f.win.document.getElementById("download-selected-btn").click();
    await new Promise(r => setTimeout(r, 40));

    const singleCall = f.calls.find(c => c.command === "download_post_selection" && c.args.mode === "single");
    assert(singleCall, "must invoke download_post_selection in single mode");
    assert.equal(singleCall.args.formatId, "prog-0");

    // Trigger Audio Only (.m4a) download
    const audioBtn = f.win.document.getElementById("download-audio-btn");
    assert.equal(audioBtn.disabled, false, "Audio Only must be enabled on video slide");
    audioBtn.click();
    await new Promise(r => setTimeout(r, 40));
    const audioCall = f.calls.find(c => c.command === "download_post_selection" && c.args.mode === "audio");
    assert(audioCall, "must invoke download_post_selection in audio mode");

    // Switching to Image slide disables Audio Only
    const slideSelect = f.win.document.getElementById("slide-select");
    slideSelect.value = "1";
    slideSelect.dispatchEvent(new f.win.Event("change"));
    assert.equal(audioBtn.disabled, true, "Audio Only must disable on still image slide");
    slideSelect.value = "0";
    slideSelect.dispatchEvent(new f.win.Event("change"));

    // Trigger bundle download
    f.win.document.getElementById("download-bundle-btn").click();
    await new Promise(r => setTimeout(r, 40));
    const bundleCall = f.calls.find(c => c.command === "download_post_selection" && c.args.mode === "bundle");
    assert(bundleCall, "must invoke bundle download");

    // Save caption separately
    captionBox.value = "Edited custom caption";
    f.win.document.getElementById("save-caption-btn").click();
    await new Promise(r => setTimeout(r, 40));
    const capCall = f.calls.find(c => c.command === "save_caption_file");
    assert(capCall, "must invoke save_caption_file");
    assert.equal(capCall.args.customCaption, "Edited custom caption");

    // Open downloads folder
    f.win.document.getElementById("open-folder-btn").click();
    await new Promise(r => setTimeout(r, 20));
    assert(f.calls.some(c => c.command === "open_downloads_folder"));
  } finally {
    f.dom.window.close();
  }
});

test("auto-loads pending context passed from Instagram window on open", async () => {
  const f = setupDownloaderDom({
    url: "https://www.instagram.com/p/C9xTokyoNight/",
    payloadJson: "{\"mock\":true}"
  });
  try {
    await new Promise(r => setTimeout(r, 50));
    assert.equal(f.win.document.getElementById("url-input").value, "https://www.instagram.com/p/C9xTokyoNight/");
    const inspectCall = f.calls.find(c => c.command === "inspect_instagram_post");
    assert(inspectCall);
    assert.equal(inspectCall.args.seedPayloadJson, "{\"mock\":true}");
  } finally {
    f.dom.window.close();
  }
});

test("auto-inspects Instagram URL from clipboard when opened standalone", async () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const script = fs.readFileSync(scriptPath, "utf8");
  const calls = [];
  const dom = new JSDOM(html, {
    url: "https://tauri.localhost/downloader.html",
    runScripts: "outside-only"
  });
  const win = dom.window;
  Object.defineProperty(win.navigator, "clipboard", {
    value: { readText: async () => "https://www.instagram.com/reel/C9xAutoClip/" },
    configurable: true
  });
  win.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "take_pending_downloader_context") return null;
        if (command === "inspect_instagram_post") return SAMPLE_POST;
        return null;
      }
    }
  };
  win.eval(script);
  try {
    await new Promise(r => setTimeout(r, 60));
    assert.equal(win.document.getElementById("url-input").value, "https://www.instagram.com/reel/C9xAutoClip/");
    assert(calls.some(c => c.command === "inspect_instagram_post" && c.args.url === "https://www.instagram.com/reel/C9xAutoClip/"));
  } finally {
    win.close();
  }
});

test("guards concurrent inspections, updates stale urlInput on payload-only context, and handles broken preview thumbnails", async () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const script = fs.readFileSync(scriptPath, "utf8");
  const calls = [];
  let releaseInspect;
  let inspectCount = 0;
  const dom = new JSDOM(html, {
    url: "https://tauri.localhost/downloader.html",
    runScripts: "outside-only"
  });
  const win = dom.window;
  win.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "take_pending_downloader_context") {
          return inspectCount === 0
            ? null
            : { url: "", payloadJson: "{\"seeded\":true}" };
        }
        if (command === "inspect_instagram_post") {
          inspectCount += 1;
          if (inspectCount === 1) {
            await new Promise(resolve => { releaseInspect = resolve; });
          }
          return SAMPLE_POST;
        }
        return null;
      }
    }
  };
  win.eval(script);
  try {
    await new Promise(r => setTimeout(r, 20));
    const urlInput = win.document.getElementById("url-input");
    const inspectBtn = win.document.getElementById("inspect-btn");
    urlInput.value = "https://www.instagram.com/reel/OldOne/";
    inspectBtn.click();
    await new Promise(r => setTimeout(r, 10));
    // Trigger Enter while busy — must NOT start a second concurrent inspect
    urlInput.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise(r => setTimeout(r, 10));
    assert.equal(inspectCount, 1, "must ignore concurrent inspect while busy");

    releaseInspect();
    await new Promise(r => setTimeout(r, 30));

    // Broken thumbnail image shows unavailable message instead of waiting-for-link prompt
    const thumb = win.document.getElementById("preview-thumb");
    thumb.dispatchEvent(new win.Event("error"));
    const emptyText = win.document.getElementById("preview-empty").textContent;
    assert(
      /unavailable/i.test(emptyText),
      `expected preview unavailable message on thumb error, got: ${emptyText}`
    );

    // Payload-only pending context updates stale urlInput to resolved postUrl
    await win.__ignowLoadDownloaderContext();
    assert.equal(urlInput.value, SAMPLE_POST.postUrl);

    // Carousel slide stepper buttons, format spec update, caption counter, and clear button
    const prevBtn = win.document.getElementById("prev-slide-btn");
    const nextBtn = win.document.getElementById("next-slide-btn");
    const slideSelect = win.document.getElementById("slide-select");
    const formatSelect = win.document.getElementById("format-select");
    const audioSpec = win.document.getElementById("audio-spec-preview");
    const captionCount = win.document.getElementById("caption-count");
    const clearBtn = win.document.getElementById("clear-url-btn");

    assert.equal(prevBtn.disabled, true);
    assert.equal(nextBtn.disabled, false);
    assert(captionCount.textContent.includes("chars"), captionCount.textContent);
    formatSelect.value = "prog-0";
    formatSelect.dispatchEvent(new win.Event("change"));
    assert(audioSpec.textContent.includes("720×1280"), audioSpec.textContent);

    nextBtn.click();
    assert.equal(slideSelect.value, "1");
    assert.equal(nextBtn.disabled, true);
    assert.equal(prevBtn.disabled, false);
    prevBtn.click();
    assert.equal(slideSelect.value, "0");

    assert.equal(clearBtn.hidden, false);
    clearBtn.click();
    assert.equal(urlInput.value, "");
    assert.equal(clearBtn.hidden, true);

    // Triggering thumbnail error keeps "unavailable" state across a download cycle
    const previewBox = win.document.getElementById("preview-box");
    const dlBtn = win.document.getElementById("download-selected-btn");
    win.document.getElementById("preview-thumb").dispatchEvent(new win.Event("error"));
    assert.equal(previewBox.getAttribute("data-state"), "unavailable");
    dlBtn.click();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(previewBox.getAttribute("data-state"), "unavailable");

    // Layout contract: primary CTA spans full width in 2-col actions-grid so buttons never clip or overlap at 760px
    const htmlSource = fs.readFileSync(htmlPath, "utf8");
    assert.match(htmlSource, /\.actions-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(htmlSource, /#download-selected-btn\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
    assert.match(htmlSource, /\.actions-grid button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
  } finally {
    win.close();
  }
});

test("image-only carousel hides Audio Only, promotes Save All N Images, and zero-pads >=10 slides", async () => {
  const imageItems = Array.from({ length: 10 }, (_, idx) => ({
    index: idx,
    kind: "image",
    thumbnailUrl: `https://cdn.instagram.com/v/photo-${idx + 1}.jpg`,
    formats: [
      {
        id: `img-${idx}-hi`,
        label: "1080x1350 JPG",
        width: 1080,
        height: 1350,
        bandwidth: 1080 * 1350,
        ext: "jpg",
        requiresMux: false,
        videoUrl: `https://cdn.instagram.com/v/photo-${idx + 1}-full.jpg`,
        audioUrl: null
      }
    ]
  }));
  const imageCarousel = {
    shortcode: "C9xPoems10",
    pk: "9876543210",
    username: "sunnyleepoetry",
    postUrl: "https://www.instagram.com/p/C9xPoems10/",
    takenAt: "2026-11-16T00:00:00Z",
    caption: "Ten poem cards",
    ffmpegAvailable: true,
    items: imageItems
  };

  const dom = new JSDOM(fs.readFileSync(htmlPath, "utf8"), {
    url: "https://tauri.localhost/downloader.html",
    runScripts: "outside-only"
  });
  const { window: win } = dom;
  const calls = [];
  win.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        calls.push({ command, args });
        if (command === "take_pending_downloader_context") {
          return { url: imageCarousel.postUrl, payloadJson: JSON.stringify(imageCarousel) };
        }
        if (command === "inspect_instagram_post") return imageCarousel;
        if (command === "download_post_selection") {
          return {
            savedPaths: imageItems.map((_, idx) => `C:\\Users\\User\\Downloads\\IG-Now\\post-slide-${String(idx + 1).padStart(2, "0")}.jpg`),
            captionPath: "C:\\Users\\User\\Downloads\\IG-Now\\caption.txt",
            metadataPath: "C:\\Users\\User\\Downloads\\IG-Now\\metadata.json",
            subfolder: "sunnyleepoetry-20261116-hash",
            warning: null
          };
        }
        return null;
      }
    }
  };
  try {
    win.eval(fs.readFileSync(scriptPath, "utf8"));
    await new Promise(r => setTimeout(r, 40));

    const audioBtn = win.document.getElementById("download-audio-btn");
    const bundleLabel = win.document.getElementById("download-bundle-label");
    const selectedLabel = win.document.getElementById("download-selected-label");
    const actionsGrid = win.document.querySelector(".actions-grid");
    const outputPreview = win.document.getElementById("output-name-preview");
    const summary = win.document.getElementById("post-summary");

    assert.equal(audioBtn.hidden, true, "Audio Only must be hidden on image-only posts");
    assert.equal(actionsGrid.getAttribute("data-image-only"), "1");
    assert.equal(bundleLabel.textContent, "Save All 10 Images + Caption");
    assert.equal(selectedLabel.textContent, "Download Slide 1 (.jpg)");
    assert(summary.textContent.includes("10 images"), summary.textContent);
    assert(outputPreview.textContent.includes("-slide-01.jpg"), outputPreview.textContent);

    // ArrowRight keyboard shortcut steps carousel slides cleanly when not in a text input
    win.document.body.focus();
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    assert.equal(selectedLabel.textContent, "Download Slide 2 (.jpg)");
    assert(outputPreview.textContent.includes("-slide-02.jpg"), outputPreview.textContent);

    win.document.getElementById("download-bundle-btn").click();
    await new Promise(r => setTimeout(r, 40));
    const bundleCall = calls.find(c => c.command === "download_post_selection" && c.args.mode === "bundle");
    assert(bundleCall, "bundle download must fire for image carousel");
  } finally {
    win.close();
  }
});

test("mixed 1-photo + 1-video carousel uses singular counts, updates slide status on switch, and locks outer UI scroll while keeping caption scrollable", async () => {
  const mixedTwo = {
    shortcode: "DfzfZnYgNp2",
    pk: "11223344",
    username: "evolving.ai",
    postUrl: "https://www.instagram.com/p/DfzfZnYgNp2/",
    takenAt: "2026-11-16T00:00:00Z",
    caption: "Line 1\n".repeat(40),
    ffmpegAvailable: true,
    items: [
      {
        index: 0,
        kind: "image",
        thumbnailUrl: "https://cdn.instagram.com/v/s1.jpg",
        formats: [{
          id: "img-0",
          label: "1080x1350 JPG",
          width: 1080,
          height: 1350,
          bandwidth: 1458000,
          ext: "jpg",
          requiresMux: false,
          videoUrl: "https://cdn.instagram.com/v/s1.jpg",
          audioUrl: null
        }]
      },
      {
        index: 1,
        kind: "video",
        thumbnailUrl: "https://cdn.instagram.com/v/s2.jpg",
        formats: [{
          id: "dash-0",
          label: "1080p MP4 (AAC Audio Muxed)",
          width: 1080,
          height: 1350,
          bandwidth: 2200000,
          ext: "mp4",
          requiresMux: true,
          videoUrl: "https://cdn.instagram.com/v/s2.mp4",
          audioUrl: "https://cdn.instagram.com/v/s2.m4a"
        }]
      }
    ]
  };
  const f = setupDownloaderDom({ url: mixedTwo.postUrl, payloadJson: JSON.stringify(mixedTwo) }, null);
  f.win.__TAURI__.core.invoke = async (command, args) => {
    f.calls.push({ command, args });
    if (command === "inspect_instagram_post") return mixedTwo;
    return null;
  };
  try {
    await f.win.__ignowLoadDownloaderContext();
    const statusBox = f.win.document.getElementById("status-box");
    const nextBtn = f.win.document.getElementById("next-slide-btn");
    assert.equal(
      statusBox.textContent,
      "Ready: 2 carousel items (1 photo, 1 video). Viewing Slide 1.",
      `expected singular mixed status, got: ${statusBox.textContent}`
    );

    nextBtn.click();
    assert.equal(
      statusBox.textContent,
      "Ready: 2 carousel items (1 photo, 1 video). Viewing Slide 2.",
      `expected Slide 2 status update on navigation, got: ${statusBox.textContent}`
    );

    const htmlSource = fs.readFileSync(htmlPath, "utf8");
    assert.match(htmlSource, /\.workbench-app\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/);
    assert.match(htmlSource, /textarea\s*\{[^}]*overflow-y:\s*auto;/);
    assert.match(htmlSource, /\.preview-box\s*\{[^}]*flex:\s*1\s+1\s+228px;/);
    assert.match(htmlSource, /\.slide-strip\s*\{[^}]*justify-content:\s*safe center;/);
  } finally {
    f.win.close();
  }
});

test("accepts collaboration /username/p/shortcode/ URLs and replaces stale root URL with resolved postUrl", async () => {
  const collabPost = {
    shortcode: "DCollab99",
    pk: "123456",
    username: "alexaaubreypoetry",
    postUrl: "https://www.instagram.com/p/DCollab99/",
    takenAt: "2026-11-16T00:00:00Z",
    caption: "Collab post",
    ffmpegAvailable: true,
    items: [
      {
        index: 0,
        kind: "image",
        thumbnailUrl: "https://cdn.instagram.com/v/collab.jpg",
        formats: [{
          id: "img-0",
          label: "1080x1350 JPG",
          width: 1080,
          height: 1350,
          bandwidth: 1080 * 1350,
          ext: "jpg",
          requiresMux: false,
          videoUrl: "https://cdn.instagram.com/v/collab.jpg",
          audioUrl: null
        }]
      }
    ]
  };
  const f = setupDownloaderDom(
    { url: "https://www.instagram.com/", payloadJson: JSON.stringify(collabPost) },
    null
  );
  // Override invoke in setup so it inspects the collab post
  f.win.__TAURI__.core.invoke = async (command, args) => {
    f.calls.push({ command, args });
    if (command === "inspect_instagram_post") return collabPost;
    return null;
  };
  try {
    await f.win.__ignowLoadDownloaderContext();
    const urlInput = f.win.document.getElementById("url-input");
    assert.equal(urlInput.value, collabPost.postUrl, "stale home URL must be replaced by resolved postUrl");

    urlInput.value = "https://www.instagram.com/alexaaubreypoetry/p/DCollab99/";
    urlInput.dispatchEvent(new f.win.Event("input"));
    assert.equal(f.win.document.getElementById("url-hint").textContent, "Instagram link detected");
  } finally {
    f.win.close();
  }
});

test("20-slide mixed photo+video carousel renders thumbnail strip, honors initial slide hint, and shows live batch progress", async () => {
  const mixedItems = Array.from({ length: 20 }, (_, idx) => {
    const num = idx + 1;
    const isVideo = num === 5 || num === 15;
    return isVideo
      ? {
          index: idx,
          kind: "video",
          thumbnailUrl: `https://cdn.instagram.com/v/mix-${num}-thumb.jpg`,
          formats: [{
            id: `dash-${idx}`,
            label: "1080p MP4 (AAC Audio Muxed)",
            width: 1080,
            height: 1920,
            bandwidth: 2800000,
            ext: "mp4",
            requiresMux: true,
            videoUrl: `https://cdn.instagram.com/v/mix-${num}.mp4`,
            audioUrl: `https://cdn.instagram.com/v/mix-${num}.m4a`
          }]
        }
      : {
          index: idx,
          kind: "image",
          thumbnailUrl: `https://cdn.instagram.com/v/mix-${num}-full.jpg`,
          formats: [{
            id: `img-${idx}`,
            label: "1080x1350 JPG",
            width: 1080,
            height: 1350,
            bandwidth: 1080 * 1350,
            ext: "jpg",
            requiresMux: false,
            videoUrl: `https://cdn.instagram.com/v/mix-${num}-full.jpg`,
            audioUrl: null
          }]
        };
  });
  const mixedPost = {
    shortcode: "D20MixPost",
    pk: "777888999",
    username: "mixcreator",
    postUrl: "https://www.instagram.com/p/D20MixPost/",
    takenAt: "2026-11-17T00:00:00Z",
    caption: "Twenty slide mixed carousel",
    ffmpegAvailable: true,
    items: mixedItems
  };

  let progressListener = null;
  let releaseDownload = null;
  const dom = new JSDOM(fs.readFileSync(htmlPath, "utf8"), {
    url: "https://tauri.localhost/downloader.html",
    runScripts: "outside-only"
  });
  const { window: win } = dom;
  win.__TAURI__ = {
    event: {
      listen: async (eventName, cb) => {
        if (eventName === "downloader-progress") progressListener = cb;
        return () => {};
      }
    },
    core: {
      invoke: async (command, args) => {
        if (command === "take_pending_downloader_context") {
          return {
            url: mixedPost.postUrl,
            payloadJson: JSON.stringify(mixedPost),
            slideIndex: 11,
            slideHint: "https://cdn.instagram.com/v/mix-12-full.jpg"
          };
        }
        if (command === "inspect_instagram_post") return mixedPost;
        if (command === "download_post_selection" && args.mode === "bundle") {
          await new Promise(resolve => { releaseDownload = resolve; });
          return {
            savedPaths: mixedItems.map((_, idx) => `C:\\Users\\User\\Downloads\\IG-Now\\mix-slide-${String(idx + 1).padStart(2, "0")}.dat`),
            captionPath: "C:\\Users\\User\\Downloads\\IG-Now\\caption.txt",
            metadataPath: "C:\\Users\\User\\Downloads\\IG-Now\\metadata.json",
            subfolder: "mixcreator-20261117-hash",
            warning: null
          };
        }
        return null;
      }
    }
  };
  try {
    win.eval(fs.readFileSync(scriptPath, "utf8"));
    await new Promise(r => setTimeout(r, 50));

    const summary = win.document.getElementById("post-summary");
    const slideSelect = win.document.getElementById("slide-select");
    const slideStrip = win.document.getElementById("slide-strip");
    const selectedLabel = win.document.getElementById("download-selected-label");
    const bundleLabel = win.document.getElementById("download-bundle-label");
    const audioBtn = win.document.getElementById("download-audio-btn");
    const statusBox = win.document.getElementById("status-box");

    assert(summary.textContent.includes("20 items") && summary.textContent.includes("18 photos") && summary.textContent.includes("2 videos"), summary.textContent);
    assert.equal(slideSelect.value, "11", "must open directly on hinted slide 12");
    assert.equal(selectedLabel.textContent, "Download Slide 12 (.jpg)");
    assert.equal(audioBtn.hidden, false, "mixed carousel keeps Audio Only visible");
    assert.equal(audioBtn.disabled, true, "Audio Only disabled on photo slide");
    assert(bundleLabel.textContent.includes("20"), bundleLabel.textContent);

    const stripButtons = slideStrip ? Array.from(slideStrip.querySelectorAll("button[data-slide-idx]")) : [];
    assert.equal(stripButtons.length, 20, "slide strip must render all 20 slide buttons");
    assert.equal(stripButtons[11].getAttribute("aria-pressed"), "true");

    // Click slide 5 (video) in strip -> switches to video slide and enables Audio Only!
    stripButtons[4].click();
    assert.equal(slideSelect.value, "4");
    assert.equal(selectedLabel.textContent, "Download Slide 5 (.mp4)");
    assert.equal(audioBtn.disabled, false);

    // Trigger Save Full Post and emit live progress updates
    const inspectBtn = win.document.getElementById("inspect-btn");
    const postSection = win.document.getElementById("post-section");
    win.document.getElementById("download-bundle-btn").click();
    await new Promise(r => setTimeout(r, 15));
    assert.equal(inspectBtn.disabled, true);
    assert.equal(inspectBtn.textContent, "Inspect Link", "download busy state must not rename Inspect Link button to Inspecting...");
    assert.equal(postSection.getAttribute("aria-busy"), "true");
    assert(progressListener, "must subscribe to downloader-progress events");
    progressListener({ payload: { completed: 8, total: 20 } });
    assert(statusBox.textContent.includes("8/20"), statusBox.textContent);
    releaseDownload();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(postSection.getAttribute("aria-busy"), "false");
    assert(statusBox.textContent.includes("20 file(s)"), statusBox.textContent);
  } finally {
    win.close();
  }
});

test("uses Cmd hints on macOS and avoids hardcoded .jpg in single-image in-flight status", async () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const script = fs.readFileSync(scriptPath, "utf8");
  const dom = new JSDOM(html, {
    url: "https://tauri.localhost/downloader.html",
    runScripts: "outside-only"
  });
  const win = dom.window;
  Object.defineProperty(win.navigator, "platform", { value: "MacIntel", configurable: true });
  let releaseSingle;
  const imgPost = {
    shortcode: "C9xImgMac",
    pk: "123",
    username: "mac_user",
    postUrl: "https://www.instagram.com/p/C9xImgMac/",
    takenAt: "2026-11-16T00:00:00Z",
    caption: "",
    ffmpegAvailable: true,
    items: [{
      index: 0,
      kind: "image",
      thumbnailUrl: "https://cdn.instagram.com/v/pic.png",
      formats: [{ id: "img-0", label: "1080x1350 JPG", width: 1080, height: 1350, bandwidth: 1458000, ext: "jpg", requiresMux: false, videoUrl: "https://cdn.instagram.com/v/pic.png", audioUrl: null }]
    }]
  };
  win.__TAURI__ = {
    core: {
      invoke: async (command) => {
        if (command === "take_pending_downloader_context") {
          return { url: imgPost.postUrl, payloadJson: JSON.stringify(imgPost) };
        }
        if (command === "inspect_instagram_post") return imgPost;
        if (command === "download_post_selection") {
          await new Promise(resolve => { releaseSingle = resolve; });
          return { savedPaths: ["/Users/u/Downloads/IG-Now/mac_user-20261116-abcdef12.png"], captionPath: null, metadataPath: null, subfolder: null, warning: null };
        }
        return null;
      }
    }
  };
  try {
    win.eval(script);
    await new Promise(r => setTimeout(r, 40));
    const urlInput = win.document.getElementById("url-input");
    const savedUrl = urlInput.value;
    win.document.getElementById("clear-url-btn").click();
    assert(win.document.getElementById("url-hint").textContent.includes("Cmd+L"));
    urlInput.value = savedUrl;
    urlInput.dispatchEvent(new win.Event("input"));
    win.document.getElementById("paste-btn").click();
    await new Promise(r => setTimeout(r, 15));
    assert(win.document.getElementById("status-box").textContent.includes("Cmd+V"));
    win.document.getElementById("download-selected-btn").click();
    await new Promise(r => setTimeout(r, 15));
    assert.equal(win.document.getElementById("status-box").textContent, "Saving full-resolution image to Downloads/IG-Now...");
    releaseSingle();
    await new Promise(r => setTimeout(r, 20));
    assert(win.document.getElementById("status-box").textContent.endsWith(".png"));
  } finally {
    win.close();
  }
});
