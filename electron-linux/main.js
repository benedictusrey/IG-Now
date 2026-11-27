"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const backend = require("./backend");
const pkg = require("./package.json");

const APP_VERSION = pkg.version || "2.5.3";
const { frontendDir: FRONTEND_DIR, iconsDir: ICONS_DIR } = backend.resolveAssetDirs(
  __dirname,
  process.resourcesPath
);
const DOWNLOADER_HTML_PATH = path.join(FRONTEND_DIR, "downloader.html");
const DOWNLOADER_FILE_URL = pathToFileURL(DOWNLOADER_HTML_PATH).href;
const PROFILE_PARTITION = "persist:profile-personal";

const DEFAULT_WIDTH = 1588;
const DEFAULT_HEIGHT = 1025;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 680;
const DOWNLOADER_WIDTH = 765;
const DOWNLOADER_HEIGHT = 885;
const DOWNLOADER_MIN_WIDTH = 580;
const DOWNLOADER_MIN_HEIGHT = 620;

const REMOTE_COMMANDS = new Set([
  "download_media",
  "save_media_bytes",
  "open_external_url",
  "prepare_download_folder",
  "report_dm_unread",
  "open_downloader_window",
  "submit_downloader_probe",
]);

const DOWNLOADER_COMMANDS = new Set([
  "open_downloader_window",
  "take_pending_downloader_context",
  "inspect_instagram_post",
  "download_post_selection",
  "save_caption_file",
  "open_downloads_folder",
  "open_external_url",
  "prepare_download_folder",
]);

const startedAtMs = Date.now();
const unreadTracker = new backend.UnreadTracker();
const pendingProbes = new Map();
let pendingDownloaderContext = null;
let probeSeq = 1;

let instagramWin = null;
let downloaderWin = null;
let tray = null;
let isQuitting = false;

let cachedInitScripts = null;
let cachedAboutLogoB64 = null;
let cachedSmallIcon = null;
let cachedLargeIcon = null;
let cachedChromeOverhead = { overheadW: 0, overheadH: 0 };

function warmStartupAssets() {
  if (!cachedInitScripts) {
    Promise.all([
      fsp.readFile(path.join(FRONTEND_DIR, "direct-messages.js"), "utf8"),
      fsp.readFile(path.join(FRONTEND_DIR, "instagram-tools.js"), "utf8"),
    ])
      .then(([dmScript, toolsScript]) => {
        if (!cachedInitScripts) cachedInitScripts = { dmScript, toolsScript };
      })
      .catch(() => {});
  }
  if (cachedAboutLogoB64 === null) {
    fsp
      .readFile(path.join(ICONS_DIR, "128x128.png"))
      .then((buf) => {
        if (cachedAboutLogoB64 === null) cachedAboutLogoB64 = buf.toString("base64");
      })
      .catch(() => {
        if (cachedAboutLogoB64 === null) cachedAboutLogoB64 = "";
      });
  }
}

function getInitScripts() {
  if (!cachedInitScripts) {
    cachedInitScripts = {
      dmScript: fs.readFileSync(path.join(FRONTEND_DIR, "direct-messages.js"), "utf8"),
      toolsScript: fs.readFileSync(path.join(FRONTEND_DIR, "instagram-tools.js"), "utf8"),
    };
  }
  return cachedInitScripts;
}

function getAboutLogoB64() {
  if (cachedAboutLogoB64 === null) {
    try {
      cachedAboutLogoB64 = fs.readFileSync(path.join(ICONS_DIR, "128x128.png")).toString("base64");
    } catch {
      cachedAboutLogoB64 = "";
    }
  }
  return cachedAboutLogoB64;
}

function loadAppIcon(preferSmall = false) {
  if (preferSmall && cachedSmallIcon) return cachedSmallIcon;
  if (!preferSmall && cachedLargeIcon) return cachedLargeIcon;
  const candidates = preferSmall
    ? ["32x32.png", "64x64.png", "128x128.png"]
    : ["128x128.png", "64x64.png", "32x32.png"];
  let resolved = nativeImage.createEmpty();
  for (const name of candidates) {
    const p = path.join(ICONS_DIR, name);
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        resolved = img;
        break;
      }
    }
  }
  if (preferSmall) cachedSmallIcon = resolved;
  else cachedLargeIcon = resolved;
  return resolved;
}

function isInstagramOrigin(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (host === "instagram.com" || host.endsWith(".instagram.com"));
  } catch {
    return false;
  }
}

function isDownloaderOrigin(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl);
    const expected = new URL(DOWNLOADER_FILE_URL);
    return parsed.protocol === "file:" && parsed.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function getDownloadsBaseDir() {
  let base = "";
  try {
    base = app.getPath("downloads");
  } catch {
    base = "";
  }
  return backend.resolveDownloadsBaseDir(base, os.homedir());
}

