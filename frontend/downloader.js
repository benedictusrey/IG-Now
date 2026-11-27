(() => {
  const urlInput = document.getElementById("url-input");
  const clearUrlBtn = document.getElementById("clear-url-btn");
  const urlHint = document.getElementById("url-hint");
  const pasteBtn = document.getElementById("paste-btn");
  const inspectBtn = document.getElementById("inspect-btn");
  const openFolderBtn = document.getElementById("open-folder-btn");
  const slideStrip = document.getElementById("slide-strip");
  const slideSelect = document.getElementById("slide-select");
  const prevSlideBtn = document.getElementById("prev-slide-btn");
  const nextSlideBtn = document.getElementById("next-slide-btn");
  const formatSelect = document.getElementById("format-select");
  const captionInput = document.getElementById("caption-input");
  const captionCount = document.getElementById("caption-count");
  const copyCaptionBtn = document.getElementById("copy-caption-btn");
  const saveCaptionBtn = document.getElementById("save-caption-btn");
  const downloadSelectedBtn = document.getElementById("download-selected-btn");
  const downloadSelectedLabel = document.getElementById("download-selected-label");
  const downloadAudioBtn = document.getElementById("download-audio-btn");
  const downloadBundleBtn = document.getElementById("download-bundle-btn");
  const downloadBundleLabel = document.getElementById("download-bundle-label");
  const actionsGrid = document.querySelector(".actions-grid");
  const actionsNote = document.getElementById("actions-note");
  const postSummary = document.getElementById("post-summary");
  const engineBadge = document.getElementById("engine-badge");
  const postSection = document.getElementById("post-section");
  const statusFooter = document.getElementById("status-footer");
  const statusBox = document.getElementById("status-box");
  const statusOpenBtn = document.getElementById("status-open-btn");
  const previewBox = document.getElementById("preview-box");
  const previewEmpty = document.getElementById("preview-empty");
  const previewEmptyText = document.getElementById("preview-empty-text");
  const previewTag = document.getElementById("preview-tag");
  const outputNamePreview = document.getElementById("output-name-preview");
  const copyStemBtn = document.getElementById("copy-stem-btn");
  const audioSpecPreview = document.getElementById("audio-spec-preview");

  let currentPost = null;
  let busy = false;
  let activeDownloadMode = "";
  let previewThumb = null;
  let lastAutoClipboardUrl = "";
  let queuedContext = null;
  const isMacPlatform = /Mac|iPhone|iPad|iPod/i.test(
    navigator.userAgentData?.platform || navigator.platform || ""
  );
  const modKeyLabel = isMacPlatform ? "Cmd" : "Ctrl";

  function invoke(command, args = {}) {
    const fn = window.__TAURI__?.core?.invoke;
    if (typeof fn !== "function") {
      return Promise.reject(new Error("IG-Now native bridge is unavailable."));
    }
    return fn(command, args);
  }

  function setStatus(message, tone = "", showOpenFolder = false) {
    statusBox.textContent = String(message || "");
    if (tone) statusBox.setAttribute("data-tone", tone);
    else statusBox.removeAttribute("data-tone");
    if (statusOpenBtn) statusOpenBtn.hidden = !showOpenFolder;
  }

  function setPreviewEmptyMessage(text, state = "idle") {
    if (previewBox) previewBox.setAttribute("data-state", state);
    if (previewEmptyText) {
      previewEmptyText.textContent = text;
    } else if (previewEmpty) {
      previewEmpty.textContent = text;
    }
  }

  function updateUrlControls() {
    const val = urlInput.value.trim();
    if (clearUrlBtn) clearUrlBtn.hidden = !val;
    if (urlHint) {
      if (!val) {
        urlHint.textContent = `Auto-inspects on open or paste \u00b7 ${modKeyLabel}+L to focus`;
      } else if (isInstagramMediaLink(val) || /^[A-Za-z0-9_-]{5,32}$/.test(val)) {
        urlHint.textContent = "Instagram link detected";
      } else {
        urlHint.textContent = "Enter an instagram.com/p/ or /reel/ URL";
      }
    }
  }

  function updateCaptionCounter() {
    if (!captionCount) return;
    const len = captionInput.value.length;
    captionCount.textContent = `${len.toLocaleString()} char${len === 1 ? "" : "s"}`;
  }

  function formatOutputPattern(post, item, slideIndex, extOverride = null) {
    if (!post || !item) return "username-YYYYMMDD-hash.mp4";
    const user = String(post.username || "instagram")
      .trim()
      .replace(/[^A-Za-z0-9._]+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 40) || "instagram";
    const isoDigits = String(post.takenAt || "").slice(0, 10).replace(/\D+/g, "");
    const datePart = isoDigits.length === 8
      ? isoDigits
      : new Date().toISOString().slice(0, 10).replace(/\D+/g, "");
    const ext = extOverride || (item.kind === "video" ? "mp4" : "jpg");
    const total = post.items?.length || 0;
    const slideNum = total >= 10 ? String(slideIndex + 1).padStart(2, "0") : String(slideIndex + 1);
    const slideSuffix = total > 1 ? `-slide-${slideNum}` : "";
    return `${user}-${datePart}-<hash>${slideSuffix}.${ext}`;
  }

  function currentSlideIndex() {
    return Math.max(0, Number(slideSelect.value) || 0);
  }

  function currentSlideItem() {
    const idx = currentSlideIndex();
    return currentPost?.items?.[idx] || currentPost?.items?.[0] || null;
  }

  function selectedFormatForItem(item) {
    if (!item || !Array.isArray(item.formats) || !item.formats.length) return null;
    return item.formats.find(f => f.id === formatSelect.value) || item.formats[0] || null;
  }

  function updateAudioAndFormatSpec(item) {
    if (!audioSpecPreview || !item) return;
    const fmt = selectedFormatForItem(item);
    const dims = fmt?.width && fmt?.height ? `${fmt.width}\u00d7${fmt.height}` : "";
    if (item.kind === "video") {
      const audioDesc = currentPost?.ffmpegAvailable
        ? (fmt?.requiresMux ? "DASH + AAC 192 kbps (muxed)" : "AAC 192 kbps \u00b7 MP4 / M4A")
        : "Source MP4 audio";
      audioSpecPreview.textContent = dims ? `${dims} \u00b7 ${audioDesc}` : audioDesc;
    } else {
      audioSpecPreview.textContent = dims ? `${dims} \u00b7 Still image (no audio)` : "Still image (no audio)";
    }
  }

  function setBusy(nextBusy, mode = "inspect") {
    busy = nextBusy;
    if (statusFooter) statusFooter.setAttribute("data-busy", nextBusy ? "1" : "0");
    if (postSection) postSection.setAttribute("aria-busy", nextBusy ? "true" : "false");
    inspectBtn.disabled = nextBusy;
    inspectBtn.textContent = nextBusy && mode === "inspect" ? "Inspecting..." : "Inspect Link";
    updateActionButtons();
  }

  async function drainQueuedContext() {
    if (!queuedContext || busy) return;
    const next = queuedContext;
    queuedContext = null;
    urlInput.value = next.url || "";
    updateUrlControls();
    await inspectUrl(next.url || "", next.payloadJson || null, next);
  }

  function setBundleButtonLabel(text) {
    if (downloadBundleLabel) {
      downloadBundleLabel.textContent = text;
    } else if (downloadBundleBtn) {
      downloadBundleBtn.textContent = text;
    }
  }

  function updateActionButtons() {
    const items = currentPost?.items || [];
    const hasPost = Boolean(currentPost && Array.isArray(items) && items.length);
    const slideIdx = currentSlideIndex();
    const activeItem = currentSlideItem();
    const hasAnyVideo = hasPost && items.some(item => item.kind === "video");
    const isVideoSlide = Boolean(hasPost && activeItem?.kind === "video");
    const isImageOnlyPost = Boolean(hasPost && !hasAnyVideo);
    slideSelect.disabled = busy || !hasPost;
    formatSelect.disabled = busy || !hasPost;
    if (prevSlideBtn) prevSlideBtn.disabled = busy || !hasPost || items.length <= 1 || slideIdx <= 0;
    if (nextSlideBtn) nextSlideBtn.disabled = busy || !hasPost || items.length <= 1 || slideIdx >= items.length - 1;
    downloadSelectedBtn.disabled = busy || !hasPost;
    downloadBundleBtn.disabled = busy || !hasPost;
    if (actionsGrid) {
      if (isImageOnlyPost) actionsGrid.setAttribute("data-image-only", "1");
      else actionsGrid.removeAttribute("data-image-only");
    }
    if (downloadAudioBtn) {
      downloadAudioBtn.hidden = isImageOnlyPost;
      downloadAudioBtn.disabled = busy || !isVideoSlide;
      downloadAudioBtn.title = isVideoSlide
        ? "Extract 192 kbps stereo AAC (.m4a)"
        : "Audio extraction is available for video slides only";
    }
    if (isImageOnlyPost) {
      if (items.length > 1) {
        setBundleButtonLabel(`Save All ${items.length} Images + Caption`);
        if (actionsNote) {
          actionsNote.textContent = `Save All ${items.length} Images saves the full image sequence in order alongside caption.txt and metadata.json into one dated folder.`;
        }
      } else {
        setBundleButtonLabel("Save Image + Caption");
        if (actionsNote) {
          actionsNote.textContent = "Save Image + Caption exports the full-resolution .jpg alongside caption.txt and metadata.json into one dated folder.";
        }
      }
    } else if (items.length > 1) {
      setBundleButtonLabel(`Save Full Post (${items.length} items)`);
      if (actionsNote) {
        actionsNote.textContent = `Save Full Post exports all ${items.length} carousel slides alongside caption.txt and metadata.json into one dated folder.`;
      }
    } else {
      setBundleButtonLabel("Save Full Post");
      if (actionsNote) {
        actionsNote.textContent = "Save Full Post exports all carousel slides alongside caption.txt and metadata.json into one dated folder.";
      }
    }
    if (slideStrip) {
      slideStrip.querySelectorAll("button[data-slide-idx]").forEach(btn => {
        btn.disabled = busy;
      });
    }
    if (copyStemBtn) copyStemBtn.disabled = busy || !hasPost;
    const hasCaptionOrPost = Boolean(currentPost || captionInput.value.trim());
    copyCaptionBtn.disabled = busy || !captionInput.value.trim();
    saveCaptionBtn.disabled = busy || !hasCaptionOrPost;
    updateCaptionCounter();
  }

  function removePreviewThumb() {
    if (previewThumb) {
      previewThumb.remove();
      previewThumb = null;
    }
  }

  function updatePreview(item, slideIndex) {
    if (!previewBox || !previewEmpty || !previewTag) return;
    if (!item) {
      removePreviewThumb();
      previewEmpty.hidden = false;
      previewTag.hidden = true;
      setPreviewEmptyMessage("Preview loads automatically on inspection", "idle");
      if (outputNamePreview) outputNamePreview.textContent = "username-YYYYMMDD-hash.mp4";
      if (audioSpecPreview) audioSpecPreview.textContent = "AAC 192 kbps (44.1 kHz)";
      return;
    }

    const ext = item.kind === "video" ? "MP4 \u00b7 AAC" : "JPEG";
    previewTag.textContent = (currentPost?.items?.length || 0) > 1
      ? `${slideIndex + 1}/${currentPost.items.length} \u00b7 ${ext}`
      : ext;
    previewTag.hidden = false;

    const thumbCandidates = [
      item.thumbnailUrl,
      ...(item.kind === "image" ? (item.formats || []).map(f => f.videoUrl) : [])
    ].filter((u, idx, arr) => u && /^https?:\/\//i.test(u) && arr.indexOf(u) === idx);
    let thumbIdx = 0;

    if (thumbCandidates.length) {
      if (!previewThumb) {
        previewThumb = document.createElement("img");
        previewThumb.id = "preview-thumb";
        previewThumb.alt = "Selected Instagram media preview";
        previewThumb.referrerPolicy = "no-referrer";
        previewBox.prepend(previewThumb);
      }
      previewThumb.onload = () => {
        if (previewThumb) previewThumb.hidden = false;
        previewEmpty.hidden = true;
        previewBox.setAttribute("data-state", "ready");
      };
      previewThumb.onerror = () => {
        thumbIdx += 1;
        if (thumbIdx < thumbCandidates.length && previewThumb) {
          previewThumb.src = thumbCandidates[thumbIdx];
          return;
        }
        removePreviewThumb();
        previewEmpty.hidden = false;
        setPreviewEmptyMessage("Thumbnail preview unavailable \u2014 media formats are ready", "unavailable");
      };
      previewThumb.src = thumbCandidates[0];
      previewThumb.hidden = false;
      previewEmpty.hidden = true;
      previewBox.setAttribute("data-state", "ready");
    } else {
      removePreviewThumb();
      previewEmpty.hidden = false;
      setPreviewEmptyMessage("Thumbnail preview unavailable \u2014 media formats are ready", "unavailable");
    }

    if (outputNamePreview) {
      outputNamePreview.textContent = formatOutputPattern(currentPost, item, slideIndex);
    }
    updateAudioAndFormatSpec(item);
  }

  function setPrimaryDownloadLabel(text) {
    if (downloadSelectedLabel) {
      downloadSelectedLabel.textContent = text;
    } else {
      downloadSelectedBtn.textContent = text;
    }
  }

  function syncSlideStrip(slideIndex) {
    if (!slideStrip) return;
    slideStrip.querySelectorAll("button[data-slide-idx]").forEach(btn => {
      const isSelected = Number(btn.getAttribute("data-slide-idx")) === slideIndex;
      btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
      if (isSelected) btn.scrollIntoView?.({ block: "nearest", inline: "center" });
    });
  }

  function renderSlideStrip(items) {
    if (!slideStrip) return;
    slideStrip.innerHTML = "";
    if (!Array.isArray(items) || items.length <= 1) {
      slideStrip.hidden = true;
      return;
    }
    slideStrip.hidden = false;
    items.forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slide-strip__btn";
      btn.setAttribute("data-slide-idx", String(idx));
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", `Select slide ${idx + 1} (${item.kind === "video" ? "Video" : "Photo"})`);
      btn.title = `Slide ${idx + 1} (${item.kind === "video" ? "Video .mp4" : "Photo .jpg"})`;
      const thumbSrc = item.thumbnailUrl || (item.kind === "image" ? item.formats?.[0]?.videoUrl : "") || "";
      if (/^https?:\/\//i.test(thumbSrc)) {
        const img = document.createElement("img");
        img.className = "slide-strip__thumb";
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.src = thumbSrc;
        btn.appendChild(img);
      }
      const num = document.createElement("span");
      num.className = "slide-strip__num";
      num.textContent = String(idx + 1);
      btn.appendChild(num);
      if (item.kind === "video") {
        const badge = document.createElement("span");
        badge.className = "slide-strip__video";
        badge.innerHTML = '<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
        btn.appendChild(badge);
      }
      btn.addEventListener("click", () => {
        if (busy) return;
        slideSelect.value = String(idx);
        renderFormatsForSlide(idx);
      });
      slideStrip.appendChild(btn);
    });
  }

  function mediaUrlBasename(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.pathname.split("/").pop()?.toLowerCase() || "";
    } catch {
      return "";
    }
  }

  function resolveInitialSlideIndex(post, rawUrl, slideCtx = null) {
    const items = post?.items || [];
    if (items.length <= 1) return 0;
    const urlHint = String(slideCtx?.slideHint || "").trim();
    const hintBase = mediaUrlBasename(urlHint);
    if (urlHint) {
      const exactIdx = items.findIndex(item => (
        item.thumbnailUrl === urlHint
        || (item.formats || []).some(f => f.videoUrl === urlHint)
        || (hintBase && (
          mediaUrlBasename(item.thumbnailUrl) === hintBase
          || (item.formats || []).some(f => mediaUrlBasename(f.videoUrl) === hintBase)
        ))
      ));
      if (exactIdx >= 0) return exactIdx;
    }
    if (Number.isInteger(slideCtx?.slideIndex) && slideCtx.slideIndex >= 0 && slideCtx.slideIndex < items.length) {
      return slideCtx.slideIndex;
    }
    const urlStr = String(rawUrl || post.postUrl || "");
    const idxMatch = urlStr.match(/[?&]img_index=(\d+)/i);
    if (idxMatch) {
      const parsedIdx = Number(idxMatch[1]) - 1;
      if (parsedIdx >= 0 && parsedIdx < items.length) return parsedIdx;
    }
    return 0;
  }

  function formatReadyStatus(post, slideIndex) {
    const items = post?.items || [];
    const total = items.length;
    const videoCount = items.filter(i => i.kind === "video").length;
    const imageCount = total - videoCount;
    const slideNum = slideIndex + 1;
    if (videoCount === 0 && total > 1) {
      return `Ready: ${total} images in sequence. Save Slide ${slideNum} (.jpg) or all ${total} images.`;
    }
    if (videoCount === 0) {
      return "Ready: 1 full-resolution image (.jpg). Download Image or Save Image + Caption.";
    }
    if (imageCount > 0) {
      const photoWord = imageCount === 1 ? "photo" : "photos";
      const videoWord = videoCount === 1 ? "video" : "videos";
      return `Ready: ${total} carousel items (${imageCount} ${photoWord}, ${videoCount} ${videoWord}). Viewing Slide ${slideNum}.`;
    }
    if (total > 1) {
      return `Ready: ${total} video items. Viewing Slide ${slideNum} (.mp4).`;
    }
    return "Ready: 1 video (.mp4). Choose Video (.mp4), Audio Only (.m4a), or Full Post.";
  }

  function renderFormatsForSlide(slideIndex) {
    formatSelect.innerHTML = "";
    const item = currentPost?.items?.[slideIndex] || currentPost?.items?.[0];
    if (!item || !Array.isArray(item.formats) || !item.formats.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No formats detected";
      formatSelect.appendChild(opt);
      setPrimaryDownloadLabel("Download Selected");
      syncSlideStrip(slideIndex);
      updatePreview(item || null, slideIndex);
      updateActionButtons();
      return;
    }
    item.formats.forEach((fmt, idx) => {
      const opt = document.createElement("option");
      opt.value = fmt.id;
      opt.textContent = fmt.label || `${fmt.ext?.toUpperCase() || "MP4"} #${idx + 1}`;
      formatSelect.appendChild(opt);
    });
    const totalSlides = currentPost?.items?.length || 0;
    if (item.kind === "video") {
      setPrimaryDownloadLabel(totalSlides > 1 ? `Download Slide ${slideIndex + 1} (.mp4)` : "Download Video (.mp4)");
    } else {
      setPrimaryDownloadLabel(totalSlides > 1 ? `Download Slide ${slideIndex + 1} (.jpg)` : "Download Image (.jpg)");
    }
    syncSlideStrip(slideIndex);
    updatePreview(item, slideIndex);
    updateActionButtons();
    if (!busy && /^Ready:/i.test(statusBox?.textContent || "")) {
      setStatus(formatReadyStatus(currentPost, slideIndex), "ok");
    }
  }

  function renderPost(post, rawUrl = "", slideCtx = null) {
    currentPost = post;
    if (post.postUrl && (!urlInput.value.trim() || !isInstagramMediaLink(urlInput.value))) {
      urlInput.value = post.postUrl;
      updateUrlControls();
    }
    const userLabel = post.username ? `@${post.username}` : "@instagram";
    const codeLabel = post.shortcode || "post";
    const dateStamp = post.takenAt ? ` \u2022 ${String(post.takenAt).slice(0, 10)}` : "";
    const total = post.items.length;
    const videoCount = post.items.filter(i => i.kind === "video").length;
    const imageCount = total - videoCount;
    let countLabel = `${total} item${total === 1 ? "" : "s"}`;
    if (videoCount === 0) {
      countLabel = `${total} image${total === 1 ? "" : "s"}`;
    } else if (imageCount === 0) {
      countLabel = `${total} video${total === 1 ? "" : "s"}`;
    } else {
      countLabel = `${total} items (${imageCount} photo${imageCount === 1 ? "" : "s"}, ${videoCount} video${videoCount === 1 ? "" : "s"})`;
    }
    postSummary.textContent = `${userLabel} \u2022 ${codeLabel}${dateStamp} \u2022 ${countLabel}`;
    engineBadge.textContent = post.ffmpegAvailable
      ? "FFmpeg AAC \u00b7 M4A Ready"
      : "Progressive MP4 Primary";
    engineBadge.setAttribute("data-ready", post.ffmpegAvailable ? "ffmpeg" : "progressive");
    captionInput.value = post.caption || "";

    slideSelect.innerHTML = "";
    post.items.forEach((item, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = total > 1
        ? `Slide ${idx + 1} / ${total} (${item.kind === "video" ? "Video .mp4" : "Image .jpg"})`
        : `Slide 1 (${item.kind === "video" ? "Video .mp4" : "Image .jpg"})`;
      slideSelect.appendChild(opt);
    });
    renderSlideStrip(post.items);
    const startIdx = resolveInitialSlideIndex(post, rawUrl, slideCtx);
    slideSelect.value = String(startIdx);
    renderFormatsForSlide(startIdx);
    updateActionButtons();
  }

  function isInstagramMediaLink(text) {
    return /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv|stories)\/[^/?#\s]+/i.test(String(text || ""));
  }

  async function inspectUrl(rawUrl, seedPayloadJson = null, slideCtx = null) {
    if (busy) return;
    const targetUrl = String(rawUrl ?? urlInput.value ?? "").trim();
    if (!targetUrl && !seedPayloadJson) {
      setStatus("Paste an Instagram Post or Reel URL first.", "warn");
      return;
    }
    setBusy(true, "inspect");
    if (previewBox && !previewThumb && previewBox.getAttribute("data-state") !== "ready") {
      previewEmpty.hidden = false;
      setPreviewEmptyMessage("Fetching formats, audio streams, and caption...", "loading");
    }
    setStatus("Inspecting Instagram formats, audio tracks, and caption...");
    try {
      const post = await invoke("inspect_instagram_post", {
        url: targetUrl,
        seedPayloadJson: seedPayloadJson || null
      });
      renderPost(post, targetUrl, slideCtx);
      setStatus(formatReadyStatus(post, currentSlideIndex()), "ok");
    } catch (error) {
      if (previewBox && previewBox.getAttribute("data-state") === "loading") {
        setPreviewEmptyMessage("Preview loads automatically on inspection", "idle");
      }
      setStatus(error?.message || String(error), "err");
    } finally {
      setBusy(false);
      await drainQueuedContext();
    }
  }

  async function tryAutoInspectClipboard() {
    if (busy || urlInput.value.trim()) return false;
    try {
      const clip = await navigator.clipboard?.readText?.();
      const clean = String(clip || "").trim();
      if (clean && clean !== lastAutoClipboardUrl && isInstagramMediaLink(clean)) {
        lastAutoClipboardUrl = clean;
        urlInput.value = clean;
        updateUrlControls();
        await inspectUrl(clean);
        return true;
      }
    } catch {
      // Clipboard access requires focus in some environments.
    }
    return false;
  }

  async function loadPendingContext() {
    try {
      const ctx = await invoke("take_pending_downloader_context");
      if (ctx && (ctx.url || ctx.payloadJson)) {
        if (busy) {
          queuedContext = {
            url: ctx.url || "",
            payloadJson: ctx.payloadJson || null,
            slideIndex: ctx.slideIndex ?? null,
            slideHint: ctx.slideHint || null
          };
          return;
        }
        urlInput.value = ctx.url || "";
        updateUrlControls();
        await inspectUrl(ctx.url || "", ctx.payloadJson || null, ctx);
        return;
      }
    } catch {
      // No pending context on standalone launch.
    }
    await tryAutoInspectClipboard();
  }

  pasteBtn.addEventListener("click", async () => {
    if (busy) return;
    try {
      const clip = await navigator.clipboard?.readText?.();
      if (clip && clip.trim()) {
        urlInput.value = clip.trim();
        updateUrlControls();
        await inspectUrl(clip.trim());
        return;
      }
    } catch {
      // Clipboard read may be unavailable without focus gesture.
    }
    urlInput.focus();
    setStatus(`Press ${modKeyLabel}+V to paste link; inspection starts automatically.`);
  });

  if (clearUrlBtn) {
    clearUrlBtn.addEventListener("click", () => {
      if (busy) return;
      urlInput.value = "";
      updateUrlControls();
      urlInput.focus();
    });
  }

  urlInput.addEventListener("input", updateUrlControls);

  urlInput.addEventListener("paste", () => {
    window.setTimeout(() => {
      updateUrlControls();
      const pasted = urlInput.value.trim();
      if (pasted && !busy && isInstagramMediaLink(pasted)) {
        inspectUrl(pasted);
      }
    }, 25);
  });

  inspectBtn.addEventListener("click", () => inspectUrl());
  urlInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      inspectUrl();
    }
  });

  window.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      urlInput.focus();
      urlInput.select();
      return;
    }
    const activeTag = document.activeElement?.tagName;
    if (!event.altKey && !event.ctrlKey && !event.metaKey
      && activeTag !== "INPUT" && activeTag !== "TEXTAREA" && activeTag !== "SELECT") {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepSlide(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepSlide(1);
      }
    }
  });

  function stepSlide(delta) {
    const items = currentPost?.items || [];
    if (busy || items.length <= 1) return;
    const nextIdx = Math.max(0, Math.min(items.length - 1, currentSlideIndex() + delta));
    if (nextIdx !== currentSlideIndex()) {
      slideSelect.value = String(nextIdx);
      renderFormatsForSlide(nextIdx);
    }
  }

  slideSelect.addEventListener("change", () => {
    renderFormatsForSlide(currentSlideIndex());
  });

  if (prevSlideBtn) prevSlideBtn.addEventListener("click", () => stepSlide(-1));
  if (nextSlideBtn) nextSlideBtn.addEventListener("click", () => stepSlide(1));

  formatSelect.addEventListener("change", () => {
    const item = currentSlideItem();
    if (item) updateAudioAndFormatSpec(item);
  });

  captionInput.addEventListener("input", updateActionButtons);

  if (copyStemBtn) {
    copyStemBtn.addEventListener("click", async () => {
      const stem = outputNamePreview?.textContent?.trim();
      if (!stem) return;
      try {
        await navigator.clipboard?.writeText?.(stem);
        copyStemBtn.textContent = "Copied";
        window.setTimeout(() => { copyStemBtn.textContent = "Copy"; }, 1200);
      } catch {
        setStatus("Could not write to clipboard.", "warn");
      }
    });
  }

  copyCaptionBtn.addEventListener("click", async () => {
    const text = captionInput.value;
    if (!text.trim()) return;
    try {
      await navigator.clipboard?.writeText?.(text);
      setStatus("Copied caption text to clipboard.", "ok");
    } catch {
      setStatus("Could not write to clipboard.", "warn");
    }
  });

  saveCaptionBtn.addEventListener("click", async () => {
    if (busy) return;
    const postPayload = currentPost || {
      shortcode: "",
      pk: "",
      username: "",
      postUrl: urlInput.value.trim(),
      takenAt: "",
      caption: captionInput.value,
      ffmpegAvailable: false,
      items: []
    };
    setBusy(true, "save");
    setStatus("Saving caption (.txt) to Downloads/IG-Now...");
    try {
      const savedPath = await invoke("save_caption_file", {
        post: postPayload,
        customCaption: captionInput.value,
        subfolder: null,
        fileStem: null
      });
      setStatus(`Saved caption to ${savedPath}`, "ok", true);
    } catch (error) {
      setStatus(error?.message || String(error), "err");
    } finally {
      setBusy(false);
      await drainQueuedContext();
    }
  });

  async function runDownload(mode) {
    if (busy || !currentPost) return;
    const itemIndex = currentSlideIndex();
    const formatId = formatSelect.value || null;
    activeDownloadMode = mode;
    setBusy(true, "download");
    if (mode === "audio") {
      setStatus("Extracting Audio Only (.m4a AAC) to Downloads/IG-Now...");
    } else if (mode === "bundle") {
      const hasVideo = currentPost.items.some(i => i.kind === "video");
      setStatus(hasVideo
        ? `Downloading full post (0/${currentPost.items.length} slides)...`
        : `Saving ${currentPost.items.length} image(s) + caption to Downloads/IG-Now...`);
    } else {
      const item = currentSlideItem();
      setStatus(item?.kind === "image"
        ? "Saving full-resolution image to Downloads/IG-Now..."
        : "Downloading selected media...");
    }
    try {
      const result = await invoke("download_post_selection", {
        post: currentPost,
        itemIndex,
        formatId,
        mode,
        customCaption: captionInput.value
      });
      if (mode === "bundle") {
        const dest = result.subfolder ? `Downloads/IG-Now/${result.subfolder}` : "Downloads/IG-Now";
        const msg = `Saved ${result.savedPaths.length} file(s)${result.captionPath ? " + caption.txt" : ""} to ${dest}`;
        setStatus(result.warning ? `${msg}\nNote: ${result.warning}` : msg, result.warning ? "warn" : "ok", true);
      } else {
        const msg = `Saved ${result.savedPaths[0] || "file"}`;
        setStatus(result.warning ? `${msg}\nNote: ${result.warning}` : msg, result.warning ? "warn" : "ok", true);
      }
    } catch (error) {
      setStatus(error?.message || String(error), "err");
    } finally {
      activeDownloadMode = "";
      setBusy(false);
      await drainQueuedContext();
    }
  }

  downloadSelectedBtn.addEventListener("click", () => runDownload("single"));
  if (downloadAudioBtn) {
    downloadAudioBtn.addEventListener("click", () => runDownload("audio"));
  }
  downloadBundleBtn.addEventListener("click", () => runDownload("bundle"));

  if (typeof window.__TAURI__?.event?.listen === "function") {
    window.__TAURI__.event.listen("downloader-progress", event => {
      if (!busy || activeDownloadMode !== "bundle") return;
      const completed = Number(event?.payload?.completed);
      const total = Number(event?.payload?.total);
      if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
        setStatus(`Saving full post (${completed}/${total} slides)...`);
      }
    }).catch(() => {});
  }

  const openFolderHandler = () => {
    invoke("open_downloads_folder").catch(error => {
      setStatus(error?.message || String(error), "err");
    });
  };
  openFolderBtn.addEventListener("click", openFolderHandler);
  if (statusOpenBtn) statusOpenBtn.addEventListener("click", openFolderHandler);

  window.__ignowLoadDownloaderContext = loadPendingContext;
  updateUrlControls();
  updateActionButtons();
  loadPendingContext();
})();
