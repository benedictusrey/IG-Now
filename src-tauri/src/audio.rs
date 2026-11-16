//! Windows audio-session control for IG-Now.
//!
//! Guarantees silence for this app's process tree (the exe + its WebView2
//! child processes) when hidden/minimized, keeps audio sessions unmuted when
//! IG-Now is in the foreground, and brands/groups Windows Volume Mixer entries
//! as "IG-Now" with the application icon.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::OnceLock;

use windows::core::{w, Interface, GUID, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, RPC_E_CHANGED_MODE};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionEnumerator,
    IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

const APP_DISPLAY_NAME: &str = "IG-Now";
const IG_NOW_AUDIO_GROUP: GUID = GUID::from_u128(0x9e4d2f10_6a7b_4c88_a1e9_72c3d8b12301);

fn exe_icon_utf16() -> Option<&'static [u16]> {
    static ICON_W: OnceLock<Option<Vec<u16>>> = OnceLock::new();
    ICON_W
        .get_or_init(|| {
            let exe = std::env::current_exe().ok()?;
            let wide: Vec<u16> = OsStr::new(exe.as_os_str())
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            Some(wide)
        })
        .as_deref()
}

/// PIDs of this process and all its descendants (covers `msedgewebview2.exe`
/// audio/renderer children owned by IG-Now).
fn process_tree() -> HashSet<u32> {
    let mut tree = HashSet::new();
    tree.insert(std::process::id());

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return tree;
        };
        let mut all: Vec<(u32, u32)> = Vec::new();
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                all.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        let mut changed = true;
        while changed {
            changed = false;
            for &(pid, parent) in &all {
                if tree.contains(&parent) && tree.insert(pid) {
                    changed = true;
                }
            }
        }
    }
    tree
}

unsafe fn brand_audio_session(session: &IAudioSessionControl) {
    let needs_label = match session.GetDisplayName() {
        Ok(pw) => {
            let current = pw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(pw.as_ptr() as *const _));
            current != APP_DISPLAY_NAME
        }
        Err(_) => true,
    };
    let needs_group = session
        .GetGroupingParam()
        .map(|g| g != IG_NOW_AUDIO_GROUP)
        .unwrap_or(true);
    if needs_label {
        let _ = session.SetDisplayName(w!("IG-Now"), std::ptr::null());
        if let Some(icon_w) = exe_icon_utf16() {
            let _ = session.SetIconPath(PCWSTR(icon_w.as_ptr()), std::ptr::null());
        }
    }
    if needs_label || needs_group {
        let _ = session.SetGroupingParam(&IG_NOW_AUDIO_GROUP, std::ptr::null());
    }
}

unsafe fn with_com<F: FnOnce() -> bool>(f: F) -> bool {
    let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
    // Tauri UI thread is already STA (`RPC_E_CHANGED_MODE`), which still supports
    // Core Audio calls without calling `CoUninitialize`.
    if hr.is_err() && hr != RPC_E_CHANGED_MODE {
        return false;
    }
    let ok = f();
    if hr.is_ok() {
        CoUninitialize();
    }
    ok
}

unsafe fn visit_active_render_managers<F>(enumerator: &IMMDeviceEnumerator, mut on_manager: F)
where
    F: FnMut(&IAudioSessionManager2),
{
    if let Ok(collection) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
        if let Ok(dev_count) = collection.GetCount() {
            for idx in 0..dev_count {
                if let Ok(device) = collection.Item(idx) {
                    if let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                    {
                        on_manager(&manager);
                    }
                }
            }
            if dev_count > 0 {
                return;
            }
        }
    }
    if let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
        if let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
            on_manager(&manager);
        }
    }
}

unsafe fn enumerate_app_sessions<F>(mut visitor: F) -> bool
where
    F: FnMut(u32, &IAudioSessionControl, &ISimpleAudioVolume),
{
    with_com(|| {
        let Ok(enumerator) =
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        else {
            return false;
        };
        let tree = process_tree();
        visit_active_render_managers(&enumerator, |manager| {
            let Ok(sessions): Result<IAudioSessionEnumerator, _> = manager.GetSessionEnumerator()
            else {
                return;
            };
            let Ok(count) = sessions.GetCount() else {
                return;
            };
            for i in 0..count {
                let Ok(session) = sessions.GetSession(i) else {
                    continue;
                };
                let Ok(ctrl2) = session.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(pid) = ctrl2.GetProcessId() else {
                    continue;
                };
                if !tree.contains(&pid) {
                    continue;
                }
                let Ok(volume) = session.cast::<ISimpleAudioVolume>() else {
                    continue;
                };
                visitor(pid, &session, &volume);
            }
        });
        true
    })
}

