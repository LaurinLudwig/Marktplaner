# Marktplaner

Maßstabsgetreue Pläne für Märkte und Feste: Hintergrundplan importieren, Grundflächen anlegen, Stände platzieren –
Freiflächen, freie Frontmeter, Standnummern und Strom rechnen sich von selbst. Am Ende steht ein druckfertiges
Vektor-PDF bis A0.

**[Im Browser ausprobieren](https://laurinludwig.github.io/Marktplaner/)** ·
**[Herunterladen](https://github.com/LaurinLudwig/Marktplaner/releases/latest)** (Windows, macOS)

Kostenlos, Open Source, offline, ohne Konto. Händlerdaten bleiben auf dem eigenen Rechner.

## Funktionen
- **Hintergrund und Maßstab:** PDF, SVG, JPEG oder PNG importieren und mit zwei Punkten auf Meter kalibrieren
  (bei PDFs alternativ Planmaßstab 1:n). Raster, Messwerkzeug, Nordrichtung.
- **Grundflächen** mit markierter Vorderseite, frei drehbar.
- **Geschäfte (Stände)** mit Platznummer, Name, Eigentümer, Ware, Maßen, Strom, Anschlussart, Notiz, Kategorie und
  Farbe; Form als Rechteck, Kreis/Oval oder eigene Formvorlage.
- **Freiflächen automatisch:** Lücken entlang der Vorderseite werden live berechnet und mit Maßen beschriftet.
- **Fang** an Vorderkanten, Nachbarständen und Raster mit Hilfslinien.
- **Warnungen:** Überlappung, Stand außerhalb der Grundflächen, Stand in freizuhaltender Infrastruktur, doppelte
  Nummer, zu enge Durchfahrt.
- **Nummerierung** links → rechts oder im Uhrzeigersinn, mit Präfix je Festplatz und fixierten Nummern.
- **Strom:** Summe und Limit je Festplatz, Anschlussarten.
- **Infrastruktur:** Sperren, Sanitätsdienst, RTW-Platz, Toiletten, Müllcontainer, enge Durchfahrten, Marker und
  eigene Typen.
- **Start-Page:** Kennzahlen je Festplatz, Geschäftstabelle mit Suche, Filtern und direkter Bearbeitung,
  CSV-Export.
- **PDF-Export** als Vektor, A4 bis A0, mit Schriftfeld, Legende, Maßstabsbalken, Nordpfeil und Export-Profilen.
- Mehrere Festplätze in einem Projekt, Rückgängig/Wiederholen, automatische Sicherung.

Die vollständige Beschreibung steht in [spec.md](spec.md).

## Installation
Die Installer liegen unter [Releases](https://github.com/LaurinLudwig/Marktplaner/releases):

- **Windows:** `.msi` oder `-setup.exe`
- **macOS:** `.dmg` (Apple Silicon und Intel)

Die Installer sind nicht signiert. Beim ersten Öffnen warnt deshalb das Betriebssystem:

- **macOS:** Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“. Alternativ im Terminal:
  `xattr -dr com.apple.quarantine /Applications/Marktplaner.app`
- **Windows (SmartScreen):** „Weitere Informationen“ → „Trotzdem ausführen“.

### Browser-Version
Unter <https://laurinludwig.github.io/Marktplaner/> läuft dieselbe App im Browser. Projekte öffnet man dort per
Upload und speichert sie per Download; nichts wird auf einen Server übertragen. Für die tägliche Arbeit ist die
Desktop-App bequemer (Speichern direkt in die Datei, zuletzt geöffnete Projekte, Doppelklick auf `.mplan`).

## Aus dem Quellcode bauen
Voraussetzungen: [Node.js](https://nodejs.org/) 26 und für die Desktop-App [Rust](https://www.rust-lang.org/tools/install)
sowie die [Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/) des Betriebssystems.

```sh
npm install
npm run dev          # im Browser: http://localhost:1420
npm run tauri dev    # als Desktop-App
npm run tauri build  # Installer bauen
```

Tests, Linter und weitere Befehle stehen in [CONTRIBUTING.md](CONTRIBUTING.md).

## Technik
[Tauri 2](https://tauri.app/), React, TypeScript, Vite; Zeichenfläche als SVG; Zustand mit Undo/Redo über
Immer-Patches; PDF-Import mit pdf.js, PDF-Export mit pdf-lib. Die Geometrie- und Rechenlogik in `src/core/` ist
unabhängig von der Oberfläche und mit Vitest getestet; die Oberfläche mit Playwright (Chromium und WebKit).

| Ordner | Inhalt |
|---|---|
| `src/core/` | Datenmodell, Geometrie, Freiflächen, Nummerierung, Warnungen, Szene, PDF-Export, Dateiformat |
| `src/state/` | Store (Zustand) mit Undo/Redo |
| `src/ui/` | Oberfläche (Zeichenfläche, Werkzeuge, Seitenleiste, Start-Page, Dialoge) |
| `src/platform/` | Zugriff auf Dateien und Fenster: Tauri (`tauri.ts`) oder Browser (`browser.ts`) |
| `src-tauri/` | Desktop-Hülle (Rust) |
| `tests/e2e/`, `tests/fixtures/` | E2E-Tests und Testdateien |

## Mitmachen
Fehlermeldungen und Ideen gern als [Issue](https://github.com/LaurinLudwig/Marktplaner/issues). Wie man Code
beiträgt, steht in [CONTRIBUTING.md](CONTRIBUTING.md). Es gilt der [Verhaltenskodex](CODE_OF_CONDUCT.md).
Sicherheitslücken bitte nicht öffentlich melden, sondern wie in [SECURITY.md](SECURITY.md) beschrieben.

## Entstehung
Der Marktplaner ist für die Planung des Schelmenmarkts in Gelnhausen entstanden, dessen Pläne bis dahin von Hand in
Adobe Illustrator gezeichnet wurden.

## Lizenz
[GNU Affero General Public License v3.0 oder später](LICENSE) (AGPL-3.0-or-later). Die App darf frei genutzt,
verändert und weitergegeben werden. Wer eine veränderte Fassung weitergibt oder Nutzern über ein Netzwerk
anbietet (z. B. als Web-Anwendung), muss deren Quellcode unter derselben Lizenz offenlegen.

Lizenzen der verwendeten Bibliotheken, Schriften und Symbole: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

© 2026 Laurin Ludwig
