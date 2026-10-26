//! Datenumzug nach der Umbenennung Schelmeplaner → Marktplaner (#10).
//!
//! Die App-Kennung bestimmt die Datenordner: Export-Profile, Raster-Einstellungen und Sicherungen unbenannter
//! Projekte (App-Datenordner) sowie Ansichtseinstellungen und Spaltenauswahl (localStorage der Webview). Beim
//! ersten Start mit der neuen Kennung werden die Ordner der alten Kennung kopiert, solange es den neuen Ordner noch
//! nicht gibt. Der alte Ordner bleibt unangetastet.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const OLD_ID: &str = "de.schelmenmarkt.schelmeplaner";
const NEW_ID: &str = "de.laurinludwig.marktplaner";

/// Basisordner, in denen Tauri bzw. die Webview je Kennung einen Unterordner anlegen.
fn base_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        let lib = PathBuf::from(home).join("Library");
        dirs.push(lib.join("Application Support"));
        dirs.push(lib.join("WebKit"));
    }
    #[cfg(target_os = "windows")]
    for var in ["LOCALAPPDATA", "APPDATA"] {
        if let Some(d) = std::env::var_os(var) {
            dirs.push(PathBuf::from(d));
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local").join("share"));
    }
    dirs
}

pub fn adopt_legacy_data() {
    for base in base_dirs() {
        if let Err(e) = adopt_dir(&base.join(OLD_ID), &base.join(NEW_ID)) {
            eprintln!("Datenumzug aus {} nicht möglich: {e}", base.display());
        }
    }
}

/// Kopiert `old` nach `new`, wenn `old` existiert und `new` noch nicht. Liefert true, wenn kopiert wurde.
pub fn adopt_dir(old: &Path, new: &Path) -> io::Result<bool> {
    if !old.is_dir() || new.exists() {
        return Ok(false);
    }
    // Erst in einen Zwischenordner, damit ein abgebrochener Umzug beim nächsten Start wiederholt wird
    let tmp = new.with_extension("umzug");
    if tmp.exists() {
        fs::remove_dir_all(&tmp)?;
    }
    copy_dir(old, &tmp)?;
    fs::rename(&tmp, new)?;
    Ok(true)
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(renamed(&entry.file_name().to_string_lossy()));
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Sicherung des unbenannten Projekts trägt die Dateiendung im Namen (`unbenannt.schelme.autosave`).
fn renamed(name: &str) -> String {
    match name.strip_prefix("unbenannt.schelme.") {
        Some(rest) => format!("unbenannt.mplan.{rest}"),
        None => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("marktplaner-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn kopiert_alten_ordner_samt_unterordnern_und_benennt_sicherung_um() {
        let base = temp("kopie");
        let old = base.join(OLD_ID);
        fs::create_dir_all(old.join("EBWebView").join("Default")).unwrap();
        fs::write(old.join("export-profiles.json"), "[1]").unwrap();
        fs::write(old.join("unbenannt.schelme.autosave"), "a").unwrap();
        fs::write(old.join("unbenannt.schelme.behalten.autosave"), "b").unwrap();
        fs::write(old.join("EBWebView").join("Default").join("Local Storage"), "ls").unwrap();
        let new = base.join(NEW_ID);

        assert!(adopt_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("export-profiles.json")).unwrap(), "[1]");
        assert_eq!(fs::read_to_string(new.join("unbenannt.mplan.autosave")).unwrap(), "a");
        assert_eq!(fs::read_to_string(new.join("unbenannt.mplan.behalten.autosave")).unwrap(), "b");
        assert_eq!(fs::read_to_string(new.join("EBWebView").join("Default").join("Local Storage")).unwrap(), "ls");
        // Alter Ordner bleibt unangetastet
        assert!(old.join("unbenannt.schelme.autosave").exists());
        assert!(!new.with_extension("umzug").exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn vorhandener_neuer_ordner_wird_nicht_ueberschrieben() {
        let base = temp("vorhanden");
        let old = base.join(OLD_ID);
        let new = base.join(NEW_ID);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a.json"), "alt").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("a.json"), "neu").unwrap();

        assert!(!adopt_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("a.json")).unwrap(), "neu");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn ohne_alten_ordner_passiert_nichts() {
        let base = temp("leer");
        assert!(!adopt_dir(&base.join(OLD_ID), &base.join(NEW_ID)).unwrap());
        assert!(!base.join(NEW_ID).exists());
        fs::remove_dir_all(base).unwrap();
    }
}
