// IG-Now — High-Performance Desktop Client for Instagram
// Sole Author & Creator: Benedictus Reynaldo Hartanto (@benedictusrey)
// Repository: https://github.com/benedictusrey/IG-Now
// All rights reserved. See LICENSE for details.

mod about_logo;
#[cfg(windows)]
mod audio;
mod downloader;
mod notifications;
mod tray;

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{utils::config::Color, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

const INSTAGRAM_WINDOW_LABEL: &str = "instagram";
const DOWNLOADER_WINDOW_LABEL: &str = "downloader";
const INSTAGRAM_HELPER_SCRIPT: &str = include_str!("../../frontend/instagram-tools.js");
const DIRECT_MESSAGES_SCRIPT: &str = include_str!("../../frontend/direct-messages.js");

/// Default window geometry (logical px): 1588 x 1025, launched centered in the
/// monitor's work area (screen minus the top system bar and the bottom
/// taskbar) so it never opens clipped on either edge.
const DEFAULT_WINDOW_WIDTH: f64 = 1588.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 1025.0;
/// Hard minimum, enforced by the builder's `min_inner_size` as well.
const MIN_WINDOW_WIDTH: f64 = 900.0;
const MIN_WINDOW_HEIGHT: f64 = 680.0;
/// Standalone Downloader window default geometry (logical px): sized so all
/// controls fit on a single screen without scrolling the outer UI, while the
/// caption textarea scrolls internally.
const DOWNLOADER_WINDOW_WIDTH: f64 = 765.0;
const DOWNLOADER_WINDOW_HEIGHT: f64 = 885.0;
const DOWNLOADER_MIN_WIDTH: f64 = 580.0;
const DOWNLOADER_MIN_HEIGHT: f64 = 620.0;

#[derive(Debug, Clone, Copy, PartialEq)]
struct WorkAreaFrame {
    target_width: f64,
    target_height: f64,
    outer_x: i32,
    outer_y: i32,
}

#[allow(clippy::too_many_arguments)]
fn compute_centered_work_area_frame(
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    overhead_width: u32,
    overhead_height: u32,
    scale: f64,
    default_width: f64,
    default_height: f64,
    min_width: f64,
    min_height: f64,
) -> WorkAreaFrame {
    let safe_scale = if scale > 0.0 { scale } else { 1.0 };
    let max_inner_width = ((work_width as f64 - overhead_width as f64) / safe_scale).max(0.0);
    let max_inner_height = ((work_height as f64 - overhead_height as f64) / safe_scale).max(0.0);
    let target_width = default_width.min(max_inner_width).max(min_width);
    let target_height = default_height.min(max_inner_height).max(min_height);
    let expected_outer_w = (target_width * safe_scale).round() + overhead_width as f64;
    let expected_outer_h = (target_height * safe_scale).round() + overhead_height as f64;
    let outer_x = work_x + (((work_width as f64 - expected_outer_w).max(0.0)) / 2.0).floor() as i32;
    let outer_y =
        work_y + (((work_height as f64 - expected_outer_h).max(0.0)) / 2.0).floor() as i32;
    WorkAreaFrame {
        target_width,
        target_height,
        outer_x,
        outer_y,
    }
}

fn is_window_hidden_state(minimized: Option<bool>, visible: Option<bool>) -> bool {
    minimized.unwrap_or(false) || !visible.unwrap_or(false)
}

fn is_wayland_session() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
}

/// Clamp the window to the target monitor's WORK AREA (excludes the taskbar and
/// any top system bar) and center it there. Uses live `outer_size` when no
/// resize was issued, and `frame.outer_x`/`outer_y` after resizing so Win32
/// async resize latency cannot leave the window off-center.
fn fit_window_to_work_area_on_monitor(
    window: &tauri::WebviewWindow,
    anchor_monitor: Option<tauri::Monitor>,
    default_width: f64,
    default_height: f64,
    min_width: f64,
    min_height: f64,
) {
    let Ok(inner) = window.inner_size() else {
        return;
    };
    let Ok(outer) = window.outer_size() else {
        return;
    };
    let Some(monitor) = anchor_monitor
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();

    // Decoration overhead (title bar + borders) in physical pixels.
    let overhead_width = outer.width.saturating_sub(inner.width);
    let overhead_height = outer.height.saturating_sub(inner.height);

    let frame = compute_centered_work_area_frame(
        work.position.x,
        work.position.y,
        work.size.width,
        work.size.height,
        overhead_width,
        overhead_height,
        scale,
        default_width,
        default_height,
        min_width,
        min_height,
    );

    let current_width = inner.width as f64 / scale;
    let current_height = inner.height as f64 / scale;
    let needs_resize = (current_width - frame.target_width).abs() > 0.5
        || (current_height - frame.target_height).abs() > 0.5;
    if needs_resize {
        let _ = window.set_size(tauri::LogicalSize::new(
            frame.target_width,
            frame.target_height,
        ));
    }

    // Wayland compositors manage window placement and reject/ignore client positioning.
    if is_wayland_session() {
        return;
    }

    if !needs_resize {
        if let Ok(final_outer) = window.outer_size() {
            let x = work.position.x
                + (((work.size.width as f64 - final_outer.width as f64).max(0.0)) / 2.0).floor()
                    as i32;
            let y = work.position.y
                + (((work.size.height as f64 - final_outer.height as f64).max(0.0)) / 2.0).floor()
                    as i32;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
            return;
        }
    }
    let _ = window.set_position(tauri::PhysicalPosition::new(frame.outer_x, frame.outer_y));
}

fn fit_window_to_work_area(window: &tauri::WebviewWindow) {
    fit_window_to_work_area_on_monitor(
        window,
        None,
        DEFAULT_WINDOW_WIDTH,
        DEFAULT_WINDOW_HEIGHT,
        MIN_WINDOW_WIDTH,
        MIN_WINDOW_HEIGHT,
    );
}

/// Guards the playback watchdog so it is spawned exactly once per process,
/// no matter how many times the Instagram window is (re)launched.
static WATCHDOG_STARTED: AtomicBool = AtomicBool::new(false);
static INITIAL_GEOMETRY_APPLIED: AtomicBool = AtomicBool::new(false);

fn instagram_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    // Keep the existing Personal WebView2 data directory so removing the
    // profile manager does not sign the current Instagram session out.
    app.path()
        .app_data_dir()
        .map(|path| path.join("profiles").join("profile-personal"))
        .map_err(|error| error.to_string())
}

fn is_safe_http_url(url: &str) -> bool {
    downloader::is_safe_http_url(url)
}

/// JS that pauses everything via the page helpers and returns a diagnostics report.
const PAUSE_JS: &str = r#"(function(){
    if (window.__onWindowHidden) window.__onWindowHidden();
    return window.__ignowPauseReport ? window.__ignowPauseReport() : 'no-report';
})()"#;

/// JS that returns the current page-state diagnostics (for re-checks).
/// NOTE: must be an IIFE — WebView2's ExecuteScript rejects top-level `return`.
const REPORT_JS: &str = r#"(function(){
    // Pick the AUDIBLE video: the tools' active video, else the first
    // currently-playing one, else the first video element. Sampling only the
    // first element was misleading — Instagram preloads neighbor videos, and
    // the first element may not be the one that is actually playing.
    var _pickVideo = function() {
        var v = (window.__ignowActiveVideo && window.__ignowActiveVideo()) || null;
        if (!v) {
            var vs = document.querySelectorAll('video');
            for (var i = 0; i < vs.length; i++) { if (!vs[i].paused) { v = vs[i]; break; } }
            v = v || vs[0] || null;
        }
        return v;
    };
    return JSON.stringify({
        url: location.href,
        title: document.title,
        ready: document.readyState,
        hasPause: typeof window.__onWindowHidden,
        hasResume: typeof window.__resumeIfNeeded,
        hasReport: typeof window.__ignowPauseReport,
        hasToast: typeof window.showToast,
        media: document.querySelectorAll('video, audio').length,
        mediaMuted: (function(){ var v = _pickVideo(); return v ? v.muted : null; })(),
        mediaVolume: (function(){ var v = _pickVideo(); return v ? v.volume : null; })(),
        mediaPaused: (function(){ var v = _pickVideo(); return v ? v.paused : null; })()
    });
})()"#;

