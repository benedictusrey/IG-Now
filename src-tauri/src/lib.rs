// IG-Now — High-Performance Desktop Client for Instagram
// Sole Author & Creator: Benedictus Reynaldo Hartanto (@benedictusrey)
// Repository: https://github.com/benedictusrey/IG-Now
// All rights reserved. See LICENSE for details.

mod about_logo;
#[cfg(windows)]
mod audio;
mod tray;

use std::{
    fs,
    io::Read,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{utils::config::Color, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

const INSTAGRAM_WINDOW_LABEL: &str = "instagram";
const INSTAGRAM_HELPER_SCRIPT: &str = include_str!("../../frontend/instagram-tools.js");

/// Default window geometry (logical px): 1180 x 1032, launched centered in the
/// monitor's work area (screen minus the top system bar and the bottom
/// taskbar) so it never opens clipped on either edge.
const DEFAULT_WINDOW_WIDTH: f64 = 1180.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 1032.0;
/// Hard minimum, enforced by the builder's `min_inner_size` as well.
const MIN_WINDOW_WIDTH: f64 = 900.0;
const MIN_WINDOW_HEIGHT: f64 = 680.0;

/// Clamp the window to the monitor's WORK AREA (excludes the taskbar and any
/// top system bar) and center it there. The requested default is 1180x1032
/// logical px; when the work area cannot fit the window's outer size (client
/// + title bar + borders, measured from the real window so per-platform
/// decoration differences are exact), the size is reduced to fit. This keeps
/// the default resolution on normal desktops and gracefully shrinks only on
/// small displays instead of opening clipped under the taskbar.
///
/// Instagram's UI is dark; painting the webview background the same near-black
/// (18,18,18) removes the white flash on every navigation (v2.1.0).
fn fit_window_to_work_area(window: &tauri::WebviewWindow) {
    let Ok(inner) = window.inner_size() else {
        return;
    };
    let Ok(outer) = window.outer_size() else {
        return;
    };
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let work_width = work.size.width as f64;
    let work_height = work.size.height as f64;

    // Decoration overhead (title bar + borders) in physical pixels.
    let overhead_width = outer.width.saturating_sub(inner.width) as f64;
    let overhead_height = outer.height.saturating_sub(inner.height) as f64;

    let max_inner_width = ((work_width - overhead_width) / scale).max(0.0);
    let max_inner_height = ((work_height - overhead_height) / scale).max(0.0);
    let target_width = DEFAULT_WINDOW_WIDTH
        .min(max_inner_width)
        .max(MIN_WINDOW_WIDTH);
    let target_height = DEFAULT_WINDOW_HEIGHT
        .min(max_inner_height)
        .max(MIN_WINDOW_HEIGHT);

    let current_width = inner.width as f64 / scale;
    let current_height = inner.height as f64 / scale;
    if (current_width - target_width).abs() > 0.5 || (current_height - target_height).abs() > 0.5 {
        let _ = window.set_size(tauri::LogicalSize::new(target_width, target_height));
    }

    // Center within the work area (NOT the raw monitor bounds) so the window
    // sits between the top bar and the bottom taskbar.
    let Ok(final_outer) = window.outer_size() else {
        return;
    };
    let x =
        work.position.x + (((work_width - final_outer.width as f64) / 2.0).floor() as i32).max(0);
    let y =
        work.position.y + (((work_height - final_outer.height as f64) / 2.0).floor() as i32).max(0);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Guards the playback watchdog so it is spawned exactly once per process,
/// no matter how many times the Instagram window is (re)launched.
static WATCHDOG_STARTED: AtomicBool = AtomicBool::new(false);

fn instagram_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    // Keep the existing Personal WebView2 data directory so removing the
    // profile manager does not sign the current Instagram session out.
    app.path()
        .app_data_dir()
        .map(|path| path.join("profiles").join("profile-personal"))
        .map_err(|error| error.to_string())
}

fn is_safe_http_url(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://")) && !url.contains(['\r', '\n'])
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
    // Fail-safe direction: if a state query errors (e.g. the window was
    // destroyed), treat the window as HIDDEN so playback gets paused.
    let state_hidden = || w.is_minimized().unwrap_or(true) || !w.is_visible().unwrap_or(false);
    let mut last_hidden = state_hidden();
    #[cfg(windows)]
    let mut unmute_ticks = 0u32;
    #[cfg(windows)]
    let mut startup_unmuted = false;
    let mut startup_ticks = 0u32;
    let mut startup_reported = false;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(800));
        let hidden = state_hidden();
        // Windows PERSISTS a session's mute state across app restarts
        // (per-app Volume Mixer store). If the previous session exited while
        // muted (pause-on-minimize), this cold start would begin OS-muted —
        // with no hidden/visible transition ever firing, nothing would unmute
        // it and the app would be silent while the page plays fine. Retry the
        // unmute until a session actually exists (the WebView2 session appears
        // seconds after launch), capped at ~48 s. (Windows-only: audio.rs /
        // Core Audio is cfg(windows).)
        #[cfg(windows)]
        {
            if !startup_unmuted {
                unmute_ticks += 1;
                if unmute_ticks >= 3 && !hidden {
                    if audio::set_app_audio_mute(false) {
                        startup_unmuted = true;
                        eprintln!(
                            "[IG-Now] Watchdog: startup unmute (cleared persisted session mute)"
                        );
                        // Immediate evidence: session state right after clearing.
                        audio::report_audio_state();
                    } else if unmute_ticks >= 60 {
                        startup_unmuted = true; // no session appeared — nothing to clear
                        eprintln!(
                            "[IG-Now] Watchdog: startup unmute gave up (no session appeared)"
                        );
                    }
                }
            }
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
    // frame instead of white, and the window is only shown once the page has
    // finished loading (on_page_load below) — no white/black blink on launch
    // or in-app navigation.
    .background_color(Color(18, 18, 18, 255))
    .visible(false)
    .data_directory(profile_data_dir)
    .initialization_script(INSTAGRAM_HELPER_SCRIPT)
    .on_page_load(move |window, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Finished && !start_minimized {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.unminimize();
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
    if !start_minimized {
        let fallback = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(8));
            if !fallback.is_visible().unwrap_or(true) {
                let _ = fallback.show();
                let _ = fallback.set_focus();
            }
        });
    }

    // 1180x1032 default, clamped to the work area and centered between the
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

fn media_target_path(app: &AppHandle, media_type: &str) -> Result<PathBuf, String> {
    let extension = if media_type.eq_ignore_ascii_case("video") {
        "mp4"
    } else {
        "jpg"
    };
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?
        .join("IG-Now");
    fs::create_dir_all(&download_dir).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    Ok(download_dir.join(format!("IG-Now-Instagram-{timestamp}.{extension}")))
}

fn validate_mp4_file(path: &PathBuf) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 8];
    file.read_exact(&mut header).map_err(|_| {
        "The downloaded video was only a media fragment, not a complete MP4.".to_string()
    })?;
    if &header[4..8] != b"ftyp" {
        return Err(
            "The downloaded video was only a media fragment, not a complete MP4.".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
async fn download_media(
    app: AppHandle,
    url: String,
    media_type: String,
    referer: Option<String>,
) -> Result<String, String> {
    if !is_safe_http_url(&url) {
        return Err("Instagram did not provide a downloadable HTTP(S) media URL.".to_string());
    }

    let target_path = media_target_path(&app, &media_type)?;
    let referer = referer
        .filter(|value| is_safe_http_url(value))
        .unwrap_or_else(|| "https://www.instagram.com/".to_string());

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        // Windows ships `curl.exe`; macOS/Linux use the system `curl`.
        let curl = if cfg!(windows) { "curl.exe" } else { "curl" };
        let status = Command::new(curl)
            .args([
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
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "--referer",
            ])
            .arg(referer)
            .args(["--header", "Accept: */*", "--output"])
            .arg(&target_path)
            .arg(&url)
            .status()
            .map_err(|error| format!("Unable to start {curl}: {error}"))?;

        if !status.success() {
            let _ = fs::remove_file(&target_path);
            return Err(format!("{curl} exited with status {status}"));
        }

        let metadata = fs::metadata(&target_path).map_err(|error| error.to_string())?;
        if metadata.len() == 0 {
            let _ = fs::remove_file(&target_path);
            return Err("The downloaded media file was empty.".to_string());
        }
        if media_type.eq_ignore_ascii_case("video") {
            if let Err(error) = validate_mp4_file(&target_path) {
                let _ = fs::remove_file(&target_path);
                return Err(error);
            }
        }

        Ok(target_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_media_bytes(
    app: AppHandle,
    data: Vec<u8>,
    media_type: String,
) -> Result<String, String> {
    if data.is_empty() {
        return Err("Instagram returned an empty media response.".to_string());
    }

    let target_path = media_target_path(&app, &media_type)?;
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        if media_type.eq_ignore_ascii_case("video") && data.len() < 8 {
            return Err(
                "The downloaded video was only a media fragment, not a complete MP4.".to_string(),
            );
        }
        if media_type.eq_ignore_ascii_case("video") && &data[4..8] != b"ftyp" {
            return Err(
                "The downloaded video was only a media fragment, not a complete MP4.".to_string(),
            );
        }
        fs::write(&target_path, data).map_err(|error| error.to_string())?;
        let metadata = fs::metadata(&target_path).map_err(|error| error.to_string())?;
        if metadata.len() == 0 {
            let _ = fs::remove_file(&target_path);
            return Err("The saved media file was empty.".to_string());
        }
        Ok(target_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Launch-on-startup support; the app reads the `--minimized` argument
        // itself and starts hidden to the tray (autostart never pops a window).
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            prepare_download_folder,
            download_media,
            save_media_bytes
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
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running IG-Now");
}
