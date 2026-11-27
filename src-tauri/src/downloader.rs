use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsStr,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

static HASH_SEQ: AtomicU64 = AtomicU64::new(1);

pub fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

const IG_ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const IG_APP_ID: &str = "936619743392459";
const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoFormat {
    pub id: String,
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub bandwidth: u64,
    #[serde(default)]
    pub codecs: String,
    pub ext: String,
    pub requires_mux: bool,
    pub video_url: String,
    pub audio_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaItemSpec {
    pub index: usize,
    pub kind: String,
    pub thumbnail_url: Option<String>,
    pub formats: Vec<VideoFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InspectedPost {
    pub shortcode: String,
    pub pk: String,
    pub username: String,
    pub post_url: String,
    pub taken_at: String,
    pub caption: String,
    pub ffmpeg_available: bool,
    pub items: Vec<MediaItemSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub saved_paths: Vec<String>,
    pub caption_path: Option<String>,
    pub metadata_path: Option<String>,
    pub subfolder: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingDownloadOpen {
    pub url: String,
    pub payload_json: Option<String>,
    #[serde(default)]
    pub slide_index: Option<usize>,
    #[serde(default)]
    pub slide_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DashTrack {
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub bandwidth: u64,
    pub codecs: String,
    pub is_audio: bool,
}

#[derive(Default)]
pub struct DownloaderProbeState {
    pub pending_open: Mutex<Option<PendingDownloadOpen>>,
    pub pending_probes: Mutex<HashMap<String, oneshot::Sender<String>>>,
}

impl DownloaderProbeState {
    pub fn set_pending_open(&self, open: Option<PendingDownloadOpen>) {
        if let Ok(mut slot) = self.pending_open.lock() {
            *slot = open;
        }
    }

    pub fn take_pending_open(&self) -> Option<PendingDownloadOpen> {
        self.pending_open.lock().ok().and_then(|mut s| s.take())
    }

    pub fn register_probe(&self, request_id: String, tx: oneshot::Sender<String>) {
        if let Ok(mut map) = self.pending_probes.lock() {
            map.insert(request_id, tx);
        }
    }

    pub fn resolve_probe(&self, request_id: &str, payload: String) -> bool {
        let sender = self
            .pending_probes
            .lock()
            .ok()
            .and_then(|mut map| map.remove(request_id));
        match sender {
            Some(tx) => tx.send(payload).is_ok(),
            None => false,
        }
    }

    pub fn cancel_probe(&self, request_id: &str) {
        if let Ok(mut map) = self.pending_probes.lock() {
            map.remove(request_id);
        }
    }
}

pub fn is_safe_http_url(url: &str) -> bool {
    let trimmed = url.trim();
    (trimmed.starts_with("https://") || trimmed.starts_with("http://"))
        && !trimmed.contains(['\r', '\n', '\0'])
}

pub fn is_instagram_app_host(url: &str) -> bool {
    tauri::Url::parse(url.trim())
        .ok()
        .and_then(|parsed| parsed.host_str().map(|h| h.to_ascii_lowercase()))
        .is_some_and(|host| host == "instagram.com" || host.ends_with(".instagram.com"))
}

pub fn is_instagram_share_url(url: &str) -> bool {
    tauri::Url::parse(url.trim())
        .ok()
        .and_then(|parsed| parsed.host_str().map(|h| h.to_ascii_lowercase()))
        .is_some_and(|host| {
            host == "instagram.com" || host.ends_with(".instagram.com") || host == "instagr.am"
        })
}

pub fn unescape_url(raw: &str) -> String {
    raw.trim()
        .replace("\\u0026", "&")
        .replace("\\u003A", ":")
        .replace("\\u003a", ":")
        .replace("\\u002F", "/")
        .replace("\\u002f", "/")
        .replace("\\u003F", "?")
        .replace("\\u003f", "?")
        .replace("\\u003D", "=")
        .replace("\\u003d", "=")
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
}

pub fn strip_media_range_params(raw: &str) -> String {
    let decoded = unescape_url(raw);
    if !is_safe_http_url(&decoded) {
        return String::new();
    }
    let Some((base, query)) = decoded.split_once('?') else {
        return decoded;
    };
    let (query, fragment) = match query.split_once('#') {
        Some((q, f)) => (q, Some(f)),
        None => (query, None),
    };
    let kept: Vec<&str> = query
        .split('&')
        .filter(|pair| {
            let key = pair.split('=').next().unwrap_or("");
            !matches!(
                key.to_ascii_lowercase().as_str(),
                "bytestart" | "byteend" | "range" | "segment" | "chunk" | "part"
            )
        })
        .collect();
    let mut rebuilt = base.to_string();
    if !kept.is_empty() {
        rebuilt.push('?');
        rebuilt.push_str(&kept.join("&"));
    }
    if let Some(frag) = fragment {
        rebuilt.push('#');
        rebuilt.push_str(frag);
    }
    rebuilt
}

fn sanitize_url_candidate(raw: &str) -> Option<String> {
    let cleaned = strip_media_range_params(raw);
    if cleaned.is_empty() || !is_safe_http_url(&cleaned) {
        None
    } else {
        Some(cleaned)
    }
}

pub fn shortcode_from_url(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        && (5..=32).contains(&trimmed.len())
    {
        return Some(trimmed.to_string());
    }
    if (trimmed.contains("://") || trimmed.to_ascii_lowercase().starts_with("http"))
        && !is_instagram_share_url(trimmed)
    {
        return None;
    }
    for prefix in ["/p/", "/reel/", "/reels/", "/tv/"] {
        if let Some(pos) = trimmed.find(prefix) {
            let rest = &trimmed[pos + prefix.len()..];
            let code = rest.split(['/', '?', '#', '&']).next().unwrap_or("").trim();
            if !code.is_empty()
                && code
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            {
                return Some(code.to_string());
            }
        }
    }
    None
}

pub fn shortcode_to_media_id(shortcode: &str) -> Option<String> {
    let code = shortcode.trim();
    if code.is_empty() || code.len() > 11 {
        return None;
    }
    let mut id: u128 = 0;
    for ch in code.chars() {
        let idx = IG_ALPHABET.find(ch)? as u128;
        id = (id << 6) + idx;
    }
    (id > 0).then(|| id.to_string())
}

pub fn media_id_to_shortcode(media_id: &str) -> Option<String> {
    let digits = media_id.split('_').next()?.trim();
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut id = digits.parse::<u128>().ok()?;
    if id == 0 {
        return None;
    }
    let bytes = IG_ALPHABET.as_bytes();
    let mut chars = Vec::new();
    while id > 0 {
        chars.push(bytes[(id & 63) as usize] as char);
        id >>= 6;
    }
    chars.reverse();
    Some(chars.into_iter().collect())
}

fn read_xml_attr(tag: &str, name: &str) -> Option<String> {
    let lower_tag = tag.to_ascii_lowercase();
    let needle = format!("{}=", name.to_ascii_lowercase());
    let mut offset = 0;
    while let Some(pos) = lower_tag[offset..].find(&needle) {
        let abs = offset + pos;
        let prev_ok = abs == 0
            || lower_tag.as_bytes()[abs - 1].is_ascii_whitespace()
            || lower_tag.as_bytes()[abs - 1] == b'<';
        let after = &tag[abs + needle.len()..];
        offset = abs + needle.len();
        if !prev_ok {
            continue;
        }
        let quote = after.chars().next()?;
        if quote != '"' && quote != '\'' {
            continue;
        }
        let value = &after[quote.len_utf8()..];
        if let Some(end) = value.find(quote) {
            return Some(unescape_url(&value[..end]));
        }
    }
    None
}

fn tag_blocks<'a>(source: &'a str, tag: &str) -> Vec<&'a str> {
    let open_prefix = format!("<{}", tag.to_ascii_lowercase());
    let close_tag = format!("</{}>", tag.to_ascii_lowercase());
    let lower = source.to_ascii_lowercase();
    let mut blocks = Vec::new();
    let mut pos = 0;
    while let Some(start) = lower[pos..].find(&open_prefix) {
        let abs_start = pos + start;
        let next_char = lower.as_bytes().get(abs_start + open_prefix.len()).copied();
        if !matches!(next_char, Some(b'>' | b' ' | b'\t' | b'\r' | b'\n')) {
            pos = abs_start + open_prefix.len();
            continue;
        }
        if let Some(end_rel) = lower[abs_start..].find(&close_tag) {
            let abs_end = abs_start + end_rel + close_tag.len();
            blocks.push(&source[abs_start..abs_end]);
            pos = abs_end;
        } else {
            break;
        }
    }
    blocks
}

fn extract_tag_inner(block: &str, tag: &str) -> Option<String> {
    let lower = block.to_ascii_lowercase();
    let open = format!("<{}", tag.to_ascii_lowercase());
    let close = format!("</{}>", tag.to_ascii_lowercase());
    let start = lower.find(&open)?;
    let gt = lower[start..].find('>')? + start + 1;
    let end = lower[gt..].find(&close)? + gt;
    Some(block[gt..end].trim().to_string())
}

pub fn video_codec_rank(codecs: &str) -> u8 {
    let c = codecs.trim().to_ascii_lowercase();
    if c.is_empty() {
        return 2;
    }
    if c.contains("avc1") || c.contains("avc3") || c.contains("h264") {
        4
    } else if c.contains("hev1") || c.contains("hvc1") || c.contains("hevc") {
        3
    } else if c.contains("vp09") || c.contains("vp9") || c.contains("vp8") {
        1
    } else if c.contains("av01") || c.contains("av1") {
        0
    } else {
        2
    }
}

pub fn audio_codec_rank(codecs: &str) -> u8 {
    let c = codecs.trim().to_ascii_lowercase();
    if c.is_empty() {
        return 2;
    }
    if c.contains("mp4a") || c.contains("aac") {
        3
    } else if c.contains("opus") {
        0
    } else {
        1
    }
}

pub fn parse_dash_manifest(xml: &str) -> (Vec<DashTrack>, Vec<DashTrack>) {
    if xml.trim().is_empty() || !xml.to_ascii_lowercase().contains("<baseurl") {
        return (Vec::new(), Vec::new());
    }
    let mut videos = Vec::new();
    let mut audios = Vec::new();
    let sets = tag_blocks(xml, "AdaptationSet");
    let containers = if sets.is_empty() { vec![xml] } else { sets };

    for set in containers {
        let set_head = set.split('>').next().unwrap_or("");
        let set_mime = read_xml_attr(set_head, "mimeType")
            .or_else(|| read_xml_attr(set_head, "contentType"))
            .unwrap_or_default()
            .to_ascii_lowercase();

        for rep in tag_blocks(set, "Representation") {
            let rep_head = rep.split('>').next().unwrap_or("");
            let rep_mime = read_xml_attr(rep_head, "mimeType").unwrap_or_else(|| set_mime.clone());
            let codecs = read_xml_attr(rep_head, "codecs").unwrap_or_default();
            let width = read_xml_attr(rep_head, "width")
                .or_else(|| read_xml_attr(set_head, "width"))
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0);
            let height = read_xml_attr(rep_head, "height")
                .or_else(|| read_xml_attr(set_head, "height"))
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0);
            let bandwidth = read_xml_attr(rep_head, "bandwidth")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            let Some(raw_url) = extract_tag_inner(rep, "BaseURL") else {
                continue;
            };
            let Some(url) = sanitize_url_candidate(&raw_url) else {
                continue;
            };
            let lower_codecs = codecs.to_ascii_lowercase();
            let is_audio = rep_mime.contains("audio")
                || lower_codecs.starts_with("mp4a")
                || lower_codecs.contains("opus")
                || (width == 0
                    && height == 0
                    && (set_mime.contains("audio")
                        || rep_head.to_ascii_lowercase().contains("audiosamplingrate")));
            let track = DashTrack {
                url,
                width,
                height,
                bandwidth,
                codecs,
                is_audio,
            };
            if is_audio {
                audios.push(track);
            } else {
                videos.push(track);
            }
        }
    }

    videos.sort_by(|a, b| {
        let area_a = (a.width as u64) * (a.height as u64);
        let area_b = (b.width as u64) * (b.height as u64);
        area_b
            .cmp(&area_a)
            .then_with(|| video_codec_rank(&b.codecs).cmp(&video_codec_rank(&a.codecs)))
            .then_with(|| b.bandwidth.cmp(&a.bandwidth))
    });
    audios.sort_by(|a, b| {
        audio_codec_rank(&b.codecs)
            .cmp(&audio_codec_rank(&a.codecs))
            .then_with(|| b.bandwidth.cmp(&a.bandwidth))
    });
    (videos, audios)
}