/// Guards the 2.5 s pause re-check so at most ONE runs at a time. The old
/// per-call detached thread piled up threads on rapid minimize/restore
/// cycles (v2.1.0 perf fix).
static PAUSE_RECHECK_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Pause playback when the window becomes hidden/minimized. Layered:
/// page-side pause (in `__onWindowHidden`), then a hard mute of this app's
/// Windows audio sessions as a guarantee.
fn pause_media_for_hidden(w: &tauri::WebviewWindow) {
    let _ = w.eval_with_callback(PAUSE_JS, |report| {
        eprintln!("[IG-Now] Watchdog pause report: {}", report);
    });
    // Re-check a moment later: if the player engine re-played it, the report
    // will show it (and the OS-level session mute still guarantees silence).
    // Skipped when another re-check is already pending — transitions fire
    // faster than the 2.5 s window on rapid minimize/restore cycles.
    if !PAUSE_RECHECK_IN_FLIGHT.swap(true, Ordering::Relaxed) {
        let w2 = w.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(2500));
            let _ = w2.eval_with_callback(REPORT_JS, |report| {
                eprintln!("[IG-Now] Watchdog recheck: {}", report);
            });
            PAUSE_RECHECK_IN_FLIGHT.store(false, Ordering::Relaxed);
        });
    }
    #[cfg(windows)]
    if audio::set_app_audio_mute(true) {
        eprintln!("[IG-Now] Watchdog: audio sessions muted");
    } else {
        eprintln!("[IG-Now] Watchdog: no audio session found to mute");
    }
}

/// Resume playback when the window becomes visible again.
fn resume_media_for_visible(w: &tauri::WebviewWindow) {
    let _ = w.eval("if (window.__resumeIfNeeded) window.__resumeIfNeeded();");
    let _ = w.eval_with_callback(REPORT_JS, |report| {
        eprintln!("[IG-Now] Watchdog visible report: {}", report);
    });
    #[cfg(windows)]
    if audio::set_app_audio_mute(false) {
        eprintln!("[IG-Now] Watchdog: audio sessions unmuted");
    }
}

/// Playback watchdog for the Instagram window.
///
/// Some WebView2/WebKit builds never fire `visibilitychange` (or a resize
/// event) for a minimized window, so the page would keep playing audio in the
/// background. This thread polls the REAL window state and drives the page
/// helpers on every hidden/visible transition. Cheap: two state reads every
/// 800 ms, and the page eval only runs on a state CHANGE.
fn watch_instagram_window(w: tauri::WebviewWindow) {
    // Keep one grouped "IG-Now" audio session registered across active render
    // endpoints so Windows Volume Mixer recognizes "IG-Now" cleanly.
    #[cfg(windows)]
    let mut _audio_keepalive = audio::register_app_sessions();
    #[cfg(windows)]
    let mut last_endpoints = audio::active_render_endpoint_ids();

    // Treat unsupported `is_minimized` queries (e.g. Wayland) as not minimized;
    // visibility is still checked via `!is_visible()`.
    let state_hidden = || is_window_hidden_state(w.is_minimized().ok(), w.is_visible().ok());
    let mut last_hidden = state_hidden();
    #[cfg(windows)]
    let mut last_foreground = !last_hidden && w.is_focused().unwrap_or(false);
    let mut startup_ticks = 0u32;
    let mut startup_reported = false;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(800));
        if w.app_handle()
            .get_webview_window(INSTAGRAM_WINDOW_LABEL)
            .is_none()
        {
            break;
        }
        let hidden = state_hidden();
        // While focused in foreground on Windows, refresh sessions on device
        // hotplug and keep IG-Now audio sessions branded and unmuted.
        #[cfg(windows)]
        {
            let in_foreground = !hidden && w.is_focused().unwrap_or(false);
            let endpoints = audio::active_render_endpoint_ids();
            if endpoints != last_endpoints {
                _audio_keepalive = audio::register_app_sessions_with_mute(hidden);
                last_endpoints = endpoints;
            }
            if in_foreground && audio::ensure_foreground_audio_ready() {
                eprintln!("[IG-Now] Watchdog: foreground audio session unmuted");
            }
            if in_foreground && !last_foreground {
                let _ = w.eval(
                    "if (window.__ignowEnsureForegroundAudio) window.__ignowEnsureForegroundAudio();",
                );
            }
            last_foreground = in_foreground;
        }
        if hidden && !last_hidden {
            eprintln!("[IG-Now] Watchdog: window hidden -> pausing media");
            pause_media_for_hidden(&w);
        } else if !hidden && last_hidden {
            eprintln!("[IG-Now] Watchdog: window visible -> resuming media");
            resume_media_for_visible(&w);
        }
        last_hidden = hidden;
        // Cold-start diagnostic: ~20 s after launch, with no hidden/visible
        // transition yet, dump the TRUE fresh-launch page state (muted?
        // volume?) — the E2E evidence that the startup audio defaults hold
        // BEFORE any minimize/restore cycle.
        if !startup_reported {
            if hidden {
                startup_reported = true; // a transition happened first; skip
            } else {
                startup_ticks += 1;
                if startup_ticks >= 25 {
                    startup_reported = true;
                    let _ = w.eval_with_callback(REPORT_JS, |report| {
                        eprintln!("[IG-Now] Watchdog startup report: {}", report);
                    });
                    // OS-level evidence: session mute + master volume.
                    #[cfg(windows)]
                    audio::report_audio_state();
                }
            }
        }
    }
}

pub fn launch_instagram_internal(app: &AppHandle, start_minimized: bool) -> Result<(), String> {
    let profile_data_dir = instagram_data_directory(app)?;
    fs::create_dir_all(&profile_data_dir).map_err(|error| error.to_string())?;

    if let Some(window) = app.get_webview_window(INSTAGRAM_WINDOW_LABEL) {
        // Autostart (`--minimized`) never pops a window over the user's work.
        if !start_minimized {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        return Ok(());
    }

    // On Linux/Wayland, creating a GTK window hidden and calling `.show()` later
    // can freeze native decorations/input mapping; show immediately unless `--minimized`.
    let start_visible_now = !start_minimized && cfg!(target_os = "linux");

    let browser_app = app.clone();
    let window = WebviewWindowBuilder::new(
        app,
        INSTAGRAM_WINDOW_LABEL,
        WebviewUrl::External("https://www.instagram.com/".parse().unwrap()),
    )
    .title("IG-Now")
    .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
    .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    .resizable(true)
    .center()
    // Anti-flash: the webview paints Instagram's near-black from the first
    // frame instead of white, and on Windows/macOS the window is only shown
    // once the page finishes loading (on_page_load below).
    .background_color(Color(18, 18, 18, 255))
    .visible(start_visible_now)
    .data_directory(profile_data_dir)
    .initialization_script(DIRECT_MESSAGES_SCRIPT)
    .initialization_script(INSTAGRAM_HELPER_SCRIPT)
    .on_page_load(move |window, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Finished && !start_minimized {
            if !INITIAL_GEOMETRY_APPLIED.swap(true, Ordering::Relaxed) {
                fit_window_to_work_area(&window);
            }
            if !start_visible_now {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
            #[cfg(windows)]
            let _ = audio::ensure_foreground_audio_ready();
            let _ = window.eval(
                "if (window.__ignowEnsureForegroundAudio) window.__ignowEnsureForegroundAudio();",
            );
        }
    })
    .on_new_window(move |url, _features| {
        if let Err(error) = open_external_url(browser_app.clone(), url.to_string()) {
            eprintln!("[IG-Now] Failed to open a link in the default browser: {error}");
        }
        tauri::webview::NewWindowResponse::Deny
    })
    .on_navigation(|_| true)
    .build()
    .map_err(|error| error.to_string())?;

    // Paint-ready show: `on_page_load` (builder above) reveals the window
    // only once the page has finished loading, killing the launch flash.
    // This fallback guarantees the window still appears if a page never
    // reaches load-finished (offline start, stalled navigation).
    if !start_minimized && !start_visible_now {
        let fallback = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(8));
            if !fallback.is_visible().unwrap_or(true) {
                if !INITIAL_GEOMETRY_APPLIED.swap(true, Ordering::Relaxed) {
                    fit_window_to_work_area(&fallback);
                }
                let _ = fallback.show();
                let _ = fallback.set_focus();
            }
        });
    }

    // 1588x1025 default, clamped to the work area and centered between the
    // top system bar and the bottom taskbar (also applied for the
    // autostart-hidden case so restoring shows the right geometry).
    fit_window_to_work_area(&window);

    // Start the playback watchdog exactly once for this window. It polls the
    // REAL window state (minimized/visible) and applies the layered pause /
    // resume on transitions, plus the Windows session unmute retry.
    if !WATCHDOG_STARTED.swap(true, Ordering::Relaxed) {
        let w = window.clone();
        std::thread::spawn(move || watch_instagram_window(w));
    }

    Ok(())
}

