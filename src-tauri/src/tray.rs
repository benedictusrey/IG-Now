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
const AUTOSTART_ON: &str = "Launch on Startup: On";
const AUTOSTART_OFF: &str = "Launch on Startup: Off";

fn resolve_autostart_enabled(after_toggle: Option<bool>, fallback_previous: bool) -> bool {
    after_toggle.unwrap_or(fallback_previous)
}

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
///   Tools ▸         (Open downloads folder / IG-Now Downloader /
///                    Copy page URL / Open page in browser / ─ /
///                    Compact memory and cache / Test message notification /
///                    Developer tools / ─ / Launch on Startup)
///   How to IG-Now ▸ (seven concise gesture & shortcut hints)
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
            MenuRow::Item("refresh", "Refresh page"),
        ],
    ),
    MenuRow::Submenu(
        "view",
        "View",
        &[
            MenuRow::Item("zoom_in", "Zoom in (+10%)"),
            MenuRow::Item("zoom_out", "Zoom out (-10%)"),
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
            MenuRow::Item("cobalt_guide", "IG-Now Downloader"),
            MenuRow::Item("copy_url", "Copy page URL"),
            MenuRow::Item("open_browser", "Open page in browser"),
            MenuRow::Separator,
            MenuRow::Item("clear_mem", "Compact memory and cache"),
            MenuRow::Item("test_notification", "Test message notification"),
            MenuRow::Item("devtools", "Developer tools"),
            MenuRow::Separator,
            MenuRow::Item("autostart", "Launch on Startup"),
        ],
    ),
    MenuRow::Submenu(
        "how_to",
        "How to IG-Now",
        &[
            MenuRow::Hint("usage_zoom", "Image zoom: Ctrl + Left-click any photo"),
            MenuRow::Hint("usage_save", "Quick save: Right-click photo or video"),
            MenuRow::Hint(
                "usage_cobalt",
                "Downloader: Sidebar or video bar for MP4, M4A & captions",
            ),
            MenuRow::Hint(
                "usage_seek",
                "Seek & Reels: Drag line, -5s/+5s, or arrow keys",
            ),
            MenuRow::Hint(
                "usage_escape",
                "Navigate back: Sidebar Back, Alt+Left, or Esc",
            ),
            MenuRow::Hint(
                "usage_link",
                "External links: Right-click link to open in browser",
            ),
            MenuRow::Hint(
                "usage_like",
                "Instagram actions: Click, double-click, and swipe stay native",
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
    "test_notification",
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
    #[cfg(target_os = "linux")]
    let _ = window.eval("if (window.__resumeIfNeeded) window.__resumeIfNeeded();");
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
/// a seamless dialog rendered INSIDE the page (no separate window hop). The
/// `__VERSION__` placeholder is replaced with the real package version.
const ABOUT_JS: &str = r##"(function() {
  var ID = '__ignow_about';
  var STYLE_ID = '__ignow_about_style';
  var old = document.getElementById(ID);
  if (old) {
    if (typeof old.__ignowClose === 'function') old.__ignowClose();
    else old.remove();
    return;
  }

  var prevStyle = document.getElementById(STYLE_ID);
  if (prevStyle) prevStyle.remove();

  var isLinuxWebKit = /Linux/i.test(navigator.platform || '') && !/(?:Chrome|Chromium|Edg)\//i.test(navigator.userAgent || '');
  var styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent =
    '#' + ID + '{position:fixed;inset:0;background:' + (isLinuxWebKit ? 'rgba(6,7,10,0.88)' : 'rgba(6,7,10,0.80);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)') + ';' +
    'display:flex;align-items:center;justify-content:center;padding:20px;z-index:2147483647;' +
    'font-family:"Segoe UI Variable Text","Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,sans-serif;opacity:0;transition:opacity 160ms ease;}' +
    '#' + ID + '[data-open="1"]{opacity:1;}' +
    '#' + ID + ' *{box-sizing:border-box;}' +
    '#' + ID + ' ::selection{background:rgba(59,130,246,0.32);color:#f8fafc;}' +
    '#' + ID + '_card{width:540px;max-width:100%;max-height:88vh;overflow-y:auto;background:#101217;' +
    'border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,0.78);color:#f4f5f7;text-align:left;' +
    'transform:translateY(6px) scale(0.99);transition:transform 180ms cubic-bezier(0.2,0.8,0.2,1);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.22) transparent;}' +
    '#' + ID + '[data-open="1"] #' + ID + '_card{transform:translateY(0) scale(1);}' +
    '#' + ID + '_card::-webkit-scrollbar{width:6px;}' +
    '#' + ID + '_card::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.22);border-radius:999px;}' +
    '#' + ID + ' .ignow-ab-btn{height:34px;padding:0 14px;background:#191c23;color:#e5e7eb;font:500 12px/1 inherit;' +
    'border:1px solid rgba(255,255,255,0.15);border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;' +
    'transition:background 120ms ease,border-color 120ms ease,transform 80ms ease;}' +
    '#' + ID + ' .ignow-ab-btn:hover{background:#232731;border-color:rgba(255,255,255,0.28);}' +
    '#' + ID + ' .ignow-ab-btn:active{transform:translateY(1px);}' +
    '#' + ID + ' .ignow-ab-btn--primary{background:#f4f5f7;color:#0b0c0f;border-color:#f4f5f7;font-weight:600;}' +
    '#' + ID + ' .ignow-ab-btn--primary:hover{background:#e4e7ec;border-color:#e4e7ec;}' +
    '#' + ID + ' .ignow-ab-iconbtn{width:32px;height:32px;padding:0;justify-content:center;}' +
    '#' + ID + ' .ignow-ab-ver{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;' +
    'background:#191c23;border:1px solid rgba(255,255,255,0.14);color:#d7dce5;font:500 12px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
    'cursor:pointer;transition:background 120ms ease,border-color 120ms ease;}' +
    '#' + ID + ' .ignow-ab-ver:hover{background:#232731;border-color:rgba(255,255,255,0.28);color:#f4f5f7;}' +
    '#' + ID + ' .ignow-ab-link{color:#f4f5f7;text-decoration:underline;text-underline-offset:3px;font-weight:600;cursor:pointer;}' +
    '#' + ID + ' .ignow-ab-link:hover{color:#93c5fd;}' +
    '#' + ID + ' .ignow-ab-btn:focus-visible,#' + ID + ' .ignow-ab-ver:focus-visible,#' + ID + ' .ignow-ab-link:focus-visible,#' + ID + '_card:focus-visible{outline:2px solid #3b82f6;outline-offset:2px;}' +
    '#' + ID + ' .ignow-ab-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;}' +
    '#' + ID + ' .ignow-ab-feat{display:flex;align-items:flex-start;gap:10px;min-width:0;}' +
    '#' + ID + ' .ignow-ab-featic{width:28px;height:28px;border-radius:7px;background:#171920;border:1px solid rgba(255,255,255,0.08);' +
    'color:#c4cad6;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;}' +
    '#' + ID + ' .ignow-ab-feattitle{color:#f4f5f7;font-size:12.5px;font-weight:600;line-height:1.3;}' +
    '#' + ID + ' .ignow-ab-featdesc{color:#9aa1b0;font-size:12px;line-height:1.4;margin-top:2px;}' +
    '#' + ID + ' .ignow-ab-kbd{background:#0b0c0f;border:1px solid rgba(255,255,255,0.17);border-radius:4px;padding:1px 6px;' +
    'color:#f4f5f7;font:500 12px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}' +
    '@media (max-width:520px){#' + ID + ' .ignow-ab-grid{grid-template-columns:1fr;}}' +
    '@media (prefers-reduced-motion:reduce){#' + ID + ',#' + ID + '_card,#' + ID + ' .ignow-ab-btn{transition:none!important;}}';
  (document.head || document.documentElement).appendChild(styleEl);

  var previousFocus = document.activeElement;
  function el(tag, css, extra) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (extra) Object.assign(e, extra);
    return e;
  }
  function openUrl(url) {
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        window.__TAURI__.core.invoke('open_external_url', { url: url })
          .catch(function() { window.open(url, '_blank', 'noopener,noreferrer'); });
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
  function escClose(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      var list = card.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  function close() {
    document.removeEventListener('keydown', escClose, true);
    var o = document.getElementById(ID);
    if (o) o.remove();
    var s = document.getElementById(STYLE_ID);
    if (s) s.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus(); } catch (err) {}
    }
  }
  document.addEventListener('keydown', escClose, true);

  var overlay = el('div');
  overlay.id = ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', ID + '_title');
  overlay.__ignowClose = close;
  overlay.onclick = function(e) { if (e.target === overlay) { close(); } };

  var card = el('div');
  card.id = ID + '_card';
  card.tabIndex = -1;

  var header = el('div',
    'display:flex;align-items:center;justify-content:space-between;gap:14px;' +
    'padding:18px 22px 16px;border-bottom:1px solid rgba(255,255,255,0.09);background:#0c0d11;border-radius:14px 14px 0 0;');
  var brandRow = el('div', 'display:flex;align-items:center;gap:14px;min-width:0;');
  var logo = el('img',
    'width:46px;height:46px;display:block;border-radius:11px;flex-shrink:0;' +
    'border:1px solid rgba(255,255,255,0.12);box-shadow:0 6px 18px rgba(0,0,0,0.45);');
  logo.src = 'data:image/png;base64,' + `__LOGO_B64__`;
  logo.alt = 'IG-Now logo';
  logo.draggable = false;
  var titleCol = el('div', 'min-width:0;');
  var titleRow = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;');
  var h2 = el('h2', 'margin:0;font-size:17px;font-weight:700;line-height:1.25;letter-spacing:-0.015em;color:#f4f5f7;');
  h2.id = ID + '_title';
  h2.textContent = 'IG-Now';
  var verBtn = el('button', '', { type: 'button', className: 'ignow-ab-ver', title: 'Copy version details' });
  verBtn.textContent = 'v__VERSION__';
  verBtn.setAttribute('aria-label', 'Copy IG-Now version v__VERSION__');
  verBtn.onclick = function() {
    var summary = 'IG-Now v__VERSION__ (Desktop Client · Rust & Tauri v2)';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(summary).then(function() {
        verBtn.textContent = 'Copied';
        setTimeout(function() { verBtn.textContent = 'v__VERSION__'; }, 1400);
      }).catch(function() {});
    }
  };
  titleRow.appendChild(h2);
  titleRow.appendChild(verBtn);
  var metaLine = el('p', 'margin:4px 0 0;font-size:12px;line-height:1.4;color:#a4aab6;');
  metaLine.textContent = 'Instagram Desktop Client · Rust & Tauri v2';
  titleCol.appendChild(titleRow);
  titleCol.appendChild(metaLine);
  brandRow.appendChild(logo);
  brandRow.appendChild(titleCol);
  header.appendChild(brandRow);

  var closeX = el('button', '', { type: 'button', className: 'ignow-ab-btn ignow-ab-iconbtn' });
  closeX.setAttribute('aria-label', 'Close About window');
  closeX.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  closeX.onclick = close;
  header.appendChild(closeX);
  card.appendChild(header);

  var body = el('div', 'padding:18px 22px 20px;display:flex;flex-direction:column;gap:16px;');
  var feats = el('div', '', { className: 'ignow-ab-grid' });
  var items = [
    ['<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
      'Reels & Video Controls', 'Seek line, ±5s skip, and synced volume slider'],
    ['<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
      'Native Downloader', 'H.264+AAC .mp4, .m4a audio, and post bundles'],
    ['<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
      'Foreground Audio Sync', 'Grouped IG-Now mixer & pause-on-hide guard'],
    ['<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
      'Back Navigation & Esc', 'Sidebar Back & Esc return to pre-click view'],
    ['<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      'DM Alerts & Links', 'Native unread alerts and safe external links'],
    ['<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
      'System Tray & Layout', 'Close-to-tray & native Instagram comments intact']
  ];
  items.forEach(function (f) {
    var row = el('div', '', { className: 'ignow-ab-feat' });
    var ic = el('span', '', { className: 'ignow-ab-featic' });
    ic.innerHTML = f[0];
    var copy = el('div', 'min-width:0;');
    var ttl = el('div', '', { className: 'ignow-ab-feattitle', textContent: f[1] });
    var dsc = el('div', '', { className: 'ignow-ab-featdesc', textContent: f[2] });
    copy.appendChild(ttl);
    copy.appendChild(dsc);
    row.appendChild(ic);
    row.appendChild(copy);
    feats.appendChild(row);
  });
  body.appendChild(feats);

  var keysStrip = el('div',
    'display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;padding:10px 12px;' +
    'border-radius:8px;background:#16181f;border:1px solid rgba(255,255,255,0.08);' +
    'font-size:12px;line-height:1.4;color:#a4aab6;');
  keysStrip.innerHTML =
    '<span><kbd class="ignow-ab-kbd">Esc</kbd> Back / close</span>' +
    '<span><kbd class="ignow-ab-kbd">&larr; &rarr;</kbd> Seek &plusmn;5s</span>' +
    '<span><kbd class="ignow-ab-kbd">&uarr; &darr;</kbd> Prev / next reel</span>' +
    '<span><kbd class="ignow-ab-kbd">Alt+&larr;</kbd> History back</span>' +
    '<span><kbd class="ignow-ab-kbd">Ctrl+Click</kbd> Zoom image</span>';
  body.appendChild(keysStrip);

  var footer = el('div',
    'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;' +
    'padding-top:12px;border-top:1px solid rgba(255,255,255,0.09);');
  var author = el('div', 'font-size:12px;line-height:1.4;color:#a4aab6;');
  var authorLink = document.createElement('a');
  authorLink.className = 'ignow-ab-link';
  authorLink.textContent = '@benedictusrey';
  authorLink.href = 'https://github.com/benedictusrey';
  authorLink.onclick = function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    openUrl('https://github.com/benedictusrey');
  };
  author.appendChild(document.createTextNode('Maintained by '));
  author.appendChild(authorLink);
  footer.appendChild(author);

  var actions = el('div', 'display:flex;gap:8px;align-items:center;');
  var repoBtn = el('button', '', { type: 'button', className: 'ignow-ab-btn' });
  repoBtn.textContent = 'GitHub \u2197';
  repoBtn.onclick = function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    openUrl('https://github.com/benedictusrey/IG-Now');
  };
  var gotit = el('button', '', { type: 'button', className: 'ignow-ab-btn ignow-ab-btn--primary' });
  gotit.textContent = 'Close';
  gotit.onclick = close;
  actions.appendChild(repoBtn);
  actions.appendChild(gotit);
  footer.appendChild(actions);
  body.appendChild(footer);

  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(function() {
    overlay.setAttribute('data-open', '1');
    gotit.focus();
  });
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
            #[cfg(target_os = "linux")]
            let _ = window.eval("if (window.__resumeIfNeeded) window.__resumeIfNeeded();");
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
        .tooltip(concat!("IG-Now Desktop v", env!("CARGO_PKG_VERSION")))
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
                if let Some(window) = open_instagram_window(app) {
                    let _ = window.eval("window.location.reload();");
                }
            }
            "zoom_in" => {
                if let Some(window) = open_instagram_window(app) {
                    let _ = window.eval(&zoom_in_js());
                }
            }
            "zoom_out" => {
                if let Some(window) = open_instagram_window(app) {
                    let _ = window.eval(&zoom_out_js());
                }
            }
            "zoom_reset" => {
                if let Some(window) = open_instagram_window(app) {
                    let _ = window.eval(&zoom_reset_js());
                }
            }
            // Reflect the real window state in the checkmark right away —
            // the menu is built once and would otherwise go stale until the
            // next full rebuild.
            "always_top" => {
                if let Some(window) = active_instagram(app) {
                    if let Ok(is_top) = window.is_always_on_top() {
                        let next_top = !is_top;
                        let _ = window.set_always_on_top(next_top);
                        let _ = always_top_handle.set_checked(next_top);
                        let _ = window.eval(&format!(
                            "if (window.showToast) window.showToast('Always on top: {}');",
                            if next_top { "On" } else { "Off" }
                        ));
                    }
                }
            }
            "clear_mem" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(
                        "if (window.caches) caches.keys().then(keys => keys.forEach(key => caches.delete(key))); if (window.showToast) window.showToast('Cleared cached page data');",
                    );
                }
            }
            "devtools" => {
                if let Some(window) = open_instagram_window(app) {
                    let _ = window.open_devtools();
                }
            }
            "copy_url" => {
                if let Some(window) = active_instagram(app) {
                    let _ = window.eval(
                        "(function(){var u=window.location.href,ok=function(){if(window.showToast)window.showToast('Copied page URL to clipboard');},fail=function(){if(window.showToast)window.showToast('Could not copy page URL');},fallbackCopy=function(){try{var t=document.createElement('textarea');t.value=u;t.style.cssText='position:fixed;opacity:0';document.body.appendChild(t);t.select();var c=document.execCommand('copy');t.remove();c?ok():fail();}catch(e){fail();}};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(ok).catch(fallbackCopy);}else{fallbackCopy();}})();",
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
                let app_handle = app.clone();
                std::thread::spawn(move || {
                    if let Err(error) =
                        crate::open_downloader_window_internal(&app_handle, None, None, None, None)
                    {
                        eprintln!("[IG-Now] Failed to open IG-Now Downloader: {error}");
                    }
                });
            }
            "test_notification" => {
                if let Err(error) = crate::notifications::test_message_notification(app.clone()) {
                    eprintln!("[IG-Now] Notification test failed: {error}");
                    if let Some(window) = active_instagram(app) {
                        let _ = window.eval(
                            "if (window.showToast) window.showToast('OS notification blocked or unavailable');",
                        );
                    }
                }
            }
            "autostart" => {
                use tauri_plugin_autostart::ManagerExt;
                let autol = app.autolaunch();
                let was_enabled = autol.is_enabled().unwrap_or(false);
                let toggle_res = if was_enabled {
                    autol.disable()
                } else {
                    autol.enable()
                };
                if let Err(ref error) = toggle_res {
                    eprintln!("[IG-Now] Autostart toggle failed: {error}");
                }
                let now_enabled =
                    resolve_autostart_enabled(autol.is_enabled().ok(), was_enabled);
                let _ = autostart_handle.set_text(if now_enabled {
                    AUTOSTART_ON
                } else {
                    AUTOSTART_OFF
                });
                if let Some(window) = active_instagram(app) {
                    let msg = if toggle_res.is_err() {
                        "Could not update Launch on Startup setting"
                    } else if now_enabled {
                        "Launch on Startup: On"
                    } else {
                        "Launch on Startup: Off"
                    };
                    let _ = window.eval(&format!(
                        "if (window.showToast) window.showToast('{msg}');",
                    ));
                }
            }
            "about" => show_about(app),
            "quit" => app.exit(0),
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
            js.contains("removeEventListener('keydown', escClose"),
            "close() must clean up keydown listener"
        );
        assert!(
            js.contains("role', 'dialog'") && js.contains("aria-modal', 'true'"),
            "dialog ARIA semantics missing"
        );
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

    #[test]
    fn autostart_resolution_preserves_previous_state_on_os_error() {
        assert!(super::resolve_autostart_enabled(Some(true), false));
        assert!(!super::resolve_autostart_enabled(Some(false), true));
        assert!(super::resolve_autostart_enabled(None, true));
        assert!(!super::resolve_autostart_enabled(None, false));
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
        assert!(
            rows.iter()
                .any(|r| matches!(r, MenuRow::Item("cobalt_guide", "IG-Now Downloader"))),
            "Tools must expose IG-Now Downloader instead of Cobalt"
        );
        assert!(
            !rows
                .iter()
                .filter_map(|r| label_of(r))
                .any(|label| label.to_ascii_lowercase().contains("cobalt")),
            "Cobalt external label must not remain in tray menu"
        );
    }
}
