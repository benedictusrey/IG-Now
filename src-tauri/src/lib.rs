mod tray;

use std::{
    fs,
    io::Read,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

const INSTAGRAM_WINDOW_LABEL: &str = "instagram";
const INSTAGRAM_HELPER_SCRIPT: &str = include_str!("../../frontend/instagram-tools.js");

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

pub fn launch_instagram_internal(app: &AppHandle) -> Result<(), String> {
    let profile_data_dir = instagram_data_directory(app)?;
    fs::create_dir_all(&profile_data_dir).map_err(|error| error.to_string())?;

    if let Some(window) = app.get_webview_window(INSTAGRAM_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(hub) = app.get_webview_window("main") {
            let _ = hub.hide();
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
    .inner_size(1175.0, 885.0)
    .min_inner_size(900.0, 680.0)
    .resizable(true)
    .center()
    .data_directory(profile_data_dir)
    .initialization_script(INSTAGRAM_HELPER_SCRIPT)
    .on_new_window(move |url, _features| {
        if let Err(error) = open_external_url(browser_app.clone(), url.to_string()) {
            eprintln!("[IG-Now] Failed to open a link in the default browser: {error}");
        }
        tauri::webview::NewWindowResponse::Deny
    })
    .on_navigation(|_| true)
    .build()
    .map_err(|error| error.to_string())?;

    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if let Some(hub) = app.get_webview_window("main") {
        let _ = hub.hide();
    }

    Ok(())
}

#[tauri::command]
fn hide_about(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
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
        let status = Command::new("curl.exe")
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
            .map_err(|error| format!("Unable to start curl.exe: {error}"))?;

        if !status.success() {
            let _ = fs::remove_file(&target_path);
            return Err(format!("curl.exe exited with status {status}"));
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
        .invoke_handler(tauri::generate_handler![
            hide_about,
            open_external_url,
            prepare_download_folder,
            download_media,
            save_media_bytes
        ])
        .setup(|app| {
            if let Err(error) = tray::setup_tray(app.handle()) {
                eprintln!("[IG-Now] Tray setup failed: {error}");
            }

            let _hub = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("IG-Now")
                .inner_size(500.0, 650.0)
                .resizable(false)
                .shadow(true)
                .visible(false)
                .center()
                .build()
                .expect("Failed to build IG-Now main window");

            if let Err(error) = launch_instagram_internal(app.handle()) {
                eprintln!("[IG-Now] Failed to launch Instagram: {error}");
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => match window.label() {
                "main" => {
                    let _ = window.hide();
                    api.prevent_close();
                }
                INSTAGRAM_WINDOW_LABEL => {}
                _ => {}
            },
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running IG-Now");
}