#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    if !is_safe_http_url(&url) {
        return Err("Only safe HTTP(S) URLs can be opened externally.".to_string());
    }

    app.shell()
        .open(url, None)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn prepare_download_folder(app: AppHandle) -> Result<String, String> {
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?
        .join("IG-Now");
    fs::create_dir_all(&download_dir).map_err(|error| error.to_string())?;
    Ok(download_dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_downloads_folder(app: AppHandle) -> Result<(), String> {
    let path = prepare_download_folder(app.clone())?;
    app.shell().open(path, None).map_err(|e| e.to_string())
}

pub fn open_downloader_window_internal(
    app: &AppHandle,
    url: Option<String>,
    payload_json: Option<String>,
    slide_index: Option<usize>,
    slide_hint: Option<String>,
) -> Result<(), String> {
    let clean_url = url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let clean_payload = payload_json
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let clean_slide_hint = slide_hint
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if clean_url.is_some()
        || clean_payload.is_some()
        || slide_index.is_some()
        || clean_slide_hint.is_some()
    {
        let probe_state = app.state::<downloader::DownloaderProbeState>();
        probe_state.set_pending_open(Some(downloader::PendingDownloadOpen {
            url: clean_url.unwrap_or_default(),
            payload_json: clean_payload,
            slide_index,
            slide_hint: clean_slide_hint,
        }));
    }

    let ig_monitor = app
        .get_webview_window(INSTAGRAM_WINDOW_LABEL)
        .and_then(|ig| ig.current_monitor().ok().flatten());

    if let Some(window) = app.get_webview_window(DOWNLOADER_WINDOW_LABEL) {
        let hidden_or_min =
            !window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false);
        let _ = window.unminimize();
        if hidden_or_min {
            fit_window_to_work_area_on_monitor(
                &window,
                ig_monitor,
                DOWNLOADER_WINDOW_WIDTH,
                DOWNLOADER_WINDOW_HEIGHT,
                DOWNLOADER_MIN_WIDTH,
                DOWNLOADER_MIN_HEIGHT,
            );
        }
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval(
            "if (window.__ignowLoadDownloaderContext) window.__ignowLoadDownloaderContext();",
        );
        return Ok(());
    }

    let dl_visible_now = cfg!(target_os = "linux");
    let dl_win = WebviewWindowBuilder::new(
        app,
        DOWNLOADER_WINDOW_LABEL,
        WebviewUrl::App("downloader.html".into()),
    )
    .title("IG-Now Downloader")
    .inner_size(DOWNLOADER_WINDOW_WIDTH, DOWNLOADER_WINDOW_HEIGHT)
    .min_inner_size(DOWNLOADER_MIN_WIDTH, DOWNLOADER_MIN_HEIGHT)
    .resizable(true)
    .visible(dl_visible_now)
    .background_color(Color(17, 19, 24, 255))
    .build()
    .map_err(|error| error.to_string())?;
    fit_window_to_work_area_on_monitor(
        &dl_win,
        ig_monitor,
        DOWNLOADER_WINDOW_WIDTH,
        DOWNLOADER_WINDOW_HEIGHT,
        DOWNLOADER_MIN_WIDTH,
        DOWNLOADER_MIN_HEIGHT,
    );
    if !dl_visible_now {
        let _ = dl_win.show();
        let _ = dl_win.set_focus();
    }

    Ok(())
}

#[tauri::command]
async fn open_downloader_window(
    app: AppHandle,
    url: Option<String>,
    payload_json: Option<String>,
    slide_index: Option<usize>,
    slide_hint: Option<String>,
) -> Result<(), String> {
    open_downloader_window_internal(&app, url, payload_json, slide_index, slide_hint)
}

#[tauri::command]
fn take_pending_downloader_context(
    state: tauri::State<'_, downloader::DownloaderProbeState>,
) -> Option<downloader::PendingDownloadOpen> {
    state.take_pending_open()
}

#[tauri::command]
fn submit_downloader_probe(
    state: tauri::State<'_, downloader::DownloaderProbeState>,
    request_id: String,
    payload_json: String,
) -> bool {
    state.resolve_probe(&request_id, payload_json)
}

fn merge_cookie_fallback(
    webview_pairs: Vec<(String, String)>,
    fallback_cookie: Option<&str>,
) -> (Option<String>, Option<String>) {
    let (header, csrf) = downloader::cookie_header_and_csrf_from_pairs(&webview_pairs);
    if header.is_some() {
        return (header, csrf);
    }
    let clean_fallback = fallback_cookie
        .map(sanitize_header_value)
        .filter(|s| !s.is_empty());
    (clean_fallback, None)
}

fn instagram_auth_headers(
    app: &AppHandle,
    fallback_cookie: Option<&str>,
) -> (Option<String>, Option<String>) {
    let mut pairs = Vec::new();
    if let Some(win) = app.get_webview_window(INSTAGRAM_WINDOW_LABEL) {
        if let Ok(ig_url) = "https://www.instagram.com/".parse() {
            if let Ok(cookies) = win.cookies_for_url(ig_url) {
                for cookie in cookies {
                    pairs.push((cookie.name().to_string(), cookie.value().to_string()));
                }
            }
        }
    }
    merge_cookie_fallback(pairs, fallback_cookie)
}

fn sanitize_path_segment(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == '_');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        String::new()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn media_extension(media_type: &str) -> &'static str {
    if media_type.eq_ignore_ascii_case("video") {
        "mp4"
    } else if media_type.eq_ignore_ascii_case("audio")
        || media_type.eq_ignore_ascii_case("audio-m4a")
    {
        "m4a"
    } else if media_type.eq_ignore_ascii_case("mp3") || media_type.eq_ignore_ascii_case("audio-mp3")
    {
        "mp3"
    } else if media_type.eq_ignore_ascii_case("text") || media_type.eq_ignore_ascii_case("caption")
    {
        "txt"
    } else if media_type.eq_ignore_ascii_case("json") {
        "json"
    } else {
        "jpg"
    }
}

fn sanitize_header_value(raw: &str) -> String {
    raw.chars()
        .filter(|&c| c != '\r' && c != '\n' && c != '\0')
        .collect()
}

fn is_valid_mp4_header(bytes: &[u8]) -> bool {
    if bytes.len() < 8 {
        return false;
    }
    matches!(
        &bytes[4..8],
        b"ftyp" | b"styp" | b"wide" | b"free" | b"moov"
    )
}

fn build_target_path(
    base_dir: PathBuf,
    media_type: &str,
    subfolder: Option<&str>,
    file_stem: Option<&str>,
    timestamp_ms: u128,
) -> PathBuf {
    let extension = media_extension(media_type);
    let mut dir = base_dir;
    if let Some(sub) = subfolder
        .map(sanitize_path_segment)
        .filter(|s| !s.is_empty())
    {
        dir = dir.join(sub);
    }
    let stem = file_stem
        .map(sanitize_path_segment)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("IG-Now-Instagram-{timestamp_ms}"));
    dir.join(format!("{stem}.{extension}"))
}

