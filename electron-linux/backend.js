"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");
const path = require("node:path");

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const IG_APP_ID = "936619743392459";
const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let hashSeq = 1n;
let cachedFfmpeg;

function isSafeHttpUrl(raw) {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) return false;
  if (/[\r\n\0]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isInstagramAppHost(raw) {
  if (typeof raw !== "string") return false;
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

function isInstagramShareUrl(raw) {
  if (typeof raw !== "string") return false;
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am";
  } catch {
    return false;
  }
}

function isAllowedInstagramNavUrl(raw) {
  if (!isSafeHttpUrl(raw)) return false;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "instagram.com" ||
      host.endsWith(".instagram.com") ||
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "meta.com" ||
      host.endsWith(".meta.com")
    );
  } catch {
    return false;
  }
}

function toMediaBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  return null;
}

function sanitizeHeaderValue(raw) {
  return String(raw ?? "").replace(/[\r\n\0]/g, "");
}

function unescapeUrl(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\\u0026/g, "&")
    .replace(/\\u003[Aa]/g, ":")
    .replace(/\\u002[Ff]/g, "/")
    .replace(/\\u003[Ff]/g, "?")
    .replace(/\\u003[Dd]/g, "=")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

function stripMediaRangeParams(raw) {
  const decoded = unescapeUrl(raw);
  if (!isSafeHttpUrl(decoded)) return "";
  const qIdx = decoded.indexOf("?");
  if (qIdx === -1) return decoded;
  const base = decoded.slice(0, qIdx);
  const rest = decoded.slice(qIdx + 1);
  const hIdx = rest.indexOf("#");
  const query = hIdx === -1 ? rest : rest.slice(0, hIdx);
  const fragment = hIdx === -1 ? null : rest.slice(hIdx + 1);
  const blocked = new Set(["bytestart", "byteend", "range", "segment", "chunk", "part"]);
  const kept = query.split("&").filter((pair) => {
    const eqIdx = pair.indexOf("=");
    const key = (eqIdx === -1 ? pair : pair.slice(0, eqIdx)).toLowerCase();
    return !blocked.has(key);
  });
  let rebuilt = base;
  if (kept.length > 0 && !(kept.length === 1 && kept[0] === "")) {
    rebuilt += "?" + kept.join("&");
  }
  if (fragment !== null) rebuilt += "#" + fragment;
  return rebuilt;
}

function sanitizeUrlCandidate(raw) {
  const cleaned = stripMediaRangeParams(raw);
  return cleaned && isSafeHttpUrl(cleaned) ? cleaned : null;
}

