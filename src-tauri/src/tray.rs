use std::error::Error;

use tauri::{
    menu::{
        CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
        SubmenuBuilder,
    },
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tauri_plugin_shell::ShellExt;

fn build_menu(app: &AppHandle) -> Result<Menu<Wry>, Box<dyn Error>> {
    let always_top = CheckMenuItemBuilder::with_id("always_top", "Always on top").build(app)?;

    let ig_home = MenuItemBuilder::with_id("ig_home", "Home feed").build(app)?;
    let ig_explore = MenuItemBuilder::with_id("ig_explore", "Explore").build(app)?;
    let ig_reels = MenuItemBuilder::with_id("ig_reels", "Reels").build(app)?;
    let ig_msgs = MenuItemBuilder::with_id("ig_msgs", "Direct messages").build(app)?;
    let ig_notif = MenuItemBuilder::with_id("ig_notif", "Notifications").build(app)?;
    let ig_profile = MenuItemBuilder::with_id("ig_profile", "My profile").build(app)?;

    let refresh = MenuItemBuilder::with_id("refresh", "Refresh").build(app)?;
    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom in").build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom out").build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Reset zoom (100%)").build(app)?;

    let clear_mem = MenuItemBuilder::with_id("clear_mem", "Compact memory and cache").build(app)?;
    let devtools = MenuItemBuilder::with_id("devtools", "Open developer tools").build(app)?;
    let copy_url = MenuItemBuilder::with_id("copy_url", "Copy current page URL").build(app)?;
    let open_browser =
        MenuItemBuilder::with_id("open_browser", "Open current page in browser").build(app)?;
    let cobalt_guide =
        MenuItemBuilder::with_id("cobalt_guide", "Open Cobalt video downloader").build(app)?;

    let usage_zoom = MenuItemBuilder::with_id(
        "usage_zoom",
        "Ctrl + left-click image: open viewer and zoom",
    )
    .enabled(false)
    .build(app)?;
    let usage_save = MenuItemBuilder::with_id(
        "usage_save",
        "Right-click image/video: save to Downloads\\IG-Now",
    )
    .enabled(false)
    .build(app)?;
    let usage_link =
        MenuItemBuilder::with_id("usage_link", "Right-click link: open in default browser")
            .enabled(false)
            .build(app)?;
    let usage_seek = MenuItemBuilder::with_id(
        "usage_seek",
        "Search: hover/drag white line; Home/Reels: Left/Right -5s/+5s; Reels Up=next, Down=previous",
    )
    .enabled(false)
    .build(app)?;
    let usage_escape =
        MenuItemBuilder::with_id("usage_escape", "Esc: close viewer or leave a Reel")
            .enabled(false)
            .build(app)?;
    let usage_like = MenuItemBuilder::with_id(
        "usage_like",
        "Normal click, double-click, and carousel drag stay Instagram actions",
    )
    .enabled(false)
    .build(app)?;
    let usage_cobalt = MenuItemBuilder::with_id(
        "usage_cobalt",
        "Video: copy link and open Cobalt, then save to Downloads\\IG-Now",
    )
    .enabled(false)
    .build(app)?;
    let usage = SubmenuBuilder::with_id(app, "how_to", "How to IG-Now")
        .item(&usage_zoom)
        .item(&usage_save)
        .item(&usage_link)
        .item(&usage_seek)
        .item(&usage_escape)
        .item(&usage_like)
        .item(&usage_cobalt)
        .build()?;

    let about = MenuItemBuilder::with_id("about", "About IG-Now").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit IG-Now").build(app)?;

    let separator_navigation = PredefinedMenuItem::separator(app)?;
    let separator_view = PredefinedMenuItem::separator(app)?;
    let separator_tools = PredefinedMenuItem::separator(app)?;
    let separator_about = PredefinedMenuItem::separator(app)?;

    Ok(MenuBuilder::new(app)
        .item(&ig_home)
        .item(&ig_explore)
        .item(&ig_reels)
        .item(&ig_msgs)
        .item(&ig_notif)
        .item(&ig_profile)
        .item(&separator_navigation)
        .item(&refresh)
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .item(&always_top)
        .item(&separator_view)
        .item(&clear_mem)
        .item(&devtools)
        .item(&copy_url)
        .item(&open_browser)
        .item(&cobalt_guide)
        .item(&separator_tools)
        .item(&usage)
        .item(&about)
        .item(&separator_about)
        .item(&quit)
        .build()?)
}

fn launch_instagram_in_background(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = crate::launch_instagram_internal(&app) {
            eprintln!("[IG-Now] Failed to launch Instagram: {}", error);
        }
    });
}

fn active_instagram(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("instagram")
}

fn navigate(app: &AppHandle, path: &str) {
    if let Some(window) = active_instagram(app) {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval(&format!(
            "window.location.href = 'https://www.instagram.com{}';",
            path
        ));
    }
}

fn show_about(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval("document.getElementById('ignow-about-modal').hidden = false;");
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let menu = build_menu(app)?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| std::io::Error::other("failed to get default window icon"))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("IG-Now")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "ig_home" => navigate(app, "/"),
            "ig_explore" => navigate(app, "/explore/"),
            "ig_reels" => navigate(app, "/reels/"),
            "ig_msgs" => navigate(app, "/direct/inbox/"),
            "ig_notif" => navigate(app, "/notifications/"),
            "ig_profile" => navigate(app, "/accounts/edit/"),
            "refresh" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval("window.location.reload();");
                }
            }
            "always_top" => {
                if let Some(window) = active_instagram(app) {
                    if let Ok(is_top) = window.is_always_on_top() {
                        let _ = window.set_always_on_top(!is_top);
                    }
                }
            }
            "zoom_in" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(
                        "document.body.style.zoom = (parseFloat(document.body.style.zoom || '1') + 0.1).toFixed(1);",
                    );
                }
            }
            "zoom_out" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(
                        "document.body.style.zoom = Math.max(0.5, (parseFloat(document.body.style.zoom || '1') - 0.1)).toFixed(1);",
                    );
                }
            }
            "zoom_reset" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval("document.body.style.zoom = '1';");
                }
            }
            "clear_mem" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(
                        "if (window.caches) caches.keys().then(keys => keys.forEach(key => caches.delete(key)));",
                    );
                }
            }
            "devtools" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.open_devtools();
                }
            }
            "copy_url" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(
                        "navigator.clipboard.writeText(window.location.href).catch(() => {});",
                    );
                }
            }
            "open_browser" => {
                if let Some(window) = active_instagram(app) {
                    if let Ok(url) = window.url() {
                        let url = url.to_string();
                        if (url.starts_with("https://") || url.starts_with("http://"))
                            && !url.contains(['\r', '\n'])
                        {
                            if let Err(error) = app.shell().open(url, None) {
                                eprintln!("[IG-Now] Failed to open the current page in the browser: {error}");
                            }
                        }
                    }
                }
            }
            "cobalt_guide" => {
                if let Err(error) = app.shell().open("https://cobalt.tools/", None) {
                    eprintln!("[IG-Now] Failed to open the Cobalt setup guide: {error}");
                }
            }
            "about" => show_about(app),
            "quit" => std::process::exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                launch_instagram_in_background(&tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
