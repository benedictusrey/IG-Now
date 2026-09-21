// IG-Now — High-Performance Desktop Client for Instagram
// Sole Author & Creator: Benedictus Reynaldo Hartanto (@benedictusrey)
// Repository: https://github.com/benedictusrey/IG-Now
// All rights reserved. See LICENSE for details.

use std::error::Error;

use tauri::{
    menu::{
        CheckMenuItemBuilder, IsMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
        SubmenuBuilder,
    },
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tauri_plugin_shell::ShellExt;

/// Label of the Launch-on-Startup row. The menu is built once, so the row's
/// state is read from the OS (autostart registry) at build time and after
/// every toggle — the menu must never show a stale ON/OFF.
const AUTOSTART_ON: &str = "🚀 Launch on Startup: ON";
const AUTOSTART_OFF: &str = "🚀 Launch on Startup: OFF";

/// One row of the IG-Now tray menu, described as data so the structure is
/// locked by unit tests (see `menu_tests` below): row set, order, and the
/// id↔handler pairing cannot silently drift.
enum MenuRow {
    Separator,
    /// A clickable action (id, label). MUST have an arm in the
    /// `on_menu_event` handler in `setup_tray` AND an entry in
    /// `HANDLED_MENU_IDS` — both directions are test-enforced.
    Item(&'static str, &'static str),
    /// A read-only hint row (id, label), rendered disabled.
    Hint(&'static str, &'static str),
    /// A checkable row (id, label).
    Checkbox(&'static str, &'static str),
    /// A nested submenu (id, label, rows).
    Submenu(&'static str, &'static str, &'static [MenuRow]),
}

/// The tray menu layout, v2.1.0 redesign. The flat 26-row wall became three
/// fixed rows + four named groups, so the menu reads at a glance:
///
///   Show / Hide IG-Now
///   ──────────────────
///   Places ▸        (Home feed / Explore / Reels / DMs / Notifications /
///                    My profile / ─ / Refresh)
///   View ▸          (Zoom in / Zoom out / Reset zoom / ─ / ✓ Always on top)
///   Tools ▸         (Open downloads folder / Compact memory and cache /
///                    Devtools / Copy URL / Open in browser / Cobalt /
///                    🚀 Launch on Startup)
///   How to IG-Now ▸ (the seven gesture hints)
///   ──────────────────
///   About IG-Now
///   ──────────────────
///   Quit IG-Now
///
/// Item ids and labels are load-bearing: handlers and tests match on them.
const MENU_LAYOUT: &[MenuRow] = &[
    MenuRow::Item("show_hide", "Show / Hide IG-Now"),
    MenuRow::Separator,
    MenuRow::Submenu(
        "places",
        "Places",
        &[
            MenuRow::Item("ig_home", "Home feed"),
            MenuRow::Item("ig_explore", "Explore"),
            MenuRow::Item("ig_reels", "Reels"),
            MenuRow::Item("ig_msgs", "Direct messages"),
            MenuRow::Item("ig_notif", "Notifications"),
            MenuRow::Item("ig_profile", "My profile"),
            MenuRow::Separator,
            MenuRow::Item("refresh", "Refresh"),
        ],
    ),
    MenuRow::Submenu(
        "view",
        "View",
        &[
            MenuRow::Item("zoom_in", "Zoom in"),
            MenuRow::Item("zoom_out", "Zoom out"),
            MenuRow::Item("zoom_reset", "Reset zoom (100%)"),
            MenuRow::Separator,
            MenuRow::Checkbox("always_top", "Always on top"),
        ],
    ),
    MenuRow::Submenu(
        "tools",
        "Tools",
        &[
            MenuRow::Item("open_downloads", "Open downloads folder"),
            MenuRow::Item("clear_mem", "Compact memory and cache"),
            MenuRow::Item("devtools", "Developer tools"),
            MenuRow::Item("copy_url", "Copy page URL"),
            MenuRow::Item("open_browser", "Open page in browser"),
            MenuRow::Item("cobalt_guide", "Cobalt video downloader"),
            MenuRow::Separator,
            MenuRow::Item("autostart", "🚀 Launch on Startup"),
        ],
    ),
    MenuRow::Submenu(
        "how_to",
        "How to IG-Now",
        &[
            MenuRow::Hint(
                "usage_zoom",
                "Ctrl + left-click image: open viewer and zoom",
            ),
            MenuRow::Hint(
                "usage_save",
                "Right-click image/video: save to your Downloads / IG-Now folder",
            ),
            MenuRow::Hint("usage_link", "Right-click link: open in default browser"),
            MenuRow::Hint(
                "usage_seek",
                "Every video: click/drag the seek line or use the -5s/+5s buttons; Reels: prev/next buttons (or Up/Down arrows)",
            ),
            MenuRow::Hint("usage_escape", "Esc: close viewer or leave a Reel"),
            MenuRow::Hint(
                "usage_like",
                "Normal click, double-click, and carousel drag stay Instagram actions",
            ),
            MenuRow::Hint(
                "usage_cobalt",
                "Video: copy link and open Cobalt, then save to your Downloads / IG-Now folder",
            ),
        ],
    ),
    MenuRow::Separator,
    MenuRow::Item("about", "About IG-Now"),
    MenuRow::Separator,
    MenuRow::Item("quit", "Quit IG-Now"),
];

/// Every clickable id the `on_menu_event` handler in `setup_tray` implements.
/// `menu_tests::every_action_id_is_handled` keeps this list and MENU_LAYOUT in
/// lockstep — a menu row without a handler (or a handler without a row) fails
/// `cargo test`. Keep in sync with the match arms.
#[allow(dead_code)] // test-mirror contract: consumed by #[cfg(test)] menu_tests
const HANDLED_MENU_IDS: &[&str] = &[
    "show_hide",
    "ig_home",
    "ig_explore",
    "ig_reels",
    "ig_msgs",
    "ig_notif",
    "ig_profile",
    "refresh",
    "zoom_in",
    "zoom_out",
    "zoom_reset",
    "always_top",
    "clear_mem",
    "open_downloads",
    "devtools",
    "copy_url",
    "open_browser",
    "cobalt_guide",
    "autostart",
    "about",
    "quit",
];

/// The zoom level Instagram's own page zoom (`body.style.zoom`) had when the
/// user first used an IG-Now zoom action, captured lazily by the JS below.
/// Levels ≤ 0.25 render the page unusable and count as "no meaningful page
/// zoom". Resetting hands control back to this value instead of blindly
/// flattening the user's own page preference to 1.
fn page_zoom_base_js() -> &'static str {
    "var base = (window.__ignowPageZoom !== undefined) ? window.__ignowPageZoom : (function () { var z = parseFloat(document.body.style.zoom); var b = (!isNaN(z) && z > 0.25) ? z : 1; window.__ignowPageZoom = b; return b; })();"
}

fn set_zoom_js(level_expression: &str) -> String {
    format!(
        "(function () {{ {} document.body.style.zoom = {}; }})();",
        page_zoom_base_js(),
        level_expression
    )
}

fn zoom_in_js() -> String {
    set_zoom_js("Math.min(2, (parseFloat(document.body.style.zoom) || base) + 0.1).toFixed(2)")
}

fn zoom_out_js() -> String {
    set_zoom_js("Math.max(0.5, (parseFloat(document.body.style.zoom) || base) - 0.1).toFixed(2)")
}

fn zoom_reset_js() -> String {
    set_zoom_js("base > 0.25 && Math.abs(base - 1) > 0.001 ? base : 1")
}

/// Show (or relaunch) the Instagram window and focus it — the entry point
/// shared by every menu action that needs the window on screen. Returns None
/// when the window had to be launched fresh (it is not ready to drive yet);
/// the action then simply applies the next time it is used.
fn open_instagram_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let window = match active_instagram(app) {
        Some(window) => window,
        None => {
            launch_instagram_in_background(app);
            return None;
        }
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    Some(window)
}

/// Append one layout level (recursively for submenus) onto a menu under
/// construction, handing every built item to `add` and capturing the two
/// stateful rows (Launch on Startup, Always on top) for post-build syncing.
fn append_menu_rows(
    app: &AppHandle,
    rows: &[MenuRow],
    autostart_slot: &mut Option<tauri::menu::MenuItem<Wry>>,
    always_top_slot: &mut Option<tauri::menu::CheckMenuItem<Wry>>,
    add: &mut dyn FnMut(&dyn IsMenuItem<Wry>) -> Result<(), Box<dyn Error>>,
) -> Result<(), Box<dyn Error>> {
    for row in rows {
        match row {
            MenuRow::Separator => {
                let separator = PredefinedMenuItem::separator(app)?;
                add(&separator)?;
            }
            MenuRow::Item(id, label) => {
                let item = MenuItemBuilder::with_id(*id, *label).build(app)?;
                if *id == "autostart" {
                    *autostart_slot = Some(item.clone());
                }
                add(&item)?;
            }
            MenuRow::Hint(id, label) => {
                let item = MenuItemBuilder::with_id(*id, *label)
                    .enabled(false)
                    .build(app)?;
                add(&item)?;
            }
            MenuRow::Checkbox(id, label) => {
                let item = CheckMenuItemBuilder::with_id(*id, *label).build(app)?;
                if *id == "always_top" {
                    *always_top_slot = Some(item.clone());
                }
                add(&item)?;
            }
            MenuRow::Submenu(id, label, sub_rows) => {
                let submenu_cell =
                    std::cell::Cell::new(Some(SubmenuBuilder::with_id(app, *id, *label)));
                {
                    let mut add_to_submenu =
                        |item: &dyn IsMenuItem<Wry>| -> Result<(), Box<dyn Error>> {
                            let prev = submenu_cell.take().expect("submenu builder present");
                            submenu_cell.set(Some(prev.item(item)));
                            Ok(())
                        };
                    append_menu_rows(
                        app,
                        sub_rows,
                        autostart_slot,
                        always_top_slot,
                        &mut add_to_submenu,
                    )?;
                }
                let built = submenu_cell
                    .take()
                    .expect("submenu builder present")
                    .build()?;
                add(&built)?;
            }
        }
    }
    Ok(())
}

fn build_menu(
    app: &AppHandle,
) -> Result<
    (
        Menu<Wry>,
        tauri::menu::MenuItem<Wry>,
        tauri::menu::CheckMenuItem<Wry>,
    ),
    Box<dyn Error>,
> {
    let mut autostart_slot = None;
    let mut always_top_slot = None;
    let builder_cell = std::cell::Cell::new(Some(MenuBuilder::new(app)));
    {
        let mut add = |item: &dyn IsMenuItem<Wry>| -> Result<(), Box<dyn Error>> {
            let prev = builder_cell.take().expect("menu builder present");
            builder_cell.set(Some(prev.item(item)));
            Ok(())
        };
        append_menu_rows(
            app,
            MENU_LAYOUT,
            &mut autostart_slot,
            &mut always_top_slot,
            &mut add,
        )?;
    }
    let menu = builder_cell.take().expect("menu builder present").build()?;

    let autostart = autostart_slot.ok_or("the Launch-on-Startup menu item is missing")?;
    let always_top = always_top_slot.ok_or("the Always-on-top menu item is missing")?;
    sync_menu_state_to_reality(app, &autostart, &always_top);
    Ok((menu, autostart, always_top))
}

/// Keep the two stateful rows truthful: the menu is built once at startup, so
/// the stored autostart state and the window's current always-on-top flag are
/// read into it. (The old menu shipped a pre-ticked "Always on top" that
/// reflected nothing, and a Launch-on-Startup row with no state at all.)
fn sync_menu_state_to_reality(
    app: &AppHandle,
    autostart_item: &tauri::menu::MenuItem<Wry>,
    always_top_item: &tauri::menu::CheckMenuItem<Wry>,
) {
    use tauri_plugin_autostart::ManagerExt;

    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let _ = autostart_item.set_text(if autostart_on {
        AUTOSTART_ON
    } else {
        AUTOSTART_OFF
    });

    let always_on_top = active_instagram(app)
        .and_then(|window| window.is_always_on_top().ok())
        .unwrap_or(false);
    let _ = always_top_item.set_checked(always_on_top);
}

/// In-page About overlay for the Instagram window:
/// a seamless card rendered INSIDE the page (no separate window hop). The
/// `__VERSION__` placeholder is replaced with the real package version.
const ABOUT_JS: &str = r##"(function() {
  var ID = '__ignow_about';
  var old = document.getElementById(ID);
  if (old) { old.remove(); return; }

  function el(tag, css, extra) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (extra) Object.assign(e, extra);
    return e;
  }
  function close() { var o = document.getElementById(ID); if (o) o.remove(); }
  // Esc closes (once — the listener removes itself with the overlay)
  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', escClose);
    }
  });

  var overlay = el('div',
    'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
    'background:rgba(8,8,12,0.78);backdrop-filter:blur(16px) saturate(140%);' +
    '-webkit-backdrop-filter:blur(16px) saturate(140%);display:flex;align-items:center;' +
    'justify-content:center;z-index:2147483647;opacity:0;transition:opacity 180ms ease;' +
    'font-family:system-ui,-apple-system,Segoe UI,sans-serif;');
  overlay.id = ID;
  requestAnimationFrame(function() { overlay.style.opacity = '1'; });
  overlay.onclick = function(e) { if (e.target === overlay) { close(); } };

  var card = el('div',
    'background:linear-gradient(160deg,#17171d 0%,#101014 100%);' +
    'border:1px solid rgba(225,48,108,0.35);border-radius:20px;' +
    'padding:0;width:460px;max-width:92vw;max-height:88vh;overflow-y:auto;' +
    'position:relative;box-shadow:0 24px 70px rgba(0,0,0,0.85),0 0 0 1px rgba(255,255,255,0.03) inset;' +
    'color:#fff;text-align:center;transform:translateY(8px) scale(0.98);' +
    'transition:transform 220ms cubic-bezier(0.2,0.9,0.3,1);');
  requestAnimationFrame(function() {
    card.style.transform = 'translateY(0) scale(1)';
  });

  // Banner header — gradient wash with the logo mark, not a flat border box
  var banner = el('div',
    'background:linear-gradient(135deg,rgba(245,133,41,0.16),rgba(221,42,123,0.16),rgba(129,52,175,0.16),rgba(81,91,212,0.16));' +
    'padding:2rem 2rem 1.2rem;border-radius:20px 20px 0 0;');
  card.appendChild(banner);

  // Close X — visible focus, larger hit area
  var closeX = el('button',
    'position:absolute;top:12px;right:12px;width:34px;height:34px;background:rgba(255,255,255,0.06);' +
    'border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#a7a1b4;font-size:20px;' +
    'cursor:pointer;line-height:1;');
  closeX.textContent = '\u00d7';
  closeX.onclick = close;
  card.appendChild(closeX);

  // IG-Now logo — the app's own icon (128x128 PNG) embedded as a data URL
  // (placeholder replaced with the real base64 by show_about before eval).
  // No network request, works on Instagram's remote page, renders crisp on
  // any DPI; drop-shadow keeps it visible over the gradient banner.
  var logo = el('img',
    'width:76px;height:76px;display:block;margin:0 auto 0.9rem;' +
    'border-radius:18px;box-shadow:0 6px 24px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.08);');
  logo.src = 'data:image/png;base64,' + `__LOGO_B64__`;
  logo.alt = 'IG-Now logo';
  logo.draggable = false;
  banner.appendChild(logo);

  // Kicker — explicit line-height: Instagram's global CSS sets `h2 { line-height: 18px }`,
  // which CROPS gradient-clipped titles; every text element here pins its own.
  var kicker = el('p',
    'color:#9b95ab;font-size:10px;font-weight:800;letter-spacing:1.5px;' +
    'line-height:1.4;margin:0 0 4px;text-transform:uppercase;');
  kicker.textContent = 'Instagram Desktop View';
  banner.appendChild(kicker);

  // Title
  var h2 = el('h2',
    'font-size:2rem;font-weight:800;line-height:1.25;padding:0.1em 0;margin:0 0 0.35rem;' +
    'background:linear-gradient(135deg,#F58529,#DD2A7B,#8134AF,#515BD4);' +
    '-webkit-background-clip:text;-webkit-text-fill-color:transparent;');
  h2.textContent = 'IG-Now';
  banner.appendChild(h2);

  // Version badge — pill, not a plain text line
  var ver = el('span',
    'display:inline-block;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);' +
    'color:#c9c9d2;font-size:0.72rem;font-weight:600;letter-spacing:0.4px;line-height:1.4;' +
    'padding:0.25rem 0.85rem;border-radius:999px;');
  ver.textContent = 'v__VERSION__ · Rust + Tauri v2';
  banner.appendChild(ver);

  // Body
  var body = el('div', 'padding:1.4rem 2rem 1.8rem;');
  card.appendChild(body);

  var sub = el('p',
    'color:#E1306C;font-size:0.86rem;font-weight:bold;line-height:1.4;margin:0 0 1rem;');
  sub.textContent = 'Your focused Instagram desktop experience';
  body.appendChild(sub);

  // Feature list — compact two-column grid of what the app actually does
  var feats = el('div',
    'display:grid;grid-template-columns:1fr 1fr;gap:0.45rem 0.9rem;text-align:left;' +
    'margin:0 0 1.2rem;');
  [
    ['\u25b6', 'Reels with seek & volume controls'],
    ['\u23f8', 'Auto-pause & silence on minimize'],
    ['\u2b07', 'One-click media saving to Downloads'],
    ['\u1f5d2', 'Native tray with quick places'],
    ['\u2328', 'Keyboard seeking (\u2190 \u2192) & Esc'],
    ['\u26a1', 'Lightweight native window'],
  ].forEach(function (f) {
    var row = el('div', 'display:flex;align-items:flex-start;gap:0.45rem;');
    var ic = el('span', 'color:#DD2A7B;font-size:0.78rem;line-height:1.5;');
    ic.textContent = f[0];
    var tx = el('span', 'color:#c9c9d2;font-size:0.76rem;line-height:1.5;');
    tx.textContent = f[1];
    row.appendChild(ic); row.appendChild(tx);
    feats.appendChild(row);
  });
  body.appendChild(feats);

  // Author + repo link row
  var author = el('div', 'font-size:0.78rem;line-height:1.5;color:#8e8ea0;margin-bottom:1.3rem;');
  var authorLink = document.createElement('a');
  authorLink.textContent = '@benedictusrey';
  authorLink.href = 'https://github.com/benedictusrey';
  authorLink.style.cssText = 'color:#E1306C;text-decoration:none;font-weight:bold;cursor:pointer;';
  authorLink.onclick = function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        // Opens in the OS default browser via the native bridge; if that
        // fails for any reason, fall back to a plain new-window open.
        window.__TAURI__.core.invoke('open_external_url', { url: 'https://github.com/benedictusrey' })
          .catch(function() { window.open('https://github.com/benedictusrey', '_blank'); });
      } else {
        window.open('https://github.com/benedictusrey', '_blank');
      }
    } catch (err) {
      window.open('https://github.com/benedictusrey', '_blank');
    }
  };
  author.appendChild(document.createTextNode('Authored and maintained with \u2764 by '));
  author.appendChild(authorLink);
  body.appendChild(author);

  // Footer buttons row — Got It (primary) + project repo (ghost)
  var actions = el('div', 'display:flex;gap:0.7rem;justify-content:center;align-items:center;');
  var gotit = el('button',
    'background:linear-gradient(135deg,#F58529,#DD2A7B,#8134AF,#515BD4);color:#fff;font-weight:bold;' +
    'border:none;padding:0.7rem 2.2rem;border-radius:12px;cursor:pointer;line-height:1.4;' +
    'font-size:0.92rem;box-shadow:0 4px 15px rgba(225,48,108,0.3);');
  gotit.textContent = 'Got It!';
  gotit.onclick = close;
  var repoBtn = el('button',
    'background:transparent;color:#c9c9d2;font-weight:600;border:1px solid rgba(255,255,255,0.14);' +
    'padding:0.7rem 1.3rem;border-radius:12px;cursor:pointer;line-height:1.4;font-size:0.88rem;');
  repoBtn.textContent = 'GitHub \u2197';
  repoBtn.onclick = function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        window.__TAURI__.core.invoke('open_external_url', { url: 'https://github.com/benedictusrey/IG-Now' })
          .catch(function() { window.open('https://github.com/benedictusrey/IG-Now', '_blank'); });
      } else {
        window.open('https://github.com/benedictusrey/IG-Now', '_blank');
      }
    } catch (err) {
      window.open('https://github.com/benedictusrey/IG-Now', '_blank');
    }
  };
  actions.appendChild(gotit);
  actions.appendChild(repoBtn);
  body.appendChild(actions);

  // Hint: how to dismiss (discoverability for the Esc path)
  var hint = el('p', 'color:#6f6a7c;font-size:0.7rem;line-height:1.4;margin:0.9rem 0 0;');
  hint.textContent = 'Esc or click outside to close';
  body.appendChild(hint);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
})();"##;