function shortcodeFromUrl(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9_-]{5,32}$/.test(trimmed)) return trimmed;
  if ((trimmed.includes("://") || trimmed.toLowerCase().startsWith("http")) && !isInstagramShareUrl(trimmed)) {
    return null;
  }
  for (const prefix of ["/p/", "/reel/", "/reels/", "/tv/"]) {
    const pos = trimmed.indexOf(prefix);
    if (pos !== -1) {
      const rest = trimmed.slice(pos + prefix.length);
      const code = rest.split(/[/?#&]/, 1)[0].trim();
      if (code && /^[A-Za-z0-9_-]+$/.test(code)) return code;
    }
  }
  return null;
}

function shortcodeToMediaId(shortcode) {
  const code = String(shortcode ?? "").trim();
  if (!code || code.length > 11) return null;
  let id = 0n;
  for (const ch of code) {
    const idx = IG_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    id = (id << 6n) + BigInt(idx);
  }
  return id > 0n ? id.toString() : null;
}

function mediaIdToShortcode(mediaId) {
  const digits = String(mediaId ?? "").split("_", 1)[0].trim();
  if (!digits || !/^\d+$/.test(digits)) return null;
  let id = BigInt(digits);
  if (id === 0n) return null;
  const chars = [];
  while (id > 0n) {
    chars.push(IG_ALPHABET[Number(id & 63n)]);
    id >>= 6n;
  }
  chars.reverse();
  return chars.join("");
}

function readXmlAttr(tag, name) {
  const lowerTag = tag.toLowerCase();
  const needle = `${name.toLowerCase()}=`;
  let offset = 0;
  while (true) {
    const pos = lowerTag.indexOf(needle, offset);
    if (pos === -1) return null;
    const prevOk = pos === 0 || /\s/.test(lowerTag[pos - 1]) || lowerTag[pos - 1] === "<";
    offset = pos + needle.length;
    if (!prevOk) continue;
    const after = tag.slice(offset);
    const quote = after[0];
    if (quote !== '"' && quote !== "'") continue;
    const end = after.indexOf(quote, 1);
    if (end !== -1) return unescapeUrl(after.slice(1, end));
  }
}

function tagBlocks(source, tag) {
  const openPrefix = `<${tag.toLowerCase()}`;
  const closeTag = `</${tag.toLowerCase()}>`;
  const lower = source.toLowerCase();
  const blocks = [];
  let pos = 0;
  while (true) {
    const start = lower.indexOf(openPrefix, pos);
    if (start === -1) break;
    const nextChar = lower[start + openPrefix.length];
    if (!nextChar || !"> \t\r\n".includes(nextChar)) {
      pos = start + openPrefix.length;
      continue;
    }
    const end = lower.indexOf(closeTag, start);
    if (end === -1) break;
    const absEnd = end + closeTag.length;
    blocks.push(source.slice(start, absEnd));
    pos = absEnd;
  }
  return blocks;
}

function extractTagInner(block, tag) {
  const lower = block.toLowerCase();
  const open = `<${tag.toLowerCase()}`;
  const close = `</${tag.toLowerCase()}>`;
  const start = lower.indexOf(open);
  if (start === -1) return null;
  const gt = lower.indexOf(">", start);
  if (gt === -1) return null;
  const end = lower.indexOf(close, gt + 1);
  if (end === -1) return null;
  return block.slice(gt + 1, end).trim();
}

function videoCodecRank(codecs) {
  const c = String(codecs ?? "").trim().toLowerCase();
  if (!c) return 2;
  if (c.includes("avc1") || c.includes("avc3") || c.includes("h264")) return 4;
  if (c.includes("hev1") || c.includes("hvc1") || c.includes("hevc")) return 3;
  if (c.includes("vp09") || c.includes("vp9") || c.includes("vp8")) return 1;
  if (c.includes("av01") || c.includes("av1")) return 0;
  return 2;
}

function audioCodecRank(codecs) {
  const c = String(codecs ?? "").trim().toLowerCase();
  if (!c) return 2;
  if (c.includes("mp4a") || c.includes("aac")) return 3;
  if (c.includes("opus")) return 0;
  return 1;
}

function parseDashManifest(xml) {
  if (typeof xml !== "string" || !xml.trim() || !xml.toLowerCase().includes("<baseurl")) {
    return { videos: [], audios: [] };
  }
  const videos = [];
  const audios = [];
  const sets = tagBlocks(xml, "AdaptationSet");
  const containers = sets.length ? sets : [xml];

  for (const set of containers) {
    const setHead = set.split(">", 1)[0] || "";
    const setMime = (readXmlAttr(setHead, "mimeType") || readXmlAttr(setHead, "contentType") || "").toLowerCase();

    for (const rep of tagBlocks(set, "Representation")) {
      const repHead = rep.split(">", 1)[0] || "";
      const repMime = (readXmlAttr(repHead, "mimeType") || setMime).toLowerCase();
      const codecs = readXmlAttr(repHead, "codecs") || "";
      const width = Number.parseInt(readXmlAttr(repHead, "width") || readXmlAttr(setHead, "width") || "0", 10) || 0;
      const height = Number.parseInt(readXmlAttr(repHead, "height") || readXmlAttr(setHead, "height") || "0", 10) || 0;
      const bandwidth = Number.parseInt(readXmlAttr(repHead, "bandwidth") || "0", 10) || 0;
      const rawUrl = extractTagInner(rep, "BaseURL");
      if (!rawUrl) continue;
      const url = sanitizeUrlCandidate(rawUrl);
      if (!url) continue;
      const lowerCodecs = codecs.toLowerCase();
      const isAudio =
        repMime.includes("audio") ||
        lowerCodecs.startsWith("mp4a") ||
        lowerCodecs.includes("opus") ||
        (width === 0 &&
          height === 0 &&
          (setMime.includes("audio") || repHead.toLowerCase().includes("audiosamplingrate")));
      const track = { url, width, height, bandwidth, codecs, isAudio };
      if (isAudio) audios.push(track);
      else videos.push(track);
    }
  }

  videos.sort(
    (a, b) =>
      b.width * b.height - a.width * a.height ||
      videoCodecRank(b.codecs) - videoCodecRank(a.codecs) ||
      b.bandwidth - a.bandwidth
  );
  audios.sort(
    (a, b) => audioCodecRank(b.codecs) - audioCodecRank(a.codecs) || b.bandwidth - a.bandwidth
  );
  return { videos, audios };
}

function formatResolutionLabel(width, height, suffix) {
  const shortSide = Math.min(width, height);
  if (shortSide > 0) return `${shortSide}p MP4${suffix}`;
  if (height > 0 && width > 0) return `${width}x${height} MP4${suffix}`;
  return `MP4${suffix}`;
}

function pushUniqueFormat(list, candidate) {
  const dup = list.some((e) => e.videoUrl === candidate.videoUrl && e.audioUrl === candidate.audioUrl);
  if (!dup) list.push(candidate);
}

function videoFormatsFromNode(node, hasFfmpeg) {
  const formats = [];
  const candidates = node?.image_versions2?.candidates;
  let thumb = Array.isArray(candidates) && candidates[0]?.url ? sanitizeUrlCandidate(candidates[0].url) : null;
  if (!thumb && typeof node?.display_url === "string") {
    thumb = sanitizeUrlCandidate(node.display_url);
  }

  if (Array.isArray(node?.video_versions)) {
    node.video_versions.forEach((entry, idx) => {
      const url = typeof entry?.url === "string" ? sanitizeUrlCandidate(entry.url) : null;
      if (!url) return;
      const width = Number(entry.width) || 0;
      const height = Number(entry.height) || 0;
      const bandwidth = Number(entry.bandwidth) || width * height;
      pushUniqueFormat(formats, {
        id: `prog-${idx}`,
        label: formatResolutionLabel(width, height, " (Video + Audio)"),
        width,
        height,
        bandwidth,
        codecs: typeof entry?.codecs === "string" ? entry.codecs : "",
        ext: "mp4",
        requiresMux: false,
        videoUrl: url,
        audioUrl: null,
      });
    });
  }

  if (typeof node?.video_url === "string") {
    const url = sanitizeUrlCandidate(node.video_url);
    if (url) {
      const width = Number(node?.dimensions?.width) || 0;
      const height = Number(node?.dimensions?.height) || 0;
      pushUniqueFormat(formats, {
        id: "prog-direct",
        label: formatResolutionLabel(width, height, " (Video + Audio)"),
        width,
        height,
        bandwidth: width * height,
        codecs: "",
        ext: "mp4",
        requiresMux: false,
        videoUrl: url,
        audioUrl: null,
      });
    }
  }

  if (typeof node?.video_dash_manifest === "string") {
    const { videos, audios } = parseDashManifest(node.video_dash_manifest);
    const bestAudio = audios[0]?.url || null;
    videos.forEach((track, idx) => {
      const suffix = bestAudio
        ? hasFfmpeg
          ? " (AAC Audio Muxed)"
          : " (DASH, needs ffmpeg for AAC audio)"
        : " (DASH Video)";
      pushUniqueFormat(formats, {
        id: `dash-${idx}`,
        label: formatResolutionLabel(track.width, track.height, suffix),
        width: track.width,
        height: track.height,
        bandwidth: track.bandwidth,
        codecs: track.codecs || "",
        ext: "mp4",
        requiresMux: Boolean(bestAudio),
        videoUrl: track.url,
        audioUrl: bestAudio,
      });
    });
  }

  formats.sort((a, b) => {
    if (!hasFfmpeg && a.requiresMux !== b.requiresMux) {
      return Number(a.requiresMux) - Number(b.requiresMux);
    }
    const areaDiff = b.width * b.height - a.width * a.height;
    if (areaDiff !== 0) return areaDiff;
    const codecDiff = videoCodecRank(b.codecs) - videoCodecRank(a.codecs);
    if (codecDiff !== 0) return codecDiff;
    if (hasFfmpeg && b.requiresMux !== a.requiresMux) {
      return Number(b.requiresMux) - Number(a.requiresMux);
    }
    return b.bandwidth - a.bandwidth;
  });

  return { formats, thumb };
}

function imageFormatsFromNode(node) {
  const formats = [];
  if (Array.isArray(node?.image_versions2?.candidates)) {
    node.image_versions2.candidates.forEach((entry, idx) => {
      const url = typeof entry?.url === "string" ? sanitizeUrlCandidate(entry.url) : null;
      if (!url) return;
      const width = Number(entry.width) || 0;
      const height = Number(entry.height) || 0;
      pushUniqueFormat(formats, {
        id: `img-${idx}`,
        label: width > 0 && height > 0 ? `${width}x${height} JPG` : "Original JPG",
        width,
        height,
        bandwidth: width * height,
        ext: "jpg",
        requiresMux: false,
        videoUrl: url,
        audioUrl: null,
      });
    });
  }
  if (Array.isArray(node?.display_resources)) {
    node.display_resources.forEach((entry, idx) => {
      const url = typeof entry?.src === "string" ? sanitizeUrlCandidate(entry.src) : null;
      if (!url) return;
      const width = Number(entry.config_width) || 0;
      const height = Number(entry.config_height) || 0;
      pushUniqueFormat(formats, {
        id: `img-res-${idx}`,
        label: width > 0 && height > 0 ? `${width}x${height} JPG` : "Original JPG",
        width,
        height,
        bandwidth: width * height,
        ext: "jpg",
        requiresMux: false,
        videoUrl: url,
        audioUrl: null,
      });
    });
  }
  if (typeof node?.display_url === "string") {
    const url = sanitizeUrlCandidate(node.display_url);
    if (url) {
      const width = Number(node?.dimensions?.width ?? node?.original_width) || 0;
      const height = Number(node?.dimensions?.height ?? node?.original_height) || 0;
      pushUniqueFormat(formats, {
        id: "img-display",
        label: width > 0 && height > 0 ? `${width}x${height} JPG` : "Original JPG",
        width,
        height,
        bandwidth: width * height,
        ext: "jpg",
        requiresMux: false,
        videoUrl: url,
        audioUrl: null,
      });
    }
  }
  formats.sort((a, b) => b.bandwidth - a.bandwidth);
  return { formats, thumb: formats[0]?.videoUrl || null };
}

function nodeIsInstagramMedia(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  return (
    Array.isArray(node.video_versions) ||
    Array.isArray(node.carousel_media) ||
    Array.isArray(node?.edge_sidecar_to_children?.edges) ||
    (typeof node.video_dash_manifest === "string" && node.video_dash_manifest.includes("<BaseURL")) ||
    (typeof node.video_url === "string" && ("shortcode" in node || "code" in node || "id" in node)) ||
    (Boolean(node?.image_versions2?.candidates) &&
      ("code" in node || "pk" in node || "caption" in node || "user" in node)) ||
    ((typeof node.display_url === "string" || Array.isArray(node.display_resources)) &&
      ("shortcode" in node || "code" in node))
  );
}

function mediaItemsFromChild(child, idx, hasFfmpeg) {
  const { formats: vFormats, thumb: vThumb } = videoFormatsFromNode(child, hasFfmpeg);
  if (vFormats.length) {
    return { index: idx, kind: "video", thumbnailUrl: vThumb, formats: vFormats };
  }
  const { formats: iFormats, thumb: iThumb } = imageFormatsFromNode(child);
  if (iFormats.length) {
    return { index: idx, kind: "image", thumbnailUrl: iThumb, formats: iFormats };
  }
  return null;
}

function formatUnixIsoUtc(secs) {
  return new Date(Number(secs) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildPostFromNode(node, shortcodeHint, hasFfmpeg) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const items = [];

  if (Array.isArray(node.carousel_media)) {
    node.carousel_media.forEach((child, idx) => {
      const item = mediaItemsFromChild(child, idx, hasFfmpeg);
      if (item) items.push(item);
    });
  } else if (Array.isArray(node?.edge_sidecar_to_children?.edges)) {
    node.edge_sidecar_to_children.edges.forEach((edge, idx) => {
      if (!edge?.node) return;
      const item = mediaItemsFromChild(edge.node, idx, hasFfmpeg);
      if (item) items.push(item);
    });
  } else {
    const item = mediaItemsFromChild(node, 0, hasFfmpeg);
    if (item) items.push(item);
  }

  if (!items.length) return null;

  const rawPk = node.pk ?? node.id ?? "";
  const pk = String(rawPk).split("_", 1)[0].replace(/\D+/g, "");
  const shortcode =
    (typeof node.code === "string" && node.code) ||
    (typeof node.shortcode === "string" && node.shortcode) ||
    mediaIdToShortcode(pk) ||
    shortcodeHint ||
    "";

  const username = String(
    node?.user?.username ||
      node?.owner?.username ||
      (Array.isArray(node?.coauthor_producers) ? node.coauthor_producers[0]?.username : "") ||
      ""
  ).trim();

  const caption = String(
    (typeof node?.caption?.text === "string" ? node.caption.text : typeof node?.caption === "string" ? node.caption : "") ||
      node?.edge_media_to_caption?.edges?.[0]?.node?.text ||
      node?.accessibility_caption ||
      ""
  ).trim();

  const takenEpoch = Number(node.taken_at ?? node.taken_at_timestamp) || 0;
  const takenAt = takenEpoch > 0 ? formatUnixIsoUtc(takenEpoch) : "";
  const postUrl = shortcode ? `https://www.instagram.com/p/${shortcode}/` : "https://www.instagram.com/";

  return {
    shortcode,
    pk,
    username,
    postUrl,
    takenAt,
    caption,
    ffmpegAvailable: Boolean(hasFfmpeg),
    items,
  };
}

function scanValueForPost(root, shortcodeHint, hasFfmpeg) {
  const stack = [[root, 0]];
  let visited = 0;
  let fallback = null;

  while (stack.length) {
    const [val, depth] = stack.pop();
    if (visited >= 16000 || depth > 26 || !val || typeof val !== "object") continue;
    visited += 1;

    if (nodeIsInstagramMedia(val)) {
      const post = buildPostFromNode(val, shortcodeHint, hasFfmpeg);
      if (post) {
        if (shortcodeHint && post.shortcode === shortcodeHint) return post;
        if (!fallback) fallback = post;
      }
    }

    if (Array.isArray(val)) {
      for (let i = val.length - 1; i >= 0; i--) {
        if (val[i] && typeof val[i] === "object") stack.push([val[i], depth + 1]);
      }
    } else {
      for (const child of Object.values(val)) {
        if (child && typeof child === "object") stack.push([child, depth + 1]);
      }
    }
  }
  return fallback;
}

function extractPostFromJsonText(raw, shortcodeHint, hasFfmpeg) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^for\s*\(;;\);/, "").trim();
  if (!cleaned || cleaned.length > 8 * 1024 * 1024) return null;

  try {
    const parsed = JSON.parse(cleaned);
    const post = scanValueForPost(parsed, shortcodeHint, hasFfmpeg);
    if (post) return post;
  } catch {
    // Try NDJSON lines below.
  }

  for (const line of cleaned.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(t);
      const post = scanValueForPost(parsed, shortcodeHint, hasFfmpeg);
      if (post) return post;
    } catch {
      // Skip invalid line.
    }
  }
  return null;
}

function findMetaContent(html, attrName, attrValue) {
  const lower = html.toLowerCase();
  const target = attrValue.toLowerCase();
  let pos = 0;
  while (true) {
    const idx = lower.indexOf("<meta", pos);
    if (idx === -1) return null;
    const gt = lower.indexOf(">", idx);
    if (gt === -1) return null;
    const tag = html.slice(idx, gt + 1);
    pos = gt + 1;
    const val = readXmlAttr(tag, attrName);
    if (val && val.toLowerCase() === target) {
      const content = readXmlAttr(tag, "content");
      if (content !== null) return unescapeUrl(content);
    }
  }
}

