// IG-Now — High-Performance Desktop Client for Instagram
// Sole Author & Creator: Benedictus Reynaldo Hartanto (@benedictusrey)
// Repository: https://github.com/benedictusrey/IG-Now
// All rights reserved. See LICENSE for details.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    ig_now_lib::configure_linux_runtime_env();

    ig_now_lib::run();
}
