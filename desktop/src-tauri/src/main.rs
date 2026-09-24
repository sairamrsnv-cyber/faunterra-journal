// The desktop entry point.
//
// Deliberately thin. Every decision that touches data lives in `ebird-core`,
// which has no GUI dependency and can therefore be tested headless. This file
// owns a window and a message pump, nothing else.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    faunterra_data_station::run()
}
