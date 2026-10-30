# Mitmachen

Danke für dein Interesse am Marktplaner! Fehlermeldungen, Ideen und Code sind willkommen.
Projektsprache ist Deutsch (Oberfläche, Meldungen, Kommentare, Issues).

## Fehler melden und Ideen
- Vorher kurz in den [Issues](https://github.com/LaurinLudwig/Marktplaner/issues) suchen, ob es das schon gibt.
- Bei Fehlern: Betriebssystem, App-Version (steht in jedem PDF-/CSV-Export unten), Schritte zum Nachstellen und
  erwartetes Verhalten. Wenn möglich eine kleine Projektdatei ohne echte Händlerdaten anhängen.
- Größere Änderungen erst in einem Issue besprechen, bevor du Zeit in Code steckst. Das Verhalten der App ist in
  [spec.md](spec.md) festgelegt; Änderungen am Verhalten ändern auch die Spezifikation.

## Einrichten
Node.js 26; für die Desktop-App zusätzlich Rust und die
[Tauri-Voraussetzungen](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npx playwright install chromium webkit   # einmalig, für die E2E-Tests
```

| Befehl | Zweck |
|---|---|
| `npm run dev` | Frontend im Browser, http://localhost:1420 (ohne Tauri; Dateien per Upload/Download) |
| `npm run tauri dev` | Desktop-App starten |
| `npm run tauri build` | Desktop-Installer bauen |
| `npm run typecheck` | TypeScript-Prüfung: ganzes Projekt und zusätzlich `src/core` ohne DOM-Bibliothek |
| `npm run lint` | Linter (oxlint, Warnungen gelten als Fehler) |
| `npm test` | Unit-Tests (Vitest, `src/**/*.test.ts`) |
| `npm run test:e2e` | E2E-Tests (Playwright, Chromium und WebKit; startet den Dev-Server selbst) |
| `npm run test:perf` | Lasttests (500 Stände, großer Hintergrund; ≥ 50 Bilder/s; `src/**/*.perf.test.ts`), seriell und getrennt von `test` und `test:e2e` |
| `npm run build` | Typecheck und Produktions-Build nach `dist/` |
| `npm run check` | typecheck, lint, test und build nacheinander – muss vor jedem Pull Request grün sein |
| `node scripts/make-fixtures.mjs` | Testpläne in `tests/fixtures/` neu erzeugen |
| `node scripts/make-load-project.mjs` | Lastprojekt `tests/fixtures/last-500-staende.schelme` neu erzeugen |
| `npx tauri icon src-tauri/icons/icon.svg -o src-tauri/icons` | App-Icons neu erzeugen (danach `android/` und `ios/` löschen, `public/favicon.svg` ersetzen) |

Während der Arbeit reicht es, die betroffenen Tests auszuführen (`npx vitest run <Datei>`,
`npx playwright test <Datei> --project=chromium`). Lasttests nur bei Änderungen an Darstellung oder Geometrie,
ohne Stromsparmodus und ohne rechenintensive Programme im Hintergrund.

## Regeln für den Code
- **`src/core/` bleibt frei von React-, DOM- und Tauri-Importen** und ist mit Vitest getestet. Erzwungen durch den
  Linter (`.oxlintrc.json`) und eine eigene Typprüfung ohne DOM (`src/core/tsconfig.json`; erlaubte
  plattformneutrale Funktionen nur über `src/core/env.d.ts`).
- **Betriebssystem-Zugriffe** (Dateien, Dialoge, Fenster) laufen ausschließlich über `src/platform/`
  (`platform` aus `src/platform/index.ts`). Nur `src/platform/tauri.ts` importiert `@tauri-apps/*`;
  `src/platform/browser.ts` ist der Ersatz im Browser.
- **Zahlen:** Eingabefelder mit `fmtInput` (ohne Tausenderpunkt) und `parseNum`; reine Anzeigen mit `fmt`.
- **Meldungen für Nutzer nur auf Deutsch:** `UserError` für fertige Meldungen, sonst `userMessage(e, fallback)`.
- **Kurzbefehle:** keine Strg+Alt-Kombinationen (macOS Cmd+Alt) mit Tasten, die auf deutschen Tastaturen per AltGr
  ein Zeichen erzeugen (u. a. Q, E, M, 2, 3, 7, 8, 9, 0, ß, +, <); unter Windows ist AltGr = Strg+Alt. Geprüft von
  `src/ui/shortcuts/definitions.test.ts`. In Textfeldern greifen nur Speichern, Speichern unter, Öffnen und Neu.
- **Dateiformat:** Jede Änderung am Format von `project.json` (neue, umbenannte oder anders gedeutete Felder) erhöht
  `CURRENT_SCHEMA_VERSION` und bringt eine Migration „von n auf n+1“ in `src/core/model/migrations.ts` mit Test in
  `src/core/model/migrations.test.ts` mit. Dazu kommt eine echte, mit der Vorgängerversion gespeicherte Datei unter
  `tests/fixtures/` (nie neu erzeugen), deren Migration getestet wird. Dateien mit neuerer Version weist die App mit
  deutscher Meldung ab.
- **Version:** steht in `package.json` und muss mit `src-tauri/tauri.conf.json` und `src-tauri/Cargo.toml`
  übereinstimmen.
- **Tests:** Neue Funktionen bringen Tests mit (Logik in `src/core/` mit Vitest, Bedienung mit Playwright unter
  `tests/e2e/`). Bestehende E2E-Tests nur ändern, wenn sie nachweislich falsch sind, und das im Pull Request
  begründen. Screenshots und Logs aus Testläufen gehören nach `test-artifacts/` (Helfer `artifact()` in
  `tests/e2e/helpers.ts`).
- Im Entwicklungsmodus ist der Store als `window.__marktplanerStore` erreichbar (Fehlersuche, Tests).

## Pull Requests
1. Fork anlegen, Branch vom aktuellen `main` erstellen.
2. Kleine, in sich geschlossene Änderungen; bei Verhaltensänderungen `spec.md` mit anpassen.
3. `npm run check` und die betroffenen E2E-Tests müssen grün sein. Die GitHub Action „Build“ prüft jeden Pull
   Request (check und E2E in Chromium).
4. Im Pull Request beschreiben, was sich ändert und wie man es ausprobiert (bei Oberflächenänderungen gern mit
   Screenshot).

Mit dem Einreichen eines Beitrags stimmst du zu, dass er unter der Lizenz des Projekts
([AGPL-3.0-or-later](LICENSE)) veröffentlicht wird.

## Releases (Maintainer)
Version in `package.json`, `src-tauri/tauri.conf.json` und `src-tauri/Cargo.toml` erhöhen (`package-lock.json` und
`Cargo.lock` mit aktualisieren), committen, dann einen Tag `vX.Y.Z` pushen. Der Workflow „Release“ prüft, baut die
Installer für Windows und macOS und veröffentlicht das GitHub-Release. Die Browser-Version auf GitHub Pages wird
bei jedem Push auf `main` aktualisiert.