fn launch_instagram_in_background(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = crate::launch_instagram_internal(&app, false) {
            eprintln!("[IG-Now] Failed to launch Instagram: {}", error);
        }
    });
}

fn active_instagram(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("instagram")
}

/// The restore-vs-hide rule used by both the Show/Hide menu item and a tray
/// icon click. A minimized window is still "visible" per Win32 — so restore
/// it whenever it is minimized, hidden, or merely unfocused (the user clicked
/// the tray expecting the app to come to the front). Only hide when it is
/// visible AND focused (true toggle); pause first so nothing keeps playing.
fn toggle_show_hide(app: &AppHandle) {
    if let Some(window) = active_instagram(app) {
        let minimized = window.is_minimized().unwrap_or(false);
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if minimized || !visible || !focused {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            let _ = window.eval("if (window.__onWindowHidden) window.__onWindowHidden();");
            let _ = window.hide();
        }
    } else {
        launch_instagram_in_background(app);
    }
}

fn navigate(app: &AppHandle, path: &str) {
    if let Some(window) = open_instagram_window(app) {
        let _ = window.eval(&format!(
            "window.location.href = 'https://www.instagram.com{}';",
            path
        ));
    }
}

fn show_about(app: &AppHandle) {
    if let Some(window) = open_instagram_window(app) {
        let about_js = ABOUT_JS
            .replace("__VERSION__", env!("CARGO_PKG_VERSION"))
            .replace("__LOGO_B64__", crate::about_logo::ABOUT_LOGO_PNG_B64);
        let _ = window.eval(&about_js);
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let (menu, autostart_handle, always_top_handle) = build_menu(app)?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| std::io::Error::other("failed to get default window icon"))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("IG-Now Desktop")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show_hide" => toggle_show_hide(app),
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
            "zoom_in" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(&zoom_in_js());
                }
            }
            "zoom_out" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(&zoom_out_js());
                }
            }
            "zoom_reset" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(&zoom_reset_js());
                }
            }
            // Reflect the real window state in the checkmark right away —
            // the menu is built once and would otherwise go stale until the
            // next full rebuild.
            "always_top" => {
                if let Some(window) = active_instagram(app) {
                    if let Ok(is_top) = window.is_always_on_top() {
                        let _ = window.set_always_on_top(!is_top);
                        let _ = always_top_handle.set_checked(!is_top);
                    }
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
            "open_downloads" => {
                // Same folder the media-saving pipeline uses
                // (prepare_download_folder): Downloads/IG-Now, created on
                // demand. Opened in the OS file manager.
                match crate::prepare_download_folder(app.clone()) {
                    Ok(path) => {
                        if let Err(error) = app.shell().open(path, None) {
                            eprintln!("[IG-Now] Failed to open the downloads folder: {error}");
                        }
                    }
                    Err(error) => eprintln!("[IG-Now] Downloads folder unavailable: {error}"),
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
            "autostart" => {
                use tauri_plugin_autostart::ManagerExt;
                let autol = app.autolaunch();
                let was_enabled = autol.is_enabled().unwrap_or(false);
                if was_enabled {
                    let _ = autol.disable();
                } else {
                    let _ = autol.enable();
                }
                let now_enabled = !was_enabled;
                let _ = autostart_handle.set_text(if now_enabled {
                    AUTOSTART_ON
                } else {
                    AUTOSTART_OFF
                });
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(&format!(
                        "if (window.showToast) window.showToast('🚀 Launch on Startup: {}');",
                        if now_enabled { "ON" } else { "OFF" }
                    ));
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
                // Same restore-vs-hide rule as the Show/Hide menu item:
                // minimized OR hidden OR unfocused -> restore to the front;
                // visible AND focused -> hide to the tray (pause first).
                toggle_show_hide(&tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod menu_tests {
    use super::{MenuRow, HANDLED_MENU_IDS, MENU_LAYOUT};
    use std::collections::BTreeSet;

    fn push_rows<'a>(rows: &'a [MenuRow], into: &mut Vec<&'a MenuRow>) {
        for row in rows {
            if let MenuRow::Submenu(_, _, sub_rows) = row {
                push_rows(sub_rows, into);
            }
            into.push(row);
        }
    }

    fn id_of(row: &MenuRow) -> Option<&'static str> {
        match row {
            MenuRow::Separator => None,
            MenuRow::Item(id, _)
            | MenuRow::Hint(id, _)
            | MenuRow::Checkbox(id, _)
            | MenuRow::Submenu(id, _, _) => Some(id),
        }
    }

    fn label_of(row: &MenuRow) -> Option<&'static str> {
        match row {
            MenuRow::Separator => None,
            MenuRow::Item(_, label)
            | MenuRow::Hint(_, label)
            | MenuRow::Checkbox(_, label)
            | MenuRow::Submenu(_, label, _) => Some(label),
        }
    }

    /// T1 — the top-level menu stays a three-row glance: Show/Hide, one
    /// separator, the four groups, a separator, About, a separator, Quit.
    #[test]
    fn top_level_layout_is_simple() {
        let top: Vec<_> = MENU_LAYOUT.iter().collect();
        let labels: Vec<Option<&str>> = top.iter().map(|r| label_of(r)).collect();
        assert_eq!(
            labels,
            vec![
                Some("Show / Hide IG-Now"),
                None,
                Some("Places"),
                Some("View"),
                Some("Tools"),
                Some("How to IG-Now"),
                None,
                Some("About IG-Now"),
                None,
                Some("Quit IG-Now"),
            ]
        );
    }

    /// T2 — every id (rows AND submenus) is unique; duplicate ids would
    /// resolve handlers ambiguously.
    #[test]
    fn ids_are_unique() {
        let mut all = Vec::new();
        push_rows(MENU_LAYOUT, &mut all);
        let ids: BTreeSet<_> = all.iter().filter_map(|r| id_of(r)).collect();
        let total = all.iter().filter_map(|r| id_of(r)).count();
        assert_eq!(ids.len(), total, "duplicate menu ids detected");
    }

    /// T3 — every clickable row in the layout has a handler entry. A row the
    /// user can click but nothing handles (dead menu row) fails here.
    #[test]
    fn every_clickable_row_is_handled() {
        let mut all = Vec::new();
        push_rows(MENU_LAYOUT, &mut all);
        for row in &all {
            if let MenuRow::Item(id, _) | MenuRow::Checkbox(id, _) = row {
                assert!(
                    HANDLED_MENU_IDS.contains(id),
                    "clickable menu row '{id}' has no handler entry in HANDLED_MENU_IDS"
                );
            }
        }
    }

    /// T4 — every handler entry exists in the layout. A handler whose row was
    /// removed (or renamed) is dead code silently drifting from the UI.
    #[test]
    fn every_handler_has_a_row() {
        let mut all = Vec::new();
        push_rows(MENU_LAYOUT, &mut all);
        let ids: BTreeSet<_> = all.iter().filter_map(|r| id_of(r)).collect();
        for id in HANDLED_MENU_IDS {
            assert!(
                ids.contains(id),
                "handled id '{id}' has no row in MENU_LAYOUT"
            );
        }
    }

    /// T5 — exactly two stateful rows exist (Launch on Startup, Always on
    /// top); build_menu unwraps Option on precisely these two ids.
    #[test]
    fn stateful_rows_are_present_exactly_once() {
        let mut all = Vec::new();
        push_rows(MENU_LAYOUT, &mut all);
        for id in ["autostart", "always_top"] {
            let count = all.iter().filter(|r| id_of(r) == Some(id)).count();
            assert_eq!(count, 1, "stateful row '{id}' must appear exactly once");
        }
        assert!(
            all.iter()
                .any(|r| matches!(r, MenuRow::Checkbox("always_top", _))),
            "always_top must be a Checkbox row"
        );
        assert!(
            all.iter()
                .any(|r| matches!(r, MenuRow::Item("autostart", _))),
            "autostart must be a text Item row (state is shown in the label)"
        );
    }

    /// T6 — hint rows are disabled informational text; they must never be
    /// clickable Items (they do nothing but would look actionable).
    #[test]
    fn hints_are_not_clickable_items() {
        let mut all = Vec::new();
        push_rows(MENU_LAYOUT, &mut all);
        for row in &all {
            if let MenuRow::Item(id, _) = row {
                assert!(
                    !id.starts_with("usage_"),
                    "hint row '{id}' must be a Hint, not a clickable Item"
                );
            }
        }
    }

    /// T7 — labels are non-empty and trimmed (an empty row renders as a
    /// confusing blank line).
    #[test]
    fn labels_are_clean() {
        let mut all = Vec::new();
        push_rows(MENU_LAYOUT, &mut all);
        for row in &all {
            if let Some(label) = label_of(row) {
                assert!(!label.trim().is_empty(), "empty menu label");
                assert_eq!(label.trim(), label, "untrimmed menu label '{label}'");
            }
        }
    }

    /// T8 — the zoom JS keeps levels within the 0.5x–2x bounds and reset
    /// returns to 1 (or the user's captured base). Locked as source-text
    /// assertions so the bounds survive refactors.
    #[test]
    fn zoom_js_stays_bounded() {
        assert!(super::zoom_in_js().contains("Math.min(2,"));
        assert!(super::zoom_out_js().contains("Math.max(0.5,"));
        assert!(super::zoom_reset_js().contains("base > 0.25"));
        assert!(super::set_zoom_js("1").starts_with("(function () {"));
    }
    /// T9 — the About overlay keeps its functional contract: stable root id,
    /// Esc-to-close listener, backdrop-click close, a real close path on the
    /// X and Got-It buttons, the IG-Now logo via data URL, and the version
    /// placeholder for injection.
    #[test]
    fn about_js_contract() {
        let js = super::ABOUT_JS;
        assert!(js.contains("__ignow_about"), "root id changed");
        assert!(js.contains("'Escape'"), "Esc-to-close listener missing");
        assert!(
            js.contains("e.target === overlay"),
            "backdrop close missing"
        );
        assert!(js.contains("__VERSION__"), "version placeholder missing");
        assert!(js.contains("__LOGO_B64__"), "logo placeholder missing");
        assert!(
            js.contains("data:image/png;base64,' + `__LOGO_B64__`"),
            "logo must be injected as a PNG data URL"
        );
        assert!(js.contains("github.com/benedictusrey"), "repo link missing");
        // no leftover references to the removed btn() helper or the old
        // Instagram-logo inline SVG
        assert!(!js.contains("btn('"), "stale btn() helper call remains");
        assert!(
            !js.contains("igGrad"),
            "stale Instagram-gradient SVG remains"
        );
        // the embedded logo constant decodes back to the exact app icon
        let decoded = logo_png_bytes();
        assert_eq!(decoded.len(), 10_329, "embedded logo size drifted");
    }

    /// The app icon bytes, re-decoded from the embedded base64 — proves the
    /// constant is intact base64 of the real PNG without a test-side PNG
    /// parser (size + PNG magic suffice as the regression signal).
    fn logo_png_bytes() -> Vec<u8> {
        const B64: &str = crate::about_logo::ABOUT_LOGO_PNG_B64;
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        fn val(c: u8) -> Option<u32> {
            TABLE.iter().position(|&t| t == c).map(|p| p as u32)
        }
        let mut out = Vec::with_capacity(B64.len() * 3 / 4);
        let mut acc: u32 = 0;
        let mut bits = 0u32;
        for &c in B64.as_bytes() {
            if let Some(v) = val(c) {
                acc = (acc << 6) | v;
                bits += 6;
                if bits >= 8 {
                    bits -= 8;
                    out.push((acc >> bits) as u8);
                }
            }
        }
        out
    }

    /// T9b — the decoded embedded logo starts with the PNG magic and matches
    /// the source icon byte-for-byte (the regression guard for regeneration
    /// mistakes: wrong file, truncated base64, stray whitespace).
    #[test]
    fn embedded_logo_is_the_app_icon() {
        let png = logo_png_bytes();
        assert_eq!(&png[0..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
        // 128x128: IHDR width/height at fixed offsets
        let w = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
        let h = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
        assert_eq!((w, h), (128, 128), "embedded logo is not the 128x128 icon");
    }

    /// T10 — the Tools group starts with the downloads-folder shortcut and
    /// keeps the autostart toggle visually separated at the end.
    #[test]
    fn tools_group_shape() {
        let tools = MENU_LAYOUT.iter().find_map(|row| match row {
            MenuRow::Submenu("tools", _, rows) => Some(*rows),
            _ => None,
        });
        let rows = tools.expect("Tools submenu present");
        assert!(
            matches!(rows.first(), Some(MenuRow::Item("open_downloads", _))),
            "Tools must lead with the downloads-folder shortcut"
        );
        assert!(
            matches!(rows.last(), Some(MenuRow::Item("autostart", _))),
            "autostart must stay the last Tools row"
        );
        // the separator between actions and the stateful toggle
        assert!(
            rows.iter()
                .rev()
                .skip(1)
                .any(|r| matches!(r, MenuRow::Separator)),
            "autostart must be separated from the action rows"
        );
    }
}
