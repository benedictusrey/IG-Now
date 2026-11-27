"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const backend = require("./backend");

test("URL safety and Instagram host scoping", () => {
  assert.equal(backend.isSafeHttpUrl("https://www.instagram.com/p/ABC/"), true);
  assert.equal(backend.isSafeHttpUrl("http://127.0.0.1:8080/video.mp4"), true);
  assert.equal(backend.isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(backend.isSafeHttpUrl("file:///etc/passwd"), false);
  assert.equal(backend.isSafeHttpUrl("https://www.instagram.com/\r\nEvil"), false);

  assert.equal(backend.isInstagramAppHost("https://www.instagram.com/p/ABC/"), true);
  assert.equal(backend.isInstagramAppHost("https://instagram.com/reels/XYZ/"), true);
  assert.equal(backend.isInstagramAppHost("https://scontent.cdninstagram.com/v/t50.mp4"), false);
  assert.equal(backend.isInstagramAppHost("https://evilinstagram.com/track"), false);
});

test("shortcode and media_id roundtrip and range param stripping", () => {
  assert.equal(
    backend.shortcodeFromUrl("https://www.instagram.com/reel/C9xTokyoNight/?igsh=abc"),
    "C9xTokyoNight"
  );
  assert.equal(backend.shortcodeFromUrl("https://evil.example/p/C9xTokyoNight/"), null);
  const id = backend.shortcodeToMediaId("B_test123");
  assert.ok(id);
  assert.equal(backend.mediaIdToShortcode(id), "B_test123");

  assert.equal(
    backend.stripMediaRangeParams("https://cdn.example/v.mp4?a=1\\u0026bytestart=0&byteend=99&b=2"),
    "https://cdn.example/v.mp4?a=1&b=2"
  );
});

test("curl stdin auth header formatting and escaping", () => {
  const { cookieHeader, csrfToken } = backend.cookieHeaderAndCsrfFromPairs([
    ["sessionid", "abc123\r\n"],
    ["csrftoken", "tok\"999"],
    ["sessionid", "dup"],
  ]);
  assert.equal(cookieHeader, "sessionid=abc123; csrftoken=tok\"999");
  assert.equal(csrfToken, "tok\"999");

  const buf = backend.buildCurlStdinHeaders(cookieHeader, csrfToken).toString("utf8");
  assert.ok(buf.includes('header = "Cookie: sessionid=abc123; csrftoken=tok\\"999"\n'));
  assert.ok(buf.includes('header = "X-CSRFToken: tok\\"999"\n'));
});

test("DASH manifest and JSON/HTML post extraction", () => {
  const json = JSON.stringify({
    items: [
      {
        pk: "3456789012345678901",
        code: "C9xTokyoNight",
        taken_at: 1731700000,
        user: { username: "derinjapan1" },
        caption: { text: "Tokyo winter lights #night" },
        video_versions: [
          { url: "https://cdn.instagram.com/v/prog_720.mp4", width: 720, height: 1280 },
        ],
        video_dash_manifest:
          '<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation bandwidth="3200000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/dash_1080.mp4?bytestart=0</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation bandwidth="128000"><BaseURL>https://cdn.instagram.com/v/dash_audio.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>',
      },
    ],
  });

  const withFfmpeg = backend.extractPostFromJsonText(json, "C9xTokyoNight", true);
  assert.equal(withFfmpeg.username, "derinjapan1");
  assert.equal(withFfmpeg.items[0].kind, "video");
  assert.equal(withFfmpeg.items[0].formats[0].height, 1920);
  assert.equal(withFfmpeg.items[0].formats[0].requiresMux, true);
  assert.equal(withFfmpeg.items[0].formats[0].videoUrl, "https://cdn.instagram.com/v/dash_1080.mp4");
  assert.equal(withFfmpeg.items[0].formats[0].audioUrl, "https://cdn.instagram.com/v/dash_audio.m4a");

  const withoutFfmpeg = backend.extractPostFromJsonText(json, "C9xTokyoNight", false);
  assert.equal(withoutFfmpeg.items[0].formats[0].height, 1280);
  assert.equal(withoutFfmpeg.items[0].formats[0].requiresMux, false);

  const html =
    '<html><head><meta property="og:video" content="https://cdn.instagram.com/v/embed.mp4?k=1&amp;v=2" /><meta property="og:description" content="Sample IG caption" /></head></html>';
  const fromHtml = backend.extractPostFromHtml(html, "C9xEmbed1", false);
  assert.equal(fromHtml.items[0].formats[0].videoUrl, "https://cdn.instagram.com/v/embed.mp4?k=1&v=2");
  assert.equal(fromHtml.caption, "Sample IG caption");
});

test("path sanitization, filename stems, and header validation", () => {
  assert.equal(backend.sanitizePathSegment("../../etc/passwd"), "etc_passwd");
  assert.equal(backend.sanitizePathSegment(".."), "");
  assert.equal(backend.sanitizePathSegment("a".repeat(120)).length, 80);

  const s1 = backend.singleSelectionFileStem("alice", "2024-11-15T12:00:00Z", "C9xPost", 0, 10);
  const s2 = backend.singleSelectionFileStem("alice", "2024-11-15T12:00:00Z", "C9xPost", 9, 10);
  assert.ok(s1.endsWith("-slide-01"));
  assert.ok(s2.endsWith("-slide-10"));

  assert.equal(backend.isValidMp4Header(Buffer.from("\x00\x00\x00\x18ftypisom", "latin1")), true);
  assert.equal(backend.isValidMp4Header(Buffer.from("\x00\x00\x00\x08moof", "latin1")), false);
  assert.equal(backend.isValidImageHeader(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])), true);
  assert.equal(backend.isValidImageHeader(Buffer.from("<!DOCTYPE html>")), false);
});