async function prepareDownloadFolder() {
  const dir = getDownloadsBaseDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function mediaTargetPath(mediaType, subfolder, fileStem) {
  const baseDir = getDownloadsBaseDir();
  const target = backend.buildTargetPath(baseDir, mediaType, subfolder || null, fileStem || null);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  return target;
}

async function getInstagramAuthHeaders(fallbackCookie = null) {
  let pairs = [];
  try {
    const igSession = session.fromPartition(PROFILE_PARTITION);
    const cookies = await igSession.cookies.get({ url: "https://www.instagram.com/" });
    pairs = cookies.map((c) => [c.name, c.value]);
  } catch {
    pairs = [];
  }
  const merged = backend.cookieHeaderAndCsrfFromPairs(pairs);
  if (merged.cookieHeader) return merged;
  const cleanFb = fallbackCookie ? backend.sanitizeHeaderValue(fallbackCookie).trim() : "";
  return { cookieHeader: cleanFb || null, csrfToken: null };
}

function showNotification(body) {
  if (!Notification.isSupported()) {
    throw new Error("Desktop notifications are not supported in this session.");
  }
  const n = new Notification({
    title: "IG-Now",
    body,
    icon: loadAppIcon(false),
  });
  n.on("click", () => openInstagramWindow());
  n.show();
}

function evalInInstagram(code) {
  if (!instagramWin || instagramWin.isDestroyed()) return;
  instagramWin.webContents.executeJavaScript(code, false).catch(() => {});
}

function openInstagramWindow() {
  if (!instagramWin || instagramWin.isDestroyed()) {
    createInstagramWindow(false);
    return null;
  }
  const wasHidden = !instagramWin.isVisible() || instagramWin.isMinimized();
  if (instagramWin.isMinimized()) instagramWin.restore();
  instagramWin.show();
  instagramWin.focus();
  if (wasHidden && instagramWin.__ignowApplyInitialFit) {
    instagramWin.__ignowApplyInitialFit();
  }
  evalInInstagram("if (window.__resumeIfNeeded) window.__resumeIfNeeded();");
  return instagramWin;
}

function toggleShowHide() {
  if (!instagramWin || instagramWin.isDestroyed()) {
    createInstagramWindow(false);
    return;
  }
  const wasHidden = !instagramWin.isVisible() || instagramWin.isMinimized();
  const needsRestore = wasHidden || !instagramWin.isFocused();
  if (needsRestore) {
    if (instagramWin.isMinimized()) instagramWin.restore();
    instagramWin.show();
    instagramWin.focus();
    if (wasHidden && instagramWin.__ignowApplyInitialFit) {
      instagramWin.__ignowApplyInitialFit();
    }
    evalInInstagram("if (window.__resumeIfNeeded) window.__resumeIfNeeded();");
  } else {
    evalInInstagram("if (window.__onWindowHidden) window.__onWindowHidden();");
    instagramWin.hide();
  }
}

function getAutostartExecCommand() {
  return backend.buildAutostartExecCommand(app.isPackaged, process.execPath, __dirname, process.env);
}

function buildTrayMenu() {
  const autostartOn = backend.isAutostartEnabled();
  const alwaysOnTop = Boolean(instagramWin && !instagramWin.isDestroyed() && instagramWin.isAlwaysOnTop());

  const template = [
    { label: "Show / Hide IG-Now", click: () => toggleShowHide() },
    { type: "separator" },
    {
      label: "Places",
      submenu: [
        { label: "Home feed", click: () => navigateInstagram("/") },
        { label: "Explore", click: () => navigateInstagram("/explore/") },
        { label: "Reels", click: () => navigateInstagram("/reels/") },
        { label: "Direct messages", click: () => navigateInstagram("/direct/inbox/") },
        { label: "Notifications", click: () => navigateInstagram("/notifications/") },
        { label: "My profile", click: () => navigateInstagram("/accounts/edit/") },
        { type: "separator" },
        {
          label: "Refresh page",
          click: () => {
            if (openInstagramWindow()) evalInInstagram("window.location.reload();");
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Zoom in (+10%)",
          click: () => {
            if (openInstagramWindow()) {
              evalInInstagram(
                backend.setZoomJs("Math.min(2,(parseFloat(document.body.style.zoom)||base)+0.1).toFixed(2)")
              );
            }
          },
        },
        {
          label: "Zoom out (-10%)",
          click: () => {
            if (openInstagramWindow()) {
              evalInInstagram(
                backend.setZoomJs("Math.max(0.5,(parseFloat(document.body.style.zoom)||base)-0.1).toFixed(2)")
              );
            }
          },
        },
        {
          label: "Reset zoom (100%)",
          click: () => {
            if (openInstagramWindow()) {
              evalInInstagram(backend.setZoomJs("base>0.25&&Math.abs(base-1)>0.001?base:1"));
            }
          },
        },
        { type: "separator" },
        {
          label: "Always on top",
          type: "checkbox",
          checked: alwaysOnTop,
          click: () => {
            if (instagramWin && !instagramWin.isDestroyed()) {
              const nextTop = !instagramWin.isAlwaysOnTop();
              instagramWin.setAlwaysOnTop(nextTop);
              evalInInstagram(
                `if (window.showToast) window.showToast('Always on top: ${nextTop ? "On" : "Off"}');`
              );
              refreshTrayMenu();
            }
          },
        },
      ],
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Open downloads folder",
          click: () => {
            openDownloadsFolder().catch((err) => {
              console.error("[IG-Now] Failed to open downloads folder:", err.message);
            });
          },
        },
        {
          label: "IG-Now Downloader",
          click: () => openDownloaderWindow({}),
        },
        {
          label: "Copy page URL",
          click: () => {
            if (instagramWin && !instagramWin.isDestroyed()) {
              evalInInstagram(
                "(function(){var u=window.location.href,ok=function(){if(window.showToast)window.showToast('Copied page URL to clipboard');},fail=function(){if(window.showToast)window.showToast('Could not copy page URL');},fb=function(){try{var t=document.createElement('textarea');t.value=u;t.style.cssText='position:fixed;opacity:0';document.body.appendChild(t);t.select();var c=document.execCommand('copy');t.remove();c?ok():fail();}catch(e){fail();}};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(ok).catch(fb);}else{fb();}})();"
              );
            }
          },
        },
        {
          label: "Open page in browser",
          click: () => {
            if (instagramWin && !instagramWin.isDestroyed()) {
              const url = instagramWin.webContents.getURL();
              if (backend.isSafeHttpUrl(url)) {
                shell.openExternal(url).catch((err) => {
                  console.error("[IG-Now] Failed to open browser:", err.message);
                });
              }
            }
          },
        },
        { type: "separator" },
        {
          label: "Compact memory and cache",
          click: async () => {
            if (instagramWin && !instagramWin.isDestroyed()) {
              await instagramWin.webContents.session.clearCache().catch(() => {});
              evalInInstagram(
                "if (window.caches) caches.keys().then(function(keys){keys.forEach(function(k){caches.delete(k);});}); if (window.showToast) window.showToast('Cleared cached page data');"
              );
            }
          },
        },
        {
          label: "Test message notification",
          click: () => {
            try {
              showNotification(
                "Message notifications are ready. Your operating system controls notification delivery."
              );
            } catch (err) {
              console.error("[IG-Now] Notification test failed:", err.message);
              evalInInstagram(
                "if (window.showToast) window.showToast('OS notification blocked or unavailable');"
              );
            }
          },
        },
        {
          label: "Developer tools",
          click: () => {
            if (openInstagramWindow() && instagramWin && !instagramWin.isDestroyed()) {
              instagramWin.webContents.openDevTools({ mode: "detach" });
            }
          },
        },
        { type: "separator" },
        {
          label: autostartOn ? "Launch on Startup: On" : "Launch on Startup: Off",
          click: () => {
            let ok = true;
            let nowEnabled = autostartOn;
            try {
              nowEnabled = backend.setAutostartEnabled(!autostartOn, getAutostartExecCommand());
            } catch (err) {
              ok = false;
              console.error("[IG-Now] Autostart toggle failed:", err.message);
            }
            refreshTrayMenu();
            const msg = !ok
              ? "Could not update Launch on Startup setting"
              : nowEnabled
                ? "Launch on Startup: On"
                : "Launch on Startup: Off";
            evalInInstagram(`if (window.showToast) window.showToast('${msg}');`);
          },
        },
      ],
    },
    {
      label: "How to IG-Now",
      submenu: [
        { label: "Image zoom: Ctrl + Left-click any photo", enabled: false },
        { label: "Quick save: Right-click photo or video", enabled: false },
        { label: "Downloader: Sidebar or video bar for MP4, M4A & captions", enabled: false },
        { label: "Seek & Reels: Drag line, -5s/+5s, or arrow keys", enabled: false },
        { label: "Navigate back: Sidebar Back, Alt+Left, or Esc", enabled: false },
        { label: "External links: Right-click link to open in browser", enabled: false },
        { label: "Instagram actions: Click, double-click, and swipe stay native", enabled: false },
      ],
    },
    { type: "separator" },
    {
      label: "About IG-Now",
      click: () => {
        if (openInstagramWindow()) {
          evalInInstagram(
            backend.buildAboutJs(APP_VERSION, getAboutLogoB64(), {
              disableBackdropBlur: backend.shouldDisableGpuCompositing(process.platform, process.argv),
            })
          );
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit IG-Now",
      click: () => {
        isQuitting = true;
        app.exit(0);
      },
    },
  ];
  return Menu.buildFromTemplate(template);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function setupTray() {
  tray = new Tray(loadAppIcon(true));
  tray.setToolTip(`IG-Now Desktop v${APP_VERSION}`);
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => toggleShowHide());
}

function navigateInstagram(igPath) {
  if (openInstagramWindow()) {
    const targetUrl = `https://www.instagram.com${String(igPath || "/")}`;
    evalInInstagram(`window.location.href=${JSON.stringify(targetUrl)};`);
  }
}

function isWaylandSession() {
  return backend.isWaylandOzoneSession(process.platform, process.argv, process.env);
}

function getWorkAreaForDisplay(anchorWin = instagramWin) {
  if (anchorWin && !anchorWin.isDestroyed()) {
    return screen.getDisplayMatching(anchorWin.getBounds()).workArea;
  }
  return screen.getPrimaryDisplay().workArea;
}

function applyFrameToWindow(win, frame, minW, minH, wayland) {
  if (!win || win.isDestroyed()) return;
  if (frame.minWidth < minW || frame.minHeight < minH) {
    win.setMinimumSize(frame.minWidth, frame.minHeight);
  }
  if (wayland) {
    win.setSize(frame.width, frame.height);
  } else {
    win.setBounds({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
  }
}

function scheduleChromeFit(win, initFrame, defaultW, defaultH, minW, minH) {
  const wayland = isWaylandSession();
  const applyOnce = () => {
    if (!win || win.isDestroyed() || win.__ignowChromeFitted) return;
    win.__ignowChromeFitted = true;
    if (wayland) {
      const waFrame = backend.computeCenteredWorkAreaFrame(
        getWorkAreaForDisplay(win),
        defaultW,
        defaultH,
        minW,
        minH
      );
      if (waFrame.width !== initFrame.width || waFrame.height !== initFrame.height) {
        applyFrameToWindow(win, waFrame, minW, minH, true);
      }
      return;
    }
    const timer = setTimeout(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      const overhead = backend.estimateChromeOverhead(
        win.getBounds(),
        win.getContentBounds(),
        { x: initFrame.x, y: initFrame.y }
      );
      if (overhead.overheadW > 0 || overhead.overheadH > 0) {
        cachedChromeOverhead = overhead;
      }
      const effectiveOverhead =
        overhead.overheadW > 0 || overhead.overheadH > 0 ? overhead : cachedChromeOverhead;
      const fitted = backend.computeCenteredWorkAreaFrame(
        getWorkAreaForDisplay(win),
        defaultW,
        defaultH,
        minW,
        minH,
        effectiveOverhead.overheadW,
        effectiveOverhead.overheadH
      );
      if (
        fitted.width !== initFrame.width ||
        fitted.height !== initFrame.height ||
        fitted.x !== initFrame.x ||
        fitted.y !== initFrame.y
      ) {
        applyFrameToWindow(win, fitted, minW, minH, false);
      }
    }, 150);
    if (typeof timer.unref === "function") timer.unref();
  };
  win.__ignowApplyInitialFit = applyOnce;
  return applyOnce;
}

function createInstagramWindow(startMinimized = false) {
  if (instagramWin && !instagramWin.isDestroyed()) {
    if (!startMinimized) openInstagramWindow();
    return instagramWin;
  }

  const wayland = isWaylandSession();
  const frame = backend.computeCenteredWorkAreaFrame(
    screen.getPrimaryDisplay().workArea,
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    MIN_WIDTH,
    MIN_HEIGHT,
    wayland ? 0 : cachedChromeOverhead.overheadW,
    wayland ? 0 : cachedChromeOverhead.overheadH
  );

  const winOptions = {
    title: "IG-Now",
    width: frame.width,
    height: frame.height,
    minWidth: frame.minWidth,
    minHeight: frame.minHeight,
    backgroundColor: "#121212",
    icon: loadAppIcon(false),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-instagram.js"),
      partition: PROFILE_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  };
  if (!wayland) {
    winOptions.x = frame.x;
    winOptions.y = frame.y;
  }

  instagramWin = new BrowserWindow(winOptions);
  instagramWin.setMenuBarVisibility(false);

  const applyInitialFit = scheduleChromeFit(
    instagramWin,
    frame,
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    MIN_WIDTH,
    MIN_HEIGHT
  );

  let revealTimer = null;
  const revealWindow = () => {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    if (!instagramWin || instagramWin.isDestroyed()) return;
    if (!instagramWin.isVisible()) {
      instagramWin.show();
      instagramWin.focus();
    }
    applyInitialFit();
    evalInInstagram("if (window.__ignowEnsureForegroundAudio) window.__ignowEnsureForegroundAudio();");
  };

  if (!startMinimized) {
    instagramWin.once("ready-to-show", revealWindow);
    revealTimer = setTimeout(revealWindow, 4000);
    if (typeof revealTimer.unref === "function") revealTimer.unref();
  }

  instagramWin.webContents.setWindowOpenHandler(({ url }) => {
    if (backend.isSafeHttpUrl(url)) {
      shell.openExternal(url).catch((err) => {
        console.error("[IG-Now] Failed to open external link:", err.message);
      });
    }
    return { action: "deny" };
  });

  instagramWin.webContents.on("will-navigate", (event, targetUrl) => {
    if (!backend.isAllowedInstagramNavUrl(targetUrl)) {
      event.preventDefault();
      if (backend.isSafeHttpUrl(targetUrl)) {
        shell.openExternal(targetUrl).catch((err) => {
          console.error("[IG-Now] Failed to open external link:", err.message);
        });
      }
    }
  });

  instagramWin.webContents.on("did-finish-load", () => {
    if (instagramWin && !instagramWin.isDestroyed() && instagramWin.isVisible() && !instagramWin.isMinimized()) {
      evalInInstagram("if (window.__ignowEnsureForegroundAudio) window.__ignowEnsureForegroundAudio();");
    }
  });

  instagramWin.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      evalInInstagram("if (window.__onWindowHidden) window.__onWindowHidden();");
      instagramWin.hide();
    }
  });

  instagramWin.on("minimize", () => {
    evalInInstagram("if (window.__onWindowHidden) window.__onWindowHidden();");
  });

  instagramWin.on("restore", () => {
    evalInInstagram(
      "if (window.__resumeIfNeeded) window.__resumeIfNeeded(); if (window.__ignowEnsureForegroundAudio) window.__ignowEnsureForegroundAudio();"
    );
  });

  instagramWin.on("focus", () => {
    if (instagramWin && !instagramWin.isDestroyed() && instagramWin.isVisible() && !instagramWin.isMinimized()) {
      evalInInstagram(
        "if (window.__resumeIfNeeded) window.__resumeIfNeeded(); if (window.__ignowEnsureForegroundAudio) window.__ignowEnsureForegroundAudio();"
      );
    }
  });

  instagramWin.on("closed", () => {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    instagramWin = null;
  });

  instagramWin.loadURL("https://www.instagram.com/");
  return instagramWin;
}

