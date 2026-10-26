mod legacy_data;
mod opened_files;

use opened_files::OpenedFiles;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Vor dem Start der Webview, damit deren Speicher (localStorage) schon am neuen Ort liegt (#10)
    legacy_data::adopt_legacy_data();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Doppelklick auf eine Projektdatei (Windows, Linux: Startargumente)
        .manage(OpenedFiles::new(opened_files::from_args(std::env::args())))
        .invoke_handler(tauri::generate_handler![opened_files::take_opened_files])
        .build(tauri::generate_context!())
        .expect("Fehler beim Starten von Marktplaner");
    app.run(|handle, event| {
        // macOS übergibt Dateien als Open-Event, beim Start wie bei laufender App
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .filter(|p| opened_files::is_project_file(p))
                .collect();
            opened_files::push(handle, paths);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (handle, event);
    });
}
