# Fremdbestandteile

Der Marktplaner selbst steht unter der [AGPL-3.0-or-later](LICENSE). Er enthält bzw. nutzt die folgenden
Bestandteile anderer Urheber unter deren Lizenzen. Die vollständigen Lizenztexte liegen den jeweiligen Paketen bei
(`node_modules/<paket>/LICENSE`, für Rust-Crates im Quellpaket auf crates.io).

## Mitgelieferte Bibliotheken (Oberfläche)
| Bestandteil | Lizenz |
|---|---|
| [React, React DOM](https://react.dev/) | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | MIT |
| [Immer](https://github.com/immerjs/immer) | MIT |
| [nanoid](https://github.com/ai/nanoid) | MIT |
| [fflate](https://github.com/101arrowz/fflate) | MIT |
| [pdf-lib](https://github.com/Hopding/pdf-lib), [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | MIT |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | Apache-2.0 |
| [Tauri](https://tauri.app/) (`@tauri-apps/api`, Plugins `dialog` und `fs`) | MIT oder Apache-2.0 |

## Zusatzdateien von pdf.js (`public/pdfjs/`, beim Build kopiert)
Die Lizenztexte liegen jeweils im selben Ordner.

| Ordner | Inhalt | Lizenz |
|---|---|---|
| `cmaps/` | Adobe CMaps | Adobe, BSD-artig (`cmaps/LICENSE`) |
| `standard_fonts/` | Foxit-Schriften, Liberation Sans | PDFium BSD (`LICENSE_FOXIT`), Liberation-Lizenz (`LICENSE_LIBERATION`) |
| `wasm/` | JBIG2, OpenJPEG, qcms | BSD (PDFium, OpenJPEG), MIT (qcms); je `LICENSE_*` |
| `iccs/` | ICC-Profile | CC0-1.0 |

## Schriften und Symbole
| Bestandteil | Lizenz |
|---|---|
| [IBM Plex Sans](https://github.com/IBM/plex) (`src/assets/fonts/`, auch im PDF-Export eingebettet) | SIL Open Font License 1.1 (`src/assets/fonts/OFL.txt`) |
| [IBM Plex Mono](https://github.com/IBM/plex) (`@fontsource/ibm-plex-mono`) | SIL Open Font License 1.1 |
| [Material Symbols](https://github.com/google/material-design-icons) (`@material-symbols/svg-400`, lokal gebündelt) | Apache-2.0 |

## Desktop-Hülle (Rust)
[Tauri 2](https://github.com/tauri-apps/tauri), `tauri-plugin-dialog`, `tauri-plugin-fs`, [serde](https://serde.rs/)
und deren Abhängigkeiten (siehe `src-tauri/Cargo.lock`), überwiegend unter MIT und/oder Apache-2.0.

## Nur zur Entwicklung (nicht in der App enthalten)
Vite, TypeScript, Vitest, Playwright, oxlint, fast-check, Tauri CLI und weitere Pakete aus `devDependencies`
in `package.json`.