function extractPostFromHtml(html, shortcodeHint, hasFfmpeg) {
  if (typeof html !== "string") return null;
  for (const block of tagBlocks(html, "script")) {
    const gt = block.indexOf(">");
    const closeIdx = block.lastIndexOf("</");
    if (gt === -1 || closeIdx <= gt) continue;
    const inner = block.slice(gt + 1, closeIdx);
    if (
      inner.includes("video_") ||
      inner.includes("display_url") ||
      inner.includes("image_versions2") ||
      inner.includes("carousel_media") ||
      inner.includes("edge_sidecar_to_children")
    ) {
      const post = extractPostFromJsonText(inner, shortcodeHint, hasFfmpeg);
      if (post) return post;
    }
  }

  const videoUrl = sanitizeUrlCandidate(
    findMetaContent(html, "property", "og:video:secure_url") ||
      findMetaContent(html, "property", "og:video:url") ||
      findMetaContent(html, "property", "og:video") ||
      ""
  );
  const imageUrl = sanitizeUrlCandidate(findMetaContent(html, "property", "og:image") || "");
  const caption = (
    findMetaContent(html, "property", "og:description") ||
    findMetaContent(html, "name", "description") ||
    ""
  ).trim();

  const items = [];
  if (videoUrl) {
    items.push({
      index: 0,
      kind: "video",
      thumbnailUrl: imageUrl,
      formats: [
        {
          id: "og-video",
          label: "MP4 Video",
          width: 0,
          height: 0,
          bandwidth: 0,
          ext: "mp4",
          requiresMux: false,
          videoUrl,
          audioUrl: null,
        },
      ],
    });
  } else if (imageUrl) {
    items.push({
      index: 0,
      kind: "image",
      thumbnailUrl: imageUrl,
      formats: [
        {
          id: "og-image",
          label: "Original JPG",
          width: 0,
          height: 0,
          bandwidth: 0,
          ext: "jpg",
          requiresMux: false,
          videoUrl: imageUrl,
          audioUrl: null,
        },
      ],
    });
  }

  if (!items.length) return null;
  const shortcode = shortcodeHint || "";
  const pk = shortcodeToMediaId(shortcode) || "";
  const postUrl = shortcode ? `https://www.instagram.com/p/${shortcode}/` : "https://www.instagram.com/";
  return {
    shortcode,
    pk,
    username: "",
    postUrl,
    takenAt: "",
    caption,
    ffmpegAvailable: Boolean(hasFfmpeg),
    items,
  };
}

function jsonIndicatesMultiItemCarousel(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(jsonIndicatesMultiItemCarousel);
  if ((Number(value.carousel_media_count) || 0) > 1 || Number(value.media_type) === 8) return true;
  return Object.values(value).some(jsonIndicatesMultiItemCarousel);
}

function isCompleteSeedPost(seedJson, post, requestedShortcode) {
  if (!post || !post.username?.trim() || !post.shortcode?.trim() || !post.items?.length) return false;
  const sc = String(requestedShortcode || "").trim();
  if (sc && post.shortcode.toLowerCase() !== sc.toLowerCase()) return false;
  if (
    post.items.length <= 1 &&
    (seedJson.includes("carousel_media_count") || seedJson.includes('"media_type":8'))
  ) {
    try {
      if (jsonIndicatesMultiItemCarousel(JSON.parse(seedJson))) return false;
    } catch {
      // Ignore invalid JSON.
    }
  }
  return post.items.every(
    (item) => Array.isArray(item.formats) && item.formats.length > 0 && item.formats.every((f) => f.videoUrl?.trim())
  );
}

function pickRicherInspectedPost(httpPost, seedPost) {
  const sameShortcode =
    !httpPost.shortcode || !seedPost.shortcode || httpPost.shortcode === seedPost.shortcode;
  const seedHasFormats = seedPost.items.some((i) => i.formats?.length > 0);
  if (sameShortcode && seedHasFormats && seedPost.items.length > httpPost.items.length) {
    const merged = { ...seedPost };
    if (!merged.username && httpPost.username) merged.username = httpPost.username;
    if (!merged.caption && httpPost.caption) merged.caption = httpPost.caption;
    if (!merged.takenAt && httpPost.takenAt) merged.takenAt = httpPost.takenAt;
    return merged;
  }
  const httpIsSparse = !httpPost.username && httpPost.items.length <= 1;
  const seedHasMore =
    seedPost.items.length > 0 &&
    (Boolean(seedPost.username) ||
      seedPost.items.length > httpPost.items.length ||
      (seedPost.items[0]?.formats?.length || 0) > (httpPost.items[0]?.formats?.length || 0));
  return sameShortcode && httpIsSparse && seedHasMore ? seedPost : httpPost;
}

function sanitizePathSegment(raw) {
  const cleaned = String(raw ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
  const trimmed = cleaned.replace(/^[._]+|[._]+$/g, "");
  if (!trimmed || trimmed === "." || trimmed === "..") return "";
  return trimmed.slice(0, 80);
}

function mediaExtension(mediaType) {
  const lower = String(mediaType ?? "").toLowerCase();
  if (lower === "video") return "mp4";
  if (lower === "audio" || lower === "audio-m4a") return "m4a";
  if (lower === "mp3" || lower === "audio-mp3") return "mp3";
  if (lower === "text" || lower === "caption") return "txt";
  if (lower === "json") return "json";
  return "jpg";
}

function buildTargetPath(baseDir, mediaType, subfolder, fileStem, timestampMs = Date.now()) {
  const ext = mediaExtension(mediaType);
  let dir = baseDir;
  const cleanSub = subfolder ? sanitizePathSegment(subfolder) : "";
  if (cleanSub) dir = path.join(dir, cleanSub);
  const cleanStem = fileStem ? sanitizePathSegment(fileStem) : "";
  const stem = cleanStem || `IG-Now-Instagram-${timestampMs}`;
  return path.join(dir, `${stem}.${ext}`);
}

function buildSourceFilenameStem(username, takenAt, shortcode) {
  const userPart = String(username ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.]/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  const userCapped = (userPart || "instagram").slice(0, 40);

  const dateDigits = String(takenAt ?? "").slice(0, 10).replace(/\D+/g, "");
  const datePart =
    dateDigits.length === 8
      ? dateDigits
      : new Date().toISOString().slice(0, 10).replace(/\D+/g, "");

  const nanos = process.hrtime.bigint();
  const seq = hashSeq++;
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(nanos & 0xffff_ffff_ffff_ffffn, 0);
  buf.writeBigUInt64LE(seq & 0xffff_ffff_ffff_ffffn, 8);
  const input = Buffer.concat([
    Buffer.from(userCapped, "utf8"),
    Buffer.from(String(shortcode ?? ""), "utf8"),
    buf,
  ]);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x0100000001b3n;
  const mask64 = 0xffff_ffff_ffff_ffffn;
  for (const byte of input) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask64;
  }
  const folded = Number(((hash ^ (hash >> 32n)) & 0xffff_ffffn));
  const shortHash = folded.toString(16).padStart(8, "0");
  return `${userCapped}-${datePart}-${shortHash}`;
}

function carouselSlideStem(base, itemIndex, itemCount) {
  if (itemCount >= 10) return `${base}-slide-${String(itemIndex + 1).padStart(2, "0")}`;
  if (itemCount > 1) return `${base}-slide-${itemIndex + 1}`;
  return base;
}

function singleSelectionFileStem(username, takenAt, shortcode, itemIndex, itemCount) {
  const base = buildSourceFilenameStem(username, takenAt, shortcode);
  return carouselSlideStem(base, itemIndex, itemCount);
}

function formatCaptionDocument(post) {
  const lines = [];
  if (post?.username?.trim()) lines.push(`Author: @${post.username.trim()}`);
  if (post?.postUrl?.trim()) lines.push(`URL: ${post.postUrl.trim()}`);
  if (post?.takenAt?.trim()) lines.push(`Date: ${post.takenAt.trim()}`);
  if (lines.length) lines.push("");
  const body = String(post?.caption ?? "").trim();
  lines.push(body || "(No caption text available for this post)");
  return lines.join("\n");
}

function buildMetadataJson(post) {
  return JSON.stringify(
    {
      shortcode: post?.shortcode || "",
      pk: post?.pk || "",
      username: post?.username || "",
      postUrl: post?.postUrl || "",
      takenAt: post?.takenAt || "",
      caption: post?.caption || "",
      mediaCount: Array.isArray(post?.items) ? post.items.length : 0,
    },
    null,
    2
  );
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_FTYP_BRANDS = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

function isValidMp4Header(bytes) {
  if (!bytes || bytes.length < 8) return false;
  const box = Buffer.from(bytes.slice(4, 8)).toString("ascii");
  return box === "ftyp" || box === "styp" || box === "wide" || box === "free" || box === "moov";
}

function isValidWebmHeader(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
}

function isValidDownloadVideoHeader(bytes, allowWebm = false) {
  return isValidMp4Header(bytes) || (Boolean(allowWebm) && isValidWebmHeader(bytes));
}

function detectImageFormat(bytes) {
  if (!bytes) return null;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length < 6) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { format: "jpg", ext: "jpg", isLosslessOrAlpha: false };
  }
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { format: "png", ext: "png", isLosslessOrAlpha: true };
  }
  const head6 = b.subarray(0, 6).toString("ascii");
  if (head6 === "GIF87a" || head6 === "GIF89a") {
    return { format: "gif", ext: "gif", isLosslessOrAlpha: true };
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = b.length >= 16 ? b.subarray(12, 16).toString("ascii") : "";
    const isLosslessOrAlpha =
      chunk === "VP8L" || (chunk === "VP8X" && b.length >= 21 && (b[20] & 0x10) !== 0);
    return { format: "webp", ext: "webp", isLosslessOrAlpha };
  }
  if (b.length >= 12 && b.subarray(4, 8).toString("ascii") === "ftyp") {
    const major = b.subarray(8, 12).toString("ascii").toLowerCase();
    const brands = [major];
    for (let i = 16; i + 4 <= Math.min(b.length, 64); i += 4) {
      brands.push(b.subarray(i, i + 4).toString("ascii").toLowerCase());
    }
    const matched = brands.find((brand) => IMAGE_FTYP_BRANDS.has(brand));
    if (!matched) return null;
    const isAvif = brands.some((brand) => brand === "avif" || brand === "avis");
    return isAvif
      ? { format: "avif", ext: "avif", isLosslessOrAlpha: false }
      : { format: "heic", ext: "heic", isLosslessOrAlpha: false };
  }
  return null;
}

