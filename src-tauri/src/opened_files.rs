//! Projektdateien, die das Betriebssystem der App übergibt (Doppelklick im Finder/Explorer, „Öffnen mit“; E-02,
//! QA-M10-02). Windows und Linux übergeben sie als Startargumente, macOS als Open-Event (auch bei laufender App).
//! Die Pfade landen in einer Warteschlange; das Frontend holt sie mit `take_opened_files` ab, sobald es bereit ist,
//! und wird bei späteren Dateien über das Ereignis `files-opened` benachrichtigt.

use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const EXTENSIONS: [&str; 2] = ["mplan", "schelme"];

#[derive(Default)]
pub struct OpenedFiles(Mutex<Vec<String>>);

impl OpenedFiles {
    pub fn new(paths: Vec<String>) -> Self {
        Self(Mutex::new(paths))
    }
}

pub fn is_project_file(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// Projektdateien aus den Startargumenten (das erste Argument ist das Programm selbst).
pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter().skip(1).filter(|a| is_project_file(a)).collect()
}

/// Dateien bei laufender App (macOS) einreihen und das Frontend benachrichtigen.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn push(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut queue) = app.state::<OpenedFiles>().0.lock() {
        queue.extend(paths);
    }
    let _ = app.emit("files-opened", ());
}

#[tauri::command]
pub fn take_opened_files(state: State<OpenedFiles>) -> Vec<String> {
    state.0.lock().map(|mut q| std::mem::take(&mut *q)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nimmt_nur_projektdateien_aus_den_startargumenten() {
        let args = ["C:\\Programme\\Marktplaner.exe", "C:\\Pläne\\Markt 2026.mplan", "--flag", "alt.SCHELME", "plan.pdf"];
        assert_eq!(from_args(args.map(String::from)), vec!["C:\\Pläne\\Markt 2026.mplan", "alt.SCHELME"]);
    }

    #[test]
    fn ohne_argumente_keine_dateien() {
        assert!(from_args(["/Applications/Marktplaner.app/Contents/MacOS/marktplaner".to_string()]).is_empty());
    }

    #[test]
    fn endung_entscheidet() {
        assert!(is_project_file("/Users/a/x.mplan"));
        assert!(is_project_file("/Users/a/x.schelme"));
        assert!(!is_project_file("/Users/a/x.mplan.autosave"));
        assert!(!is_project_file("/Users/a/mplan"));
    }
}