test("UnreadTracker suppresses baseline, focused inbox, and 5s bursts", () => {
  const tracker = new backend.UnreadTracker();
  const t0 = 100000;
  assert.equal(tracker.update(4, false, t0), false);
  assert.equal(tracker.update(4, false, t0 + 100), false);
  assert.equal(tracker.update(0, false, t0 + 200), false);
  assert.equal(tracker.update(1, false, t0 + 300), true);
  assert.equal(tracker.update(2, true, t0 + 6000), false);
  assert.equal(tracker.update(3, false, t0 + 7000), true);
  assert.equal(tracker.update(4, false, t0 + 8000), false);
  assert.equal(tracker.update(5, false, t0 + 12500), true);
});

test("XDG autostart .desktop toggle and atomic file replace", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignow-test-"));
  try {
    const env = { XDG_CONFIG_HOME: tmpDir };
    assert.equal(backend.isAutostartEnabled(env), false);
    assert.equal(backend.setAutostartEnabled(true, '"/usr/bin/electron" --minimized', env), true);
    assert.equal(backend.isAutostartEnabled(env), true);
    const desktopContent = fs.readFileSync(backend.getAutostartDesktopPath(env), "utf8");
    assert.ok(desktopContent.includes('Exec="/usr/bin/electron" --minimized'));
    assert.equal(backend.setAutostartEnabled(false, "", env), false);
    assert.equal(backend.isAutostartEnabled(env), false);

    const src = path.join(tmpDir, "src.tmp");
    const dst = path.join(tmpDir, "dst.txt");
    fs.writeFileSync(src, "new-content");
    fs.writeFileSync(dst, "old-content");
    await backend.replaceFileAtomically(src, dst);
    assert.equal(fs.readFileSync(dst, "utf8"), "new-content");
    assert.equal(fs.existsSync(src), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveDownloadsBaseDir falls back to ~/Downloads/IG-Now when Electron returns homedir", () => {
  const home = "/home/benedictus";
  assert.equal(backend.resolveDownloadsBaseDir(home, home), path.join(home, "Downloads", "IG-Now"));
  assert.equal(backend.resolveDownloadsBaseDir(`${home}/`, home), path.join(home, "Downloads", "IG-Now"));
  assert.equal(backend.resolveDownloadsBaseDir("", home), path.join(home, "Downloads", "IG-Now"));
  assert.equal(
    backend.resolveDownloadsBaseDir("/data/Downloads", home),
    path.join("/data/Downloads", "IG-Now")
  );
});

test("ffmpeg muxing and audio extraction smoke test (when ffmpeg is installed)", async () => {
  const ffmpeg = backend.findFfmpegBinary();
  if (!ffmpeg) return;
  const { execFileSync } = require("node:child_process");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignow-ff-"));
  try {
    const vid = path.join(tmpDir, "v.mp4");
    const aud = path.join(tmpDir, "a.m4a");
    const muxed = path.join(tmpDir, "out.mp4");
    const m4a = path.join(tmpDir, "out.m4a");
    execFileSync(ffmpeg, [
      "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:d=0.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", vid,
    ], { stdio: "ignore" });
    execFileSync(ffmpeg, [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=0.5",
      "-c:a", "aac", aud,
    ], { stdio: "ignore" });

    assert.equal(await backend.probeMp4AudioState(ffmpeg, vid), "missing");
    await backend.muxVideoAudioFfmpeg(ffmpeg, vid, aud, muxed);
    assert.equal(await backend.probeMp4AudioState(ffmpeg, muxed), "aac");
    await backend.extractAudioAacM4aFfmpeg(ffmpeg, muxed, m4a);
    assert.equal(backend.isValidMp4Header(fs.readFileSync(m4a)), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("WSLg detection and X11 GPU compositing fallback gating", () => {
  assert.equal(backend.isWslEnvironment({ WSL_DISTRO_NAME: "archlinux" }, ""), true);
  assert.equal(backend.isWslEnvironment({}, "6.6.87.2-microsoft-standard-WSL2"), true);
  assert.equal(backend.isWslEnvironment({}, "6.12.10-arch1-1"), false);

  assert.equal(backend.shouldDisableGpuCompositing("linux", [], { WSL_DISTRO_NAME: "archlinux" }, ""), true);
  assert.equal(
    backend.shouldDisableGpuCompositing("linux", ["--disable-gpu-compositing"], { WSL_DISTRO_NAME: "archlinux" }, ""),
    false
  );
  assert.equal(backend.shouldDisableGpuCompositing("linux", [], {}, "6.12.10-arch1-1"), false);
  assert.equal(backend.shouldDisableGpuCompositing("win32", [], { WSL_DISTRO_NAME: "archlinux" }, ""), false);
});

test("computeCenteredWorkAreaFrame handles WM chrome overhead, taskbars, and HiDPI scaling", () => {
  // 1080p WSLg (1920x1080) with 12x33 visible WM chrome -> 1588x1025 centered at (160, 11)
  const f1080 = backend.computeCenteredWorkAreaFrame(
    { x: 0, y: 0, width: 1920, height: 1080 },
    1588,
    1025,
    900,
    680,
    12,
    33
  );
  assert.deepEqual(f1080, { width: 1588, height: 1025, x: 160, y: 11, minWidth: 900, minHeight: 680 });
  assert.ok(f1080.y + f1080.height + 33 <= 1080);

  // 1080p with 48px taskbar (workArea 1920x1032) -> clamps height to 999 so outer fits 1032
  const f1080Taskbar = backend.computeCenteredWorkAreaFrame(
    { x: 0, y: 0, width: 1920, height: 1032 },
    1588,
    1025,
    900,
    680,
    12,
    33
  );
  assert.deepEqual(f1080Taskbar, { width: 1588, height: 999, x: 160, y: 0, minWidth: 900, minHeight: 680 });

  // 1440p with 48px taskbar (2560x1392) -> full 1588x1025 centered
  const f1440 = backend.computeCenteredWorkAreaFrame(
    { x: 0, y: 0, width: 2560, height: 1392 },
    1588,
    1025,
    900,
    680,
    12,
    33
  );
  assert.deepEqual(f1440, { width: 1588, height: 1025, x: 480, y: 167, minWidth: 900, minHeight: 680 });

  // 1080p @ 125% (1536x825) Downloader (765x885) clamps cleanly without overflow
  const f125Dl = backend.computeCenteredWorkAreaFrame(
    { x: 0, y: 0, width: 1536, height: 825 },
    765,
    885,
    580,
    620,
    12,
    33
  );
  assert.deepEqual(f125Dl, { width: 765, height: 792, x: 379, y: 0, minWidth: 580, minHeight: 620 });

  // 1080p @ 150% (1280x680) relaxes minHeight so outer fits within workArea
  const f150 = backend.computeCenteredWorkAreaFrame(
    { x: 0, y: 0, width: 1280, height: 680 },
    1588,
    1025,
    900,
    680,
    12,
    33
  );
  assert.deepEqual(f150, { width: 1268, height: 647, x: 0, y: 0, minWidth: 900, minHeight: 647 });

  // GNOME top bar offset (y=28)
  const fGnome = backend.computeCenteredWorkAreaFrame(
    { x: 0, y: 28, width: 1920, height: 1052 },
    1588,
    1025,
    900,
    680,
    12,
    33
  );
  assert.equal(fGnome.y, 28);
  assert.equal(fGnome.height, 1019);
});

test("estimateChromeOverhead detects outer-vs-content delta and X11 reparent shift", () => {
  assert.deepEqual(
    backend.estimateChromeOverhead(
      { x: 100, y: 50, width: 1600, height: 1058 },
      { x: 106, y: 77, width: 1588, height: 1025 },
      { x: 100, y: 50 }
    ),
    { overheadW: 12, overheadH: 33 }
  );
  assert.deepEqual(
    backend.estimateChromeOverhead(
      { x: 166, y: 38, width: 1588, height: 1025 },
      { x: 166, y: 38, width: 1588, height: 1025 },
      { x: 160, y: 11 }
    ),
    { overheadW: 12, overheadH: 33 }
  );
  assert.deepEqual(
    backend.estimateChromeOverhead(
      { x: 400, y: 200, width: 1588, height: 1025 },
      { x: 400, y: 200, width: 1588, height: 1025 },
      { x: 160, y: 11 }
    ),
    { overheadW: 0, overheadH: 0 }
  );
});

test("Linux startup flags, Wayland detection, and sandbox gating", () => {
  const wslEnv = { WSL_DISTRO_NAME: "archlinux", WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" };
  assert.equal(backend.isWaylandOzoneSession("linux", [], wslEnv, ""), false);
  assert.equal(backend.isWaylandOzoneSession("linux", ["--ozone-platform=wayland"], wslEnv, ""), true);
  assert.deepEqual(
    backend.getLinuxStartupSwitches("linux", [], wslEnv, "", "/usr/bin/node"),
    [["no-sandbox"], ["disable-gpu-compositing"]]
  );

  const waylandEnv = { WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" };
  assert.equal(backend.isWaylandOzoneSession("linux", [], waylandEnv, "6.12.10-arch1-1"), true);
  assert.equal(
    backend.isWaylandOzoneSession("linux", ["--ozone-platform=x11"], waylandEnv, "6.12.10-arch1-1"),
    false
  );
  assert.deepEqual(
    backend.getLinuxStartupSwitches("linux", [], waylandEnv, "6.12.10-arch1-1", "/nonexistent/electron"),
    [
      ["no-sandbox"],
      ["ozone-platform-hint", "auto"],
      ["enable-features", "VaapiVideoDecodeLinuxGL,VaapiVideoDecoder"],
    ]
  );
  assert.deepEqual(
    backend.getLinuxStartupSwitches(
      "linux",
      ["--no-sandbox", "--ozone-platform=x11", "--disable-gpu"],
      waylandEnv,
      "6.12.10-arch1-1",
      "/nonexistent/electron"
    ),
    []
  );
});

test("Instagram navigation URL guard, media buffer conversion, and About dialog parity", () => {
  assert.equal(backend.isAllowedInstagramNavUrl("https://www.instagram.com/reels/"), true);
  assert.equal(backend.isAllowedInstagramNavUrl("https://www.facebook.com/login/"), true);
  assert.equal(backend.isAllowedInstagramNavUrl("https://accountscenter.meta.com/"), true);
  assert.equal(backend.isAllowedInstagramNavUrl("http://www.instagram.com/"), false);
  assert.equal(backend.isAllowedInstagramNavUrl("https://evilinstagram.com/"), false);
  assert.equal(backend.isAllowedInstagramNavUrl("https://example.com/"), false);

  const backing = new Uint8Array([9, 10, 11, 12, 13]);
  const subView = backing.subarray(1, 4);
  assert.deepEqual(backend.toMediaBuffer(subView), Buffer.from([10, 11, 12]));
  assert.deepEqual(backend.toMediaBuffer(backing.buffer), Buffer.from([9, 10, 11, 12, 13]));
  assert.deepEqual(backend.toMediaBuffer([1, 2, 3]), Buffer.from([1, 2, 3]));
  assert.equal(backend.toMediaBuffer("bad"), null);

  const wslAbout = backend.buildAboutJs("2.5.3", "QUJD", { disableBackdropBlur: true });
  assert.ok(wslAbout.includes("aria-labelledby"));
  assert.ok(wslAbout.includes("Close About window"));
  assert.ok(wslAbout.includes("e.key==='Tab'"));
  assert.ok(wslAbout.includes(":focus-visible"));
  assert.ok(wslAbout.includes("prefers-reduced-motion:reduce"));
  assert.ok(wslAbout.includes("@media (max-width:520px)"));
  assert.ok(!wslAbout.includes("backdrop-filter:blur"));

  const gpuAbout = backend.buildAboutJs("2.5.3", "QUJD", { disableBackdropBlur: false });
  assert.ok(gpuAbout.includes("backdrop-filter:blur(10px)"));
});

test("DASH manifest and videoFormatsFromNode prefer avc1 and mp4a at equal resolution", () => {
  const dashXml = [
    "<MPD><Period>",
    '<AdaptationSet mimeType="video/mp4">',
    '<Representation bandwidth="4200000" width="1080" height="1920" codecs="av01.0.08M.08"><BaseURL>https://cdn.instagram.com/v/av1_1080.mp4</BaseURL></Representation>',
    '<Representation bandwidth="3600000" width="1080" height="1920" codecs="vp09.00.41.08"><BaseURL>https://cdn.instagram.com/v/vp9_1080.mp4</BaseURL></Representation>',
    '<Representation bandwidth="2800000" width="1080" height="1920" codecs="avc1.64002a"><BaseURL>https://cdn.instagram.com/v/h264_1080.mp4</BaseURL></Representation>',
    "</AdaptationSet>",
    '<AdaptationSet mimeType="audio/mp4">',
    '<Representation bandwidth="192000" codecs="opus"><BaseURL>https://cdn.instagram.com/v/audio_opus.webm</BaseURL></Representation>',
    '<Representation bandwidth="128000" codecs="mp4a.40.2"><BaseURL>https://cdn.instagram.com/v/audio_aac.m4a</BaseURL></Representation>',
    "</AdaptationSet>",
    "</Period></MPD>",
  ].join("");

  const parsed = backend.parseDashManifest(dashXml);
  assert.equal(parsed.videos[0].url, "https://cdn.instagram.com/v/h264_1080.mp4");
  assert.equal(parsed.audios[0].url, "https://cdn.instagram.com/v/audio_aac.m4a");

  const post = backend.extractPostFromJsonText(
    JSON.stringify({
      items: [
        {
          pk: "12345",
          code: "CodecPref1",
          user: { username: "tester" },
          video_versions: [
            { url: "https://cdn.instagram.com/v/prog_720.mp4", width: 720, height: 1280 },
          ],
          video_dash_manifest: dashXml,
        },
      ],
    }),
    "CodecPref1",
    true
  );
  assert.equal(post.items[0].formats[0].videoUrl, "https://cdn.instagram.com/v/h264_1080.mp4");
  assert.equal(post.items[0].formats[0].audioUrl, "https://cdn.instagram.com/v/audio_aac.m4a");
});

test("magic-byte detection for JPEG, PNG, GIF, WebP (lossy vs alpha/lossless), AVIF/HEIC, and WebM", () => {
  assert.equal(
    backend.detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1])).format,
    "jpg"
  );
  assert.equal(
    backend.detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])).format,
    "png"
  );
  assert.equal(backend.detectImageFormat(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00", "latin1")).format, "gif");

  const webpLossy = Buffer.from("RIFF\x20\x00\x00\x00WEBPVP8 \x14\x00\x00\x00\x00\x00\x00\x00", "latin1");
  assert.deepEqual(backend.detectImageFormat(webpLossy), {
    format: "webp",
    ext: "webp",
    isLosslessOrAlpha: false,
  });

  const webpLossless = Buffer.from("RIFF\x20\x00\x00\x00WEBPVP8L\x14\x00\x00\x00\x2f\x00\x00\x00", "latin1");
  assert.deepEqual(backend.detectImageFormat(webpLossless), {
    format: "webp",
    ext: "webp",
    isLosslessOrAlpha: true,
  });

  const webpAlphaX = Buffer.from("RIFF\x20\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x10\x00\x00\x00", "latin1");
  assert.equal(backend.detectImageFormat(webpAlphaX).isLosslessOrAlpha, true);

  const avifBuf = Buffer.from("\x00\x00\x00\x1cftypavif\x00\x00\x00\x00avifmif1", "latin1");
  assert.equal(backend.detectImageFormat(avifBuf).format, "avif");

  // MP4 ftypisom must NOT be accepted as a valid image header
  const mp4Buf = Buffer.from("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2", "latin1");
  assert.equal(backend.detectImageFormat(mp4Buf), null);
  assert.equal(backend.isValidImageHeader(mp4Buf), false);

  const webmBuf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
  assert.equal(backend.isValidWebmHeader(webmBuf), true);
  assert.equal(backend.isValidDownloadVideoHeader(webmBuf, false), false);
  assert.equal(backend.isValidDownloadVideoHeader(webmBuf, true), true);
  assert.equal(backend.isValidMp4Header(webmBuf), false);
});

test("ffmpeg video normalization enforces H.264 yuv420p + AAC + faststart while preserving native H.264+AAC", async () => {
  const ffmpeg = backend.findFfmpegBinary();
  if (!ffmpeg) return;
  const { execFileSync } = require("node:child_process");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignow-vnorm-"));
  try {
    // 1. Native H.264 yuv420p + AAC + faststart -> preserved byte-for-byte
    const nativeMp4 = path.join(tmpDir, "native.mp4");
    execFileSync(
      ffmpeg,
      [
        "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.4",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=0.4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
        nativeMp4,
      ],
      { stdio: "ignore" }
    );
    const beforeBytes = fs.readFileSync(nativeMp4);
    const nativeWarn = await backend.normalizeVideoMp4(ffmpeg, nativeMp4, null, nativeMp4);
    assert.equal(nativeWarn, null);
    assert.equal(Buffer.compare(fs.readFileSync(nativeMp4), beforeBytes), 0);

    // 2. Fragmented MP4 (moof) -> unfragmented faststart MP4
    const fragMp4 = path.join(tmpDir, "frag.mp4");
    execFileSync(
      ffmpeg,
      [
        "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=0.4",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=0.4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        "-movflags", "frag_keyframe+empty_moov", fragMp4,
      ],
      { stdio: "ignore" }
    );
    assert.equal((await backend.inspectMp4Layout(fragMp4)).isFragmented, true);
    await backend.normalizeVideoMp4(ffmpeg, fragMp4, null, fragMp4);
    const fragLayout = await backend.inspectMp4Layout(fragMp4);
    assert.equal(fragLayout.isFragmented, false);
    assert.equal(fragLayout.isFaststart, true);
    const fragStreams = await backend.probeMediaStreams(ffmpeg, fragMp4);
    assert.equal(fragStreams.videoCodec, "h264");
    assert.equal(fragStreams.pixFmt, "yuv420p");
    assert.equal(fragStreams.audioCodec, "aac");

    // 3. 10-bit H.264 (yuv420p10le) -> transcoded to 8-bit yuv420p + AAC + faststart
    const tenBitMp4 = path.join(tmpDir, "tenbit.mp4");
    execFileSync(
      ffmpeg,
      [
        "-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:d=0.4",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=0.4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-c:a", "aac",
        tenBitMp4,
      ],
      { stdio: "ignore" }
    );
    await backend.normalizeVideoMp4(ffmpeg, tenBitMp4, null, tenBitMp4);
    const tenStreams = await backend.probeMediaStreams(ffmpeg, tenBitMp4);
    assert.equal(tenStreams.videoCodec, "h264");
    assert.equal(tenStreams.pixFmt, "yuv420p");
    assert.equal(tenStreams.audioCodec, "aac");
    assert.equal((await backend.inspectMp4Layout(tenBitMp4)).isFaststart, true);

    // 4. VP9 + Opus WebM -> transcoded to H.264 yuv420p + AAC + faststart MP4
    const vp9Webm = path.join(tmpDir, "vp9_opus.webm");
    const vp9Out = path.join(tmpDir, "vp9_out.mp4");
    execFileSync(
      ffmpeg,
      [
        "-y", "-f", "lavfi", "-i", "color=c=yellow:s=64x64:d=0.4",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=0.4",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-c:a", "libopus",
        vp9Webm,
      ],
      { stdio: "ignore" }
    );
    await backend.normalizeVideoMp4(ffmpeg, vp9Webm, null, vp9Out);
    assert.equal(backend.isValidMp4Header(fs.readFileSync(vp9Out)), true);
    const vp9Streams = await backend.probeMediaStreams(ffmpeg, vp9Out);
    assert.equal(vp9Streams.videoCodec, "h264");
    assert.equal(vp9Streams.pixFmt, "yuv420p");
    assert.equal(vp9Streams.audioCodec, "aac");
    assert.equal((await backend.inspectMp4Layout(vp9Out)).isFaststart, true);

    // 5. DASH muxing VP9 video + Opus audio -> H.264 yuv420p + AAC + faststart MP4
    const vp9DashV = path.join(tmpDir, "dash_vp9.webm");
    const opusDashA = path.join(tmpDir, "dash_opus.webm");
    const muxOut = path.join(tmpDir, "dash_muxed.mp4");
    execFileSync(
      ffmpeg,
      ["-y", "-f", "lavfi", "-i", "color=c=cyan:s=64x64:d=0.4", "-c:v", "libvpx-vp9", vp9DashV],
      { stdio: "ignore" }
    );
    execFileSync(
      ffmpeg,
      ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=0.4", "-c:a", "libopus", opusDashA],
      { stdio: "ignore" }
    );
    await backend.muxVideoAudioFfmpeg(ffmpeg, vp9DashV, opusDashA, muxOut);
    const muxStreams = await backend.probeMediaStreams(ffmpeg, muxOut);
    assert.equal(muxStreams.videoCodec, "h264");
    assert.equal(muxStreams.pixFmt, "yuv420p");
    assert.equal(muxStreams.audioCodec, "aac");
    assert.equal((await backend.inspectMp4Layout(muxOut)).isFaststart, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ffmpeg image normalization outputs matching .jpg/.png files with authentic magic bytes", async () => {
  const ffmpeg = backend.findFfmpegBinary();
  if (!ffmpeg) return;
  const { execFileSync } = require("node:child_process");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignow-inorm-"));
  try {
    // 1. Authentic PNG saved with placeholder .jpg target -> preserved byte-for-byte as .png
    const pngSrc = path.join(tmpDir, "src.png");
    execFileSync(
      ffmpeg,
      ["-y", "-f", "lavfi", "-i", "color=c=magenta:s=32x32:d=1", "-frames:v", "1", pngSrc],
      { stdio: "ignore" }
    );
    const pngBytes = fs.readFileSync(pngSrc);
    const pngSaved = await backend.normalizeImageFile(ffmpeg, pngSrc, path.join(tmpDir, "out1.jpg"));
    assert.ok(pngSaved.endsWith(".png"));
    assert.equal(Buffer.compare(fs.readFileSync(pngSaved), pngBytes), 0);

    // 2. Lossy WebP -> converted to authentic .jpg with JPEG magic bytes
    const webpLossy = path.join(tmpDir, "lossy.webp");
    execFileSync(
      ffmpeg,
      ["-y", "-f", "lavfi", "-i", "color=c=orange:s=32x32:d=1", "-frames:v", "1", "-c:v", "libwebp", webpLossy],
      { stdio: "ignore" }
    );
    const jpgOut = await backend.normalizeImageFile(ffmpeg, webpLossy, path.join(tmpDir, "out2.jpg"));
    assert.ok(jpgOut.endsWith(".jpg"));
    assert.equal(backend.detectImageFormat(fs.readFileSync(jpgOut)).format, "jpg");

    // 3. Lossless / Alpha WebP -> converted to authentic .png with PNG magic bytes
    const webpAlpha = path.join(tmpDir, "alpha.webp");
    execFileSync(
      ffmpeg,
      [
        "-y", "-f", "lavfi", "-i", "color=c=black@0.5:s=32x32:d=1,format=rgba",
        "-frames:v", "1", "-c:v", "libwebp", "-lossless", "1", webpAlpha,
      ],
      { stdio: "ignore" }
    );
    const alphaOut = await backend.normalizeImageFile(ffmpeg, webpAlpha, path.join(tmpDir, "out3.jpg"));
    assert.ok(alphaOut.endsWith(".png"));
    assert.equal(backend.detectImageFormat(fs.readFileSync(alphaOut)).format, "png");
    const alphaProbe = await backend.probeMediaStreams(ffmpeg, alphaOut);
    assert.ok(alphaProbe.pixFmt.includes("rgba"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fetchMediaToPath end-to-end normalizes HTTP video/image downloads and updates image extensions", async () => {
  const ffmpeg = backend.findFfmpegBinary();
  if (!ffmpeg) return;
  const http = require("node:http");
  const { execFileSync } = require("node:child_process");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignow-http-"));
  let server;
  try {
    const vp9Webm = path.join(tmpDir, "src.webm");
    const nativeMp4 = path.join(tmpDir, "native.mp4");
    const pngSrc = path.join(tmpDir, "src.png");
    const webpLossy = path.join(tmpDir, "src.webp");
    execFileSync(
      ffmpeg,
      [
        "-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:d=0.3",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=0.3",
        "-c:v", "libvpx-vp9", "-c:a", "libopus", vp9Webm,
      ],
      { stdio: "ignore" }
    );
    execFileSync(
      ffmpeg,
      [
        "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.3",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=0.3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", nativeMp4,
      ],
      { stdio: "ignore" }
    );
    execFileSync(
      ffmpeg,
      ["-y", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=1", "-frames:v", "1", pngSrc],
      { stdio: "ignore" }
    );
    execFileSync(
      ffmpeg,
      ["-y", "-f", "lavfi", "-i", "color=c=white:s=32x32:d=1", "-frames:v", "1", "-c:v", "libwebp", webpLossy],
      { stdio: "ignore" }
    );

    const fixtures = {
      "/vp9.webm": fs.readFileSync(vp9Webm),
      "/native.mp4": fs.readFileSync(nativeMp4),
      "/img.png": fs.readFileSync(pngSrc),
      "/img.webp": fs.readFileSync(webpLossy),
    };

    server = http.createServer((req, res) => {
      const data = fixtures[req.url];
      if (!data) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Length": data.length });
      res.end(data);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const outVp9 = path.join(tmpDir, "out-vp9.mp4");
    const r1 = await backend.fetchMediaToPath(
      `${base}/vp9.webm`, "video", null, null, "https://www.instagram.com/", backend.DEFAULT_UA, null, outVp9
    );
    assert.equal(r1.path, outVp9);
    assert.equal(r1.warning, null);
    const s1 = await backend.probeMediaStreams(ffmpeg, outVp9);
    assert.equal(s1.videoCodec, "h264");
    assert.equal(s1.pixFmt, "yuv420p");
    assert.equal(s1.audioCodec, "aac");
    assert.equal(s1.isFaststart, true);

    const outNative = path.join(tmpDir, "out-native.mp4");
    const r2 = await backend.fetchMediaToPath(
      `${base}/native.mp4`, "video", null, null, "https://www.instagram.com/", backend.DEFAULT_UA, null, outNative
    );
    assert.equal(r2.path, outNative);
    assert.equal(Buffer.compare(fs.readFileSync(outNative), fixtures["/native.mp4"]), 0);

    const placeholderPng = path.join(tmpDir, "out-png.jpg");
    const r3 = await backend.fetchMediaToPath(
      `${base}/img.png`, "image", null, null, "https://www.instagram.com/", backend.DEFAULT_UA, null, placeholderPng
    );
    assert.equal(r3.path, path.join(tmpDir, "out-png.png"));
    assert.equal(fs.existsSync(placeholderPng), false);
    assert.equal(Buffer.compare(fs.readFileSync(r3.path), fixtures["/img.png"]), 0);

    const outWebp = path.join(tmpDir, "out-webp.jpg");
    const r4 = await backend.fetchMediaToPath(
      `${base}/img.webp`, "image", null, null, "https://www.instagram.com/", backend.DEFAULT_UA, null, outWebp
    );
    assert.equal(outWebp, r4.path);
    assert.equal(backend.detectImageFormat(fs.readFileSync(outWebp)).format, "jpg");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveAssetDirs and buildAutostartExecCommand handle dev, packaged, and AppImage paths", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignow-assets-"));
  try {
    const devDirs = backend.resolveAssetDirs("/opt/repo/electron-linux", tmpDir);
    assert.equal(devDirs.frontendDir, path.resolve("/opt/repo/electron-linux", "..", "frontend"));
    assert.equal(devDirs.iconsDir, path.resolve("/opt/repo/electron-linux", "..", "src-tauri", "icons"));

    fs.mkdirSync(path.join(tmpDir, "frontend"));
    fs.mkdirSync(path.join(tmpDir, "icons"));
    const pkgDirs = backend.resolveAssetDirs("/opt/app.asar", tmpDir);
    assert.equal(pkgDirs.frontendDir, path.join(tmpDir, "frontend"));
    assert.equal(pkgDirs.iconsDir, path.join(tmpDir, "icons"));

    assert.equal(
      backend.buildAutostartExecCommand(false, "/usr/bin/electron", "/repo/electron-linux", {}),
      '"/usr/bin/electron" "/repo/electron-linux" --minimized'
    );
    assert.equal(
      backend.buildAutostartExecCommand(true, "/opt/IG-Now/ig-now", "/opt/app.asar", {}),
      '"/opt/IG-Now/ig-now" --minimized'
    );
    assert.equal(
      backend.buildAutostartExecCommand(
        true,
        "/tmp/.mount_IG-Now123/ig-now",
        "/tmp/.mount_IG-Now123/resources/app.asar",
        { APPIMAGE: "/home/user/Applications/IG-Now_2.5.3_amd64.AppImage" }
      ),
      '"/home/user/Applications/IG-Now_2.5.3_amd64.AppImage" --minimized'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("electron-linux package metadata and preload expose desktopName/syncDesktopName and WSLg blur flag", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  assert.equal(pkg.desktopName, "ig-now.desktop");
  assert.equal(pkg.build?.linux?.syncDesktopName, true);

  const mainSrc = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const preloadSrc = fs.readFileSync(path.join(__dirname, "preload-instagram.js"), "utf8");
  assert.ok(mainSrc.includes("disableBackdropBlur:"));
  assert.ok(preloadSrc.includes("__ignowDisableBackdropBlur"));
});

test("normalizeImageFile skips ffmpeg probe for lossless/alpha WebP, normalizeVideoMp4 accepts preprobed streams, and inspectWithWindowFallback races window probe", async () => {
  const ffmpeg = backend.findFfmpegBinary();
  if (ffmpeg) {
    const { execFileSync } = require("node:child_process");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ignow-preprobe-"));
    try {
      const webpAlpha = path.join(tmpDir, "alpha.webp");
      execFileSync(
        ffmpeg,
        [
          "-y", "-f", "lavfi", "-i", "color=c=blue@0.5:s=32x32:d=1,format=rgba",
          "-frames:v", "1", "-c:v", "libwebp", "-lossless", "1", webpAlpha,
        ],
        { stdio: "ignore" }
      );
      let probeCount = 0;
      const outPng = await backend.normalizeImageFile(ffmpeg, webpAlpha, path.join(tmpDir, "out.jpg"), {
        onProbe: () => { probeCount += 1; },
      });
      assert.ok(outPng.endsWith(".png"));
      assert.equal(probeCount, 0, "lossless/alpha WebP must skip redundant ffmpeg -i probe");

      const vid = path.join(tmpDir, "native.mp4");
      const outVid = path.join(tmpDir, "out.mp4");
      execFileSync(
        ffmpeg,
        [
          "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.3",
          "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=0.3",
          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", vid,
        ],
        { stdio: "ignore" }
      );
      const preprobed = await backend.probeMediaStreams(ffmpeg, vid);
      let vidProbeCount = 0;
      await backend.normalizeVideoMp4(ffmpeg, vid, null, outVid, preprobed, () => { vidProbeCount += 1; });
      assert.equal(vidProbeCount, 0, "normalizeVideoMp4 with preprobed streams must skip redundant ffmpeg -i probe");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  assert.equal(typeof backend.inspectWithWindowRace, "function");
  const fastProbePost = {
    shortcode: "DRaceFast1",
    pk: "1",
    username: "fast_user",
    postUrl: "https://www.instagram.com/p/DRaceFast1/",
    takenAt: "",
    caption: "fast",
    ffmpegAvailable: true,
    items: [{ index: 0, kind: "image", thumbnailUrl: null, formats: [{ id: "img-0", videoUrl: "https://cdn.instagram.com/a.jpg" }] }],
  };
  let resolveSlowHttp;
  const start = Date.now();
  const raced = await backend.inspectWithWindowRace({
    shortcode: "DRaceFast1",
    seedPost: null,
    httpPromise: new Promise((resolve) => { resolveSlowHttp = resolve; }),
    probePromise: Promise.resolve(fastProbePost),
  });
  const elapsed = Date.now() - start;
  if (resolveSlowHttp) resolveSlowHttp(null);
  assert.equal(raced.username, "fast_user");
  assert.ok(elapsed < 100, `expected fast window probe race (<100ms), took ${elapsed}ms`);
});