function isValidImageHeader(bytes) {
  return detectImageFormat(bytes) !== null;
}

function cookieHeaderAndCsrfFromPairs(pairs) {
  const seen = new Set();
  const parts = [];
  let csrf = null;
  for (const [k, v] of pairs || []) {
    const name = sanitizeHeaderValue(k);
    const val = sanitizeHeaderValue(v);
    if (!name || !val || seen.has(name)) continue;
    seen.add(name);
    if (name === "csrftoken") csrf = val;
    parts.push(`${name}=${val}`);
  }
  return {
    cookieHeader: parts.length ? parts.join("; ") : null,
    csrfToken: csrf,
  };
}

function escapeCurlConfigHeader(headerName, value) {
  const trimmed = sanitizeHeaderValue(value).trim();
  if (!trimmed) return "";
  const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `header = "${headerName}: ${escaped}"\n`;
}

function buildCurlStdinHeaders(cookieHeader, csrfToken) {
  let out = "";
  if (cookieHeader) out += escapeCurlConfigHeader("Cookie", cookieHeader);
  if (csrfToken) out += escapeCurlConfigHeader("X-CSRFToken", csrfToken);
  return Buffer.from(out, "utf8");
}

function spawnAsync(bin, args, stdinBytes = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: [stdinBytes && stdinBytes.length ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    });
    if (stdinBytes && stdinBytes.length && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdinBytes);
    }
  });
}

async function runCurlWithAuthStdin(args, url, cookieHeader, csrfToken) {
  const sendAuth = isInstagramAppHost(url);
  const configBytes = sendAuth ? buildCurlStdinHeaders(cookieHeader, csrfToken) : Buffer.alloc(0);
  const finalArgs = configBytes.length ? ["--config", "-", ...args] : [...args];
  return spawnAsync("curl", finalArgs, configBytes.length ? configBytes : null);
}

async function runCurlText(url, cookieHeader, csrfToken, postForm = null) {
  if (!isSafeHttpUrl(url)) throw new Error("Invalid Instagram URL.");
  const args = [
    "--fail",
    "--location",
    "--proto",
    "=http,https",
    "--proto-redir",
    "=http,https",
    "--max-redirs",
    "5",
    "--silent",
    "--show-error",
    "--compressed",
    "--connect-timeout",
    "8",
    "--max-time",
    "12",
    "--user-agent",
    DEFAULT_UA,
    "--referer",
    "https://www.instagram.com/",
    "--header",
    `X-IG-App-ID: ${IG_APP_ID}`,
    "--header",
    "X-Requested-With: XMLHttpRequest",
  ];
  if (Array.isArray(postForm)) {
    for (const [k, v] of postForm) {
      args.push("--data-urlencode", `${k}=${v}`);
    }
  }
  args.push(url);
  const out = await runCurlWithAuthStdin(args, url, cookieHeader, csrfToken).catch((err) => {
    throw new Error(`Failed to invoke curl: ${err.message}`);
  });
  if (out.code !== 0) {
    throw new Error(`HTTP error (${url}): ${out.stderr.toString("utf8")}`);
  }
  return out.stdout.toString("utf8");
}

function uniqueTempMediaPath(tag, ext) {
  const seq = hashSeq++;
  return path.join(os.tmpdir(), `ignow-${tag}-${Date.now()}-${process.pid}-${seq}.${ext}`);
}

function uniqueTempMediaPathNear(targetPath, tag, ext) {
  const seq = hashSeq++;
  const dir = path.dirname(targetPath) || os.tmpdir();
  return path.join(dir, `.ignow-${tag}-${Date.now()}-${process.pid}-${seq}.${ext}`);
}

async function replaceFileAtomically(tempPath, targetPath) {
  try {
    await fsp.rename(tempPath, targetPath);
    return;
  } catch {
    // Fallback below if cross-device or existing destination prevents direct rename.
  }
  const backup = uniqueTempMediaPathNear(targetPath, "bak", "tmp");
  let hadBackup = false;
  try {
    await fsp.access(targetPath);
    await fsp.rename(targetPath, backup);
    hadBackup = true;
  } catch {
    hadBackup = false;
  }
  try {
    try {
      await fsp.rename(tempPath, targetPath);
    } catch {
      await fsp.copyFile(tempPath, targetPath);
    }
    await fsp.rm(tempPath, { force: true });
    if (hadBackup) await fsp.rm(backup, { force: true });
  } catch (err) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    if (hadBackup) await fsp.rename(backup, targetPath).catch(() => {});
    throw new Error(`Failed to replace destination file (${err.message})`);
  }
}

async function curlDownloadToFile(url, referer, ua, cookieHeader, targetPath) {
  if (!isSafeHttpUrl(url)) {
    throw new Error("Instagram did not provide a downloadable HTTP(S) media URL.");
  }
  const tempTarget = uniqueTempMediaPathNear(targetPath, "dl", "tmp");
  const args = [
    "--fail",
    "--location",
    "--proto",
    "=http,https",
    "--proto-redir",
    "=http,https",
    "--max-redirs",
    "5",
    "--silent",
    "--show-error",
    "--retry",
    "2",
    "--connect-timeout",
    "20",
    "--max-time",
    "300",
    "--user-agent",
    ua,
    "--referer",
    referer,
    "--header",
    "Accept: */*",
    "--output",
    tempTarget,
    url,
  ];
  let out;
  try {
    out = await runCurlWithAuthStdin(args, url, cookieHeader, null);
  } catch (err) {
    await fsp.rm(tempTarget, { force: true }).catch(() => {});
    throw new Error(`Unable to start curl: ${err.message}`);
  }
  if (out.code !== 0) {
    await fsp.rm(tempTarget, { force: true }).catch(() => {});
    throw new Error(`curl exited with status ${out.code}: ${out.stderr.toString("utf8").trim()}`);
  }
  const stat = await fsp.stat(tempTarget).catch(() => null);
  if (!stat || stat.size === 0) {
    await fsp.rm(tempTarget, { force: true }).catch(() => {});
    throw new Error("The downloaded media file was empty.");
  }
  await replaceFileAtomically(tempTarget, targetPath);
}

async function readFileHead(filePath, maxBytes = 64) {
  const fh = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function validateOrRemoveVideoInput(filePath, allowWebm = false) {
  try {
    const head = await readFileHead(filePath, 16);
    if (!isValidDownloadVideoHeader(head, allowWebm)) {
      throw new Error("The downloaded video was only a media fragment, not a complete MP4.");
    }
  } catch {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    throw new Error("The downloaded video was only a media fragment, not a complete MP4.");
  }
}

async function validateOrRemoveMp4(filePath) {
  return validateOrRemoveVideoInput(filePath, false);
}

async function validateOrRemoveImage(filePath) {
  try {
    const head = await readFileHead(filePath, 64);
    if (!isValidImageHeader(head)) {
      throw new Error("Instagram returned a non-image response (expired link or login page).");
    }
  } catch {
    await fsp.rm(filePath, { force: true }).catch(() => {});
    throw new Error("Instagram returned a non-image response (expired link or login page).");
  }
}

function findFfmpegBinary() {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const candidates = [
    ...pathDirs.map((dir) => path.join(dir, "ffmpeg")),
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        cachedFfmpeg = candidate;
        return cachedFfmpeg;
      }
    } catch {
      // Keep scanning.
    }
  }
  cachedFfmpeg = null;
  return null;
}

function splitTopLevelComma(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0) depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

