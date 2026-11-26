use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsStr,
    fs,
    io::Write,
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
            .then_with(|| b.bandwidth.cmp(&a.bandwidth))
    });
    audios.sort_by(|a, b| b.bandwidth.cmp(&a.bandwidth));
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
            push_unique_format(
                &mut formats,
                VideoFormat {
                    id: format!("prog-{idx}"),
                    label: format_resolution_label(width, height, " (Video + Audio)"),
                    width,
                    height,
                    bandwidth,
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
        if has_ffmpeg {
            // At equal resolution, prefer explicit DASH Video + AAC Audio muxing over raw progressive URLs
            // because some Instagram `video_versions` streams ship video-only at 1080p.
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

pub fn mux_video_audio_ffmpeg(
    ffmpeg: &Path,
    video_path: &Path,
    audio_path: &Path,
    out_path: &Path,
) -> Result<(), String> {
    let mut cmd = Command::new(ffmpeg);
    apply_no_window(&mut cmd);
    let output = cmd
        .args(["-y", "-fflags", "+genpts", "-i"])
        .arg(video_path)
        .arg("-i")
        .arg(audio_path)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-shortest",
            "-movflags",
            "+faststart",
        ])
        .arg(out_path)
        .output()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(out_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.lines().rev().take(4).collect::<Vec<_>>().join(" | ");
        return Err(format!(
            "ffmpeg exited with status {}: {tail}",
            output.status
        ));
    }
    let meta = fs::metadata(out_path).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        let _ = fs::remove_file(out_path);
        return Err("ffmpeg produced an empty MP4 output file.".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mp4AudioState {
    Aac,
    NonAac,
    Missing,
}

pub fn probe_mp4_audio_state(ffmpeg: &Path, path: &Path) -> Mp4AudioState {
    let mut cmd = Command::new(ffmpeg);
    apply_no_window(&mut cmd);
    let Ok(out) = cmd.arg("-i").arg(path).output() else {
        return Mp4AudioState::Missing;
    };
    let info = String::from_utf8_lossy(&out.stderr);
    for line in info.lines() {
        if let Some(pos) = line.find("Audio:") {
            let tail = line[pos + 6..].trim().to_ascii_lowercase();
            return if tail.starts_with("aac") {
                Mp4AudioState::Aac
            } else {
                Mp4AudioState::NonAac
            };
        }
    }
    Mp4AudioState::Missing
}

pub fn transcode_mp4_audio_to_aac(ffmpeg: &Path, mp4_path: &Path) -> Result<(), String> {
    let temp_out = unique_temp_media_path_near(mp4_path, "aacfix", "mp4");
    let mut cmd = Command::new(ffmpeg);
    apply_no_window(&mut cmd);
    let output = cmd
        .args(["-y", "-fflags", "+genpts", "-i"])
        .arg(mp4_path)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-movflags",
            "+faststart",
        ])
        .arg(&temp_out)
        .output()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&temp_out);
        return Err(format!("ffmpeg AAC conversion exited {}", output.status));
    }
    let meta = fs::metadata(&temp_out).map_err(|e| {
        let _ = fs::remove_file(&temp_out);
        e.to_string()
    })?;
    if meta.len() == 0 {
        let _ = fs::remove_file(&temp_out);
        return Err("ffmpeg AAC conversion produced an empty file.".to_string());
    }
    replace_file_atomically(&temp_out, mp4_path)?;
    Ok(())
}

/// Extracts or encodes an audio-only `.m4a` (AAC stereo 192 kbps) track from any video or audio file.
pub fn extract_audio_aac_m4a_ffmpeg(
    ffmpeg: &Path,
    input_path: &Path,
    out_path: &Path,
) -> Result<(), String> {
    let mut cmd = Command::new(ffmpeg);
    apply_no_window(&mut cmd);
    let output = cmd
        .args(["-y", "-fflags", "+genpts", "-i"])
        .arg(input_path)
        .args([
            "-vn",
            "-map",
            "0:a:0",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-movflags",
            "+faststart",
        ])
        .arg(out_path)
        .output()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(out_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.lines().rev().take(4).collect::<Vec<_>>().join(" | ");
        return Err(format!(
            "ffmpeg audio extraction exited with status {}: {tail}",
            output.status
        ));
    }
    let meta = fs::metadata(out_path).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        let _ = fs::remove_file(out_path);
        return Err("ffmpeg audio extraction produced an empty file.".to_string());
    }
    Ok(())
}

/// Ensures `mp4_path` contains a valid AAC audio track when possible:
/// - already AAC -> keeps as-is (`Ok(None)`)
/// - non-AAC audio -> remuxes + encodes AAC (`Ok(None)`)
/// - missing audio -> muxes `fallback_audio_path` as AAC if given, else warns
pub fn ensure_mp4_aac_audio(
    ffmpeg: &Path,
    mp4_path: &Path,
    fallback_audio_path: Option<&Path>,
) -> Result<Option<String>, String> {
    match probe_mp4_audio_state(ffmpeg, mp4_path) {
        Mp4AudioState::Aac => Ok(None),
        Mp4AudioState::NonAac => {
            transcode_mp4_audio_to_aac(ffmpeg, mp4_path)?;
            Ok(None)
        }
        Mp4AudioState::Missing => {
            if let Some(aud) = fallback_audio_path {
                let temp_out = unique_temp_media_path_near(mp4_path, "aacmux", "mp4");
                if let Err(err) = mux_video_audio_ffmpeg(ffmpeg, mp4_path, aud, &temp_out) {
                    let _ = fs::remove_file(&temp_out);
                    return Err(err);
                }
                replace_file_atomically(&temp_out, mp4_path)?;
                return Ok(None);
            }
            Ok(Some(
                "This Instagram source video had no audio track in the stream.".to_string(),
            ))
        }
    }
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

        let v_status = Command::new(&ffmpeg)
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
        let a_status = Command::new(&ffmpeg)
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
            let info = Command::new(&ffmpeg)
                .arg("-i")
                .arg(&out)
                .output()
                .expect("probe");
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
        let status = Command::new(&ffmpeg)
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
            let info = Command::new(&ffmpeg)
                .arg("-i")
                .arg(&out)
                .output()
                .expect("probe m4a");
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
}