fn media_target_path(
    app: &AppHandle,
    media_type: &str,
    subfolder: Option<&str>,
    file_stem: Option<&str>,
) -> Result<PathBuf, String> {
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?
        .join("IG-Now");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let target = build_target_path(download_dir, media_type, subfolder, file_stem, timestamp);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(target)
}

fn validate_mp4_file(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 8];
    file.read_exact(&mut header).map_err(|_| {
        "The downloaded video was only a media fragment, not a complete MP4.".to_string()
    })?;
    if !is_valid_mp4_header(&header) {
        return Err(
            "The downloaded video was only a media fragment, not a complete MP4.".to_string(),
        );
    }
    Ok(())
}

fn curl_download_to_file(
    url: &str,
    referer: &str,
    ua: &str,
    cookie_header: Option<&str>,
    target_path: &Path,
) -> Result<(), String> {
    if !is_safe_http_url(url) {
        return Err("Instagram did not provide a downloadable HTTP(S) media URL.".to_string());
    }
    // Windows ships `curl.exe`; macOS/Linux use the system `curl`.
    let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
    let mut cmd = Command::new(curl);
    downloader::apply_no_window(&mut cmd);
    cmd.args([
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry",
        "2",
        "--connect-timeout",
        "20",
        "--max-time",
        "300",
        "--user-agent",
    ])
    .arg(ua)
    .arg("--referer")
    .arg(referer);
    cmd.args(["--header", "Accept: */*", "--output"])
        .arg(target_path)
        .arg(url);
    let output = downloader::run_curl_with_auth_stdin(&mut cmd, url, cookie_header, None)
        .map_err(|error| format!("Unable to start {curl}: {error}"))?;

    if !output.status.success() {
        let _ = fs::remove_file(target_path);
        return Err(format!("{curl} exited with status {}", output.status));
    }
    let metadata = fs::metadata(target_path).map_err(|error| error.to_string())?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(target_path);
        return Err("The downloaded media file was empty.".to_string());
    }
    Ok(())
}

fn validate_or_remove_mp4(path: &Path) -> Result<(), String> {
    if let Err(err) = validate_mp4_file(path) {
        let _ = fs::remove_file(path);
        return Err(err);
    }
    Ok(())
}

fn is_valid_image_header(bytes: &[u8]) -> bool {
    if bytes.len() < 12 {
        return false;
    }
    bytes.starts_with(&[0xFF, 0xD8, 0xFF]) // JPEG
        || bytes.starts_with(b"\x89PNG\r\n\x1a\n") // PNG
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || (&bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP") // WebP
        || (&bytes[4..8] == b"ftyp") // AVIF/HEIC ISO-BMFF container
}

fn validate_or_remove_image(path: &Path) -> Result<(), String> {
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(err) => {
            let _ = fs::remove_file(path);
            return Err(err.to_string());
        }
    };
    let mut header = [0_u8; 16];
    let n = file.read(&mut header).unwrap_or(0);
    if !is_valid_image_header(&header[..n]) {
        let _ = fs::remove_file(path);
        return Err(
            "Instagram returned a non-image response (expired link or login page).".to_string(),
        );
    }
    Ok(())
}