async function inspectMp4Layout(filePath) {
  const result = {
    isMp4: false,
    hasFtyp: false,
    hasMoov: false,
    hasMdat: false,
    isFragmented: false,
    moovBeforeMdat: false,
    isFaststart: false,
  };
  let fh;
  try {
    fh = await fsp.open(filePath, "r");
    const stat = await fh.stat();
    const fileSize = stat.size;
    const header = Buffer.alloc(16);
    let pos = 0;
    let firstBox = null;
    let moovPos = null;
    let mdatPos = null;
    let boxes = 0;

    while (pos + 8 <= fileSize && boxes < 4096) {
      const { bytesRead } = await fh.read(header, 0, 16, pos);
      if (bytesRead < 8) break;
      const size32 = header.readUInt32BE(0);
      const boxType = header.subarray(4, 8).toString("ascii");
      if (!/^[\x20-\x7e]{4}$/.test(boxType)) break;

      let boxSize = size32;
      if (size32 === 1) {
        if (bytesRead < 16) break;
        const bigSize = header.readBigUInt64BE(8);
        if (bigSize < 16n || bigSize > BigInt(fileSize - pos)) break;
        boxSize = Number(bigSize);
      } else if (size32 === 0) {
        boxSize = fileSize - pos;
      }
      if (!Number.isFinite(boxSize) || boxSize < 8 || pos + boxSize > fileSize) break;

      if (!firstBox) firstBox = boxType;
      if (boxType === "ftyp") result.hasFtyp = true;
      if (boxType === "moov" && moovPos === null) {
        result.hasMoov = true;
        moovPos = pos;
      }
      if (boxType === "mdat" && mdatPos === null) {
        result.hasMdat = true;
        mdatPos = pos;
      }
      if (boxType === "moof") result.isFragmented = true;
      pos += boxSize;
      boxes += 1;
    }

    if (firstBox === "styp") result.isFragmented = true;
    result.isMp4 =
      result.hasFtyp || firstBox === "styp" || firstBox === "moov" || firstBox === "wide" || firstBox === "free";
    result.moovBeforeMdat = moovPos !== null && (mdatPos === null || moovPos < mdatPos);
    result.isFaststart = result.hasFtyp && result.hasMoov && !result.isFragmented && result.moovBeforeMdat;
  } catch {
    // Unreadable or non-MP4 file.
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
  return result;
}

async function probeMediaStreams(ffmpeg, filePath) {
  const layout = await inspectMp4Layout(filePath);
  const info = {
    container: "",
    videoCodec: "",
    pixFmt: "",
    audioCodec: "",
    audioState: "missing",
    ...layout,
  };
  try {
    const out = await spawnAsync(ffmpeg, ["-i", filePath]);
    const lines = out.stderr.toString("utf8").split(/\r?\n/);
    for (const line of lines) {
      const inputMatch = line.match(/^\s*Input #0,\s*([^,]+(?:,[^,]+)*?),\s*from\b/i);
      if (inputMatch && !info.container) {
        info.container = inputMatch[1].trim().toLowerCase();
      }
      const vPos = line.indexOf("Video:");
      if (vPos !== -1 && !info.videoCodec) {
        const parts = splitTopLevelComma(line.slice(vPos + 6).trim());
        const codecMatch = (parts[0] || "").toLowerCase().match(/^([a-z0-9_+-]+)/);
        if (codecMatch) info.videoCodec = codecMatch[1];
        const pixMatch = (parts[1] || "").toLowerCase().match(/^([a-z0-9_]+)/);
        if (pixMatch) info.pixFmt = pixMatch[1];
      }
      const aPos = line.indexOf("Audio:");
      if (aPos !== -1 && !info.audioCodec) {
        const aTail = line.slice(aPos + 6).trim().toLowerCase();
        const aMatch = aTail.match(/^([a-z0-9_+-]+)/);
        if (aMatch) {
          info.audioCodec = aMatch[1];
          info.audioState = info.audioCodec === "aac" ? "aac" : "non-aac";
        }
      }
    }
    if (!info.isMp4 && (info.container.includes("mp4") || info.container.includes("mov"))) {
      info.isMp4 = true;
    }
  } catch {
    // Unreadable media.
  }
  return info;
}

async function probeMp4AudioState(ffmpeg, filePath) {
  const streams = await probeMediaStreams(ffmpeg, filePath);
  return streams.audioState;
}

async function runFfmpegToAtomicOutput(ffmpeg, args, outPath, tag, ext, label) {
  const tempOut = uniqueTempMediaPathNear(outPath, tag, ext);
  const out = await spawnAsync(ffmpeg, [...args, tempOut]).catch((err) => {
    throw new Error(`Failed to start ffmpeg: ${err.message}`);
  });
  if (out.code !== 0) {
    await fsp.rm(tempOut, { force: true }).catch(() => {});
    const tail = out.stderr.toString("utf8").trim().split(/\r?\n/).slice(-4).join(" | ");
    throw new Error(`ffmpeg ${label} exited with status ${out.code}: ${tail}`);
  }
  const stat = await fsp.stat(tempOut).catch(() => null);
  if (!stat || stat.size === 0) {
    await fsp.rm(tempOut, { force: true }).catch(() => {});
    throw new Error(`ffmpeg ${label} produced an empty output file.`);
  }
  await replaceFileAtomically(tempOut, outPath);
}

async function muxVideoAudioFfmpeg(
  ffmpeg,
  videoPath,
  audioPath,
  outPath,
  preprobedVideoStreams = null,
  onProbe = null
) {
  const [vStreams, aStreams] = await Promise.all([
    preprobedVideoStreams
      ? Promise.resolve(preprobedVideoStreams)
      : (onProbe?.("video"), probeMediaStreams(ffmpeg, videoPath)),
    (onProbe?.("audio"), probeMediaStreams(ffmpeg, audioPath)),
  ]);
  const videoOk = vStreams.videoCodec === "h264" && vStreams.pixFmt === "yuv420p";
  const audioOk = aStreams.audioState === "aac";
  const vCodecArgs = videoOk
    ? ["-c:v", "copy"]
    : ["-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p"];
  const aCodecArgs = audioOk
    ? ["-c:a", "copy"]
    : ["-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100"];
  await runFfmpegToAtomicOutput(
    ffmpeg,
    [
      "-y",
      "-fflags",
      "+genpts",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      ...vCodecArgs,
      ...aCodecArgs,
      "-shortest",
      "-movflags",
      "+faststart",
    ],
    outPath,
    "mux",
    "mp4",
    "muxing"
  );
}

async function normalizeVideoMp4(
  ffmpeg,
  inputPath,
  fallbackAudioPath = null,
  outPath = inputPath,
  preprobedStreams = null,
  onProbe = null
) {
  const streams = preprobedStreams || (onProbe?.("video"), await probeMediaStreams(ffmpeg, inputPath));
  if (!streams.videoCodec) {
    throw new Error("The downloaded video contained no decodable video stream.");
  }
  if (streams.audioState === "missing" && fallbackAudioPath) {
    await muxVideoAudioFfmpeg(ffmpeg, inputPath, fallbackAudioPath, outPath, streams, onProbe);
    return null;
  }

  const videoOk = streams.videoCodec === "h264" && streams.pixFmt === "yuv420p";
  const hasAudio = streams.audioState !== "missing";
  const audioOk = streams.audioState === "aac";
  const containerOk = streams.isMp4 && !streams.isFragmented && streams.isFaststart;
  const warning = hasAudio ? null : "This Instagram source video had no audio track in the stream.";

  if (videoOk && (audioOk || !hasAudio) && containerOk) {
    if (path.resolve(inputPath) !== path.resolve(outPath)) {
      const tempCopy = uniqueTempMediaPathNear(outPath, "vcopy", "mp4");
      try {
        await fsp.copyFile(inputPath, tempCopy);
        await replaceFileAtomically(tempCopy, outPath);
      } catch (err) {
        await fsp.rm(tempCopy, { force: true }).catch(() => {});
        throw err;
      }
    }
    return warning;
  }

  const vCodecArgs = videoOk
    ? ["-c:v", "copy"]
    : ["-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p"];
  const aMapArgs = hasAudio ? ["-map", "0:a:0"] : [];
  const aCodecArgs = !hasAudio
    ? []
    : audioOk
      ? ["-c:a", "copy"]
      : ["-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100"];

  await runFfmpegToAtomicOutput(
    ffmpeg,
    [
      "-y",
      "-fflags",
      "+genpts",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      ...aMapArgs,
      ...vCodecArgs,
      ...aCodecArgs,
      "-movflags",
      "+faststart",
    ],
    outPath,
    "vnorm",
    "mp4",
    "normalization"
  );
  return warning;
}

async function transcodeMp4AudioToAac(ffmpeg, mp4Path) {
  return normalizeVideoMp4(ffmpeg, mp4Path, null, mp4Path);
}

async function extractAudioAacM4aFfmpeg(ffmpeg, inputPath, outPath, preprobedStreams = null) {
  const streams = preprobedStreams || (await probeMediaStreams(ffmpeg, inputPath));
  const aCodecArgs =
    streams.audioState === "aac" && streams.isMp4
      ? ["-c:a", "copy"]
      : ["-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100"];
  await runFfmpegToAtomicOutput(
    ffmpeg,
    ["-y", "-fflags", "+genpts", "-i", inputPath, "-vn", "-map", "0:a:0", ...aCodecArgs, "-movflags", "+faststart"],
    outPath,
    "m4a",
    "m4a",
    "audio extraction"
  );
}

async function ensureMp4AacAudio(ffmpeg, mp4Path, fallbackAudioPath = null) {
  return normalizeVideoMp4(ffmpeg, mp4Path, fallbackAudioPath, mp4Path);
}

function replacePathExtension(filePath, newExt) {
  const ext = String(newExt || "").replace(/^\./, "");
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${ext}`);
}

function isAlphaOrLosslessPixFmt(pixFmt) {
  return /rgba|bgra|argb|abgr|yuva|gbrap|pal8|ya8|ya16/i.test(String(pixFmt || ""));
}

async function normalizeImageFile(ffmpeg, inputPath, targetPath, options = {}) {
  const head = await readFileHead(inputPath, 64);
  const detected = detectImageFormat(head);
  if (!detected) {
    throw new Error("Instagram returned a non-image response (expired link or login page).");
  }

  const passthrough =
    detected.format === "jpg" || detected.format === "png" || detected.format === "gif" || !ffmpeg;
  if (passthrough) {
    const finalPath = replacePathExtension(targetPath, detected.ext);
    if (path.resolve(inputPath) !== path.resolve(finalPath)) {
      const tempCopy = uniqueTempMediaPathNear(finalPath, "imgcopy", detected.ext);
      try {
        await fsp.copyFile(inputPath, tempCopy);
        await replaceFileAtomically(tempCopy, finalPath);
      } catch (err) {
        await fsp.rm(tempCopy, { force: true }).catch(() => {});
        throw err;
      }
    }
    return finalPath;
  }

  let usePng = detected.isLosslessOrAlpha;
  if (!usePng) {
    options?.onProbe?.();
    const streams = await probeMediaStreams(ffmpeg, inputPath);
    usePng = isAlphaOrLosslessPixFmt(streams.pixFmt);
  }
  const outExt = usePng ? "png" : "jpg";
  const finalPath = replacePathExtension(targetPath, outExt);
  const codecArgs = usePng ? ["-c:v", "png"] : ["-c:v", "mjpeg", "-q:v", "1", "-qmin", "1"];
  await runFfmpegToAtomicOutput(
    ffmpeg,
    ["-y", "-i", inputPath, "-frames:v", "1", ...codecArgs],
    finalPath,
    "imgconv",
    outExt,
    "image conversion"
  );
  return finalPath;
}

async function fetchMediaToPath(
  url,
  mediaType,
  audioUrl,
  fallbackAudioUrl,
  referer,
  ua,
  cookieHeader,
  targetPath
) {
  const cleanAudio = audioUrl && isSafeHttpUrl(audioUrl.trim()) ? audioUrl.trim() : null;
  const cleanFallback =
    fallbackAudioUrl && isSafeHttpUrl(fallbackAudioUrl.trim()) ? fallbackAudioUrl.trim() : null;
  const kind = String(mediaType).toLowerCase();

  if (kind === "video") {
    const ffmpeg = findFfmpegBinary();
    if (cleanAudio) {
      if (ffmpeg) {
        const tempV = uniqueTempMediaPath("video", "bin");
        const tempA = uniqueTempMediaPath("audio", "bin");
        try {
          await curlDownloadToFile(url, referer, ua, cookieHeader, tempV);
          await validateOrRemoveVideoInput(tempV, true);
          let muxed = false;
          try {
            await curlDownloadToFile(cleanAudio, referer, ua, cookieHeader, tempA);
            await muxVideoAudioFfmpeg(ffmpeg, tempV, tempA, targetPath);
            muxed = true;
          } catch {
            muxed = false;
          } finally {
            await fsp.rm(tempA, { force: true }).catch(() => {});
          }
          if (muxed) {
            await fsp.rm(tempV, { force: true }).catch(() => {});
            await validateOrRemoveMp4(targetPath);
            return { path: targetPath, warning: null };
          }
          const warn = await normalizeVideoMp4(ffmpeg, tempV, null, targetPath);
          await validateOrRemoveMp4(targetPath);
          return {
            path: targetPath,
            warning: warn ? "Saved .mp4 video stream only; DASH audio muxing failed." : null,
          };
        } finally {
          await fsp.rm(tempV, { force: true }).catch(() => {});
          await fsp.rm(tempA, { force: true }).catch(() => {});
        }
      }
      await curlDownloadToFile(url, referer, ua, cookieHeader, targetPath);
      await validateOrRemoveMp4(targetPath);
      return {
        path: targetPath,
        warning: "Saved .mp4 video stream only; install ffmpeg to combine DASH audio.",
      };
    }

    if (ffmpeg) {
      const tempV = uniqueTempMediaPath("video", "bin");
      let tempFb = null;
      try {
        await curlDownloadToFile(url, referer, ua, cookieHeader, tempV);
        await validateOrRemoveVideoInput(tempV, true);
        let preprobedV = null;
        if (cleanFallback) {
          preprobedV = await probeMediaStreams(ffmpeg, tempV);
          if (preprobedV.audioState === "missing") {
            const candidate = uniqueTempMediaPath("fallback-audio", "bin");
            try {
              await curlDownloadToFile(cleanFallback, referer, ua, cookieHeader, candidate);
              tempFb = candidate;
            } catch {
              await fsp.rm(candidate, { force: true }).catch(() => {});
            }
          }
        }
        const warn = await normalizeVideoMp4(ffmpeg, tempV, tempFb, targetPath, preprobedV);
        await validateOrRemoveMp4(targetPath);
        return { path: targetPath, warning: warn };
      } finally {
        await fsp.rm(tempV, { force: true }).catch(() => {});
        if (tempFb) await fsp.rm(tempFb, { force: true }).catch(() => {});
      }
    }

    await curlDownloadToFile(url, referer, ua, cookieHeader, targetPath);
    await validateOrRemoveMp4(targetPath);
    return { path: targetPath, warning: null };
  }

  if (kind === "image") {
    const tempImg = uniqueTempMediaPathNear(targetPath, "imgdl", "tmp");
    try {
      await curlDownloadToFile(url, referer, ua, cookieHeader, tempImg);
      await validateOrRemoveImage(tempImg);
      const finalPath = await normalizeImageFile(findFfmpegBinary(), tempImg, targetPath);
      return { path: finalPath, warning: null };
    } finally {
      await fsp.rm(tempImg, { force: true }).catch(() => {});
    }
  }

  await curlDownloadToFile(url, referer, ua, cookieHeader, targetPath);
  return { path: targetPath, warning: null };
}

async function fetchMediaWithFallbacks(
  primaryUrl,
  fallbackCandidates,
  mediaType,
  audioUrl,
  fallbackAudioUrl,
  referer,
  ua,
  cookieHeader,
  targetPath
) {
  try {
    return await fetchMediaToPath(
      primaryUrl,
      mediaType,
      audioUrl,
      fallbackAudioUrl,
      referer,
      ua,
      cookieHeader,
      targetPath
    );
  } catch (primaryErr) {
    for (const [altUrl, altAudio] of fallbackCandidates || []) {
      await fsp.rm(targetPath, { force: true }).catch(() => {});
      try {
        return await fetchMediaToPath(
          altUrl,
          mediaType,
          altAudio || null,
          altAudio || fallbackAudioUrl || null,
          referer,
          ua,
          cookieHeader,
          targetPath
        );
      } catch {
        // Try next candidate.
      }
    }
    throw primaryErr;
  }
}

async function fetchAudioOnlyToPath(videoUrl, audioUrl, referer, ua, cookieHeader, targetPath) {
  const ffmpeg = findFfmpegBinary();
  if (!ffmpeg) throw new Error("FFmpeg is required to extract Audio Only (.m4a) files.");

  const cleanAudio = audioUrl && isSafeHttpUrl(audioUrl.trim()) ? audioUrl.trim() : null;
  if (cleanAudio) {
    const tempA = uniqueTempMediaPath("audio-src", "bin");
    try {
      await curlDownloadToFile(cleanAudio, referer, ua, cookieHeader, tempA);
      await extractAudioAacM4aFfmpeg(ffmpeg, tempA, targetPath);
      await fsp.rm(tempA, { force: true }).catch(() => {});
      await validateOrRemoveMp4(targetPath);
      return;
    } catch {
      await fsp.rm(tempA, { force: true }).catch(() => {});
    }
  }

  const tempV = uniqueTempMediaPath("audio-vid", "bin");
  try {
    await curlDownloadToFile(videoUrl, referer, ua, cookieHeader, tempV);
    await validateOrRemoveVideoInput(tempV, true);
    const vStreams = await probeMediaStreams(ffmpeg, tempV);
    if (vStreams.audioState === "missing") {
      throw new Error("This Instagram video stream has no audio track to extract.");
    }
    await extractAudioAacM4aFfmpeg(ffmpeg, tempV, targetPath, vStreams);
    await validateOrRemoveMp4(targetPath);
  } finally {
    await fsp.rm(tempV, { force: true }).catch(() => {});
  }
}

async function inspectViaHttpCascade(urlOrShortcode, cookieHeader, csrfToken) {
  const shortcode = shortcodeFromUrl(urlOrShortcode);
  if (!shortcode) throw new Error("Enter a valid Instagram Post or Reel URL or shortcode.");
  const hasFfmpeg = Boolean(findFfmpegBinary());

  const mediaId = shortcodeToMediaId(shortcode);
  if (mediaId) {
    try {
      const body = await runCurlText(
        `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
        cookieHeader,
        csrfToken
      );
      const post = extractPostFromJsonText(body, shortcode, hasFfmpeg);
      if (post) return post;
    } catch {
      // Continue cascade.
    }
  }

  try {
    const body = await runCurlText(
      `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
      cookieHeader,
      csrfToken
    );
    const post = extractPostFromJsonText(body, shortcode, hasFfmpeg);
    if (post) return post;
  } catch {
    // Continue cascade.
  }

  try {
    const body = await runCurlText("https://www.instagram.com/api/graphql", cookieHeader, csrfToken, [
      ["variables", JSON.stringify({ shortcode })],
      ["doc_id", "8845758582119845"],
    ]);
    const post = extractPostFromJsonText(body, shortcode, hasFfmpeg);
    if (post) return post;
  } catch {
    // Continue cascade.
  }

  try {
    const html = await runCurlText(
      `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
      cookieHeader,
      csrfToken
    );
    const post = extractPostFromHtml(html, shortcode, hasFfmpeg);
    if (post) return post;
  } catch {
    // Continue cascade.
  }

  const pageUrl =
    isSafeHttpUrl(urlOrShortcode) && isInstagramAppHost(urlOrShortcode)
      ? urlOrShortcode
      : `https://www.instagram.com/p/${shortcode}/`;
  try {
    const html = await runCurlText(pageUrl, cookieHeader, csrfToken);
    const post = extractPostFromHtml(html, shortcode, hasFfmpeg);
    if (post) return post;
  } catch {
    // End of cascade.
  }

  throw new Error("Instagram did not return playable media from direct endpoints.");
}

