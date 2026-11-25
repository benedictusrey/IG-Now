// IG-Now — High-Performance Desktop Client for Instagram
// Sole Author & Creator: Benedictus Reynaldo Hartanto (@benedictusrey)
// Repository: https://github.com/benedictusrey/IG-Now
// All rights reserved. See LICENSE for details.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's zero-copy DMA-BUF renderer deadlocks or freezes on many Linux
    // Wayland + AMD/NVIDIA setups (issue #6). Respect an explicit user override.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    ig_now_lib::run();
}