fn collect_item_fallback_candidates(
    item: &downloader::MediaItemSpec,
    primary_url: &str,
) -> Vec<(String, Option<String>)> {
    item.formats
        .iter()
        .filter(|f| f.video_url != primary_url)
        .map(|f| (f.video_url.clone(), f.audio_url.clone()))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn fetch_media_with_fallbacks(
    primary_url: &str,
    fallback_candidates: &[(String, Option<String>)],
    media_type: &str,
    audio_url: Option<&str>,
    fallback_audio_url: Option<&str>,
    referer: &str,
    ua: &str,
    cookie_header: Option<&str>,
    target_path: &Path,
) -> Result<Option<String>, String> {
    let primary = fetch_media_to_path(
        primary_url,
        media_type,
        audio_url,
        fallback_audio_url,
        referer,
        ua,
        cookie_header,
        target_path,
    );
    if primary.is_ok() {
        return primary;
    }
    for (alt_url, alt_audio) in fallback_candidates {
        let _ = fs::remove_file(target_path);
        let alt_fb_audio = alt_audio.as_deref().or(fallback_audio_url);
        if let Ok(warn) = fetch_media_to_path(
            alt_url,
            media_type,
            alt_audio.as_deref(),
            alt_fb_audio,
            referer,
            ua,
            cookie_header,
            target_path,
        ) {
            return Ok(warn);
        }
    }
    primary
}

fn carousel_slide_stem(base: &str, item_index: usize, item_count: usize) -> String {
    if item_count >= 10 {
        format!("{base}-slide-{:02}", item_index + 1)
    } else if item_count > 1 {
        format!("{base}-slide-{}", item_index + 1)
    } else {
        base.to_string()
    }
}

fn single_selection_file_stem(
    username: &str,
    taken_at: &str,
    shortcode: &str,
    item_index: usize,
    item_count: usize,
) -> String {
    let base = downloader::build_source_filename_stem(username, taken_at, shortcode);
    carousel_slide_stem(&base, item_index, item_count)
}

fn fetch_media_to_path(
    url: &str,
    media_type: &str,
    audio_url: Option<&str>,
    fallback_audio_url: Option<&str>,
    referer: &str,
    ua: &str,
    cookie_header: Option<&str>,
    target_path: &Path,
) -> Result<Option<String>, String> {
    let clean_audio = audio_url.map(str::trim).filter(|s| is_safe_http_url(s));
    let clean_fallback = fallback_audio_url
        .map(str::trim)
        .filter(|s| is_safe_http_url(s));
    if media_type.eq_ignore_ascii_case("video") {
        if let Some(a_url) = clean_audio {
            if let Some(ffmpeg) = downloader::find_ffmpeg_binary() {
                let temp_v = downloader::unique_temp_media_path("video", "mp4");
                let temp_a = downloader::unique_temp_media_path("audio", "m4a");
                curl_download_to_file(url, referer, ua, cookie_header, &temp_v)?;
                validate_or_remove_mp4(&temp_v)?;
                let audio_ok = curl_download_to_file(a_url, referer, ua, cookie_header, &temp_a);
                let mux_ok = if audio_ok.is_ok() {
                    downloader::mux_video_audio_ffmpeg(&ffmpeg, &temp_v, &temp_a, target_path)
                } else {
                    Err("Audio stream download failed".to_string())
                };
                let _ = fs::remove_file(&temp_a);
                if mux_ok.is_ok() {
                    let _ = fs::remove_file(&temp_v);
                    validate_or_remove_mp4(target_path)?;
                    return Ok(None);
                }
                let move_res = fs::rename(&temp_v, target_path)
                    .or_else(|_| fs::copy(&temp_v, target_path).map(|_| ()));
                let _ = fs::remove_file(&temp_v);
                move_res.map_err(|e| e.to_string())?;
                let _ = downloader::ensure_mp4_aac_audio(&ffmpeg, target_path, None);
                return Ok(Some(
                    "Saved .mp4 video stream only; DASH audio muxing failed.".to_string(),
                ));
            }
            curl_download_to_file(url, referer, ua, cookie_header, target_path)?;
            validate_or_remove_mp4(target_path)?;
            return Ok(Some(
                "Saved .mp4 video stream only; install ffmpeg to combine DASH audio.".to_string(),
            ));
        }

        curl_download_to_file(url, referer, ua, cookie_header, target_path)?;
        validate_or_remove_mp4(target_path)?;
        if let Some(ffmpeg) = downloader::find_ffmpeg_binary() {
            let mut temp_fb: Option<std::path::PathBuf> = None;
            if let Some(fb_url) = clean_fallback {
                if matches!(
                    downloader::probe_mp4_audio_state(&ffmpeg, target_path),
                    downloader::Mp4AudioState::Missing
                ) {
                    let candidate = downloader::unique_temp_media_path("fallback-audio", "m4a");
                    if curl_download_to_file(fb_url, referer, ua, cookie_header, &candidate).is_ok()
                    {
                        temp_fb = Some(candidate);
                    }
                }
            }
            let warn = downloader::ensure_mp4_aac_audio(&ffmpeg, target_path, temp_fb.as_deref())?;
            if let Some(ref p) = temp_fb {
                let _ = fs::remove_file(p);
            }
            validate_or_remove_mp4(target_path)?;
            return Ok(warn);
        }
        return Ok(None);
    }

    curl_download_to_file(url, referer, ua, cookie_header, target_path)?;
    if media_type.eq_ignore_ascii_case("image") {
        validate_or_remove_image(target_path)?;
    }
    Ok(None)
}

fn fetch_audio_only_to_path(
    video_url: &str,
    audio_url: Option<&str>,
    referer: &str,
    ua: &str,
    cookie_header: Option<&str>,
    target_path: &Path,
) -> Result<(), String> {
    let ffmpeg = downloader::find_ffmpeg_binary()
        .ok_or_else(|| "FFmpeg is required to extract Audio Only (.m4a) files.".to_string())?;
    let clean_audio = audio_url.map(str::trim).filter(|s| is_safe_http_url(s));
    if let Some(a_url) = clean_audio {
        let temp_a = downloader::unique_temp_media_path("audio-src", "m4a");
        if curl_download_to_file(a_url, referer, ua, cookie_header, &temp_a).is_ok() {
            let ext_res = downloader::extract_audio_aac_m4a_ffmpeg(&ffmpeg, &temp_a, target_path);
            let _ = fs::remove_file(&temp_a);
            if ext_res.is_ok() {
                validate_or_remove_mp4(target_path)?;
                return Ok(());
            }
        } else {
            let _ = fs::remove_file(&temp_a);
        }
    }

    let temp_v = downloader::unique_temp_media_path("audio-vid", "mp4");
    curl_download_to_file(video_url, referer, ua, cookie_header, &temp_v)?;
    validate_or_remove_mp4(&temp_v)?;
    if matches!(
        downloader::probe_mp4_audio_state(&ffmpeg, &temp_v),
        downloader::Mp4AudioState::Missing
    ) {
        let _ = fs::remove_file(&temp_v);
        return Err("This Instagram video stream has no audio track to extract.".to_string());
    }
    let res = downloader::extract_audio_aac_m4a_ffmpeg(&ffmpeg, &temp_v, target_path);
    let _ = fs::remove_file(&temp_v);
    res?;
    validate_or_remove_mp4(target_path)?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn download_media(
    app: AppHandle,
    url: String,
    media_type: String,
    referer: Option<String>,
    subfolder: Option<String>,
    file_stem: Option<String>,
    cookies: Option<String>,
    user_agent: Option<String>,
    audio_url: Option<String>,
) -> Result<String, String> {
    if !is_safe_http_url(&url) {
        return Err("Instagram did not provide a downloadable HTTP(S) media URL.".to_string());
    }

    let target_path = media_target_path(
        &app,
        &media_type,
        subfolder.as_deref(),
        file_stem.as_deref(),
    )?;
    let referer = referer
        .filter(|value| is_safe_http_url(value))
        .unwrap_or_else(|| "https://www.instagram.com/".to_string());
    let ua = user_agent
        .map(|s| sanitize_header_value(&s))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".into());
    let (cookie_header, _) = instagram_auth_headers(&app, cookies.as_deref());

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let _ = fetch_media_to_path(
            &url,
            &media_type,
            audio_url.as_deref(),
            None,
            &referer,
            &ua,
            cookie_header.as_deref(),
            &target_path,
        )?;
        Ok(target_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn probe_post_via_instagram_window(
    app: &AppHandle,
    probe_state: &tauri::State<'_, downloader::DownloaderProbeState>,
    clean_input: &str,
    shortcode: Option<&str>,
    has_ffmpeg: bool,
) -> Option<downloader::InspectedPost> {
    let ig_win = app.get_webview_window(INSTAGRAM_WINDOW_LABEL)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let request_id = format!("probe-{nanos}");
    let (tx, rx) = tokio::sync::oneshot::channel();
    probe_state.register_probe(request_id.clone(), tx);

    let url_json = serde_json::to_string(clean_input).ok()?;
    let req_json = serde_json::to_string(&request_id).ok()?;
    let script = format!(
        "if (window.__ignowTools && window.__ignowTools.probePostForDownloader) window.__ignowTools.probePostForDownloader({req_json}, {url_json});"
    );
    if ig_win.eval(&script).is_err() {
        probe_state.cancel_probe(&request_id);
        return None;
    }
    let waited = tokio::time::timeout(std::time::Duration::from_secs(15), rx).await;
    probe_state.cancel_probe(&request_id);
    if let Ok(Ok(raw_payload)) = waited {
        return downloader::extract_post_from_json_text(&raw_payload, shortcode, has_ffmpeg)
            .or_else(|| downloader::extract_post_from_html(&raw_payload, shortcode, has_ffmpeg));
    }
    None
}

#[tauri::command]
async fn inspect_instagram_post(
    app: AppHandle,
    probe_state: tauri::State<'_, downloader::DownloaderProbeState>,
    url: String,
    seed_payload_json: Option<String>,
) -> Result<downloader::InspectedPost, String> {
    let clean_input = url.trim().to_string();
    let shortcode = downloader::shortcode_from_url(&clean_input);
    let has_ffmpeg = downloader::find_ffmpeg_binary().is_some();

    let (cookie_header, csrf_token) = instagram_auth_headers(&app, None);
    let input_for_http = clean_input.clone();
    let http_res = tokio::task::spawn_blocking(move || {
        downloader::inspect_via_http_cascade(
            &input_for_http,
            cookie_header.as_deref(),
            csrf_token.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    let seed_post = seed_payload_json
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .and_then(|seed| {
            downloader::extract_post_from_json_text(seed, shortcode.as_deref(), has_ffmpeg)
        });

    if let Ok(post) = http_res {
        let mut best = match seed_post {
            Some(seed) => downloader::pick_richer_inspected_post(post, seed),
            None => post,
        };
        if best.username.is_empty() && best.items.len() <= 1 {
            if let Some(probed) = probe_post_via_instagram_window(
                &app,
                &probe_state,
                &clean_input,
                shortcode.as_deref(),
                has_ffmpeg,
            )
            .await
            {
                best = downloader::pick_richer_inspected_post(best, probed);
            }
        }
        return Ok(best);
    }

    if let Some(post) = seed_post {
        return Ok(post);
    }

    if let Some(post) = probe_post_via_instagram_window(
        &app,
        &probe_state,
        &clean_input,
        shortcode.as_deref(),
        has_ffmpeg,
    )
    .await
    {
        return Ok(post);
    }

    http_res
}

#[tauri::command]
async fn save_caption_file(
    app: AppHandle,
    post: downloader::InspectedPost,
    custom_caption: Option<String>,
    subfolder: Option<String>,
    file_stem: Option<String>,
) -> Result<String, String> {
    let mut final_post = post;
    if let Some(cap) = custom_caption {
        final_post.caption = cap;
    }
    let stem = file_stem.unwrap_or_else(|| {
        downloader::build_source_filename_stem(
            &final_post.username,
            &final_post.taken_at,
            &final_post.shortcode,
        )
    });
    let doc = downloader::format_caption_document(&final_post);
    save_media_bytes(
        app,
        doc.into_bytes(),
        "text".to_string(),
        subfolder,
        Some(stem),
    )
    .await
}

#[tauri::command]
async fn download_post_selection(
    app: AppHandle,
    post: downloader::InspectedPost,
    item_index: usize,
    format_id: Option<String>,
    mode: String,
    custom_caption: Option<String>,
) -> Result<downloader::DownloadOutcome, String> {
    let mut final_post = post;
    if let Some(cap) = custom_caption {
        final_post.caption = cap;
    }
    if mode.eq_ignore_ascii_case("caption") {
        let cap_path = save_caption_file(app, final_post, None, None, None).await?;
        return Ok(downloader::DownloadOutcome {
            saved_paths: Vec::new(),
            caption_path: Some(cap_path),
            metadata_path: None,
            subfolder: None,
            warning: None,
        });
    }

    if final_post.items.is_empty() {
        return Err("No downloadable video or image items found for this post.".to_string());
    }

    let referer = if is_safe_http_url(&final_post.post_url) {
        final_post.post_url.clone()
    } else {
        "https://www.instagram.com/".to_string()
    };
    let ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string();
    let (cookie_header, _) = instagram_auth_headers(&app, None);

    if mode.eq_ignore_ascii_case("audio") {
        let item = final_post
            .items
            .get(item_index)
            .or_else(|| final_post.items.first())
            .ok_or_else(|| "Selected media item not found.".to_string())?;
        if !item.kind.eq_ignore_ascii_case("video") {
            return Err("Audio Only (.m4a) is only available for video or Reel items.".to_string());
        }
        let chosen = format_id
            .as_deref()
            .and_then(|id| item.formats.iter().find(|f| f.id == id))
            .or_else(|| item.formats.first())
            .ok_or_else(|| "No downloadable audio source found for this video.".to_string())?;
        let audio_candidate = chosen
            .audio_url
            .clone()
            .or_else(|| item.formats.iter().find_map(|f| f.audio_url.clone()));
        let video_url = chosen.video_url.clone();
        let stem = single_selection_file_stem(
            &final_post.username,
            &final_post.taken_at,
            &final_post.shortcode,
            item.index,
            final_post.items.len(),
        );
        let target_path = media_target_path(&app, "audio", None, Some(&stem))?;
        let target_str = target_path.to_string_lossy().into_owned();
        tokio::task::spawn_blocking(move || {
            fetch_audio_only_to_path(
                &video_url,
                audio_candidate.as_deref(),
                &referer,
                &ua,
                cookie_header.as_deref(),
                &target_path,
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        return Ok(downloader::DownloadOutcome {
            saved_paths: vec![target_str],
            caption_path: None,
            metadata_path: None,
            subfolder: None,
            warning: None,
        });
    }

    if mode.eq_ignore_ascii_case("single") {
        let item = final_post
            .items
            .get(item_index)
            .or_else(|| final_post.items.first())
            .ok_or_else(|| "Selected media item not found.".to_string())?;
        let chosen = format_id
            .as_deref()
            .and_then(|id| item.formats.iter().find(|f| f.id == id))
            .or_else(|| item.formats.first())
            .ok_or_else(|| "No downloadable format available for this item.".to_string())?;

        let stem = single_selection_file_stem(
            &final_post.username,
            &final_post.taken_at,
            &final_post.shortcode,
            item.index,
            final_post.items.len(),
        );
        let target_path = media_target_path(&app, &item.kind, None, Some(&stem))?;
        let target_str = target_path.to_string_lossy().into_owned();
        let video_url = chosen.video_url.clone();
        let audio_url = chosen.audio_url.clone();
        let fallback_audio = item
            .formats
            .iter()
            .find_map(|f| f.audio_url.as_deref())
            .filter(|fb| audio_url.as_deref() != Some(*fb))
            .map(str::to_string);
        let fallback_candidates = collect_item_fallback_candidates(item, &video_url);
        let kind = item.kind.clone();
        let warning = tokio::task::spawn_blocking(move || {
            fetch_media_with_fallbacks(
                &video_url,
                &fallback_candidates,
                &kind,
                audio_url.as_deref(),
                fallback_audio.as_deref(),
                &referer,
                &ua,
                cookie_header.as_deref(),
                &target_path,
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        return Ok(downloader::DownloadOutcome {
            saved_paths: vec![target_str],
            caption_path: None,
            metadata_path: None,
            subfolder: None,
            warning,
        });
    }

    let post_stem = downloader::build_source_filename_stem(
        &final_post.username,
        &final_post.taken_at,
        &final_post.shortcode,
    );
    let subfolder = post_stem.clone();

    let item_count = final_post.items.len();
    let mut indexed_results: Vec<(usize, String, Result<Option<String>, String>)> =
        Vec::with_capacity(item_count);
    let mut join_set = tokio::task::JoinSet::new();
    let emit_progress = |completed: usize| {
        if let Some(dl_win) = app.get_webview_window(DOWNLOADER_WINDOW_LABEL) {
            let _ = dl_win.emit(
                "downloader-progress",
                serde_json::json!({ "completed": completed, "total": item_count }),
            );
        }
    };

    for (idx, item) in final_post.items.iter().enumerate() {
        let chosen = if idx == item_index {
            format_id
                .as_deref()
                .and_then(|id| item.formats.iter().find(|f| f.id == id))
                .or_else(|| item.formats.first())
        } else {
            item.formats.first()
        };
        let Some(fmt) = chosen else {
            continue;
        };
        let stem = carousel_slide_stem(&post_stem, idx, item_count);
        let target_path = media_target_path(&app, &item.kind, Some(&subfolder), Some(&stem))?;
        let target_str = target_path.to_string_lossy().into_owned();
        let v_url = fmt.video_url.clone();
        let a_url = fmt.audio_url.clone();
        let fb_audio = item
            .formats
            .iter()
            .find_map(|f| f.audio_url.as_deref())
            .filter(|fb| a_url.as_deref() != Some(*fb))
            .map(str::to_string);
        let fallback_candidates = collect_item_fallback_candidates(item, &v_url);
        let kind = item.kind.clone();
        let ref_clone = referer.clone();
        let ua_clone = ua.clone();
        let cookie_clone = cookie_header.clone();

        while join_set.len() >= 6 {
            if let Some(joined) = join_set.join_next().await {
                indexed_results.push(joined.map_err(|e| e.to_string())?);
                emit_progress(indexed_results.len());
            }
        }

        join_set.spawn_blocking(move || {
            let res = fetch_media_with_fallbacks(
                &v_url,
                &fallback_candidates,
                &kind,
                a_url.as_deref(),
                fb_audio.as_deref(),
                &ref_clone,
                &ua_clone,
                cookie_clone.as_deref(),
                &target_path,
            );
            (idx, target_str, res)
        });
    }

    while let Some(joined) = join_set.join_next().await {
        indexed_results.push(joined.map_err(|e| e.to_string())?);
        emit_progress(indexed_results.len());
    }

    indexed_results.sort_by_key(|(idx, _, _)| *idx);
    let mut saved_paths = Vec::new();
    let mut first_warning = None;
    let mut failed_slides = Vec::new();
    for (idx, target_str, res) in indexed_results {
        match res {
            Ok(warn_opt) => {
                saved_paths.push(target_str);
                if first_warning.is_none() {
                    first_warning = warn_opt;
                }
            }
            Err(err) => {
                failed_slides.push(idx + 1);
                if first_warning.is_none() {
                    first_warning = Some(err);
                }
            }
        }
    }
    if !failed_slides.is_empty() {
        let slide_list: String = failed_slides
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        let detail = first_warning.take().unwrap_or_default();
        first_warning = Some(if detail.is_empty() {
            format!("Slides [{slide_list}] could not be downloaded.")
        } else {
            format!("Slides [{slide_list}] failed ({detail}).")
        });
    }

    let caption_path = save_caption_file(
        app.clone(),
        final_post.clone(),
        None,
        Some(subfolder.clone()),
        Some("caption".to_string()),
    )
    .await
    .ok();

    let metadata_path = match downloader::build_metadata_json(&final_post) {
        Ok(meta_json) => save_media_bytes(
            app,
            meta_json.into_bytes(),
            "json".to_string(),
            Some(subfolder.clone()),
            Some("metadata".to_string()),
        )
        .await
        .ok(),
        Err(_) => None,
    };

    if saved_paths.is_empty() && caption_path.is_none() {
        return Err(first_warning.unwrap_or_else(|| "Post download failed.".to_string()));
    }

    Ok(downloader::DownloadOutcome {
        saved_paths,
        caption_path,
        metadata_path,
        subfolder: Some(subfolder),
        warning: first_warning,
    })
}

#[tauri::command]
async fn save_media_bytes(
    app: AppHandle,
    data: Vec<u8>,
    media_type: String,
    subfolder: Option<String>,
    file_stem: Option<String>,
) -> Result<String, String> {
    if data.is_empty() {
        return Err("Instagram returned an empty media response.".to_string());
    }

    let target_path = media_target_path(
        &app,
        &media_type,
        subfolder.as_deref(),
        file_stem.as_deref(),
    )?;
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        if media_type.eq_ignore_ascii_case("video") && !is_valid_mp4_header(&data) {
            return Err(
                "The downloaded video was only a media fragment, not a complete MP4.".to_string(),
            );
        }
        if media_type.eq_ignore_ascii_case("image") && !is_valid_image_header(&data) {
            return Err(
                "Instagram returned a non-image response (expired link or login page).".to_string(),
            );
        }
        fs::write(&target_path, data).map_err(|error| error.to_string())?;
        let metadata = fs::metadata(&target_path).map_err(|error| error.to_string())?;
        if metadata.len() == 0 {
            let _ = fs::remove_file(&target_path);
            return Err("The saved media file was empty.".to_string());
        }
        if media_type.eq_ignore_ascii_case("video") {
            if let Some(ffmpeg) = downloader::find_ffmpeg_binary() {
                let _ = downloader::ensure_mp4_aac_audio(&ffmpeg, &target_path, None);
            }
        }
        Ok(target_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(notifications::MessageNotifications::default())
        .manage(downloader::DownloaderProbeState::default())
        .plugin(tauri_plugin_shell::init())
        // Launch-on-startup support; the app reads the `--minimized` argument
        // itself and starts hidden to the tray (autostart never pops a window).
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .invoke_handler(tauri::generate_handler![
            notifications::report_dm_unread,
            notifications::test_message_notification,
            open_external_url,
            prepare_download_folder,
            open_downloads_folder,
            download_media,
            save_media_bytes,
            open_downloader_window,
            take_pending_downloader_context,
            inspect_instagram_post,
            submit_downloader_probe,
            download_post_selection,
            save_caption_file
        ])
        .setup(|app| {
            if let Err(error) = tray::setup_tray(app.handle()) {
                eprintln!("[IG-Now] Tray setup failed: {error}");
            }

            // Launch hidden to tray when started by the OS autostart feature.
            let start_minimized = std::env::args().any(|arg| arg == "--minimized");

            if let Err(error) = launch_instagram_internal(app.handle(), start_minimized) {
                eprintln!("[IG-Now] Failed to launch Instagram: {error}");
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == INSTAGRAM_WINDOW_LABEL {
                    // Minimal, deterministic close-to-tray: prevent the close
                    // FIRST, pause via a plain eval (no callbacks/threads/COM —
                    // those were observed to race with the OS close processing
                    // and occasionally let the window be destroyed), then hide.
                    // The watchdog's hidden-transition applies the full layered
                    // pause within ~800 ms.
                    api.prevent_close();
                    if let Some(win) = window.get_webview_window(INSTAGRAM_WINDOW_LABEL) {
                        let _ = win.eval("if (window.__onWindowHidden) window.__onWindowHidden();");
                        let _ = win.hide();
                    }
                }
            }
            // Fast path: tao emits Resized(0x0) the moment the window minimizes,
            // while the watchdog polls at 800 ms. Pause immediately here too.
            tauri::WindowEvent::Resized(_) => {
                if window.label() == INSTAGRAM_WINDOW_LABEL
                    && window.is_minimized().unwrap_or(false)
                {
                    if let Some(win) = window.get_webview_window(INSTAGRAM_WINDOW_LABEL) {
                        pause_media_for_hidden(&win);
                    }
                }
            }
            tauri::WindowEvent::Focused(true) => {
                if window.label() == INSTAGRAM_WINDOW_LABEL
                    && window.is_visible().unwrap_or(false)
                    && !window.is_minimized().unwrap_or(false)
                {
                    #[cfg(windows)]
                    let _ = audio::ensure_foreground_audio_ready();
                    if let Some(win) = window.get_webview_window(INSTAGRAM_WINDOW_LABEL) {
                        let _ = win.eval(
                            "if (window.__ignowEnsureForegroundAudio) window.__ignowEnsureForegroundAudio();",
                        );
                    }
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running IG-Now");
}

#[cfg(test)]
mod download_tests {
    use super::{build_target_path, media_extension, sanitize_path_segment, validate_mp4_file};
    use std::{fs, path::PathBuf};

    #[test]
    fn sanitizes_unsafe_path_segments() {
        assert_eq!(sanitize_path_segment("../../etc/passwd"), "etc_passwd");
        assert_eq!(sanitize_path_segment(".."), "");
        assert_eq!(
            sanitize_path_segment("IG-Now-Post-user.1_abc"),
            "IG-Now-Post-user.1_abc"
        );
        assert_eq!(sanitize_path_segment("a".repeat(120).as_str()).len(), 80);
    }

    #[test]
    fn resolves_extensions_and_subfolders() {
        assert_eq!(media_extension("video"), "mp4");
        assert_eq!(media_extension("audio"), "m4a");
        assert_eq!(media_extension("audio-m4a"), "m4a");
        assert_eq!(media_extension("mp3"), "mp3");
        assert_eq!(media_extension("text"), "txt");
        assert_eq!(media_extension("caption"), "txt");
        assert_eq!(media_extension("json"), "json");
        assert_eq!(media_extension("image"), "jpg");

        let base = PathBuf::from("IG-Now");
        assert_eq!(
            build_target_path(
                base.clone(),
                "video",
                Some("IG-Now-Post-user-123"),
                Some("01-video"),
                42
            ),
            base.join("IG-Now-Post-user-123").join("01-video.mp4")
        );
        assert_eq!(
            build_target_path(base.clone(), "text", Some("../post"), Some("caption"), 42),
            base.join("post").join("caption.txt")
        );
        assert_eq!(
            build_target_path(base.clone(), "image", None, None, 99),
            base.join("IG-Now-Instagram-99.jpg")
        );
    }

    #[test]
    fn validates_mp4_ftyp_header() {
        let mut dir = std::env::temp_dir();
        let unique = format!("ignow-mp4-test-{}.mp4", std::process::id());
        dir.push(unique);

        fs::write(&dir, b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00").unwrap();
        assert!(validate_mp4_file(&dir).is_ok());

        fs::write(&dir, b"\x00\x00\x00\x08moof\x00\x00\x00\x00").unwrap();
        assert!(validate_mp4_file(&dir).is_err());

        let _ = fs::remove_file(&dir);
    }

    #[test]
    fn merges_webview_cookies_or_uses_sanitized_fallback() {
        let (header, csrf) = super::merge_cookie_fallback(
            vec![("sessionid".to_string(), "sess1".to_string())],
            Some("ignored=1"),
        );
        assert_eq!(header.as_deref(), Some("sessionid=sess1"));
        assert!(csrf.is_none());

        let (fb_header, _) = super::merge_cookie_fallback(Vec::new(), Some("ds_user=9\r\n"));
        assert_eq!(fb_header.as_deref(), Some("ds_user=9"));
    }

    #[test]
    fn single_selection_disambiguates_carousel_slides() {
        let s1 =
            super::single_selection_file_stem("alice", "2024-11-15T12:00:00Z", "C9xPost", 0, 2);
        let s2 =
            super::single_selection_file_stem("alice", "2024-11-15T12:00:00Z", "C9xPost", 1, 2);
        assert_ne!(s1, s2);
        assert!(s2.ends_with("-slide-2"));

        let ten_first =
            super::single_selection_file_stem("alice", "2024-11-15T12:00:00Z", "C9xPost", 0, 10);
        let ten_last =
            super::single_selection_file_stem("alice", "2024-11-15T12:00:00Z", "C9xPost", 9, 10);
        assert!(ten_first.ends_with("-slide-01"));
        assert!(ten_last.ends_with("-slide-10"));

        let single =
            super::single_selection_file_stem("alice", "2024-11-15T12:00:00Z", "C9xPost", 0, 1);
        let parts: Vec<&str> = single.split('-').collect();
        assert_eq!(parts.len(), 3, "expected username-date-hash, got {single}");
        assert_eq!(parts[0], "alice");
        assert_eq!(parts[1], "20241115");
        assert_eq!(parts[2].len(), 8);
        assert!(parts[2].chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn validate_or_remove_mp4_cleans_invalid_file() {
        let mut p = std::env::temp_dir();
        p.push(format!("ignow-invalid-cleanup-{}.mp4", std::process::id()));
        fs::write(&p, b"\x00\x00\x00\x08moof\x00\x00\x00\x00").unwrap();
        assert!(super::validate_or_remove_mp4(&p).is_err());
        assert!(!p.exists(), "invalid MP4 target must be deleted");
    }

    #[test]
    fn cookie_header_only_sent_to_instagram_app_hosts() {
        assert!(crate::downloader::is_instagram_app_host(
            "https://www.instagram.com/p/ABC/"
        ));
        assert!(crate::downloader::is_instagram_app_host(
            "https://instagram.com/reels/XYZ/"
        ));
        assert!(!crate::downloader::is_instagram_app_host(
            "https://scontent.cdninstagram.com/v/t50.mp4"
        ));
        assert!(!crate::downloader::is_instagram_app_host(
            "https://video.xx.fbcdn.net/v/video.mp4"
        ));
        assert!(!crate::downloader::is_instagram_app_host(
            "https://evilinstagram.com/track"
        ));
    }

    #[test]
    fn validates_image_headers_and_removes_html_error_responses() {
        assert!(super::is_valid_image_header(
            b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01"
        ));
        assert!(super::is_valid_image_header(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0d"
        ));
        assert!(super::is_valid_image_header(b"RIFF\x24\x00\x00\x00WEBP"));
        assert!(!super::is_valid_image_header(b"<!DOCTYPE html><html>"));

        let mut p = std::env::temp_dir();
        p.push(format!("ignow-invalid-img-{}.jpg", std::process::id()));
        fs::write(&p, b"<!DOCTYPE html><html>Login required</html>").unwrap();
        assert!(super::validate_or_remove_image(&p).is_err());
        assert!(!p.exists(), "non-image HTML response must be deleted");
    }

    #[test]
    fn default_window_1588x1025_centers_and_clamps_to_work_area() {
        assert_eq!(super::DEFAULT_WINDOW_WIDTH, 1588.0);
        assert_eq!(super::DEFAULT_WINDOW_HEIGHT, 1025.0);

        // 2560x1440 monitor (1392px work height after 48px taskbar) at 100% scale:
        let qhd = super::compute_centered_work_area_frame(
            0,
            0,
            2560,
            1392,
            16,
            39,
            1.0,
            super::DEFAULT_WINDOW_WIDTH,
            super::DEFAULT_WINDOW_HEIGHT,
            super::MIN_WINDOW_WIDTH,
            super::MIN_WINDOW_HEIGHT,
        );
        assert_eq!(qhd.target_width, 1588.0);
        assert_eq!(qhd.target_height, 1025.0);
        assert_eq!(qhd.outer_x, 478); // (2560 - (1588 + 16)) / 2
        assert_eq!(qhd.outer_y, 164); // (1392 - (1025 + 39)) / 2

        // 1920x1080 monitor (1032px work height) clamps height cleanly instead of clipping under taskbar:
        let fhd = super::compute_centered_work_area_frame(
            1920,
            0,
            1920,
            1032,
            16,
            39,
            1.0,
            super::DEFAULT_WINDOW_WIDTH,
            super::DEFAULT_WINDOW_HEIGHT,
            super::MIN_WINDOW_WIDTH,
            super::MIN_WINDOW_HEIGHT,
        );
        assert_eq!(fhd.target_width, 1588.0);
        assert_eq!(fhd.target_height, 993.0);
        assert_eq!(fhd.outer_x, 1920 + 158);
        assert_eq!(fhd.outer_y, 0);

        assert_eq!(super::DOWNLOADER_WINDOW_WIDTH, 765.0);
        assert_eq!(super::DOWNLOADER_WINDOW_HEIGHT, 885.0);
        let dl = super::compute_centered_work_area_frame(
            0,
            0,
            2560,
            1392,
            16,
            39,
            1.0,
            super::DOWNLOADER_WINDOW_WIDTH,
            super::DOWNLOADER_WINDOW_HEIGHT,
            super::DOWNLOADER_MIN_WIDTH,
            super::DOWNLOADER_MIN_HEIGHT,
        );
        assert_eq!(dl.target_width, 765.0);
        assert_eq!(dl.target_height, 885.0);
        assert_eq!(dl.outer_x, 889);
        assert_eq!(dl.outer_y, 234);

        // Secondary left monitor at negative origin (-1920, 0) and 125% DPI scaling (1536x825 work area):
        let scaled_dl = super::compute_centered_work_area_frame(
            -1920,
            0,
            1920,
            1032,
            20,
            49,
            1.25,
            super::DOWNLOADER_WINDOW_WIDTH,
            super::DOWNLOADER_WINDOW_HEIGHT,
            super::DOWNLOADER_MIN_WIDTH,
            super::DOWNLOADER_MIN_HEIGHT,
        );
        assert_eq!(scaled_dl.target_width, 765.0);
        assert!(
            scaled_dl.target_height < 800.0 && scaled_dl.target_height >= 620.0,
            "125% scaled 1080p work area must clamp Downloader height cleanly: {}",
            scaled_dl.target_height
        );
        let expected_dl_x =
            -1920 + ((1920.0 - ((765.0 * 1.25_f64).round() + 20.0)) / 2.0).floor() as i32;
        assert_eq!(scaled_dl.outer_x, expected_dl_x);
        assert_eq!(scaled_dl.outer_y, 0);
    }

    #[test]
    fn collects_fallback_candidates_for_both_video_and_image_items() {
        let vid_item = super::downloader::MediaItemSpec {
            index: 0,
            kind: "video".to_string(),
            thumbnail_url: None,
            formats: vec![
                super::downloader::VideoFormat {
                    id: "dash-0".to_string(),
                    label: "1080p".to_string(),
                    width: 1080,
                    height: 1920,
                    bandwidth: 3000,
                    ext: "mp4".to_string(),
                    requires_mux: true,
                    video_url: "https://cdn.instagram.com/v/primary.mp4".to_string(),
                    audio_url: Some("https://cdn.instagram.com/v/primary.m4a".to_string()),
                },
                super::downloader::VideoFormat {
                    id: "prog-0".to_string(),
                    label: "720p".to_string(),
                    width: 720,
                    height: 1280,
                    bandwidth: 1500,
                    ext: "mp4".to_string(),
                    requires_mux: false,
                    video_url: "https://cdn.instagram.com/v/fallback.mp4".to_string(),
                    audio_url: None,
                },
            ],
        };
        let fb = super::collect_item_fallback_candidates(
            &vid_item,
            "https://cdn.instagram.com/v/primary.mp4",
        );
        assert_eq!(
            fb,
            vec![("https://cdn.instagram.com/v/fallback.mp4".to_string(), None)]
        );
    }

    #[test]
    fn unsupported_minimized_query_does_not_force_window_hidden() {
        assert!(!super::is_window_hidden_state(None, Some(true)));
        assert!(super::is_window_hidden_state(Some(true), Some(true)));
        assert!(super::is_window_hidden_state(Some(false), Some(false)));
        assert!(super::is_window_hidden_state(None, None));
    }
}