function isCompleteInspectedPost(post, shortcode = null) {
  if (!post || !String(post.username || "").trim() || !String(post.shortcode || "").trim()) {
    return false;
  }
  if (!Array.isArray(post.items) || !post.items.length) return false;
  if (shortcode && String(post.shortcode).toLowerCase() !== String(shortcode).toLowerCase()) {
    return false;
  }
  return post.items.every(
    (item) =>
      Array.isArray(item.formats) &&
      item.formats.length > 0 &&
      item.formats.every((f) => String(f.videoUrl || "").trim())
  );
}

async function inspectWithWindowRace({ shortcode, seedPost, httpPromise, probePromise }) {
  const safeHttp = Promise.resolve(httpPromise).then(
    (post) => ({ ok: true, post }),
    (err) => ({ ok: false, err })
  );
  const safeProbe = Promise.resolve(probePromise).then(
    (post) => ({ ok: true, post: post || null }),
    () => ({ ok: true, post: null })
  );

  const first = await Promise.race([
    safeHttp.then((res) => ({ kind: "http", res })),
    safeProbe.then((res) => ({ kind: "probe", res })),
  ]);

  if (first.kind === "probe") {
    const probed = first.res.post;
    if (probed && isCompleteInspectedPost(probed, shortcode)) {
      return seedPost ? pickRicherInspectedPost(probed, seedPost) : probed;
    }
    const httpRes = await safeHttp;
    if (httpRes.ok) {
      let best = seedPost ? pickRicherInspectedPost(httpRes.post, seedPost) : httpRes.post;
      if (probed) best = pickRicherInspectedPost(best, probed);
      return best;
    }
    if (probed) return seedPost ? pickRicherInspectedPost(probed, seedPost) : probed;
    if (seedPost) return seedPost;
    throw httpRes.err || new Error("Instagram did not return playable media.");
  }

  const httpRes = first.res;
  if (httpRes.ok) {
    let best = seedPost ? pickRicherInspectedPost(httpRes.post, seedPost) : httpRes.post;
    if (!best.username && best.items.length <= 1) {
      const probeRes = await safeProbe;
      if (probeRes.post) best = pickRicherInspectedPost(best, probeRes.post);
    }
    return best;
  }

  if (seedPost) return seedPost;
  const probeRes = await safeProbe;
  if (probeRes.post) return probeRes.post;
  throw httpRes.err || new Error("Instagram did not return playable media.");
}

class UnreadTracker {
  constructor() {
    this.count = null;
    this.lastAlertMs = null;
  }

