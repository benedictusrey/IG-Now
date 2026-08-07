//! Windows audio-session control for IG-Now.
//!
//! Guarantees silence for this app's process tree (the exe + its WebView2
//! child processes) by muting the process's audio sessions directly through
//! the Windows Core Audio API. This works even if the page-side pause fails
//! (e.g. the webview is minimized and `eval` is throttled, or Instagram's
//! player engine resumes the media element).

use std::collections::HashSet;

use windows::core::Interface;
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};

/// PIDs of this process and all its descendants (covers `msedgewebview2.exe`
/// children, which actually own the audio sessions for the web content).
fn process_tree() -> HashSet<u32> {
    let mut tree = HashSet::new();
    tree.insert(std::process::id());

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return tree;
        };
        let mut all: Vec<(u32, u32)> = Vec::new(); // (pid, parent_pid)
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
        // BFS from our own PID through the parent links.
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

unsafe fn set_app_audio_mute_inner(mute: bool) -> bool {
    let Ok(enumerator) =
        CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
    else {
        return false;
    };
    let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) else {
        return false;
    };
    let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
        return false;
    };
    let Ok(sessions) = manager.GetSessionEnumerator() else {
        return false;
    };
    let Ok(count) = sessions.GetCount() else {
        return false;
    };

    let tree = process_tree();
    let mut touched = false;
    for i in 0..count {
        let Ok(session) = sessions.GetSession(i) else { continue };
        let Ok(control) = session.cast::<IAudioSessionControl2>() else { continue };
        let Ok(pid) = control.GetProcessId() else { continue };
        if !tree.contains(&pid) {
            continue;
        }
        let Ok(volume) = session.cast::<ISimpleAudioVolume>() else { continue };
        if volume.SetMute(mute, std::ptr::null()).is_ok() {
            touched = true;
        }
    }
    touched
}

/// Mute or unmute every audio session owned by this app's process tree.
/// Returns `true` if at least one session was adjusted.
pub fn set_app_audio_mute(mute: bool) -> bool {
    unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).0 < 0 {
            return false;
        }
        let result = set_app_audio_mute_inner(mute);
        CoUninitialize();
        result
    }
}

/// Diagnostic: print every audio session owned by this app's process tree with
/// its MUTE flag and MASTER VOLUME. Used at cold start to catch "page element
/// says unmuted but the OS session is silent" cases (mixer volume at 0, etc.).
pub fn report_audio_state() {
    unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).0 < 0 {
            eprintln!("[IG-Now] Audio state: COM init failed");
            return;
        }
        let Ok(enumerator) =
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        else {
            eprintln!("[IG-Now] Audio state: no audio endpoint");
            CoUninitialize();
            return;
        };
        let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) else {
            eprintln!("[IG-Now] Audio state: no default render device");
            CoUninitialize();
            return;
        };
        let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
            eprintln!("[IG-Now] Audio state: no session manager");
            CoUninitialize();
            return;
        };
        let Ok(sessions) = manager.GetSessionEnumerator() else {
            eprintln!("[IG-Now] Audio state: no session enumerator");
            CoUninitialize();
            return;
        };
        let Ok(count) = sessions.GetCount() else {
            eprintln!("[IG-Now] Audio state: no session count");
            CoUninitialize();
            return;
        };

        let tree = process_tree();
        let mut found = 0;
        for i in 0..count {
            let Ok(session) = sessions.GetSession(i) else { continue };
            let Ok(control) = session.cast::<IAudioSessionControl2>() else { continue };
            let Ok(pid) = control.GetProcessId() else { continue };
            if !tree.contains(&pid) {
                continue;
            }
            let Ok(volume) = session.cast::<ISimpleAudioVolume>() else { continue };
            let Ok(muted) = volume.GetMute() else { continue };
            let Ok(level) = volume.GetMasterVolume() else { continue };
            // TRUE audio-flow evidence: the session's peak meter. 0.0 while a
            // video "plays" = the player is outputting silence (player-level
            // mute / WebAudio gain at 0), even though the DOM says unmuted.
            let peak = session
                .cast::<IAudioMeterInformation>()
                .ok()
                .and_then(|m| m.GetPeakValue().ok())
                .unwrap_or(-1.0);
            eprintln!(
                "[IG-Now] Audio state: pid={} muted={} volume={:.2} peak={:.4}",
                pid,
                if muted.as_bool() { "yes" } else { "no" },
                level,
                peak
            );
            found += 1;
        }
        if found == 0 {
            eprintln!("[IG-Now] Audio state: no sessions in the process tree");
        }
        CoUninitialize();
    }
}