function openDownloaderWindow(args = {}) {
  const cleanUrl = typeof args.url === "string" ? args.url.trim() : "";
  const cleanPayload = typeof args.payloadJson === "string" ? args.payloadJson.trim() : "";
  const slideIndex = Number.isInteger(args.slideIndex) ? args.slideIndex : null;
  const cleanSlideHint = typeof args.slideHint === "string" ? args.slideHint.trim() : "";

  if (cleanUrl || cleanPayload || slideIndex !== null || cleanSlideHint) {
    pendingDownloaderContext = {
      url: cleanUrl,
      payloadJson: cleanPayload || null,
      slideIndex,
      slideHint: cleanSlideHint || null,
    };
  }

  const wayland = isWaylandSession();
  if (downloaderWin && !downloaderWin.isDestroyed()) {
    const hiddenOrMin = !downloaderWin.isVisible() || downloaderWin.isMinimized();
    if (downloaderWin.isMinimized()) downloaderWin.restore();
    if (hiddenOrMin) {
      const fitted = backend.computeCenteredWorkAreaFrame(
        getWorkAreaForDisplay(instagramWin),
        DOWNLOADER_WIDTH,
        DOWNLOADER_HEIGHT,
        DOWNLOADER_MIN_WIDTH,
        DOWNLOADER_MIN_HEIGHT,
        wayland ? 0 : cachedChromeOverhead.overheadW,
        wayland ? 0 : cachedChromeOverhead.overheadH
      );
      applyFrameToWindow(
        downloaderWin,
        fitted,
        DOWNLOADER_MIN_WIDTH,
        DOWNLOADER_MIN_HEIGHT,
        wayland
      );
    }
    downloaderWin.show();
    downloaderWin.focus();
    downloaderWin.webContents
      .executeJavaScript("if (window.__ignowLoadDownloaderContext) window.__ignowLoadDownloaderContext();", false)
      .catch(() => {});
    return;
  }

  const frame = backend.computeCenteredWorkAreaFrame(
    getWorkAreaForDisplay(instagramWin),
    DOWNLOADER_WIDTH,
    DOWNLOADER_HEIGHT,
    DOWNLOADER_MIN_WIDTH,
    DOWNLOADER_MIN_HEIGHT,
    wayland ? 0 : cachedChromeOverhead.overheadW,
    wayland ? 0 : cachedChromeOverhead.overheadH
  );

  const dlOptions = {
    title: "IG-Now Downloader",
    width: frame.width,
    height: frame.height,
    minWidth: frame.minWidth,
    minHeight: frame.minHeight,
    backgroundColor: "#111318",
    icon: loadAppIcon(false),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-downloader.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (!wayland) {
    dlOptions.x = frame.x;
    dlOptions.y = frame.y;
  }

  downloaderWin = new BrowserWindow(dlOptions);
  downloaderWin.setMenuBarVisibility(false);

  const applyInitialFit = scheduleChromeFit(
    downloaderWin,
    frame,
    DOWNLOADER_WIDTH,
    DOWNLOADER_HEIGHT,
    DOWNLOADER_MIN_WIDTH,
    DOWNLOADER_MIN_HEIGHT
  );

  let revealTimer = null;
  const revealDownloader = () => {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    if (!downloaderWin || downloaderWin.isDestroyed()) return;
    if (!downloaderWin.isVisible()) {
      downloaderWin.show();
      downloaderWin.focus();
    }
    applyInitialFit();
  };
  downloaderWin.once("ready-to-show", revealDownloader);
  revealTimer = setTimeout(revealDownloader, 2500);
  if (typeof revealTimer.unref === "function") revealTimer.unref();

  downloaderWin.webContents.setWindowOpenHandler(({ url }) => {
    if (backend.isSafeHttpUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  downloaderWin.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isDownloaderOrigin(targetUrl)) event.preventDefault();
  });

  downloaderWin.on("closed", () => {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    downloaderWin = null;
  });

  downloaderWin.loadFile(DOWNLOADER_HTML_PATH);
}

async function openDownloadsFolder() {
  const dir = await prepareDownloadFolder();
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
}

function probePostViaInstagramWindow(cleanInput, shortcode, hasFfmpeg) {
  return new Promise((resolve) => {
    if (!instagramWin || instagramWin.isDestroyed()) {
      resolve(null);
      return;
    }
    if (pendingProbes.size >= 20) {
      const oldestKey = pendingProbes.keys().next().value;
      const oldestResolve = pendingProbes.get(oldestKey);
      pendingProbes.delete(oldestKey);
      if (oldestResolve) oldestResolve("");
    }
    const requestId = `probe-${Date.now()}-${probeSeq++}`;
    const timer = setTimeout(() => {
      pendingProbes.delete(requestId);
      resolve(null);
    }, 15000);

    pendingProbes.set(requestId, (rawPayload) => {
      clearTimeout(timer);
      if (!rawPayload) {
        resolve(null);
        return;
      }
      const post =
        backend.extractPostFromJsonText(rawPayload, shortcode, hasFfmpeg) ||
        backend.extractPostFromHtml(rawPayload, shortcode, hasFfmpeg);
      resolve(post);
    });

    const script = `if (window.__ignowTools && window.__ignowTools.probePostForDownloader) window.__ignowTools.probePostForDownloader(${JSON.stringify(
      requestId
    )}, ${JSON.stringify(cleanInput)});`;
    instagramWin.webContents.executeJavaScript(script, false).catch(() => {
      clearTimeout(timer);
      pendingProbes.delete(requestId);
      resolve(null);
    });
  });
}

async function saveMediaBytesCmd({ data, mediaType, subfolder, fileStem }) {
  const buf = backend.toMediaBuffer(data);
  if (!buf || buf.length === 0) {
    throw new Error("Instagram returned an empty media response.");
  }
  const kind = String(mediaType || "");
  const kindLower = kind.toLowerCase();
  const ffmpeg = backend.findFfmpegBinary();

  if (kindLower === "video") {
    if (!backend.isValidDownloadVideoHeader(buf, Boolean(ffmpeg))) {
      throw new Error("The downloaded video was only a media fragment, not a complete MP4.");
    }
    const targetPath = await mediaTargetPath(kind, subfolder, fileStem);
    const tmp = backend.uniqueTempMediaPath(
      "bytes",
      backend.isValidWebmHeader(buf) ? "webm" : "mp4"
    );
    try {
      await fsp.writeFile(tmp, buf);
      if (ffmpeg) {
        await backend.normalizeVideoMp4(ffmpeg, tmp, null, targetPath);
      } else {
        await backend.replaceFileAtomically(tmp, targetPath);
      }
      await backend.validateOrRemoveMp4(targetPath);
      const stat = await fsp.stat(targetPath).catch(() => null);
      if (!stat || stat.size === 0) {
        await fsp.rm(targetPath, { force: true }).catch(() => {});
        throw new Error("The saved media file was empty.");
      }
      return targetPath;
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }

  if (kindLower === "image") {
    if (!backend.isValidImageHeader(buf)) {
      throw new Error("Instagram returned a non-image response (expired link or login page).");
    }
    const targetPath = await mediaTargetPath(kind, subfolder, fileStem);
    const tmp = backend.uniqueTempMediaPath("bytes", "img");
    try {
      await fsp.writeFile(tmp, buf);
      const finalPath = await backend.normalizeImageFile(ffmpeg, tmp, targetPath);
      const stat = await fsp.stat(finalPath).catch(() => null);
      if (!stat || stat.size === 0) {
        await fsp.rm(finalPath, { force: true }).catch(() => {});
        throw new Error("The saved media file was empty.");
      }
      return finalPath;
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }

  const targetPath = await mediaTargetPath(kind, subfolder, fileStem);
  const tmp = backend.uniqueTempMediaPath("bytes", backend.mediaExtension(kind));
  await fsp.writeFile(tmp, buf);
  await backend.replaceFileAtomically(tmp, targetPath);
  const stat = await fsp.stat(targetPath).catch(() => null);
  if (!stat || stat.size === 0) {
    await fsp.rm(targetPath, { force: true }).catch(() => {});
    throw new Error("The saved media file was empty.");
  }
  return targetPath;
}

async function saveCaptionFileCmd({ post, customCaption, subfolder, fileStem }) {
  const finalPost = { ...(post || {}) };
  if (typeof customCaption === "string") finalPost.caption = customCaption;
  const stem =
    fileStem ||
    backend.buildSourceFilenameStem(finalPost.username, finalPost.takenAt, finalPost.shortcode);
  const doc = backend.formatCaptionDocument(finalPost);
  return saveMediaBytesCmd({
    data: Buffer.from(doc, "utf8"),
    mediaType: "text",
    subfolder: subfolder || null,
    fileStem: stem,
  });
}

function collectItemFallbackCandidates(item, primaryUrl) {
  return (item?.formats || [])
    .filter((f) => f.videoUrl !== primaryUrl)
    .map((f) => [f.videoUrl, f.audioUrl || null]);
}

async function inspectInstagramPostCmd({ url, seedPayloadJson }) {
  const cleanInput = String(url || "").trim();
  const shortcode = backend.shortcodeFromUrl(cleanInput);
  const hasFfmpeg = Boolean(backend.findFfmpegBinary());

  let seedPost = null;
  if (typeof seedPayloadJson === "string" && seedPayloadJson.trim()) {
    seedPost = backend.extractPostFromJsonText(seedPayloadJson, shortcode, hasFfmpeg);
    if (seedPost && backend.isCompleteSeedPost(seedPayloadJson, seedPost, shortcode)) {
      return seedPost;
    }
  }

  const { cookieHeader, csrfToken } = await getInstagramAuthHeaders();
  const httpPromise = backend.inspectViaHttpCascade(cleanInput, cookieHeader, csrfToken);
  const probePromise = probePostViaInstagramWindow(cleanInput, shortcode, hasFfmpeg);
  return backend.inspectWithWindowRace({
    shortcode,
    seedPost,
    httpPromise,
    probePromise,
  });
}

async function downloadPostSelectionCmd({ post, itemIndex, formatId, mode, customCaption }) {
  const finalPost = { ...(post || {}) };
  if (typeof customCaption === "string") finalPost.caption = customCaption;
  const modeLower = String(mode || "").toLowerCase();

  if (modeLower === "caption") {
    const captionPath = await saveCaptionFileCmd({ post: finalPost });
    return {
      savedPaths: [],
      captionPath,
      metadataPath: null,
      subfolder: null,
      warning: null,
    };
  }

  const items = Array.isArray(finalPost.items) ? finalPost.items : [];
  if (!items.length) {
    throw new Error("No downloadable video or image items found for this post.");
  }

  const referer = backend.isSafeHttpUrl(finalPost.postUrl)
    ? finalPost.postUrl
    : "https://www.instagram.com/";
  const ua = backend.DEFAULT_UA;
  const { cookieHeader } = await getInstagramAuthHeaders();
  const idx = Number.isInteger(itemIndex) ? itemIndex : 0;

  if (modeLower === "audio") {
    const item = items[idx] || items[0];
    if (!item || String(item.kind).toLowerCase() !== "video") {
      throw new Error("Audio Only (.m4a) is only available for video or Reel items.");
    }
    const chosen = (formatId && item.formats.find((f) => f.id === formatId)) || item.formats[0];
    if (!chosen) throw new Error("No downloadable audio source found for this video.");
    const audioCandidate = chosen.audioUrl || item.formats.find((f) => f.audioUrl)?.audioUrl || null;
    const stem = backend.singleSelectionFileStem(
      finalPost.username,
      finalPost.takenAt,
      finalPost.shortcode,
      item.index,
      items.length
    );
    const targetPath = await mediaTargetPath("audio", null, stem);
    await backend.fetchAudioOnlyToPath(chosen.videoUrl, audioCandidate, referer, ua, cookieHeader, targetPath);
    return {
      savedPaths: [targetPath],
      captionPath: null,
      metadataPath: null,
      subfolder: null,
      warning: null,
    };
  }

  if (modeLower === "single") {
    const item = items[idx] || items[0];
    const chosen = (formatId && item?.formats?.find((f) => f.id === formatId)) || item?.formats?.[0];
    if (!chosen) throw new Error("No downloadable format available for this item.");
    const stem = backend.singleSelectionFileStem(
      finalPost.username,
      finalPost.takenAt,
      finalPost.shortcode,
      item.index,
      items.length
    );
    const targetPath = await mediaTargetPath(item.kind, null, stem);
    const fallbackAudio =
      item.formats.map((f) => f.audioUrl).find((a) => a && a !== chosen.audioUrl) || null;
    const result = await backend.fetchMediaWithFallbacks(
      chosen.videoUrl,
      collectItemFallbackCandidates(item, chosen.videoUrl),
      item.kind,
      chosen.audioUrl || null,
      fallbackAudio,
      referer,
      ua,
      cookieHeader,
      targetPath
    );
    return {
      savedPaths: [result.path],
      captionPath: null,
      metadataPath: null,
      subfolder: null,
      warning: result.warning || null,
    };
  }

  const postStem = backend.buildSourceFilenameStem(
    finalPost.username,
    finalPost.takenAt,
    finalPost.shortcode
  );
  const subfolder = postStem;
  const total = items.length;
  let completed = 0;
  const emitProgress = () => {
    if (downloaderWin && !downloaderWin.isDestroyed()) {
      downloaderWin.webContents.send("ignow:downloader-progress", { completed, total });
    }
  };

  const tasks = items.map((item, i) => {
    const chosen =
      i === idx && formatId
        ? item.formats.find((f) => f.id === formatId) || item.formats[0]
        : item.formats[0];
    if (!chosen) return null;
    return async () => {
      const stem = backend.carouselSlideStem(postStem, i, total);
      const targetPath = await mediaTargetPath(item.kind, subfolder, stem);
      const fallbackAudio =
        item.formats.map((f) => f.audioUrl).find((a) => a && a !== chosen.audioUrl) || null;
      try {
        const result = await backend.fetchMediaWithFallbacks(
          chosen.videoUrl,
          collectItemFallbackCandidates(item, chosen.videoUrl),
          item.kind,
          chosen.audioUrl || null,
          fallbackAudio,
          referer,
          ua,
          cookieHeader,
          targetPath
        );
        return { idx: i, targetPath: result.path, ok: true, warn: result.warning || null };
      } catch (err) {
        return { idx: i, targetPath, ok: false, error: err.message || String(err) };
      } finally {
        completed += 1;
        emitProgress();
      }
    };
  }).filter(Boolean);

  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const myIdx = cursor++;
      results[myIdx] = await tasks[myIdx]();
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => a.idx - b.idx);
  const savedPaths = [];
  let firstWarning = null;
  const failedSlides = [];
  for (const res of results) {
    if (res.ok) {
      savedPaths.push(res.targetPath);
      if (!firstWarning && res.warn) firstWarning = res.warn;
    } else {
      failedSlides.push(res.idx + 1);
      if (!firstWarning) firstWarning = res.error;
    }
  }
  if (failedSlides.length) {
    const slideList = failedSlides.join(", ");
    firstWarning = firstWarning
      ? `Slides [${slideList}] failed (${firstWarning}).`
      : `Slides [${slideList}] could not be downloaded.`;
  }

  let captionPath = null;
  try {
    captionPath = await saveCaptionFileCmd({
      post: finalPost,
      subfolder,
      fileStem: "caption",
    });
  } catch {
    captionPath = null;
  }

  let metadataPath = null;
  try {
    const metaJson = backend.buildMetadataJson(finalPost);
    metadataPath = await saveMediaBytesCmd({
      data: Buffer.from(metaJson, "utf8"),
      mediaType: "json",
      subfolder,
      fileStem: "metadata",
    });
  } catch {
    metadataPath = null;
  }

  if (!savedPaths.length && !captionPath) {
    throw new Error(firstWarning || "Post download failed.");
  }

  return {
    savedPaths,
    captionPath,
    metadataPath,
    subfolder,
    warning: firstWarning,
  };
}

async function handleIpcCommand(event, command, args = {}) {
  const frameUrl = event.senderFrame?.url || "";
  const fromIg = instagramWin && !instagramWin.isDestroyed() && event.sender === instagramWin.webContents;
  const fromDl = downloaderWin && !downloaderWin.isDestroyed() && event.sender === downloaderWin.webContents;

  const allowed =
    (fromIg && isInstagramOrigin(frameUrl) && REMOTE_COMMANDS.has(command)) ||
    (fromDl && isDownloaderOrigin(frameUrl) && DOWNLOADER_COMMANDS.has(command));
  if (!allowed) {
    throw new Error(`Unauthorized IPC command "${command}" from origin "${frameUrl}".`);
  }

  switch (command) {
    case "prepare_download_folder":
      return prepareDownloadFolder();
    case "open_downloads_folder":
      return openDownloadsFolder();
    case "open_external_url": {
      const url = String(args.url || "");
      if (!backend.isSafeHttpUrl(url)) {
        throw new Error("Only safe HTTP(S) URLs can be opened externally.");
      }
      await shell.openExternal(url);
      return null;
    }
    case "report_dm_unread": {
      const count = Number(args.count) || 0;
      const viewingInbox = Boolean(args.viewingInbox);
      const focusedInbox =
        viewingInbox &&
        Boolean(
          instagramWin &&
            !instagramWin.isDestroyed() &&
            instagramWin.isVisible() &&
            !instagramWin.isMinimized() &&
            instagramWin.isFocused()
        );
      const suppress = focusedInbox || Date.now() - startedAtMs < 10000;
      if (unreadTracker.update(count, suppress, Date.now())) {
        try {
          showNotification("You have new Instagram messages. Open IG-Now to read them.");
        } catch (err) {
          throw new Error(err.message);
        }
      }
      return null;
    }
    case "download_media": {
      const url = String(args.url || "");
      if (!backend.isSafeHttpUrl(url)) {
        throw new Error("Instagram did not provide a downloadable HTTP(S) media URL.");
      }
      const mediaType = String(args.mediaType || "image");
      const targetPath = await mediaTargetPath(mediaType, args.subfolder, args.fileStem);
      const referer = backend.isSafeHttpUrl(args.referer) ? args.referer : "https://www.instagram.com/";
      const ua = backend.sanitizeHeaderValue(args.userAgent || "").trim() || backend.DEFAULT_UA;
      const { cookieHeader } = await getInstagramAuthHeaders(args.cookies || null);
      const result = await backend.fetchMediaToPath(
        url,
        mediaType,
        args.audioUrl || null,
        null,
        referer,
        ua,
        cookieHeader,
        targetPath
      );
      return result.path;
    }
    case "save_media_bytes":
      return saveMediaBytesCmd(args);
    case "open_downloader_window":
      openDownloaderWindow(args);
      return null;
    case "take_pending_downloader_context": {
      const ctx = pendingDownloaderContext;
      pendingDownloaderContext = null;
      return ctx;
    }
    case "submit_downloader_probe": {
      const resolver = pendingProbes.get(String(args.requestId || ""));
      if (!resolver) return false;
      pendingProbes.delete(String(args.requestId));
      resolver(String(args.payloadJson || ""));
      return true;
    }
    case "inspect_instagram_post":
      return inspectInstagramPostCmd(args);
    case "save_caption_file":
      return saveCaptionFileCmd(args);
    case "download_post_selection":
      return downloadPostSelectionCmd(args);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function registerIpcHandlers() {
  ipcMain.on("ignow:get-init-scripts", (event) => {
    const frameUrl = event.senderFrame?.url || "";
    const fromIg = instagramWin && !instagramWin.isDestroyed() && event.sender === instagramWin.webContents;
    if (fromIg && isInstagramOrigin(frameUrl)) {
      event.returnValue = {
        ...getInitScripts(),
        disableBackdropBlur: backend.shouldDisableGpuCompositing(process.platform, process.argv),
      };
    } else {
      event.returnValue = null;
    }
  });

  ipcMain.handle("ignow:invoke", async (event, command, args) => {
    try {
      const value = await handleIpcCommand(event, command, args);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

function preconnectInstagramSession() {
  try {
    const igSession = session.fromPartition(PROFILE_PARTITION);
    for (const url of [
      "https://www.instagram.com",
      "https://static.cdninstagram.com",
      "https://scontent.cdninstagram.com",
    ]) {
      igSession.preconnect({ url, numSockets: 2 });
    }
  } catch {
    // Ignore preconnect failures.
  }
}

for (const [flag, val] of backend.getLinuxStartupSwitches(
  process.platform,
  process.argv,
  process.env,
  null,
  process.execPath
)) {
  if (val !== undefined) app.commandLine.appendSwitch(flag, val);
  else app.commandLine.appendSwitch(flag);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName("IG-Now");

  app.on("second-instance", (_event, argv) => {
    if (!argv.includes("--minimized")) openInstagramWindow();
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (isQuitting) app.quit();
  });

  app.whenReady().then(() => {
    warmStartupAssets();
    preconnectInstagramSession();
    registerIpcHandlers();
    setupTray();
    const startMinimized = process.argv.includes("--minimized");
    createInstagramWindow(startMinimized);
  });
}
