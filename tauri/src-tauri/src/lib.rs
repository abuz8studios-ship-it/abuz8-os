// ABUZ8 OS · Tauri runtime entry
// Loads the bundled frontend (dist/) into a native window.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // Bismillah. Frontend boots in the default window from tauri.conf.json.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ABUZ8 OS");
}