  update(count, suppress, nowMs = Date.now()) {
    const clamped = Math.max(0, Math.min(9999, Math.trunc(Number(count) || 0)));
    const prev = this.count;
    this.count = clamped;
    const increased = prev !== null && clamped > prev;
    if (!increased || suppress) return false;
    if (this.lastAlertMs !== null && nowMs - this.lastAlertMs < 5000) return false;
    this.lastAlertMs = nowMs;
    return true;
  }
}

function getAutostartDesktopPath(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "autostart", "IG-Now.desktop");
}

function isAutostartEnabled(env = process.env) {
  return fs.existsSync(getAutostartDesktopPath(env));
}

function buildAutostartDesktopEntry(execCommand) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=IG-Now",
    "Comment=IG-Now Desktop Client for Instagram",
    `Exec=${execCommand}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

function setAutostartEnabled(enabled, execCommand, env = process.env) {
  const desktopPath = getAutostartDesktopPath(env);
  if (enabled) {
    fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
    fs.writeFileSync(desktopPath, buildAutostartDesktopEntry(execCommand), "utf8");
    return true;
  }
  if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
  return false;
}

function computeCenteredWorkAreaFrame(
  workArea,
  defaultW,
  defaultH,
  minW,
  minH,
  overheadW = 0,
  overheadH = 0
) {
  const waX = Number(workArea?.x) || 0;
  const waY = Number(workArea?.y) || 0;
  const waW = Math.max(0, Number(workArea?.width) || defaultW);
  const waH = Math.max(0, Number(workArea?.height) || defaultH);
  const ohW = Math.max(0, Number(overheadW) || 0);
  const ohH = Math.max(0, Number(overheadH) || 0);

  const maxInnerW = Math.max(1, waW - ohW);
  const maxInnerH = Math.max(1, waH - ohH);
  const effectiveMinW = Math.min(minW, maxInnerW);
  const effectiveMinH = Math.min(minH, maxInnerH);

  const width = Math.max(effectiveMinW, Math.min(defaultW, maxInnerW));
  const height = Math.max(effectiveMinH, Math.min(defaultH, maxInnerH));
  const outerW = width + ohW;
  const outerH = height + ohH;
  const x = waX + Math.floor(Math.max(0, waW - outerW) / 2);
  const y = waY + Math.floor(Math.max(0, waH - outerH) / 2);
  return { width, height, x, y, minWidth: effectiveMinW, minHeight: effectiveMinH };
}

function estimateChromeOverhead(outerBounds, contentBounds, requestedPos) {
  let overheadW = Math.max(0, (outerBounds?.width || 0) - (contentBounds?.width || 0));
  let overheadH = Math.max(0, (outerBounds?.height || 0) - (contentBounds?.height || 0));
  if (overheadW === 0 && overheadH === 0 && requestedPos && contentBounds) {
    const dx = (contentBounds.x ?? 0) - (requestedPos.x ?? 0);
    const dy = (contentBounds.y ?? 0) - (requestedPos.y ?? 0);
    if (dx >= 0 && dx <= 40 && dy >= 0 && dy <= 80 && (dx > 0 || dy > 0)) {
      overheadW = dx * 2;
      overheadH = dy + dx;
    }
  }
  return { overheadW, overheadH };
}

function setZoomJs(levelExpr) {
  const baseJs =
    "var base=(window.__ignowPageZoom!==undefined)?window.__ignowPageZoom:(function(){var z=parseFloat(document.body.style.zoom);var b=(!isNaN(z)&&z>0.25)?z:1;window.__ignowPageZoom=b;return b;})();";
  return `(function(){${baseJs}document.body.style.zoom=${levelExpr};})();`;
}

function buildAboutJs(version, logoB64, options = {}) {
  const safeVer = String(version || "2.5.3").replace(/[^\w.-]/g, "");
  const safeB64 = String(logoB64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
  const disableBackdropBlur =
    typeof options.disableBackdropBlur === "boolean"
      ? options.disableBackdropBlur
      : isWslEnvironment();
  const overlayBgCss = disableBackdropBlur
    ? "background:rgba(6,7,10,0.90);"
    : "background:rgba(6,7,10,0.80);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);";
  return `(function(){
  var ID='__ignow_about',STYLE_ID='__ignow_about_style';
  var old=document.getElementById(ID);
  if(old){if(typeof old.__ignowClose==='function')old.__ignowClose();else old.remove();return;}
  var prevStyle=document.getElementById(STYLE_ID);if(prevStyle)prevStyle.remove();
  var styleEl=document.createElement('style');styleEl.id=STYLE_ID;
  styleEl.textContent=
    '#'+ID+'{position:fixed;inset:0;${overlayBgCss}display:flex;align-items:center;justify-content:center;padding:20px;z-index:2147483647;font-family:"Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,sans-serif;opacity:0;transition:opacity 160ms ease;}'+
    '#'+ID+'[data-open="1"]{opacity:1;}#'+ID+' *{box-sizing:border-box;}'+
    '#'+ID+'_card{width:540px;max-width:100%;max-height:88vh;overflow-y:auto;background:#101217;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,0.78);color:#f4f5f7;text-align:left;transform:translateY(6px) scale(0.99);transition:transform 180ms cubic-bezier(0.2,0.8,0.2,1);}'+
    '#'+ID+'[data-open="1"] #'+ID+'_card{transform:translateY(0) scale(1);}'+
    '#'+ID+' .ignow-ab-btn{height:34px;padding:0 14px;background:#191c23;color:#e5e7eb;font:500 12px/1 inherit;border:1px solid rgba(255,255,255,0.15);border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}'+
    '#'+ID+' .ignow-ab-btn--primary{background:#f4f5f7;color:#0b0c0f;border-color:#f4f5f7;font-weight:600;}'+
    '#'+ID+' .ignow-ab-iconbtn{width:32px;height:32px;padding:0;justify-content:center;}'+
    '#'+ID+' .ignow-ab-ver{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;background:#191c23;border:1px solid rgba(255,255,255,0.14);color:#d7dce5;font:500 12px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:pointer;}'+
    '#'+ID+' .ignow-ab-link{color:#f4f5f7;text-decoration:underline;text-underline-offset:3px;font-weight:600;cursor:pointer;}'+
    '#'+ID+' .ignow-ab-btn:focus-visible,#'+ID+' .ignow-ab-ver:focus-visible,#'+ID+' .ignow-ab-link:focus-visible,#'+ID+'_card:focus-visible{outline:2px solid #3b82f6;outline-offset:2px;}'+
    '#'+ID+' .ignow-ab-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;}'+
    '#'+ID+' .ignow-ab-feat{display:flex;align-items:flex-start;gap:10px;min-width:0;}'+
    '#'+ID+' .ignow-ab-featic{width:28px;height:28px;border-radius:7px;background:#171920;border:1px solid rgba(255,255,255,0.08);color:#c4cad6;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}'+
    '#'+ID+' .ignow-ab-feattitle{color:#f4f5f7;font-size:12.5px;font-weight:600;line-height:1.3;}'+
    '#'+ID+' .ignow-ab-featdesc{color:#9aa1b0;font-size:12px;line-height:1.4;margin-top:2px;}'+
    '#'+ID+' .ignow-ab-kbd{background:#0b0c0f;border:1px solid rgba(255,255,255,0.17);border-radius:4px;padding:1px 6px;color:#f4f5f7;font:500 12px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}'+
    '@media (max-width:520px){#'+ID+' .ignow-ab-grid{grid-template-columns:1fr;}}'+
    '@media (prefers-reduced-motion:reduce){#'+ID+',#'+ID+'_card,#'+ID+' .ignow-ab-btn{transition:none!important;}}';
  (document.head||document.documentElement).appendChild(styleEl);
  var prevFocus=document.activeElement;
  function el(t,c,x){var e=document.createElement(t);if(c)e.style.cssText=c;if(x)Object.assign(e,x);return e;}
  function openUrl(u){try{window.__TAURI__.core.invoke('open_external_url',{url:u}).catch(function(){window.open(u,'_blank','noopener,noreferrer');});}catch(_){window.open(u,'_blank','noopener,noreferrer');}}
  function escClose(e){
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}
    if(e.key==='Tab'){
      var list=card.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      if(!list.length)return;
      var first=list[0],last=list[list.length-1];
      if(e.shiftKey&&(document.activeElement===first||!card.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }
  function close(){document.removeEventListener('keydown',escClose,true);var o=document.getElementById(ID);if(o)o.remove();var s=document.getElementById(STYLE_ID);if(s)s.remove();if(prevFocus&&prevFocus.focus)try{prevFocus.focus();}catch(_){}}
  document.addEventListener('keydown',escClose,true);
  var overlay=el('div');overlay.id=ID;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby',ID+'_title');overlay.__ignowClose=close;overlay.onclick=function(e){if(e.target===overlay)close();};
  var card=el('div');card.id=ID+'_card';card.tabIndex=-1;
  var header=el('div','display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 22px 16px;border-bottom:1px solid rgba(255,255,255,0.09);background:#0c0d11;border-radius:14px 14px 0 0;');
  var brandRow=el('div','display:flex;align-items:center;gap:14px;min-width:0;');
  var logo=el('img','width:46px;height:46px;display:block;border-radius:11px;flex-shrink:0;border:1px solid rgba(255,255,255,0.12);');
  if('${safeB64}')logo.src='data:image/png;base64,${safeB64}';logo.alt='IG-Now logo';logo.draggable=false;
  var titleCol=el('div','min-width:0;');
  var titleRow=el('div','display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
  var h2=el('h2','margin:0;font-size:17px;font-weight:700;color:#f4f5f7;',{textContent:'IG-Now'});h2.id=ID+'_title';
  var verBtn=el('button','',{type:'button',className:'ignow-ab-ver',textContent:'v${safeVer}',title:'Copy version details'});verBtn.setAttribute('aria-label','Copy IG-Now version v${safeVer}');
  verBtn.onclick=function(){var s='IG-Now v${safeVer} (Desktop Client · Electron Linux)';if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(s).then(function(){verBtn.textContent='Copied';setTimeout(function(){verBtn.textContent='v${safeVer}';},1400);}).catch(function(){});};
  titleRow.appendChild(h2);titleRow.appendChild(verBtn);
  var meta=el('p','margin:4px 0 0;font-size:12px;color:#a4aab6;',{textContent:'Instagram Desktop Client · Electron (Linux)'});
  titleCol.appendChild(titleRow);titleCol.appendChild(meta);brandRow.appendChild(logo);brandRow.appendChild(titleCol);header.appendChild(brandRow);
  var closeX=el('button','',{type:'button',className:'ignow-ab-btn ignow-ab-iconbtn',textContent:'✕'});closeX.setAttribute('aria-label','Close About window');closeX.onclick=close;header.appendChild(closeX);card.appendChild(header);
  var body=el('div','padding:18px 22px 20px;display:flex;flex-direction:column;gap:16px;');
  var feats=el('div','',{className:'ignow-ab-grid'});
  [['Reels & Video Controls','Seek line, ±5s skip, and synced volume slider'],['Native Downloader','H.264+AAC .mp4, .m4a audio, and post bundles'],['Foreground Audio Sync','Pause-on-hide guard and background silence'],['Back Navigation & Esc','Sidebar Back & Esc return to pre-click view'],['DM Alerts & Links','Native unread alerts and safe external links'],['System Tray & Layout','Close-to-tray & native Instagram comments intact']].forEach(function(f){
    var row=el('div','',{className:'ignow-ab-feat'});var copy=el('div','min-width:0;');
    copy.appendChild(el('div','',{className:'ignow-ab-feattitle',textContent:f[0]}));copy.appendChild(el('div','',{className:'ignow-ab-featdesc',textContent:f[1]}));
    row.appendChild(copy);feats.appendChild(row);
  });
  body.appendChild(feats);
  var footer=el('div','display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:12px;border-top:1px solid rgba(255,255,255,0.09);');
  var author=el('div','font-size:12px;color:#a4aab6;');var a=el('a','',{className:'ignow-ab-link',textContent:'@benedictusrey',href:'https://github.com/benedictusrey'});
  a.onclick=function(e){e.preventDefault();e.stopImmediatePropagation();openUrl('https://github.com/benedictusrey');};
  author.appendChild(document.createTextNode('Maintained by '));author.appendChild(a);footer.appendChild(author);
  var actions=el('div','display:flex;gap:8px;align-items:center;');
  var repo=el('button','',{type:'button',className:'ignow-ab-btn',textContent:'GitHub ↗'});repo.onclick=function(e){e.preventDefault();e.stopImmediatePropagation();openUrl('https://github.com/benedictusrey/IG-Now');};
  var gotit=el('button','',{type:'button',className:'ignow-ab-btn ignow-ab-btn--primary',textContent:'Close'});gotit.onclick=close;
  actions.appendChild(repo);actions.appendChild(gotit);footer.appendChild(actions);body.appendChild(footer);
  card.appendChild(body);overlay.appendChild(card);document.body.appendChild(overlay);
  requestAnimationFrame(function(){overlay.setAttribute('data-open','1');gotit.focus();});
})();`;
}

function resolveAssetDirs(baseDir = __dirname, resourcesPath = process.resourcesPath) {
  const hasPackagedDir = (subdir) =>
    typeof resourcesPath === "string" &&
    resourcesPath.length > 0 &&
    fs.existsSync(path.join(resourcesPath, subdir));
  return {
    frontendDir: hasPackagedDir("frontend")
      ? path.join(resourcesPath, "frontend")
      : path.resolve(baseDir, "..", "frontend"),
    iconsDir: hasPackagedDir("icons")
      ? path.join(resourcesPath, "icons")
      : path.resolve(baseDir, "..", "src-tauri", "icons"),
  };
}

function buildAutostartExecCommand(
  isPackaged = false,
  execPath = process.execPath,
  appDir = __dirname,
  env = process.env
) {
  if (isPackaged) {
    const appImagePath = typeof env?.APPIMAGE === "string" ? env.APPIMAGE.trim() : "";
    const target = appImagePath || execPath;
    return `"${target}" --minimized`;
  }
  return `"${execPath}" "${appDir}" --minimized`;
}

function resolveDownloadsBaseDir(electronDownloadsPath, homeDir = os.homedir()) {
  const home = path.resolve(homeDir || os.homedir());
  const raw = typeof electronDownloadsPath === "string" ? electronDownloadsPath.trim() : "";
  const base = !raw || path.resolve(raw) === home ? path.join(home, "Downloads") : raw;
  return path.join(base, "IG-Now");
}

function isWslEnvironment(env = process.env, osRelease = null) {
  if (env && (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSL2_GUI_APPS_ENABLED)) {
    return true;
  }
  if (typeof osRelease === "string") {
    return /microsoft|wsl/i.test(osRelease);
  }
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/sys/kernel/osrelease", "utf8"));
  } catch {
    return false;
  }
}

function shouldDisableGpuCompositing(
  platform = process.platform,
  argv = process.argv,
  env = process.env,
  osRelease = null
) {
  if (platform !== "linux" || !isWslEnvironment(env, osRelease)) return false;
  if (Array.isArray(argv) && argv.includes("--disable-gpu-compositing")) return false;
  return true;
}

function hasCliSwitch(argv, name) {
  if (!Array.isArray(argv)) return false;
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  return argv.some((a) => a === exact || (typeof a === "string" && a.startsWith(prefix)));
}

function getCliSwitchValue(argv, name) {
  if (!Array.isArray(argv)) return null;
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== "string") continue;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === exact && typeof argv[i + 1] === "string") return argv[i + 1];
  }
  return null;
}

function hasSuidChromeSandbox(execPath) {
  if (!execPath || typeof execPath !== "string") return false;
  try {
    const sandboxPath = path.join(path.dirname(execPath), "chrome-sandbox");
    const st = fs.statSync(sandboxPath);
    return st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

function shouldDisableChromiumSandbox(
  platform = process.platform,
  argv = process.argv,
  env = process.env,
  osRelease = null,
  execPath = process.execPath
) {
  if (platform !== "linux" || hasCliSwitch(argv, "no-sandbox")) return false;
  if (isWslEnvironment(env, osRelease) || Boolean(env?.APPIMAGE)) return true;
  return !hasSuidChromeSandbox(execPath);
}

function isWaylandOzoneSession(
  platform = process.platform,
  argv = process.argv,
  env = process.env,
  osRelease = null
) {
  if (platform !== "linux") return false;
  const explicit = getCliSwitchValue(argv, "ozone-platform");
  if (explicit) return explicit.toLowerCase() === "wayland";
  if (isWslEnvironment(env, osRelease)) return false;
  const hasWayland =
    Boolean(env?.WAYLAND_DISPLAY) ||
    String(env?.XDG_SESSION_TYPE || "").toLowerCase() === "wayland";
  return hasWayland;
}

function getLinuxStartupSwitches(
  platform = process.platform,
  argv = process.argv,
  env = process.env,
  osRelease = null,
  execPath = process.execPath
) {
  if (platform !== "linux") return [];
  const switches = [];
  if (shouldDisableChromiumSandbox(platform, argv, env, osRelease, execPath)) {
    switches.push(["no-sandbox"]);
  }
  if (isWslEnvironment(env, osRelease)) {
    if (shouldDisableGpuCompositing(platform, argv, env, osRelease)) {
      switches.push(["disable-gpu-compositing"]);
    }
    return switches;
  }
  if (!hasCliSwitch(argv, "ozone-platform") && !hasCliSwitch(argv, "ozone-platform-hint")) {
    switches.push(["ozone-platform-hint", "auto"]);
  }
  if (
    !hasCliSwitch(argv, "disable-gpu") &&
    !hasCliSwitch(argv, "disable-gpu-compositing") &&
    !hasCliSwitch(argv, "enable-features")
  ) {
    switches.push(["enable-features", "VaapiVideoDecodeLinuxGL,VaapiVideoDecoder"]);
  }
  return switches;
}

module.exports = {
  DEFAULT_UA,
  isSafeHttpUrl,
  isInstagramAppHost,
  isInstagramShareUrl,
  isAllowedInstagramNavUrl,
  toMediaBuffer,
  sanitizeHeaderValue,
  unescapeUrl,
  stripMediaRangeParams,
  shortcodeFromUrl,
  shortcodeToMediaId,
  mediaIdToShortcode,
  parseDashManifest,
  extractPostFromJsonText,
  extractPostFromHtml,
  isCompleteSeedPost,
  pickRicherInspectedPost,
  sanitizePathSegment,
  mediaExtension,
  buildTargetPath,
  buildSourceFilenameStem,
  carouselSlideStem,
  singleSelectionFileStem,
  formatCaptionDocument,
  buildMetadataJson,
  isValidMp4Header,
  isValidWebmHeader,
  isValidDownloadVideoHeader,
  detectImageFormat,
  isValidImageHeader,
  cookieHeaderAndCsrfFromPairs,
  buildCurlStdinHeaders,
  runCurlWithAuthStdin,
  runCurlText,
  curlDownloadToFile,
  validateOrRemoveVideoInput,
  validateOrRemoveMp4,
  validateOrRemoveImage,
  findFfmpegBinary,
  inspectMp4Layout,
  probeMediaStreams,
  muxVideoAudioFfmpeg,
  normalizeVideoMp4,
  normalizeImageFile,
  replacePathExtension,
  probeMp4AudioState,
  transcodeMp4AudioToAac,
  extractAudioAacM4aFfmpeg,
  ensureMp4AacAudio,
  replaceFileAtomically,
  uniqueTempMediaPath,
  fetchMediaToPath,
  fetchMediaWithFallbacks,
  fetchAudioOnlyToPath,
  inspectViaHttpCascade,
  isCompleteInspectedPost,
  inspectWithWindowRace,
  UnreadTracker,
  getAutostartDesktopPath,
  isAutostartEnabled,
  buildAutostartDesktopEntry,
  setAutostartEnabled,
  computeCenteredWorkAreaFrame,
  estimateChromeOverhead,
  setZoomJs,
  buildAboutJs,
  resolveAssetDirs,
  buildAutostartExecCommand,
  resolveDownloadsBaseDir,
  isWslEnvironment,
  shouldDisableGpuCompositing,
  shouldDisableChromiumSandbox,
  isWaylandOzoneSession,
  getLinuxStartupSwitches,
};