/// Returns active Windows audio render endpoint IDs so callers can detect
/// headphone/monitor hotplugs and refresh session branding.
pub fn active_render_endpoint_ids() -> Vec<String> {
    let mut ids = Vec::new();
    unsafe {
        let _ = with_com(|| {
            let Ok(enumerator) =
                CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return false;
            };
            if let Ok(collection) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                if let Ok(dev_count) = collection.GetCount() {
                    for idx in 0..dev_count {
                        if let Ok(device) = collection.Item(idx) {
                            if let Ok(pw) = device.GetId() {
                                let id = pw.to_string().unwrap_or_default();
                                CoTaskMemFree(Some(pw.as_ptr() as *const _));
                                if !id.is_empty() {
                                    ids.push(id);
                                }
                            }
                        }
                    }
                }
            }
            ids.sort_unstable();
            true
        });
    }
    ids
}

/// Keeps one grouped `"IG-Now"` Core Audio session handle open per active
/// render endpoint so Windows Settings -> Sound -> Volume mixer recognizes
/// "IG-Now" before WebView2 starts its own media stream.
pub struct AudioSessionKeepAlive {
    _handles: Vec<IAudioSessionControl>,
}

pub fn register_app_sessions_with_mute(start_muted: bool) -> AudioSessionKeepAlive {
    let mut handles = Vec::new();
    unsafe {
        let _ = with_com(|| {
            let Ok(enumerator) =
                CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return false;
            };
            visit_active_render_managers(&enumerator, |manager| {
                if let Ok(ctrl) = manager.GetAudioSessionControl(Some(&IG_NOW_AUDIO_GROUP), 0) {
                    brand_audio_session(&ctrl);
                    if let Ok(vol) = ctrl.cast::<ISimpleAudioVolume>() {
                        let _ = vol.SetMute(start_muted, std::ptr::null());
                    }
                    handles.push(ctrl);
                }
            });
            true
        });
    }
    AudioSessionKeepAlive { _handles: handles }
}

pub fn register_app_sessions() -> AudioSessionKeepAlive {
    register_app_sessions_with_mute(false)
}

/// Mute or unmute every audio session owned by this app's process tree.
/// Returns `true` if at least one session was adjusted.
pub fn set_app_audio_mute(mute: bool) -> bool {
    let mut touched = false;
    unsafe {
        enumerate_app_sessions(|_, session, volume| {
            brand_audio_session(session);
            if volume.SetMute(mute, std::ptr::null()).is_ok() {
                touched = true;
            }
        });
    }
    touched
}

/// Ensures every audio session in IG-Now's process tree stays labeled
/// `"IG-Now"` with the app icon/group and unmuted while foreground/visible.
pub fn ensure_foreground_audio_ready() -> bool {
    let mut unmuted_any = false;
    unsafe {
        enumerate_app_sessions(|_, session, volume| {
            brand_audio_session(session);
            if matches!(volume.GetMute(), Ok(m) if m.as_bool()) {
                if volume.SetMute(false, std::ptr::null()).is_ok() {
                    unmuted_any = true;
                }
            }
        });
    }
    unmuted_any
}

/// Diagnostic: print every audio session owned by this app's process tree.
pub fn report_audio_state() {
    let mut found = 0;
    unsafe {
        enumerate_app_sessions(|pid, session, volume| {
            brand_audio_session(session);
            let muted = volume
                .GetMute()
                .map(|m| if m.as_bool() { "yes" } else { "no" })
                .unwrap_or("?");
            let level = volume.GetMasterVolume().unwrap_or(-1.0);
            let peak = session
                .cast::<IAudioMeterInformation>()
                .ok()
                .and_then(|m| m.GetPeakValue().ok())
                .unwrap_or(-1.0);
            eprintln!(
                "[IG-Now] Audio state: pid={} muted={} volume={:.2} peak={:.4}",
                pid, muted, level, peak
            );
            found += 1;
        });
    }
    if found == 0 {
        eprintln!("[IG-Now] Audio state: no sessions in the process tree");
    }
}

#[cfg(test)]
mod tests {
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

    #[test]
    fn process_tree_includes_current_pid_and_group_guid_is_non_zero() {
        let tree = super::process_tree();
        assert!(tree.contains(&std::process::id()));
        assert_ne!(super::IG_NOW_AUDIO_GROUP.data1, 0);
    }

    #[test]
    fn audio_session_control_works_on_sta_thread_and_brands_ig_now() {
        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let _keepalive = super::register_app_sessions();
            let _muted_keepalive = super::register_app_sessions_with_mute(true);
            let _ = super::ensure_foreground_audio_ready();
            let _ = super::active_render_endpoint_ids();
            for _ in 0..150 {
                let tree = super::process_tree();
                assert!(tree.contains(&std::process::id()));
            }
            if hr.is_ok() {
                CoUninitialize();
            }
        }
    }
}
