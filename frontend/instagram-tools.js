(function () {
  if (window.__ignowMediaToolsInstalled) return;
  window.__ignowMediaToolsInstalled = true;

  const invoke = window.__TAURI__?.core?.invoke;
  const state = {
    menu: null,
    toast: null,
    viewer: null,
    activeVideo: null,
    videoAudioUnlocked: false
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
      padding: 0 12px 12px !important;
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

    .ignow-video-controls__progress {
      position: relative !important;
      flex: 1 1 auto !important;
      min-width: 28px !important;
      height: 3px !important;
      min-height: 3px !important;
      margin: 0 !important;
      padding: 0 !important;
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
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.75) !important;
      pointer-events: none !important;
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

    .ignow-video-controls__progress--search {
      height: 23px !important;
      min-height: 23px !important;
      margin: -10px 0 !important;
      padding: 10px 0 !important;
      background-clip: content-box !important;
      cursor: pointer !important;
      pointer-events: auto !important;
    }

    .ignow-video-controls__progress--search:hover {
      height: 23px !important;
      min-height: 23px !important;
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

  function controlButtonFromTarget(target) {
    return elementFromTarget(target)?.closest?.(".ignow-video-controls button") || null;
  }

  ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup"].forEach(type => {
    window.addEventListener(type, event => {
      const button = controlButtonFromTarget(event.target);
      if (!button || !controlActions.has(button)) return;
      event.stopImmediatePropagation();
    }, true);
  });

  window.addEventListener("click", event => {
    const button = controlButtonFromTarget(event.target);
    const action = button ? controlActions.get(button) : null;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve(action()).catch(error => {
      console.warn("IG-Now video control action failed:", error);
    });
  }, true);

  window.addEventListener("dblclick", event => {
    if (!elementFromTarget(event.target)?.closest?.(".ignow-video-controls")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

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
      media.muted = true;
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
    return isSearchCardVideo(video) ? 0.2 : 0.5;
  }

  function applyDefaultVideoAudio(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const profile = isSearchCardVideo(video) ? "search-card" : "full-view";
    const profileKey = `${profile}:${defaultVolumeForVideo(video)}`;
    if (video.dataset.ignowAudioProfile === profileKey) return;
    try {
      video.volume = defaultVolumeForVideo(video);
      if (isSearchCardVideo(video)) video.muted = true;
      video.dataset.ignowAudioProfile = profileKey;
    } catch (error) {
      console.warn("IG-Now could not apply the video audio default:", error);
    }
  }

  function activateVideoAudio(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    try {
      state.videoAudioUnlocked = true;
      video.volume = defaultVolumeForVideo(video);
      video.muted = false;
      video.dataset.ignowAudioUserActivated = "1";
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

  function navigateReel(deltaY) {
    const video = activeVideoForKeyboard();
    const target = video || document.scrollingElement || document.body;
    const wheelEvent = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      deltaY
    });
    target.dispatchEvent(wheelEvent);
    if (window.scrollBy && !wheelEvent.defaultPrevented) {
      window.scrollBy({ top: deltaY, behavior: "smooth" });
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

    let downloadFolder = "Downloads\\IG-Now";
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
            : "Save image to Downloads\\IG-Now",
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
    if (target?.matches?.("input, textarea, [contenteditable=true]")) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const video = activeVideoForKeyboard();
      if (!video) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      seekVideo(video, event.key === "ArrowLeft" ? -5 : 5);
      return;
    }

    if (isStandaloneReelPage() && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const pageStep = Math.max(400, window.innerHeight || 720);
      navigateReel(event.key === "ArrowUp" ? -pageStep : pageStep);
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
      isSearchCardVideo(video)
        ? "Video progress; click or drag to seek"
        : "Video progress; use the left and right arrow keys to seek"
    );
    progressLine.setAttribute("aria-valuemin", "0");
    progressLine.setAttribute("aria-valuemax", "100");
    progressLine.setAttribute("aria-valuenow", "0");
    progressLine.style.setProperty("--ignow-progress", "0%");

    const totalLabel = document.createElement("span");
    totalLabel.className = "ignow-video-controls__time ignow-video-controls__time--total";
    totalLabel.textContent = "0:00";

    controls.append(playButton, elapsedLabel, progressLine, totalLabel);
    host.appendChild(controls);

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

    const sync = () => {
      applyDefaultVideoAudio(video);
      const searchCard = isSearchCardVideo(video);
      progressLine.classList.toggle("ignow-video-controls__progress--search", searchCard);
      progressLine.setAttribute(
        "aria-label",
        searchCard
          ? "Video progress; click or drag to seek"
          : "Video progress; use the left and right arrow keys to seek"
      );
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
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
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const nextTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
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
      if (!isSearchCardVideo(video) || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const nextTime = Math.max(0, Math.min(1, fraction)) * video.duration;
      try {
        if (typeof video.fastSeek === "function") video.fastSeek(nextTime);
      } catch (error) {
        console.warn("IG-Now fast seeking is unavailable; using normal seeking:", error);
      }
      try {
        video.currentTime = nextTime;
      } catch (error) {
        console.warn("IG-Now could not seek this Search video:", error);
      }
      sync();
    };

    const startSearchHoverPreview = () => {
      if (!isSearchCardVideo(video)) return;
      video.volume = 0.2;
      video.muted = true;
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
        video.volume = 0.2;
        video.muted = true;
      } else {
        activateVideoAudio(video);
      }
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    };

    videoControllers.set(video, { seek: seekBy, toggle, refresh: sync });
    controlActions.set(playButton, toggle);
    progressLine.addEventListener("input", event => {
      if (!isSearchCardVideo(video)) return;
      event.preventDefault();
      event.stopPropagation();
      state.activeVideo = video;
      seekToFraction(Number(progressLine.value) / 100);
    }, true);

    let pointerSeeking = false;
    const seekFromPointer = event => {
      const rect = progressLine.getBoundingClientRect();
      if (!rect.width) return;
      seekToFraction((event.clientX - rect.left) / rect.width);
    };
    progressLine.addEventListener("pointerdown", event => {
      if (!isSearchCardVideo(video)) return;
      event.preventDefault();
      event.stopPropagation();
      pointerSeeking = true;
      state.activeVideo = video;
      progressLine.setPointerCapture?.(event.pointerId);
      seekFromPointer(event);
    }, true);
    progressLine.addEventListener("pointermove", event => {
      if (!pointerSeeking) return;
      event.preventDefault();
      event.stopPropagation();
      seekFromPointer(event);
    }, true);
    const stopPointerSeeking = event => {
      if (!pointerSeeking) return;
      pointerSeeking = false;
      progressLine.releasePointerCapture?.(event.pointerId);
      event.stopPropagation();
    };
    progressLine.addEventListener("pointerup", stopPointerSeeking, true);
    progressLine.addEventListener("pointercancel", stopPointerSeeking, true);
    progressLine.addEventListener("lostpointercapture", () => {
      pointerSeeking = false;
    }, true);

    ["click", "dblclick", "pointerdown", "pointermove", "pointerup", "pointercancel", "input", "change"]
      .forEach(type => {
      controls.addEventListener(type, event => event.stopPropagation());
    });
    controls.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
    });

    video.addEventListener("timeupdate", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("durationchange", sync);
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
        _ignowMutedVideo.muted = true; // instant silence; the OS session mute is the guarantee
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
        _ignowMutedVideo.muted = _ignowMutedByHide;
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
