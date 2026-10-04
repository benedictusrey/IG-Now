use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
pub struct UnreadTracker {
    count: Option<u32>,
    last_alert: Option<Instant>,
}

impl UnreadTracker {
    fn update(&mut self, count: u32, suppress: bool, now: Instant) -> bool {
        let count = count.min(9999);
        let previous = self.count.replace(count);
        let increased = previous.is_some_and(|value| count > value);
        if !increased
            || suppress
            || self
                .last_alert
                .is_some_and(|time| now.duration_since(time) < Duration::from_secs(5))
        {
            return false;
        }
        self.last_alert = Some(now);
        true
    }
}

pub struct MessageNotifications {
    started: Instant,
    tracker: Mutex<UnreadTracker>,
}

impl Default for MessageNotifications {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            tracker: Mutex::new(UnreadTracker::default()),
        }
    }
}

#[tauri::command]
pub fn report_dm_unread(
    app: AppHandle,
    state: State<'_, MessageNotifications>,
    count: u32,
    viewing_inbox: bool,
) -> Result<(), String> {
    let now = Instant::now();
    let focused_inbox = viewing_inbox
        && app.get_webview_window("instagram").is_some_and(|window| {
            window.is_visible().unwrap_or(false)
                && !window.is_minimized().unwrap_or(true)
                && window.is_focused().unwrap_or(false)
        });
    let suppress = focused_inbox || now.duration_since(state.started) < Duration::from_secs(10);
    let notify = state
        .tracker
        .lock()
        .map_err(|_| "Notification state unavailable")?
        .update(count, suppress, now);
    if notify {
        app.notification()
            .builder()
            .title("IG-Now")
            .body("You have new Instagram messages. Open IG-Now to read them.")
            .show()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn test_message_notification(app: AppHandle) -> Result<(), String> {
    app.notification().builder().title("IG-Now")
        .body("Message notifications are ready. Your operating system controls notification delivery.")
        .show().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn baseline_duplicate_and_decrease_do_not_alert() {
        let mut tracker = UnreadTracker::default();
        let now = Instant::now();
        assert!(!tracker.update(4, false, now));
        assert!(!tracker.update(4, false, now));
        assert!(!tracker.update(0, false, now));
        assert!(tracker.update(1, false, now));
    }
    #[test]
    fn suppresses_focused_inbox_and_coalesces_bursts() {
        let mut tracker = UnreadTracker::default();
        let now = Instant::now();
        tracker.update(0, false, now);
        assert!(!tracker.update(1, true, now));
        assert!(tracker.update(2, false, now));
        assert!(!tracker.update(3, false, now + Duration::from_secs(1)));
        assert!(tracker.update(4, false, now + Duration::from_secs(6)));
    }
}