fn format_resolution_label(width: u32, height: u32, suffix: &str) -> String {
    let short_side = width.min(height);
    if short_side > 0 {
        format!("{short_side}p MP4{suffix}")
    } else if height > 0 && width > 0 {
        format!("{width}x{height} MP4{suffix}")
    } else {
        format!("MP4{suffix}")
    }
}

fn push_unique_format(list: &mut Vec<VideoFormat>, candidate: VideoFormat) {
    let dup = list.iter().any(|existing| {
        existing.video_url == candidate.video_url && existing.audio_url == candidate.audio_url
    });
    if !dup {
        list.push(candidate);
    }
}

fn video_formats_from_node(node: &Value, has_ffmpeg: bool) -> (Vec<VideoFormat>, Option<String>) {
    let mut formats = Vec::new();
    let thumb = node
        .get("image_versions2")
        .and_then(|v| v.get("candidates"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("url"))
        .and_then(|u| u.as_str())
        .and_then(sanitize_url_candidate)
        .or_else(|| {
            node.get("display_url")
                .and_then(|u| u.as_str())
                .and_then(sanitize_url_candidate)
        });

    if let Some(versions) = node.get("video_versions").and_then(|v| v.as_array()) {
        for (idx, entry) in versions.iter().enumerate() {
            let Some(url) = entry
                .get("url")
                .and_then(|u| u.as_str())
                .and_then(sanitize_url_candidate)
            else {
                continue;
            };
            let width = entry.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let height = entry.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let bandwidth = entry
                .get("bandwidth")
                .and_then(|v| v.as_u64())
                .unwrap_or((width as u64) * (height as u64));
            let codecs = entry
                .get("codecs")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            push_unique_format(
                &mut formats,
                VideoFormat {
                    id: format!("prog-{idx}"),
                    label: format_resolution_label(width, height, " (Video + Audio)"),
                    width,
                    height,
                    bandwidth,
                    codecs,
                    ext: "mp4".to_string(),
                    requires_mux: false,
                    video_url: url,
                    audio_url: None,
                },
            );
        }
    }

    if let Some(raw_url) = node.get("video_url").and_then(|u| u.as_str()) {
        if let Some(url) = sanitize_url_candidate(raw_url) {
            let w = node
                .get("dimensions")
                .and_then(|d| d.get("width"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let h = node
                .get("dimensions")
                .and_then(|d| d.get("height"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            push_unique_format(
                &mut formats,
                VideoFormat {
                    id: "prog-direct".to_string(),
                    label: format_resolution_label(w, h, " (Video + Audio)"),
                    width: w,
                    height: h,
                    bandwidth: (w as u64) * (h as u64),
                    codecs: String::new(),
                    ext: "mp4".to_string(),
                    requires_mux: false,
                    video_url: url,
                    audio_url: None,
                },
            );
        }
    }

    if let Some(manifest) = node.get("video_dash_manifest").and_then(|v| v.as_str()) {
        let (dash_videos, dash_audios) = parse_dash_manifest(manifest);
        let best_audio = dash_audios.first().map(|a| a.url.clone());
        for (idx, track) in dash_videos.into_iter().enumerate() {
            let suffix = if best_audio.is_some() {
                if has_ffmpeg {
                    " (AAC Audio Muxed)"
                } else {
                    " (DASH, needs ffmpeg for AAC audio)"
                }
            } else {
                " (DASH Video)"
            };
            push_unique_format(
                &mut formats,
                VideoFormat {
                    id: format!("dash-{idx}"),
                    label: format_resolution_label(track.width, track.height, suffix),
                    width: track.width,
                    height: track.height,
                    bandwidth: track.bandwidth,
                    codecs: track.codecs,
                    ext: "mp4".to_string(),
                    requires_mux: best_audio.is_some(),
                    video_url: track.url,
                    audio_url: best_audio.clone(),
                },
            );
        }
    }

    formats.sort_by(|a, b| {
        if !has_ffmpeg {
            let prog_cmp = a.requires_mux.cmp(&b.requires_mux);
            if prog_cmp != std::cmp::Ordering::Equal {
                return prog_cmp;
            }
        }
        let area_a = (a.width as u64) * (a.height as u64);
        let area_b = (b.width as u64) * (b.height as u64);
        let res_cmp = area_b.cmp(&area_a);
        if res_cmp != std::cmp::Ordering::Equal {
            return res_cmp;
        }
        let codec_cmp = video_codec_rank(&b.codecs).cmp(&video_codec_rank(&a.codecs));
        if codec_cmp != std::cmp::Ordering::Equal {
            return codec_cmp;
        }
        if has_ffmpeg {
            // At equal resolution & codec preference, prefer explicit DASH Video + AAC Audio muxing
            // over raw progressive URLs because some Instagram `video_versions` ship video-only at 1080p.
            let dash_pref = b.requires_mux.cmp(&a.requires_mux);
            if dash_pref != std::cmp::Ordering::Equal {
                return dash_pref;
            }
        }
        b.bandwidth.cmp(&a.bandwidth)
    });

    (formats, thumb)
}

fn image_formats_from_node(node: &Value) -> (Vec<VideoFormat>, Option<String>) {
    let mut formats = Vec::new();
    if let Some(candidates) = node
        .get("image_versions2")
        .and_then(|v| v.get("candidates"))
        .and_then(|v| v.as_array())
    {
        for (idx, entry) in candidates.iter().enumerate() {
            let Some(url) = entry
                .get("url")
                .and_then(|u| u.as_str())
                .and_then(sanitize_url_candidate)
            else {
                continue;
            };
            let width = entry.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let height = entry.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let label = if width > 0 && height > 0 {
                format!("{width}x{height} JPG")
            } else {
                "Original JPG".to_string()
            };
            push_unique_format(
                &mut formats,
                VideoFormat {
                    id: format!("img-{idx}"),
                    label,
                    width,
                    height,
                    bandwidth: (width as u64) * (height as u64),
                    codecs: String::new(),
                    ext: "jpg".to_string(),
                    requires_mux: false,
                    video_url: url,
                    audio_url: None,
                },
            );
        }
    }
    if let Some(resources) = node.get("display_resources").and_then(|v| v.as_array()) {
        for (idx, entry) in resources.iter().enumerate() {
            let Some(url) = entry
                .get("src")
                .and_then(|u| u.as_str())
                .and_then(sanitize_url_candidate)
            else {
                continue;
            };
            let width = entry
                .get("config_width")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let height = entry
                .get("config_height")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let label = if width > 0 && height > 0 {
                format!("{width}x{height} JPG")
            } else {
                "Original JPG".to_string()
            };
            push_unique_format(
                &mut formats,
                VideoFormat {
                    id: format!("img-res-{idx}"),
                    label,
                    width,
                    height,
                    bandwidth: (width as u64) * (height as u64),
                    codecs: String::new(),
                    ext: "jpg".to_string(),
                    requires_mux: false,
                    video_url: url,
                    audio_url: None,
                },
            );
        }
    }
    if let Some(raw_url) = node.get("display_url").and_then(|u| u.as_str()) {
        if let Some(url) = sanitize_url_candidate(raw_url) {
            let width = node
                .get("dimensions")
                .and_then(|d| d.get("width"))
                .or_else(|| node.get("original_width"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let height = node
                .get("dimensions")
                .and_then(|d| d.get("height"))
                .or_else(|| node.get("original_height"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let label = if width > 0 && height > 0 {
                format!("{width}x{height} JPG")
            } else {
                "Original JPG".to_string()
            };
            push_unique_format(
                &mut formats,
                VideoFormat {
                    id: "img-display".to_string(),
                    label,
                    width,
                    height,
                    bandwidth: (width as u64) * (height as u64),
                    codecs: String::new(),
                    ext: "jpg".to_string(),
                    requires_mux: false,
                    video_url: url,
                    audio_url: None,
                },
            );
        }
    }
    formats.sort_by(|a, b| b.bandwidth.cmp(&a.bandwidth));
    let thumb = formats.first().map(|f| f.video_url.clone());
    (formats, thumb)
}

fn node_is_instagram_media(node: &Value) -> bool {
    let Some(obj) = node.as_object() else {
        return false;
    };
    obj.get("video_versions")
        .and_then(|v| v.as_array())
        .is_some()
        || obj
            .get("carousel_media")
            .and_then(|v| v.as_array())
            .is_some()
        || obj
            .get("edge_sidecar_to_children")
            .and_then(|v| v.get("edges"))
            .and_then(|v| v.as_array())
            .is_some()
        || obj
            .get("video_dash_manifest")
            .and_then(|v| v.as_str())
            .map(|s| s.contains("<BaseURL"))
            .unwrap_or(false)
        || (obj.get("video_url").and_then(|v| v.as_str()).is_some()
            && (obj.contains_key("shortcode")
                || obj.contains_key("code")
                || obj.contains_key("id")))
        || (obj
            .get("image_versions2")
            .and_then(|v| v.get("candidates"))
            .is_some()
            && (obj.contains_key("code")
                || obj.contains_key("pk")
                || obj.contains_key("caption")
                || obj.contains_key("user")))
        || ((obj.get("display_url").and_then(|v| v.as_str()).is_some()
            || obj
                .get("display_resources")
                .and_then(|v| v.as_array())
                .is_some())
            && (obj.contains_key("shortcode") || obj.contains_key("code")))
}

fn build_post_from_node(
    node: &Value,
    shortcode_hint: Option<&str>,
    has_ffmpeg: bool,
) -> Option<InspectedPost> {
    if !node.is_object() {
        return None;
    }
    let mut items = Vec::new();

    if let Some(children) = node.get("carousel_media").and_then(|v| v.as_array()) {
        for (idx, child) in children.iter().enumerate() {
            let (v_formats, v_thumb) = video_formats_from_node(child, has_ffmpeg);
            if !v_formats.is_empty() {
                items.push(MediaItemSpec {
                    index: idx,
                    kind: "video".to_string(),
                    thumbnail_url: v_thumb,
                    formats: v_formats,
                });
            } else {
                let (i_formats, i_thumb) = image_formats_from_node(child);
                if !i_formats.is_empty() {
                    items.push(MediaItemSpec {
                        index: idx,
                        kind: "image".to_string(),
                        thumbnail_url: i_thumb,
                        formats: i_formats,
                    });
                }
            }
        }
    } else if let Some(edges) = node
        .get("edge_sidecar_to_children")
        .and_then(|v| v.get("edges"))
        .and_then(|v| v.as_array())
    {
        for (idx, edge) in edges.iter().enumerate() {
            let Some(child) = edge.get("node") else {
                continue;
            };
            let (v_formats, v_thumb) = video_formats_from_node(child, has_ffmpeg);
            if !v_formats.is_empty() {
                items.push(MediaItemSpec {
                    index: idx,
                    kind: "video".to_string(),
                    thumbnail_url: v_thumb,
                    formats: v_formats,
                });
            } else {
                let (i_formats, i_thumb) = image_formats_from_node(child);
                if !i_formats.is_empty() {
                    items.push(MediaItemSpec {
                        index: idx,
                        kind: "image".to_string(),
                        thumbnail_url: i_thumb,
                        formats: i_formats,
                    });
                }
            }
        }
    } else {
        let (v_formats, v_thumb) = video_formats_from_node(node, has_ffmpeg);
        if !v_formats.is_empty() {
            items.push(MediaItemSpec {
                index: 0,
                kind: "video".to_string(),
                thumbnail_url: v_thumb,
                formats: v_formats,
            });
        } else {
            let (i_formats, i_thumb) = image_formats_from_node(node);
            if !i_formats.is_empty() {
                items.push(MediaItemSpec {
                    index: 0,
                    kind: "image".to_string(),
                    thumbnail_url: i_thumb,
                    formats: i_formats,
                });
            }
        }
    }

    if items.is_empty() {
        return None;
    }

    let raw_pk = node
        .get("pk")
        .or_else(|| node.get("id"))
        .and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .unwrap_or_default();
    let pk: String = raw_pk
        .split('_')
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();

    let shortcode = node
        .get("code")
        .or_else(|| node.get("shortcode"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| media_id_to_shortcode(&pk))
        .or_else(|| shortcode_hint.map(str::to_string))
        .unwrap_or_default();

    let username = node
        .get("user")
        .and_then(|u| u.get("username"))
        .or_else(|| node.get("owner").and_then(|o| o.get("username")))
        .or_else(|| {
            node.get("coauthor_producers")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|u| u.get("username"))
        })
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let caption = node
        .get("caption")
        .and_then(|c| {
            c.get("text")
                .and_then(|t| t.as_str())
                .or_else(|| c.as_str())
        })
        .or_else(|| {
            node.get("edge_media_to_caption")
                .and_then(|c| c.get("edges"))
                .and_then(|e| e.as_array())
                .and_then(|a| a.first())
                .and_then(|first| first.get("node"))
                .and_then(|n| n.get("text"))
                .and_then(|t| t.as_str())
        })
        .or_else(|| node.get("accessibility_caption").and_then(|v| v.as_str()))
        .unwrap_or("")
        .trim()
        .to_string();

    let taken_epoch = node
        .get("taken_at")
        .or_else(|| node.get("taken_at_timestamp"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let taken_at = if taken_epoch > 0 {
        format_unix_iso_utc(taken_epoch as u64)
    } else {
        String::new()
    };

    let post_url = if !shortcode.is_empty() {
        format!("https://www.instagram.com/p/{shortcode}/")
    } else {
        "https://www.instagram.com/".to_string()
    };

    Some(InspectedPost {
        shortcode,
        pk,
        username,
        post_url,
        taken_at,
        caption,
        ffmpeg_available: has_ffmpeg,
        items,
    })
}

fn format_unix_iso_utc(secs: u64) -> String {
    // Civil-from-days algorithm (Howard Hinnant) for compact UTC timestamp with zero extra crates.
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let hour = rem / 3_600;
    let minute = (rem % 3_600) / 60;
    let second = rem % 60;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    format!("{year:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn scan_value_for_post(
    root: &Value,
    shortcode_hint: Option<&str>,
    has_ffmpeg: bool,
) -> Option<InspectedPost> {
    let mut stack = vec![(root, 0usize)];
    let mut visited = 0usize;
    let mut fallback: Option<InspectedPost> = None;

    while let Some((val, depth)) = stack.pop() {
        if visited >= 16_000 || depth > 26 {
            continue;
        }
        visited += 1;
        if node_is_instagram_media(val) {
            if let Some(post) = build_post_from_node(val, shortcode_hint, has_ffmpeg) {
                if shortcode_hint
                    .map(|hint| !hint.is_empty() && post.shortcode == hint)
                    .unwrap_or(false)
                {
                    return Some(post);
                }
                if fallback.is_none() {
                    fallback = Some(post);
                }
            }
        }
        match val {
            Value::Array(arr) => {
                for item in arr.iter().rev() {
                    if item.is_object() || item.is_array() {
                        stack.push((item, depth + 1));
                    }
                }
            }
            Value::Object(map) => {
                for child in map.values() {
                    if child.is_object() || child.is_array() {
                        stack.push((child, depth + 1));
                    }
                }
            }
            _ => {}
        }
    }
    fallback
}

pub fn extract_post_from_json_text(
    raw: &str,
    shortcode_hint: Option<&str>,
    has_ffmpeg: bool,
) -> Option<InspectedPost> {
    let cleaned = raw.trim().trim_start_matches("for (;;);").trim();
    if cleaned.is_empty() || cleaned.len() > 8 * 1024 * 1024 {
        return None;
    }
    if let Ok(parsed) = serde_json::from_str::<Value>(cleaned) {
        if let Some(post) = scan_value_for_post(&parsed, shortcode_hint, has_ffmpeg) {
            return Some(post);
        }
    }
    for line in cleaned.lines() {
        let t = line.trim();
        if !(t.starts_with('{') || t.starts_with('[')) {
            continue;
        }
        if let Ok(parsed) = serde_json::from_str::<Value>(t) {
            if let Some(post) = scan_value_for_post(&parsed, shortcode_hint, has_ffmpeg) {
                return Some(post);
            }
        }
    }
    None
}

fn find_meta_content(html: &str, attr_name: &str, attr_value: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let target = attr_value.to_ascii_lowercase();
    let mut pos = 0;
    while let Some(idx) = lower[pos..].find("<meta") {
        let abs = pos + idx;
        let Some(gt_rel) = lower[abs..].find('>') else {
            break;
        };
        let tag = &html[abs..abs + gt_rel + 1];
        pos = abs + gt_rel + 1;
        let matches = read_xml_attr(tag, attr_name)
            .map(|v| v.eq_ignore_ascii_case(&target))
            .unwrap_or(false);
        if matches {
            if let Some(content) = read_xml_attr(tag, "content") {
                return Some(unescape_url(&content));
            }
        }
    }
    None
}

pub fn extract_post_from_html(
    html: &str,
    shortcode_hint: Option<&str>,
    has_ffmpeg: bool,
) -> Option<InspectedPost> {
    for block in tag_blocks(html, "script") {
        let Some(body_start) = block.find('>') else {
            continue;
        };
        let inner = block[body_start + 1..]
            .rsplit_once("</")
            .map(|(head, _)| head)
            .unwrap_or("");
        if inner.contains("video_")
            || inner.contains("display_url")
            || inner.contains("image_versions2")
            || inner.contains("carousel_media")
            || inner.contains("edge_sidecar_to_children")
        {
            if let Some(post) = extract_post_from_json_text(inner, shortcode_hint, has_ffmpeg) {
                return Some(post);
            }
        }
    }

    let video_url = find_meta_content(html, "property", "og:video:secure_url")
        .or_else(|| find_meta_content(html, "property", "og:video:url"))
        .or_else(|| find_meta_content(html, "property", "og:video"))
        .and_then(|u| sanitize_url_candidate(&u));
    let image_url =
        find_meta_content(html, "property", "og:image").and_then(|u| sanitize_url_candidate(&u));
    let caption = find_meta_content(html, "property", "og:description")
        .or_else(|| find_meta_content(html, "name", "description"))
        .unwrap_or_default()
        .trim()
        .to_string();

    let mut items = Vec::new();
    if let Some(url) = video_url {
        items.push(MediaItemSpec {
            index: 0,
            kind: "video".to_string(),
            thumbnail_url: image_url,
            formats: vec![VideoFormat {
                id: "og-video".to_string(),
                label: "MP4 Video".to_string(),
                width: 0,
                height: 0,
                bandwidth: 0,
                codecs: String::new(),
                ext: "mp4".to_string(),
                requires_mux: false,
                video_url: url,
                audio_url: None,
            }],
        });
    } else if let Some(url) = image_url {
        items.push(MediaItemSpec {
            index: 0,
            kind: "image".to_string(),
            thumbnail_url: Some(url.clone()),
            formats: vec![VideoFormat {
                id: "og-image".to_string(),
                label: "Original JPG".to_string(),
                width: 0,
                height: 0,
                bandwidth: 0,
                codecs: String::new(),
                ext: "jpg".to_string(),
                requires_mux: false,
                video_url: url,
                audio_url: None,
            }],
        });
    }

    if items.is_empty() {
        return None;
    }

    let shortcode = shortcode_hint.unwrap_or("").to_string();
    let pk = shortcode_to_media_id(&shortcode).unwrap_or_default();
    let post_url = if !shortcode.is_empty() {
        format!("https://www.instagram.com/p/{shortcode}/")
    } else {
        "https://www.instagram.com/".to_string()
    };

    Some(InspectedPost {
        shortcode,
        pk,
        username: String::new(),
        post_url,
        taken_at: String::new(),
        caption,
        ffmpeg_available: has_ffmpeg,
        items,
    })
}

fn find_ffmpeg_in_paths_and_candidates(
    path_var: Option<&OsStr>,
    candidates: &[PathBuf],
) -> Option<PathBuf> {
    let names = if cfg!(windows) {
        &["ffmpeg.exe", "ffmpeg"][..]
    } else {
        &["ffmpeg"][..]
    };
    if let Some(paths) = path_var {
        for dir in env::split_paths(paths) {
            for name in names {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    candidates.iter().find(|c| c.is_file()).cloned()
}

static FFMPEG_BIN_CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn find_ffmpeg_binary() -> Option<PathBuf> {
    FFMPEG_BIN_CACHE
        .get_or_init(|| {
            #[cfg(windows)]
            let extra = {
                let mut list = vec![PathBuf::from(
                    r"C:\ProgramData\HP\LCDDisplayHelper\bin\ffmpeg.exe",
                )];
                if let Ok(local_app) = env::var("LOCALAPPDATA") {
                    list.push(PathBuf::from(local_app).join(r"Microsoft\WinGet\Links\ffmpeg.exe"));
                }
                list
            };
            // Finder/GUI launches on macOS/Linux often omit Homebrew/local bin paths from PATH.
            #[cfg(not(windows))]
            let extra = vec![
                PathBuf::from("/opt/homebrew/bin/ffmpeg"),
                PathBuf::from("/usr/local/bin/ffmpeg"),
                PathBuf::from("/opt/local/bin/ffmpeg"),
                PathBuf::from("/usr/bin/ffmpeg"),
            ];
            find_ffmpeg_in_paths_and_candidates(env::var_os("PATH").as_deref(), &extra)
        })
        .clone()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mp4AudioState {
    Aac,
    NonAac,
    Missing,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Mp4Layout {
    pub is_mp4: bool,
    pub has_ftyp: bool,
    pub has_moov: bool,
    pub has_mdat: bool,
    pub is_fragmented: bool,
    pub moov_before_mdat: bool,
    pub is_faststart: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaStreamsInfo {
    pub container: String,
    pub video_codec: String,
    pub pix_fmt: String,
    pub audio_codec: String,
    pub audio_state: Mp4AudioState,
    pub layout: Mp4Layout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormatKind {
    Jpg,
    Png,
    Gif,
    Webp,
    Avif,
    Heic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageFormat {
    pub kind: ImageFormatKind,
    pub ext: &'static str,
    pub is_lossless_or_alpha: bool,
}

pub fn is_valid_mp4_header(bytes: &[u8]) -> bool {
    bytes.len() >= 8
        && matches!(
            &bytes[4..8],
            b"ftyp" | b"styp" | b"wide" | b"free" | b"moov"
        )
}

pub fn is_valid_webm_header(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0..4] == [0x1a, 0x45, 0xdf, 0xa3]
}

pub fn is_valid_download_video_header(bytes: &[u8], allow_webm: bool) -> bool {
    is_valid_mp4_header(bytes) || (allow_webm && is_valid_webm_header(bytes))
}

pub fn detect_image_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.len() < 6 {
        return None;
    }
    if bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some(ImageFormat {
            kind: ImageFormatKind::Jpg,
            ext: "jpg",
            is_lossless_or_alpha: false,
        });
    }
    if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        return Some(ImageFormat {
            kind: ImageFormatKind::Png,
            ext: "png",
            is_lossless_or_alpha: true,
        });
    }
    if &bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a" {
        return Some(ImageFormat {
            kind: ImageFormatKind::Gif,
            ext: "gif",
            is_lossless_or_alpha: true,
        });
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        let chunk = bytes.get(12..16).unwrap_or(b"");
        let is_lossless_or_alpha =
            chunk == b"VP8L" || (chunk == b"VP8X" && bytes.len() >= 21 && (bytes[20] & 0x10) != 0);
        return Some(ImageFormat {
            kind: ImageFormatKind::Webp,
            ext: "webp",
            is_lossless_or_alpha,
        });
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        const IMAGE_BRANDS: &[&str] = &[
            "avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1",
        ];
        let mut brands = vec![String::from_utf8_lossy(&bytes[8..12]).to_ascii_lowercase()];
        let limit = bytes.len().min(64);
        let mut i = 16;
        while i + 4 <= limit {
            brands.push(String::from_utf8_lossy(&bytes[i..i + 4]).to_ascii_lowercase());
            i += 4;
        }
        if !brands.iter().any(|b| IMAGE_BRANDS.contains(&b.as_str())) {
            return None;
        }
        let is_avif = brands.iter().any(|b| b == "avif" || b == "avis");
        return Some(if is_avif {
            ImageFormat {
                kind: ImageFormatKind::Avif,
                ext: "avif",
                is_lossless_or_alpha: false,
            }
        } else {
            ImageFormat {
                kind: ImageFormatKind::Heic,
                ext: "heic",
                is_lossless_or_alpha: false,
            }
        });
    }
    None
}

pub fn is_valid_image_header(bytes: &[u8]) -> bool {
    detect_image_format(bytes).is_some()
}

pub fn replace_path_extension(path: &Path, new_ext: &str) -> PathBuf {
    path.with_extension(new_ext.trim_start_matches('.'))
}

fn read_file_head(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0_u8; max_bytes];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    Ok(buf)
}

fn split_top_level_comma(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (idx, ch) in text.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            ',' if depth == 0 => {
                parts.push(text[start..idx].trim());
                start = idx + 1;
            }
            _ => {}
        }
    }
    parts.push(text[start..].trim());
    parts
}

pub fn inspect_mp4_layout(path: &Path) -> Mp4Layout {
    let mut result = Mp4Layout::default();
    let Ok(mut file) = fs::File::open(path) else {
        return result;
    };
    let Ok(meta) = file.metadata() else {
        return result;
    };
    let file_size = meta.len();
    let mut pos: u64 = 0;
    let mut first_box: Option<[u8; 4]> = None;
    let mut moov_pos: Option<u64> = None;
    let mut mdat_pos: Option<u64> = None;
    let mut header = [0_u8; 16];

    for _ in 0..4096 {
        if pos + 8 > file_size {
            break;
        }
        if file.seek(SeekFrom::Start(pos)).is_err() {
            break;
        }
        let Ok(n) = file.read(&mut header[..8]) else {
            break;
        };
        if n < 8 {
            break;
        }
        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let box_type: [u8; 4] = [header[4], header[5], header[6], header[7]];
        if !box_type.iter().all(|&b| (0x20..=0x7e).contains(&b)) {
            break;
        }
        let box_size: u64 = if size32 == 1 {
            if pos + 16 > file_size {
                break;
            }
            if file.read_exact(&mut header[8..16]).is_err() {
                break;
            }
            let big = u64::from_be_bytes([
                header[8], header[9], header[10], header[11], header[12], header[13], header[14],
                header[15],
            ]);
            if big < 16 || pos.saturating_add(big) > file_size {
                break;
            }
            big
        } else if size32 == 0 {
            file_size - pos
        } else {
            u64::from(size32)
        };

        if box_size < 8 || pos.saturating_add(box_size) > file_size {
            break;
        }
        if first_box.is_none() {
            first_box = Some(box_type);
        }
        if &box_type == b"ftyp" {
            result.has_ftyp = true;
        } else if &box_type == b"moov" && moov_pos.is_none() {
            result.has_moov = true;
            moov_pos = Some(pos);
        } else if &box_type == b"mdat" && mdat_pos.is_none() {
            result.has_mdat = true;
            mdat_pos = Some(pos);
        } else if &box_type == b"moof" {
            result.is_fragmented = true;
        }
        pos += box_size;
    }

    if first_box.as_ref() == Some(b"styp") {
        result.is_fragmented = true;
    }
    result.is_mp4 = result.has_ftyp
        || matches!(
            first_box.as_ref(),
            Some(b"styp" | b"moov" | b"wide" | b"free")
        );
    result.moov_before_mdat = match (moov_pos, mdat_pos) {
        (Some(moov), Some(mdat)) => moov < mdat,
        (Some(_), None) => true,
        _ => false,
    };
    result.is_faststart =
        result.has_ftyp && result.has_moov && !result.is_fragmented && result.moov_before_mdat;
    result
}

pub fn probe_media_streams(ffmpeg: &Path, path: &Path) -> MediaStreamsInfo {
    let mut layout = inspect_mp4_layout(path);
    let mut info = MediaStreamsInfo {
        container: String::new(),
        video_codec: String::new(),
        pix_fmt: String::new(),
        audio_codec: String::new(),
        audio_state: Mp4AudioState::Missing,
        layout: layout.clone(),
    };
    let mut cmd = Command::new(ffmpeg);
    apply_no_window(&mut cmd);
    let Ok(out) = cmd.arg("-i").arg(path).output() else {
        return info;
    };
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stderr.lines() {
        let trimmed = line.trim_start();
        if info.container.is_empty() {
            if let Some(after) = trimmed.strip_prefix("Input #0,") {
                if let Some(from_idx) = after.find(" from ") {
                    info.container = after[..from_idx].trim().to_ascii_lowercase();
                }
            }
        }
        if info.video_codec.is_empty() {
            if let Some(v_pos) = line.find("Video:") {
                let parts = split_top_level_comma(line[v_pos + 6..].trim());
                if let Some(first) = parts.first() {
                    let codec: String = first
                        .to_ascii_lowercase()
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-'))
                        .collect();
                    if !codec.is_empty() {
                        info.video_codec = codec;
                    }
                }
                if let Some(second) = parts.get(1) {
                    let pix: String = second
                        .to_ascii_lowercase()
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                        .collect();
                    if !pix.is_empty() {
                        info.pix_fmt = pix;
                    }
                }
            }
        }
        if info.audio_codec.is_empty() {
            if let Some(a_pos) = line.find("Audio:") {
                let tail = line[a_pos + 6..].trim().to_ascii_lowercase();
                let codec: String = tail
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-'))
                    .collect();
                if !codec.is_empty() {
                    info.audio_state = if codec == "aac" {
                        Mp4AudioState::Aac
                    } else {
                        Mp4AudioState::NonAac
                    };
                    info.audio_codec = codec;
                }
            }
        }
    }
    if !layout.is_mp4 && (info.container.contains("mp4") || info.container.contains("mov")) {
        layout.is_mp4 = true;
    }
    info.layout = layout;
    info
}

fn run_ffmpeg_to_atomic_output<I, S>(
    ffmpeg: &Path,
    args: I,
    out_path: &Path,
    tag: &str,
    ext: &str,
    label: &str,
) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let temp_out = unique_temp_media_path_near(out_path, tag, ext);
    let mut cmd = Command::new(ffmpeg);
    apply_no_window(&mut cmd);
    let output = cmd
        .args(args)
        .arg(&temp_out)
        .output()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&temp_out);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.lines().rev().take(4).collect::<Vec<_>>().join(" | ");
        return Err(format!(
            "ffmpeg {label} exited with status {}: {tail}",
            output.status
        ));
    }
    let meta = fs::metadata(&temp_out).map_err(|e| {
        let _ = fs::remove_file(&temp_out);
        e.to_string()
    })?;
    if meta.len() == 0 {
        let _ = fs::remove_file(&temp_out);
        return Err(format!("ffmpeg {label} produced an empty output file."));
    }
    replace_file_atomically(&temp_out, out_path)?;
    Ok(())
}

fn paths_refer_to_same_file(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    if !b.exists() {
        return false;
    }
    matches!(
        (fs::canonicalize(a), fs::canonicalize(b)),
        (Ok(ca), Ok(cb)) if ca == cb
    )
}

pub fn mux_video_audio_ffmpeg_with_streams(
    ffmpeg: &Path,
    video_path: &Path,
    audio_path: &Path,
    out_path: &Path,
    preprobed_video: Option<&MediaStreamsInfo>,
) -> Result<(), String> {
    let owned_v;
    let v_streams = match preprobed_video {
        Some(s) => s,
        None => {
            owned_v = probe_media_streams(ffmpeg, video_path);
            &owned_v
        }
    };
    let a_streams = probe_media_streams(ffmpeg, audio_path);
    let video_ok = v_streams.video_codec == "h264" && v_streams.pix_fmt == "yuv420p";
    let audio_ok = a_streams.audio_state == Mp4AudioState::Aac;

    let mut args: Vec<std::ffi::OsString> = vec![
        "-y".into(),
        "-fflags".into(),
        "+genpts".into(),
        "-i".into(),
        video_path.as_os_str().to_os_string(),
        "-i".into(),
        audio_path.as_os_str().to_os_string(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "1:a:0".into(),
    ];
    if video_ok {
        args.extend(["-c:v".into(), "copy".into()]);
    } else {
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-crf".into(),
            "16".into(),
            "-preset".into(),
            "medium".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ]);
    }
    if audio_ok {
        args.extend(["-c:a".into(), "copy".into()]);
    } else {
        args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-ac".into(),
            "2".into(),
            "-ar".into(),
            "44100".into(),
        ]);
    }
    args.extend(["-shortest".into(), "-movflags".into(), "+faststart".into()]);
    run_ffmpeg_to_atomic_output(ffmpeg, args, out_path, "mux", "mp4", "muxing")
}

pub fn mux_video_audio_ffmpeg(
    ffmpeg: &Path,
    video_path: &Path,
    audio_path: &Path,
    out_path: &Path,
) -> Result<(), String> {
    mux_video_audio_ffmpeg_with_streams(ffmpeg, video_path, audio_path, out_path, None)
}

#[allow(dead_code)]
pub fn probe_mp4_audio_state(ffmpeg: &Path, path: &Path) -> Mp4AudioState {
    probe_media_streams(ffmpeg, path).audio_state
}

pub fn normalize_video_mp4_with_streams(
    ffmpeg: &Path,
    input_path: &Path,
    fallback_audio_path: Option<&Path>,
    out_path: &Path,
    preprobed: Option<&MediaStreamsInfo>,
) -> Result<Option<String>, String> {
    let owned;
    let streams = match preprobed {
        Some(s) => s,
        None => {
            owned = probe_media_streams(ffmpeg, input_path);
            &owned
        }
    };
    if streams.video_codec.is_empty() {
        return Err("The downloaded video contained no decodable video stream.".to_string());
    }
    if streams.audio_state == Mp4AudioState::Missing {
        if let Some(aud) = fallback_audio_path {
            mux_video_audio_ffmpeg_with_streams(ffmpeg, input_path, aud, out_path, Some(streams))?;
            return Ok(None);
        }
    }

    let video_ok = streams.video_codec == "h264" && streams.pix_fmt == "yuv420p";
    let has_audio = streams.audio_state != Mp4AudioState::Missing;
    let audio_ok = streams.audio_state == Mp4AudioState::Aac;
    let container_ok =
        streams.layout.is_mp4 && !streams.layout.is_fragmented && streams.layout.is_faststart;
    let warning = if has_audio {
        None
    } else {
        Some("This Instagram source video had no audio track in the stream.".to_string())
    };

    if video_ok && (audio_ok || !has_audio) && container_ok {
        if !paths_refer_to_same_file(input_path, out_path) {
            let temp_copy = unique_temp_media_path_near(out_path, "vcopy", "mp4");
            if let Err(err) = fs::copy(input_path, &temp_copy) {
                let _ = fs::remove_file(&temp_copy);
                return Err(err.to_string());
            }
            if let Err(err) = replace_file_atomically(&temp_copy, out_path) {
                let _ = fs::remove_file(&temp_copy);
                return Err(err);
            }
        }
        return Ok(warning);
    }

    let mut args: Vec<std::ffi::OsString> = vec![
        "-y".into(),
        "-fflags".into(),
        "+genpts".into(),
        "-i".into(),
        input_path.as_os_str().to_os_string(),
        "-map".into(),
        "0:v:0".into(),
    ];
    if has_audio {
        args.extend(["-map".into(), "0:a:0".into()]);
    }
    if video_ok {
        args.extend(["-c:v".into(), "copy".into()]);
    } else {
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-crf".into(),
            "16".into(),
            "-preset".into(),
            "medium".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ]);
    }
    if has_audio {
        if audio_ok {
            args.extend(["-c:a".into(), "copy".into()]);
        } else {
            args.extend([
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "192k".into(),
                "-ac".into(),
                "2".into(),
                "-ar".into(),
                "44100".into(),
            ]);
        }
    }
    args.extend(["-movflags".into(), "+faststart".into()]);
    run_ffmpeg_to_atomic_output(ffmpeg, args, out_path, "vnorm", "mp4", "normalization")?;
    Ok(warning)
}

pub fn normalize_video_mp4(
    ffmpeg: &Path,
    input_path: &Path,
    fallback_audio_path: Option<&Path>,
    out_path: &Path,
) -> Result<Option<String>, String> {
    normalize_video_mp4_with_streams(ffmpeg, input_path, fallback_audio_path, out_path, None)
}

#[allow(dead_code)]
pub fn transcode_mp4_audio_to_aac(ffmpeg: &Path, mp4_path: &Path) -> Result<(), String> {
    normalize_video_mp4(ffmpeg, mp4_path, None, mp4_path).map(|_| ())
}

/// Extracts or encodes an audio-only `.m4a` (AAC stereo 192 kbps) track from any video or audio file.
pub fn extract_audio_aac_m4a_ffmpeg_with_streams(
    ffmpeg: &Path,
    input_path: &Path,
    out_path: &Path,
    preprobed: Option<&MediaStreamsInfo>,
) -> Result<(), String> {
    let owned;
    let streams = match preprobed {
        Some(s) => s,
        None => {
            owned = probe_media_streams(ffmpeg, input_path);
            &owned
        }
    };
    let mut args: Vec<std::ffi::OsString> = vec![
        "-y".into(),
        "-fflags".into(),
        "+genpts".into(),
        "-i".into(),
        input_path.as_os_str().to_os_string(),
        "-vn".into(),
        "-map".into(),
        "0:a:0".into(),
    ];
    if streams.audio_state == Mp4AudioState::Aac && streams.layout.is_mp4 {
        args.extend(["-c:a".into(), "copy".into()]);
    } else {
        args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-ac".into(),
            "2".into(),
            "-ar".into(),
            "44100".into(),
        ]);
    }
    args.extend(["-movflags".into(), "+faststart".into()]);
    run_ffmpeg_to_atomic_output(ffmpeg, args, out_path, "m4a", "m4a", "audio extraction")
}

pub fn extract_audio_aac_m4a_ffmpeg(
    ffmpeg: &Path,
    input_path: &Path,
    out_path: &Path,
) -> Result<(), String> {
    extract_audio_aac_m4a_ffmpeg_with_streams(ffmpeg, input_path, out_path, None)
}

/// Ensures `mp4_path` is an unfragmented `+faststart` H.264 `yuv420p` + AAC `.mp4`.
#[allow(dead_code)]
pub fn ensure_mp4_aac_audio(
    ffmpeg: &Path,
    mp4_path: &Path,
    fallback_audio_path: Option<&Path>,
) -> Result<Option<String>, String> {
    normalize_video_mp4(ffmpeg, mp4_path, fallback_audio_path, mp4_path)
}

fn is_alpha_or_lossless_pix_fmt(pix_fmt: &str) -> bool {
    let lower = pix_fmt.to_ascii_lowercase();
    [
        "rgba", "bgra", "argb", "abgr", "yuva", "gbrap", "pal8", "ya8", "ya16",
    ]
    .iter()
    .any(|pat| lower.contains(pat))
}

pub fn normalize_image_file(
    ffmpeg: Option<&Path>,
    input_path: &Path,
    target_path: &Path,
) -> Result<PathBuf, String> {
    let head = read_file_head(input_path, 64)?;
    let detected = detect_image_format(&head).ok_or_else(|| {
        "Instagram returned a non-image response (expired link or login page).".to_string()
    })?;

    let passthrough = matches!(
        detected.kind,
        ImageFormatKind::Jpg | ImageFormatKind::Png | ImageFormatKind::Gif
    ) || ffmpeg.is_none();

    if passthrough {
        let final_path = replace_path_extension(target_path, detected.ext);
        if !paths_refer_to_same_file(input_path, &final_path) {
            let temp_copy = unique_temp_media_path_near(&final_path, "imgcopy", detected.ext);
            if let Err(err) = fs::copy(input_path, &temp_copy) {
                let _ = fs::remove_file(&temp_copy);
                return Err(err.to_string());
            }
            if let Err(err) = replace_file_atomically(&temp_copy, &final_path) {
                let _ = fs::remove_file(&temp_copy);
                return Err(err);
            }
        }
        return Ok(final_path);
    }

    let ff = ffmpeg.expect("checked above");
    let use_png = detected.is_lossless_or_alpha || {
        let streams = probe_media_streams(ff, input_path);
        is_alpha_or_lossless_pix_fmt(&streams.pix_fmt)
    };
    let out_ext = if use_png { "png" } else { "jpg" };
    let final_path = replace_path_extension(target_path, out_ext);
    let mut args: Vec<std::ffi::OsString> = vec![
        "-y".into(),
        "-i".into(),
        input_path.as_os_str().to_os_string(),
        "-frames:v".into(),
        "1".into(),
    ];
    if use_png {
        args.extend(["-c:v".into(), "png".into()]);
    } else {
        args.extend([
            "-c:v".into(),
            "mjpeg".into(),
            "-q:v".into(),
            "1".into(),
            "-qmin".into(),
            "1".into(),
        ]);
    }
    run_ffmpeg_to_atomic_output(
        ff,
        args,
        &final_path,
        "imgconv",
        out_ext,
        "image conversion",
    )?;
    Ok(final_path)
}

pub fn build_source_filename_stem(username: &str, taken_at: &str, shortcode: &str) -> String {
    let cleaned_user: String = username
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let user_part = cleaned_user.trim_matches(|c| c == '.' || c == '_');
    let user = if user_part.is_empty() {
        "instagram"
    } else {
        user_part
    };
    let user_capped: String = user.chars().take(40).collect();

    let date_digits: String = taken_at
        .chars()
        .take(10)
        .filter(|c| c.is_ascii_digit())
        .collect();
    let date_part = if date_digits.len() == 8 {
        date_digits
    } else {
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format_unix_iso_utc(now_secs)
            .chars()
            .take(10)
            .filter(|c| c.is_ascii_digit())
            .collect()
    };

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let seq = HASH_SEQ.fetch_add(1, Ordering::Relaxed);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in user_capped
        .as_bytes()
        .iter()
        .chain(shortcode.as_bytes().iter())
        .chain(nanos.to_le_bytes().iter())
        .chain(seq.to_le_bytes().iter())
    {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    let short_hash = format!("{:08x}", (hash ^ (hash >> 32)) as u32);
    format!("{user_capped}-{date_part}-{short_hash}")
}

pub fn format_caption_document(post: &InspectedPost) -> String {
    let mut lines = Vec::new();
    if !post.username.trim().is_empty() {
        lines.push(format!("Author: @{}", post.username.trim()));
    }
    if !post.post_url.trim().is_empty() {
        lines.push(format!("URL: {}", post.post_url.trim()));
    }
    if !post.taken_at.trim().is_empty() {
        lines.push(format!("Date: {}", post.taken_at.trim()));
    }
    if !lines.is_empty() {
        lines.push(String::new());
    }
    let body = post.caption.trim();
    lines.push(if body.is_empty() {
        "(No caption text available for this post)".to_string()
    } else {
        body.to_string()
    });
    lines.join("\n")
}

pub fn build_metadata_json(post: &InspectedPost) -> Result<String, String> {
    let payload = serde_json::json!({
        "shortcode": post.shortcode,
        "pk": post.pk,
        "username": post.username,
        "postUrl": post.post_url,
        "takenAt": post.taken_at,
        "caption": post.caption,
        "mediaCount": post.items.len(),
    });
    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
}

pub fn cookie_header_and_csrf_from_pairs(
    pairs: &[(String, String)],
) -> (Option<String>, Option<String>) {
    let mut seen = HashSet::new();
    let mut cookie_parts = Vec::new();
    let mut csrf = None;
    for (k, v) in pairs {
        let name: String = k
            .chars()
            .filter(|c| !matches!(c, '\r' | '\n' | '\0'))
            .collect();
        let val: String = v
            .chars()
            .filter(|c| !matches!(c, '\r' | '\n' | '\0'))
            .collect();
        if name.is_empty() || val.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        if name == "csrftoken" {
            csrf = Some(val.clone());
        }
        cookie_parts.push(format!("{name}={val}"));
    }
    let header = (!cookie_parts.is_empty()).then(|| cookie_parts.join("; "));
    (header, csrf)
}

fn escape_curl_config_header(header_name: &str, value: &str) -> Option<String> {
    let clean: String = value
        .chars()
        .filter(|&c| c != '\r' && c != '\n' && c != '\0')
        .collect();
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        return None;
    }
    let escaped = trimmed.replace('\\', "\\\\").replace('"', "\\\"");
    Some(format!("header = \"{header_name}: {escaped}\"\n"))
}

pub fn build_curl_stdin_headers(cookie_header: Option<&str>, csrf_token: Option<&str>) -> Vec<u8> {
    let mut buf = String::new();
    if let Some(cookie) = cookie_header {
        if let Some(line) = escape_curl_config_header("Cookie", cookie) {
            buf.push_str(&line);
        }
    }
    if let Some(csrf) = csrf_token {
        if let Some(line) = escape_curl_config_header("X-CSRFToken", csrf) {
            buf.push_str(&line);
        }
    }
    buf.into_bytes()
}

pub fn run_curl_with_auth_stdin(
    cmd: &mut Command,
    url: &str,
    cookie_header: Option<&str>,
    csrf_token: Option<&str>,
) -> std::io::Result<Output> {
    let send_auth = is_instagram_app_host(url);
    let config_bytes = if send_auth {
        build_curl_stdin_headers(cookie_header, csrf_token)
    } else {
        Vec::new()
    };
    if !config_bytes.is_empty() {
        cmd.args(["--config", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(&config_bytes);
        }
        return child.wait_with_output();
    }
    cmd.output()
}

pub fn run_curl_text(
    url: &str,
    cookie_header: Option<&str>,
    csrf_token: Option<&str>,
    post_form: Option<&[(&str, String)]>,
) -> Result<String, String> {
    if !is_safe_http_url(url) {
        return Err("Invalid Instagram URL.".to_string());
    }
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut cmd = Command::new(curl);
    apply_no_window(&mut cmd);
    cmd.args([
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
        &format!("X-IG-App-ID: {IG_APP_ID}"),
        "--header",
        "X-Requested-With: XMLHttpRequest",
    ]);
    if let Some(fields) = post_form {
        for (k, v) in fields {
            cmd.arg("--data-urlencode").arg(format!("{k}={v}"));
        }
    }
    cmd.arg(url);
    let output = run_curl_with_auth_stdin(&mut cmd, url, cookie_header, csrf_token)
        .map_err(|e| format!("Failed to invoke {curl}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("HTTP error ({url}): {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn json_indicates_multi_item_carousel(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            if map
                .get("carousel_media_count")
                .and_then(|v| v.as_u64())
                .is_some_and(|n| n > 1)
                || map.get("media_type").and_then(|v| v.as_u64()) == Some(8)
            {
                return true;
            }
            map.values().any(json_indicates_multi_item_carousel)
        }
        Value::Array(items) => items.iter().any(json_indicates_multi_item_carousel),
        _ => false,
    }
}

pub fn is_complete_seed_post(
    seed_json: &str,
    post: &InspectedPost,
    requested_shortcode: Option<&str>,
) -> bool {
    if post.username.trim().is_empty() || post.shortcode.trim().is_empty() || post.items.is_empty()
    {
        return false;
    }
    if let Some(sc) = requested_shortcode.map(str::trim).filter(|s| !s.is_empty()) {
        if !post.shortcode.eq_ignore_ascii_case(sc) {
            return false;
        }
    }
    if post.items.len() <= 1
        && (seed_json.contains("carousel_media_count") || seed_json.contains("\"media_type\":8"))
        && serde_json::from_str::<Value>(seed_json)
            .is_ok_and(|val| json_indicates_multi_item_carousel(&val))
    {
        return false;
    }
    post.items.iter().all(|item| {
        !item.formats.is_empty()
            && item
                .formats
                .iter()
                .all(|fmt| !fmt.video_url.trim().is_empty())
    })
}

pub fn inspect_via_http_cascade(
    url_or_shortcode: &str,
    cookie_header: Option<&str>,
    csrf_token: Option<&str>,
) -> Result<InspectedPost, String> {
    let shortcode = shortcode_from_url(url_or_shortcode)
        .ok_or_else(|| "Enter a valid Instagram Post or Reel URL or shortcode.".to_string())?;
    let has_ffmpeg = find_ffmpeg_binary().is_some();

    if let Some(media_id) = shortcode_to_media_id(&shortcode) {
        let info_url = format!("https://www.instagram.com/api/v1/media/{media_id}/info/");
        if let Ok(body) = run_curl_text(&info_url, cookie_header, csrf_token, None) {
            if let Some(post) = extract_post_from_json_text(&body, Some(&shortcode), has_ffmpeg) {
                return Ok(post);
            }
        }
    }

    let a1_url = format!("https://www.instagram.com/p/{shortcode}/?__a=1&__d=dis");
    if let Ok(body) = run_curl_text(&a1_url, cookie_header, csrf_token, None) {
        if let Some(post) = extract_post_from_json_text(&body, Some(&shortcode), has_ffmpeg) {
            return Ok(post);
        }
    }

    let gql_vars = serde_json::json!({ "shortcode": shortcode }).to_string();
    if let Ok(body) = run_curl_text(
        "https://www.instagram.com/api/graphql",
        cookie_header,
        csrf_token,
        Some(&[
            ("variables", gql_vars),
            ("doc_id", "8845758582119845".to_string()),
        ]),
    ) {
        if let Some(post) = extract_post_from_json_text(&body, Some(&shortcode), has_ffmpeg) {
            return Ok(post);
        }
    }

    let embed_url = format!("https://www.instagram.com/p/{shortcode}/embed/captioned/");
    if let Ok(html) = run_curl_text(&embed_url, cookie_header, csrf_token, None) {
        if let Some(post) = extract_post_from_html(&html, Some(&shortcode), has_ffmpeg) {
            return Ok(post);
        }
    }

    let page_url = if is_safe_http_url(url_or_shortcode) && is_instagram_app_host(url_or_shortcode)
    {
        url_or_shortcode.to_string()
    } else {
        format!("https://www.instagram.com/p/{shortcode}/")
    };
    if let Ok(html) = run_curl_text(&page_url, cookie_header, csrf_token, None) {
        if let Some(post) = extract_post_from_html(&html, Some(&shortcode), has_ffmpeg) {
            return Ok(post);
        }
    }

    Err("Instagram did not return playable media from direct endpoints.".to_string())
}

pub fn pick_richer_inspected_post(
    http_post: InspectedPost,
    mut seed_post: InspectedPost,
) -> InspectedPost {
    let same_shortcode = http_post.shortcode.is_empty()
        || seed_post.shortcode.is_empty()
        || http_post.shortcode == seed_post.shortcode;
    let seed_has_formats = seed_post.items.iter().any(|item| !item.formats.is_empty());
    if same_shortcode && seed_has_formats && seed_post.items.len() > http_post.items.len() {
        if seed_post.username.is_empty() && !http_post.username.is_empty() {
            seed_post.username = http_post.username;
        }
        if seed_post.caption.is_empty() && !http_post.caption.is_empty() {
            seed_post.caption = http_post.caption;
        }
        if seed_post.taken_at.is_empty() && !http_post.taken_at.is_empty() {
            seed_post.taken_at = http_post.taken_at;
        }
        return seed_post;
    }
    let http_is_sparse_fallback = http_post.username.is_empty() && http_post.items.len() <= 1;
    let seed_has_more_info = !seed_post.items.is_empty()
        && (!seed_post.username.is_empty()
            || seed_post.items.len() > http_post.items.len()
            || seed_post.items[0].formats.len()
                > http_post
                    .items
                    .first()
                    .map(|i| i.formats.len())
                    .unwrap_or(0));
    if same_shortcode && http_is_sparse_fallback && seed_has_more_info {
        seed_post
    } else {
        http_post
    }
}

pub fn unique_temp_media_path(tag: &str, ext: &str) -> PathBuf {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = HASH_SEQ.fetch_add(1, Ordering::Relaxed);
    env::temp_dir().join(format!("ignow-{tag}-{ts}-{seq}.{ext}"))
}

pub fn unique_temp_media_path_near(target: &Path, tag: &str, ext: &str) -> PathBuf {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = HASH_SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(env::temp_dir);
    dir.join(format!(".ignow-{tag}-{ts}-{seq}.{ext}"))
}

pub fn replace_file_atomically(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    if fs::rename(temp_path, target_path).is_ok() {
        return Ok(());
    }
    let backup = unique_temp_media_path_near(target_path, "bak", "tmp");
    let had_backup = target_path.exists() && fs::rename(target_path, &backup).is_ok();
    let res = match fs::rename(temp_path, target_path) {
        Ok(()) => Ok(()),
        Err(rename_err) => match fs::copy(temp_path, target_path) {
            Ok(_) => Ok(()),
            Err(copy_err) => Err(format!(
                "Failed to replace destination file ({rename_err}; {copy_err})"
            )),
        },
    };
    let _ = fs::remove_file(temp_path);
    if res.is_ok() {
        if had_backup {
            let _ = fs::remove_file(&backup);
        }
    } else if had_backup {
        let _ = fs::rename(&backup, target_path);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcode_and_media_id_roundtrip() {
        assert_eq!(
            shortcode_from_url("https://www.instagram.com/reel/C9xTokyoNight/?igsh=abc"),
            Some("C9xTokyoNight".to_string())
        );
        assert_eq!(
            shortcode_from_url("https://evil.example/p/C9xTokyoNight/"),
            None,
            "must reject non-Instagram URLs even if path contains /p/"
        );
        let id = shortcode_to_media_id("B_test123").expect("media id");
        assert_eq!(media_id_to_shortcode(&id), Some("B_test123".to_string()));
    }

    #[test]
    fn dash_manifest_separates_video_audio_and_decodes_entities() {
        let xml = r#"
        <MPD>
          <Period>
            <AdaptationSet contentType="video" mimeType="video/mp4">
              <Representation id="1" bandwidth="800000" width="720" height="1280" codecs="avc1.4d401f">
                <BaseURL>https://video.cdninstagram.com/v/720.mp4?a=1&amp;b=2</BaseURL>
              </Representation>
              <Representation id="2" bandwidth="2400000" width="1080" height="1920" codecs="avc1.64002a">
                <BaseURL>https://video.cdninstagram.com/v/1080.mp4?x=1&amp;bytestart=0&amp;byteend=100</BaseURL>
              </Representation>
            </AdaptationSet>
            <AdaptationSet contentType="audio" mimeType="audio/mp4">
              <Representation id="3" bandwidth="128000" codecs="mp4a.40.2">
                <BaseURL>https://video.cdninstagram.com/v/audio.m4a?a=1&amp;b=2</BaseURL>
              </Representation>
            </AdaptationSet>
          </Period>
        </MPD>"#;
        let (videos, audios) = parse_dash_manifest(xml);
        assert_eq!(videos.len(), 2);
        assert_eq!(audios.len(), 1);
        assert_eq!(videos[0].height, 1920);
        assert!(!videos[0].url.contains("bytestart="));
        assert_eq!(
            videos[1].url,
            "https://video.cdninstagram.com/v/720.mp4?a=1&b=2"
        );
        assert_eq!(
            audios[0].url,
            "https://video.cdninstagram.com/v/audio.m4a?a=1&b=2"
        );
    }

    #[test]
    fn json_extracts_formats_caption_and_respects_ffmpeg_priority() {
        let json = r#"{
          "items": [{
            "pk": "3456789012345678901",
            "code": "C9xTokyoNight",
            "taken_at": 1731700000,
            "user": { "username": "derinjapan1" },
            "caption": { "text": "Tokyo winter lights #night" },
            "video_versions": [
              { "url": "https://cdn.instagram.com/v/prog_720.mp4", "width": 720, "height": 1280 }
            ],
            "video_dash_manifest": "<MPD><Period><AdaptationSet mimeType=\"video/mp4\"><Representation bandwidth=\"3200000\" width=\"1080\" height=\"1920\"><BaseURL>https://cdn.instagram.com/v/dash_1080.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType=\"audio/mp4\"><Representation bandwidth=\"128000\"><BaseURL>https://cdn.instagram.com/v/dash_audio.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>"
          }]
        }"#;

        let with_ffmpeg =
            extract_post_from_json_text(json, Some("C9xTokyoNight"), true).expect("parsed");
        assert_eq!(with_ffmpeg.username, "derinjapan1");
        assert_eq!(with_ffmpeg.caption, "Tokyo winter lights #night");
        assert_eq!(with_ffmpeg.items[0].kind, "video");
        assert_eq!(with_ffmpeg.items[0].formats[0].height, 1920);
        assert!(with_ffmpeg.items[0].formats[0].requires_mux);
        assert_eq!(
            with_ffmpeg.items[0].formats[0].audio_url.as_deref(),
            Some("https://cdn.instagram.com/v/dash_audio.mp4")
        );

        let without_ffmpeg =
            extract_post_from_json_text(json, Some("C9xTokyoNight"), false).expect("parsed");
        assert_eq!(without_ffmpeg.items[0].formats[0].height, 1280);
        assert!(!without_ffmpeg.items[0].formats[0].requires_mux);
        assert_eq!(
            without_ffmpeg.items[0].formats[0].video_url,
            "https://cdn.instagram.com/v/prog_720.mp4"
        );
    }

    #[test]
    fn html_fallback_extracts_og_video_and_caption_and_rejects_unsafe_urls() {
        let unsafe_json = r#"{"items":[{"code":"Bad1","video_versions":[{"url":"javascript:alert(1)","width":720,"height":1280}]}]}"#;
        assert!(extract_post_from_json_text(unsafe_json, Some("Bad1"), true).is_none());

        let html = r#"<html><head>
          <meta property="og:video" content="https://cdn.instagram.com/v/embed_hd.mp4?k=1&amp;v=2" />
          <meta property="og:image" content="https://cdn.instagram.com/v/cover.jpg" />
          <meta property="og:description" content="Sample IG caption from embed" />
        </head><body></body></html>"#;
        let post = extract_post_from_html(html, Some("C9xEmbed1"), false).expect("html post");
        assert_eq!(post.items[0].kind, "video");
        assert_eq!(
            post.items[0].formats[0].video_url,
            "https://cdn.instagram.com/v/embed_hd.mp4?k=1&v=2"
        );
        assert_eq!(post.caption, "Sample IG caption from embed");
    }

    #[test]
    fn builds_caption_document_and_cookie_header() {
        let post = InspectedPost {
            shortcode: "C9xTokyoNight".to_string(),
            pk: "123".to_string(),
            username: "derinjapan1".to_string(),
            post_url: "https://www.instagram.com/p/C9xTokyoNight/".to_string(),
            taken_at: "2026-11-16T00:00:00Z".to_string(),
            caption: "Blue winter lights".to_string(),
            ffmpeg_available: false,
            items: vec![],
        };
        let doc = format_caption_document(&post);
        assert!(doc.contains("Author: @derinjapan1"));
        assert!(doc.contains("Blue winter lights"));

        let pairs = vec![
            ("sessionid".to_string(), "abc123\r\n".to_string()),
            ("csrftoken".to_string(), "tok999".to_string()),
            ("sessionid".to_string(), "dup".to_string()),
        ];
        let (header, csrf) = cookie_header_and_csrf_from_pairs(&pairs);
        assert_eq!(
            header.as_deref(),
            Some("sessionid=abc123; csrftoken=tok999")
        );
        assert_eq!(csrf.as_deref(), Some("tok999"));
    }

    #[test]
    fn probe_state_resolves_once_and_rejects_unknown_id() {
        let state = DownloaderProbeState::default();
        let (tx, mut rx) = oneshot::channel();
        state.register_probe("req-1".to_string(), tx);
        assert!(!state.resolve_probe("wrong", "nope".to_string()));
        assert!(state.resolve_probe("req-1", "{\"ok\":true}".to_string()));
        assert!(!state.resolve_probe("req-1", "second".to_string()));
        assert_eq!(rx.try_recv().ok().as_deref(), Some("{\"ok\":true}"));
    }

    #[test]
    fn builds_source_username_date_hash_filename_stem() {
        let s1 = build_source_filename_stem("derinjapan1", "2024-11-15T12:00:00Z", "C9xTokyoNight");
        let s2 = build_source_filename_stem("derinjapan1", "2024-11-15T12:00:00Z", "C9xTokyoNight");
        assert!(s1.starts_with("derinjapan1-20241115-"), "got: {s1}");
        let parts: Vec<&str> = s1.split('-').collect();
        assert_eq!(parts.len(), 3, "expected username-date-hash, got: {s1}");
        assert_eq!(parts[2].len(), 8);
        assert!(parts[2].chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(s1, s2, "consecutive downloads must receive distinct hashes");
    }

    #[test]
    fn dash_muxed_aac_beats_same_res_progressive_when_ffmpeg_available() {
        let json = r#"{
          "items": [{
            "pk": "3456789012345678901",
            "code": "C9xEqualRes",
            "taken_at": 1731700000,
            "user": { "username": "creator_hd" },
            "video_versions": [
              { "url": "https://cdn.instagram.com/v/prog_1080.mp4", "width": 1080, "height": 1920 }
            ],
            "video_dash_manifest": "<MPD><Period><AdaptationSet mimeType=\"video/mp4\"><Representation bandwidth=\"2400000\" width=\"1080\" height=\"1920\"><BaseURL>https://cdn.instagram.com/v/dash_1080.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType=\"audio/mp4\"><Representation bandwidth=\"128000\"><BaseURL>https://cdn.instagram.com/v/dash_audio.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>"
          }]
        }"#;
        let post = extract_post_from_json_text(json, Some("C9xEqualRes"), true).expect("parsed");
        assert!(
            post.items[0].formats[0].requires_mux,
            "DASH muxed+AAC must lead at equal resolution"
        );
        assert!(post.items[0].formats[0].label.contains("AAC"));
    }

    #[test]
    fn mux_video_audio_ffmpeg_produces_aac_audio_and_mp4() {
        let Some(ffmpeg) = find_ffmpeg_binary() else {
            return;
        };
        let vid = unique_temp_media_path("t-vid", "mp4");
        let aud = unique_temp_media_path("t-aud", "opus");
        let out = unique_temp_media_path("t-out", "mp4");

        let mut v_cmd = Command::new(&ffmpeg);
        apply_no_window(&mut v_cmd);
        let v_status = v_cmd
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.4",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&vid)
            .status()
            .expect("spawn ffmpeg test vid");
        let mut a_cmd = Command::new(&ffmpeg);
        apply_no_window(&mut a_cmd);
        let a_status = a_cmd
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.4",
                "-c:a",
                "libopus",
            ])
            .arg(&aud)
            .status()
            .expect("spawn ffmpeg test aud");
        if !v_status.success() || !a_status.success() {
            let _ = fs::remove_file(&vid);
            let _ = fs::remove_file(&aud);
            return;
        }

        let res = mux_video_audio_ffmpeg(&ffmpeg, &vid, &aud, &out);
        let probe_err = if res.is_ok() {
            let mut probe_cmd = Command::new(&ffmpeg);
            apply_no_window(&mut probe_cmd);
            let info = probe_cmd.arg("-i").arg(&out).output().expect("probe");
            String::from_utf8_lossy(&info.stderr).into_owned()
        } else {
            String::new()
        };
        let _ = fs::remove_file(&vid);
        let _ = fs::remove_file(&aud);
        let _ = fs::remove_file(&out);

        assert!(
            res.is_ok(),
            "mux with non-AAC opus audio -> AAC MP4 must succeed: {res:?}"
        );
        assert!(
            probe_err.contains("Video:"),
            "expected Video stream, got:\n{probe_err}"
        );
        assert!(
            probe_err.contains("Audio: aac"),
            "expected AAC audio stream, got:\n{probe_err}"
        );
    }

    #[test]
    fn extract_audio_aac_m4a_ffmpeg_strips_video_and_outputs_aac_m4a() {
        let Some(ffmpeg) = find_ffmpeg_binary() else {
            return;
        };
        let vid = unique_temp_media_path("t-av", "mp4");
        let out = unique_temp_media_path("t-m4a", "m4a");
        let mut cmd = Command::new(&ffmpeg);
        apply_no_window(&mut cmd);
        let status = cmd
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.4",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.4",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "libopus",
            ])
            .arg(&vid)
            .status()
            .expect("spawn ffmpeg av");
        if !status.success() {
            let _ = fs::remove_file(&vid);
            return;
        }
        let res = extract_audio_aac_m4a_ffmpeg(&ffmpeg, &vid, &out);
        let probe_err = if res.is_ok() {
            let mut probe_cmd = Command::new(&ffmpeg);
            apply_no_window(&mut probe_cmd);
            let info = probe_cmd.arg("-i").arg(&out).output().expect("probe m4a");
            String::from_utf8_lossy(&info.stderr).into_owned()
        } else {
            String::new()
        };
        let _ = fs::remove_file(&vid);
        let _ = fs::remove_file(&out);
        assert!(res.is_ok(), "audio-only extraction must succeed: {res:?}");
        assert!(probe_err.contains("Audio: aac"), "got:\n{probe_err}");
        assert!(!probe_err.contains("Video:"), "m4a must strip video stream");
    }

    #[test]
    fn pick_richer_post_prefers_seed_when_http_only_returned_sparse_og_fallback() {
        let og_http = InspectedPost {
            shortcode: "C9xCarousel".to_string(),
            pk: "123".to_string(),
            username: String::new(),
            post_url: "https://www.instagram.com/p/C9xCarousel/".to_string(),
            taken_at: String::new(),
            caption: "OG fallback".to_string(),
            ffmpeg_available: true,
            items: vec![MediaItemSpec {
                index: 0,
                kind: "image".to_string(),
                thumbnail_url: None,
                formats: vec![],
            }],
        };
        let rich_seed = InspectedPost {
            shortcode: "C9xCarousel".to_string(),
            pk: "123".to_string(),
            username: "creator_real".to_string(),
            post_url: "https://www.instagram.com/p/C9xCarousel/".to_string(),
            taken_at: "2026-11-16T00:00:00Z".to_string(),
            caption: "Full carousel caption".to_string(),
            ffmpeg_available: true,
            items: vec![
                MediaItemSpec {
                    index: 0,
                    kind: "video".to_string(),
                    thumbnail_url: None,
                    formats: vec![],
                },
                MediaItemSpec {
                    index: 1,
                    kind: "image".to_string(),
                    thumbnail_url: None,
                    formats: vec![],
                },
            ],
        };
        let picked = pick_richer_inspected_post(og_http.clone(), rich_seed.clone());
        assert_eq!(picked.username, "creator_real");
        assert_eq!(picked.items.len(), 2);

        let full_http = InspectedPost {
            username: "fresh_http_user".to_string(),
            ..og_http
        };
        let kept = pick_richer_inspected_post(full_http, rich_seed);
        assert_eq!(kept.username, "fresh_http_user");
    }

    #[test]
    fn graphql_image_carousel_extracts_all_slides_sorted_by_display_resources() {
        let json = r#"{
          "data": {
            "xdt_shortcode_media": {
              "id": "99887766",
              "shortcode": "C9xImgCarousel",
              "taken_at_timestamp": 1731700000,
              "owner": { "username": "sunnyleepoetry" },
              "edge_media_to_caption": {
                "edges": [{ "node": { "text": "Five poem cards" } }]
              },
              "edge_sidecar_to_children": {
                "edges": [
                  {
                    "node": {
                      "display_url": "https://cdn.instagram.com/v/slide1_fallback.jpg",
                      "display_resources": [
                        { "src": "https://cdn.instagram.com/v/slide1_640.jpg", "config_width": 640, "config_height": 800 },
                        { "src": "https://cdn.instagram.com/v/slide1_1080.jpg", "config_width": 1080, "config_height": 1350 }
                      ]
                    }
                  },
                  {
                    "node": {
                      "display_url": "https://cdn.instagram.com/v/slide2_only.jpg",
                      "dimensions": { "width": 1080, "height": 1080 }
                    }
                  }
                ]
              }
            }
          }
        }"#;
        let post = extract_post_from_json_text(json, Some("C9xImgCarousel"), false)
            .expect("graphql image carousel");
        assert_eq!(post.username, "sunnyleepoetry");
        assert_eq!(post.caption, "Five poem cards");
        assert_eq!(post.items.len(), 2);
        assert_eq!(post.items[0].kind, "image");
        assert_eq!(
            post.items[0].formats[0].video_url,
            "https://cdn.instagram.com/v/slide1_1080.jpg"
        );
        assert_eq!(post.items[0].formats[0].width, 1080);
        assert_eq!(post.items[0].formats[0].label, "1080x1350 JPG");
        assert_eq!(post.items[1].formats[0].width, 1080);
        assert_eq!(post.items[1].formats[0].height, 1080);
    }

    #[test]
    fn collab_post_falls_back_to_coauthor_username_and_parses_user_scoped_url() {
        assert_eq!(
            shortcode_from_url("https://www.instagram.com/alexaaubreypoetry/p/DCollab99/?igsh=1"),
            Some("DCollab99".to_string())
        );
        let json = r#"{
          "code": "DCollab99",
          "coauthor_producers": [{ "username": "alexaaubreypoetry" }, { "username": "poets" }],
          "image_versions2": {
            "candidates": [{ "url": "https://cdn.instagram.com/v/c1.jpg", "width": 1080, "height": 1350 }]
          }
        }"#;
        let post = extract_post_from_json_text(json, Some("DCollab99"), false).expect("collab");
        assert_eq!(post.username, "alexaaubreypoetry");
        assert_eq!(post.items.len(), 1);
    }

    #[test]
    fn handles_20_item_mixed_carousel_and_richer_seed_override() {
        let mut children = Vec::new();
        for idx in 1..=20 {
            if idx % 4 == 0 {
                children.push(serde_json::json!({
                    "pk": format!("900{idx}"),
                    "video_versions": [
                        { "url": format!("https://cdn.instagram.com/v/m-{idx}.mp4"), "width": 1080, "height": 1920 }
                    ],
                    "image_versions2": {
                        "candidates": [{ "url": format!("https://cdn.instagram.com/v/m-{idx}-thumb.jpg"), "width": 1080, "height": 1920 }]
                    }
                }));
            } else {
                children.push(serde_json::json!({
                    "pk": format!("900{idx}"),
                    "image_versions2": {
                        "candidates": [{ "url": format!("https://cdn.instagram.com/v/m-{idx}.jpg"), "width": 1080, "height": 1350 }]
                    }
                }));
            }
        }
        let payload = serde_json::json!({
            "items": [{
                "code": "D20MixRust",
                "pk": "55667788",
                "user": { "username": "gallery20" },
                "caption": { "text": "20-slide mixed test" },
                "carousel_media": children
            }]
        });
        let post = extract_post_from_json_text(&payload.to_string(), Some("D20MixRust"), true)
            .expect("20-item mixed carousel");
        assert_eq!(post.items.len(), 20);
        assert_eq!(post.items[0].kind, "image");
        assert_eq!(post.items[3].kind, "video");
        assert_eq!(post.items[19].kind, "video");

        // Even when an HTTP embed fallback brings a username and 1 item, a 20-item seed_post with valid formats must win!
        let embed_http = InspectedPost {
            shortcode: "D20MixRust".to_string(),
            pk: "55667788".to_string(),
            username: "gallery20".to_string(),
            post_url: "https://www.instagram.com/p/D20MixRust/".to_string(),
            taken_at: String::new(),
            caption: String::new(),
            ffmpeg_available: true,
            items: vec![post.items[0].clone()],
        };
        let picked = pick_richer_inspected_post(embed_http, post);
        assert_eq!(picked.items.len(), 20);
    }

    #[test]
    fn find_ffmpeg_resolves_extra_candidate_when_path_is_empty() {
        let temp_bin = unique_temp_media_path("ffmpeg-cand", "bin");
        fs::write(&temp_bin, b"dummy").expect("write dummy ffmpeg candidate");
        let resolved = find_ffmpeg_in_paths_and_candidates(None, &[temp_bin.clone()]);
        let _ = fs::remove_file(&temp_bin);
        assert_eq!(resolved, Some(temp_bin));
    }

    #[test]
    fn build_curl_stdin_headers_escapes_quotes_and_strips_control_chars() {
        let raw = build_curl_stdin_headers(
            Some("session=\"ab\\c\";\r\nurl = https://evil.test"),
            Some("csrf_123\n"),
        );
        let text = String::from_utf8(raw).expect("utf8 curl config");
        assert!(
            text.contains("header = \"Cookie: session=\\\"ab\\\\c\\\";url = https://evil.test\"")
        );
        assert!(text.contains("header = \"X-CSRFToken: csrf_123\""));
        assert_eq!(text.lines().count(), 2);
    }

    #[test]
    fn complete_seed_post_accepts_full_seed_and_rejects_sparse_or_unexpanded_carousel() {
        let full_seed = serde_json::json!({
            "items": [{
                "code": "DFullSeed1",
                "pk": "112233",
                "user": { "username": "creator" },
                "video_versions": [
                    { "url": "https://cdn.instagram.com/v/clip.mp4", "width": 720, "height": 1280 }
                ]
            }]
        })
        .to_string();
        let full_post =
            extract_post_from_json_text(&full_seed, Some("DFullSeed1"), true).expect("full seed");
        assert!(is_complete_seed_post(
            &full_seed,
            &full_post,
            Some("DFullSeed1")
        ));
        assert!(!is_complete_seed_post(
            &full_seed,
            &full_post,
            Some("DOther99")
        ));

        let mut no_user = full_post.clone();
        no_user.username.clear();
        assert!(!is_complete_seed_post(
            &full_seed,
            &no_user,
            Some("DFullSeed1")
        ));

        let stub_carousel_seed = serde_json::json!({
            "items": [{
                "code": "DStubCaro1",
                "pk": "445566",
                "user": { "username": "creator" },
                "carousel_media_count": 4,
                "image_versions2": {
                    "candidates": [{ "url": "https://cdn.instagram.com/v/cover.jpg", "width": 1080, "height": 1350 }]
                }
            }]
        })
        .to_string();
        let stub_post = extract_post_from_json_text(&stub_carousel_seed, Some("DStubCaro1"), true)
            .expect("stub carousel seed");
        assert!(!is_complete_seed_post(
            &stub_carousel_seed,
            &stub_post,
            Some("DStubCaro1")
        ));
    }

    #[test]
    fn replace_file_atomically_replaces_target_and_preserves_original_on_missing_temp() {
        let target = unique_temp_media_path("atom-target", "mp4");
        let temp = unique_temp_media_path_near(&target, "atom-src", "mp4");
        fs::write(&target, b"original-bytes").expect("write target");
        fs::write(&temp, b"updated-bytes").expect("write temp");

        replace_file_atomically(&temp, &target).expect("atomic replace must succeed");
        assert_eq!(fs::read(&target).expect("read replaced"), b"updated-bytes");
        assert!(!temp.exists(), "temp file must be removed after replace");

        let missing_temp = unique_temp_media_path_near(&target, "atom-missing", "mp4");
        assert!(replace_file_atomically(&missing_temp, &target).is_err());
        assert_eq!(
            fs::read(&target).expect("read preserved"),
            b"updated-bytes",
            "existing target must be restored if replacement fails"
        );
        let _ = fs::remove_file(&target);
    }

    #[test]
    fn codec_preference_prefers_h264_and_aac_at_equal_resolution() {
        assert!(video_codec_rank("avc1.64002a") > video_codec_rank("hev1.1.6.L120.90"));
        assert!(video_codec_rank("hev1.1.6.L120.90") > video_codec_rank(""));
        assert!(video_codec_rank("") > video_codec_rank("vp09.00.31.08"));
        assert!(video_codec_rank("vp09.00.31.08") > video_codec_rank("av01.0.05M.08"));
        assert!(audio_codec_rank("mp4a.40.2") > audio_codec_rank(""));
        assert!(audio_codec_rank("") > audio_codec_rank("ac-3"));
        assert!(audio_codec_rank("ac-3") > audio_codec_rank("opus"));

        let xml = r#"<MPD><Period>
          <AdaptationSet mimeType="video/mp4">
            <Representation codecs="av01.0.08M.08" bandwidth="3800000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/av1.mp4</BaseURL></Representation>
            <Representation codecs="vp09.00.40.08" bandwidth="3400000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/vp9.mp4</BaseURL></Representation>
            <Representation codecs="avc1.64002a" bandwidth="2200000" width="1080" height="1920"><BaseURL>https://cdn.instagram.com/v/h264.mp4</BaseURL></Representation>
          </AdaptationSet>
          <AdaptationSet mimeType="audio/mp4">
            <Representation codecs="opus" bandwidth="192000"><BaseURL>https://cdn.instagram.com/v/audio.opus</BaseURL></Representation>
            <Representation codecs="mp4a.40.2" bandwidth="128000"><BaseURL>https://cdn.instagram.com/v/audio.m4a</BaseURL></Representation>
          </AdaptationSet>
        </Period></MPD>"#;
        let (videos, audios) = parse_dash_manifest(xml);
        assert_eq!(videos[0].url, "https://cdn.instagram.com/v/h264.mp4");
        assert_eq!(audios[0].url, "https://cdn.instagram.com/v/audio.m4a");

        let json = serde_json::json!({
            "items": [{
                "code": "C9xCodecSort",
                "pk": "11223344",
                "user": { "username": "codec_user" },
                "video_versions": [
                    { "url": "https://cdn.instagram.com/v/prog_av1.mp4", "width": 1080, "height": 1920, "codecs": "av01.0.08M.08", "bandwidth": 3500000 },
                    { "url": "https://cdn.instagram.com/v/prog_avc.mp4", "width": 1080, "height": 1920, "codecs": "avc1.64002a", "bandwidth": 2000000 }
                ],
                "video_dash_manifest": xml
            }]
        })
        .to_string();
        let post = extract_post_from_json_text(&json, Some("C9xCodecSort"), true).expect("parsed");
        assert_eq!(
            post.items[0].formats[0].video_url,
            "https://cdn.instagram.com/v/h264.mp4"
        );
        assert_eq!(post.items[0].formats[0].codecs, "avc1.64002a");
    }

    #[test]
    fn video_header_and_mp4_layout_helpers_detect_webm_fragmented_and_faststart() {
        assert!(is_valid_webm_header(&[0x1a, 0x45, 0xdf, 0xa3, 0x9f]));
        assert!(!is_valid_download_video_header(
            &[0x1a, 0x45, 0xdf, 0xa3, 0x9f],
            false
        ));
        assert!(is_valid_download_video_header(
            &[0x1a, 0x45, 0xdf, 0xa3, 0x9f],
            true
        ));

        let fast = unique_temp_media_path("layout-fast", "mp4");
        let mut fast_bytes = Vec::new();
        fast_bytes.extend_from_slice(&20u32.to_be_bytes());
        fast_bytes.extend_from_slice(b"ftypisom\x00\x00\x02\x00isom");
        fast_bytes.extend_from_slice(&8u32.to_be_bytes());
        fast_bytes.extend_from_slice(b"moov");
        fast_bytes.extend_from_slice(&8u32.to_be_bytes());
        fast_bytes.extend_from_slice(b"mdat");
        fs::write(&fast, &fast_bytes).unwrap();
        let layout_fast = inspect_mp4_layout(&fast);
        let _ = fs::remove_file(&fast);
        assert!(layout_fast.is_mp4);
        assert!(layout_fast.is_faststart);
        assert!(!layout_fast.is_fragmented);

        let frag = unique_temp_media_path("layout-frag", "mp4");
        let mut frag_bytes = Vec::new();
        frag_bytes.extend_from_slice(&20u32.to_be_bytes());
        frag_bytes.extend_from_slice(b"ftypisom\x00\x00\x02\x00isom");
        frag_bytes.extend_from_slice(&8u32.to_be_bytes());
        frag_bytes.extend_from_slice(b"moov");
        frag_bytes.extend_from_slice(&8u32.to_be_bytes());
        frag_bytes.extend_from_slice(b"moof");
        fs::write(&frag, &frag_bytes).unwrap();
        let layout_frag = inspect_mp4_layout(&frag);
        let _ = fs::remove_file(&frag);
        assert!(layout_frag.is_fragmented);
        assert!(!layout_frag.is_faststart);
    }

    #[test]
    fn normalize_video_mp4_preserves_native_h264_aac_and_normalizes_late_moov_and_webm() {
        let Some(ffmpeg) = find_ffmpeg_binary() else {
            return;
        };
        let native = unique_temp_media_path("t-native", "mp4");
        let native_out = unique_temp_media_path("t-native-out", "mp4");
        let late = unique_temp_media_path("t-late", "mp4");
        let late_out = unique_temp_media_path("t-late-out", "mp4");
        let webm = unique_temp_media_path("t-webm", "webm");
        let webm_out = unique_temp_media_path("t-webm-out", "mp4");

        let mut c1 = Command::new(&ffmpeg);
        apply_no_window(&mut c1);
        let s1 = c1
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64:d=0.3",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ])
            .arg(&native)
            .status()
            .expect("native mp4");
        assert!(s1.success());

        let warn_native =
            normalize_video_mp4(&ffmpeg, &native, None, &native_out).expect("native passthrough");
        assert!(warn_native.is_none());
        assert_eq!(
            fs::read(&native).unwrap(),
            fs::read(&native_out).unwrap(),
            "native H.264 yuv420p + AAC + faststart must be preserved byte-for-byte"
        );

        let mut c2 = Command::new(&ffmpeg);
        apply_no_window(&mut c2);
        let s2 = c2
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=64x64:d=0.3",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=520:duration=0.3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
            ])
            .arg(&late)
            .status()
            .expect("late moov mp4");
        assert!(s2.success());
        assert!(!inspect_mp4_layout(&late).is_faststart);
        normalize_video_mp4(&ffmpeg, &late, None, &late_out).expect("remux faststart");
        let late_streams = probe_media_streams(&ffmpeg, &late_out);
        assert!(late_streams.layout.is_faststart);
        assert_eq!(late_streams.video_codec, "h264");
        assert_eq!(late_streams.audio_state, Mp4AudioState::Aac);

        let mut c3 = Command::new(&ffmpeg);
        apply_no_window(&mut c3);
        let s3 = c3
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=green:s=64x64:d=0.3",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=660:duration=0.3",
                "-c:v",
                "libvpx-vp9",
                "-c:a",
                "libopus",
            ])
            .arg(&webm)
            .status();
        if matches!(s3, Ok(st) if st.success()) {
            normalize_video_mp4(&ffmpeg, &webm, None, &webm_out).expect("normalize webm");
            let webm_streams = probe_media_streams(&ffmpeg, &webm_out);
            assert!(webm_streams.layout.is_faststart);
            assert!(!webm_streams.layout.is_fragmented);
            assert_eq!(webm_streams.video_codec, "h264");
            assert_eq!(webm_streams.pix_fmt, "yuv420p");
            assert_eq!(webm_streams.audio_state, Mp4AudioState::Aac);
        }

        for p in [native, native_out, late, late_out, webm, webm_out] {
            let _ = fs::remove_file(p);
        }
    }

    #[test]
    fn image_detection_and_normalization_handles_jpeg_png_webp_and_rejects_ftypisom() {
        assert_eq!(
            detect_image_format(b"\xFF\xD8\xFF\xE0\x00\x10JFIF").map(|f| f.kind),
            Some(ImageFormatKind::Jpg)
        );
        assert_eq!(
            detect_image_format(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0d").map(|f| f.kind),
            Some(ImageFormatKind::Png)
        );
        assert_eq!(
            detect_image_format(b"GIF89a\x01\x00\x01\x00").map(|f| f.kind),
            Some(ImageFormatKind::Gif)
        );
        let lossy_webp = detect_image_format(b"RIFF\x24\x00\x00\x00WEBPVP8 ").unwrap();
        assert_eq!(lossy_webp.kind, ImageFormatKind::Webp);
        assert!(!lossy_webp.is_lossless_or_alpha);
        let lossless_webp = detect_image_format(b"RIFF\x24\x00\x00\x00WEBPVP8L").unwrap();
        assert!(lossless_webp.is_lossless_or_alpha);
        assert_eq!(
            detect_image_format(b"\x00\x00\x00\x18ftypavif\x00\x00\x00\x00mif1").map(|f| f.kind),
            Some(ImageFormatKind::Avif)
        );
        assert!(
            detect_image_format(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isom").is_none(),
            "non-image MP4 ftypisom must be rejected"
        );
        assert_eq!(
            replace_path_extension(Path::new("dir/user.1-hash.jpg"), "png"),
            PathBuf::from("dir/user.1-hash.png")
        );

        let Some(ffmpeg) = find_ffmpeg_binary() else {
            return;
        };
        let src_png = unique_temp_media_path("t-img", "png");
        let src_webp = unique_temp_media_path("t-img", "webp");
        let src_alpha_webp = unique_temp_media_path("t-img-a", "webp");
        let target_jpg = unique_temp_media_path("t-img-target", "jpg");

        let mut cp = Command::new(&ffmpeg);
        apply_no_window(&mut cp);
        assert!(cp
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=orange:s=32x32:d=0.1",
                "-frames:v",
                "1"
            ])
            .arg(&src_png)
            .status()
            .unwrap()
            .success());

        let final_png = normalize_image_file(Some(&ffmpeg), &src_png, &target_jpg).unwrap();
        assert_eq!(final_png.extension().and_then(|e| e.to_str()), Some("png"));
        assert_eq!(fs::read(&src_png).unwrap(), fs::read(&final_png).unwrap());

        let mut cw = Command::new(&ffmpeg);
        apply_no_window(&mut cw);
        if matches!(
            cw.args(["-y", "-f", "lavfi", "-i", "color=c=blue:s=32x32:d=0.1", "-frames:v", "1"])
                .arg(&src_webp)
                .status(),
            Ok(st) if st.success()
        ) {
            let out_jpg = normalize_image_file(Some(&ffmpeg), &src_webp, &target_jpg).unwrap();
            assert_eq!(out_jpg.extension().and_then(|e| e.to_str()), Some("jpg"));
            assert_eq!(&fs::read(&out_jpg).unwrap()[0..3], &[0xff, 0xd8, 0xff]);
            let _ = fs::remove_file(out_jpg);
        }

        let mut cwa = Command::new(&ffmpeg);
        apply_no_window(&mut cwa);
        if matches!(
            cwa.args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue@0.5:s=32x32:d=0.1,format=rgba",
                "-frames:v",
                "1",
                "-lossless",
                "1",
            ])
            .arg(&src_alpha_webp)
            .status(),
            Ok(st) if st.success()
        ) {
            let out_png =
                normalize_image_file(Some(&ffmpeg), &src_alpha_webp, &target_jpg).unwrap();
            assert_eq!(out_png.extension().and_then(|e| e.to_str()), Some("png"));
            assert_eq!(&fs::read(&out_png).unwrap()[0..8], b"\x89PNG\r\n\x1a\n");
            let _ = fs::remove_file(out_png);
        }

        for p in [src_png, src_webp, src_alpha_webp, final_png, target_jpg] {
            let _ = fs::remove_file(p);
        }
    }

    #[test]
    fn normalize_video_mp4_with_streams_reuses_preprobed_metadata() {
        let Some(ffmpeg) = find_ffmpeg_binary() else {
            return;
        };
        let vid = unique_temp_media_path("t-preprobe", "mp4");
        let out = unique_temp_media_path("t-preprobe-out", "mp4");
        let mut c = Command::new(&ffmpeg);
        apply_no_window(&mut c);
        assert!(c
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.3",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ])
            .arg(&vid)
            .status()
            .unwrap()
            .success());
        let preprobed = probe_media_streams(&ffmpeg, &vid);
        let warn = normalize_video_mp4_with_streams(&ffmpeg, &vid, None, &out, Some(&preprobed))
            .expect("preprobed normalize");
        assert!(warn.is_none());
        assert_eq!(fs::read(&vid).unwrap(), fs::read(&out).unwrap());
        let _ = fs::remove_file(vid);
        let _ = fs::remove_file(out);
    }
}
