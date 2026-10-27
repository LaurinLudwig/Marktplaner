# Spezifikation: Marktplaner – Marktplan-Editor für Märkte und Feste

Die App heißt **Marktplaner** (bis 2026-10-23 „Schelmeplaner“, #10). Diese Datei beschreibt, wie sich die App
verhalten soll; Verweise wie „#10“ oder „M5“ beziehen sich auf frühere Arbeitspakete, „Entscheidung …“ auf
festgelegte Detailregeln.

## Kontext
Entstanden ist der Marktplaner für die Planung des Schelmenmarkts Gelnhausen (8 Festplätze). Bis dahin entstanden
die maßstabsgetreuen Pläne in Adobe Illustrator: farbige Rechtecke für Stände, Freiflächen, Sperren usw., darüber
Textfelder mit Eigentümer, Geschäftsname, Ware, Maße, Strom, Platznummer (händisch gezählt).
Ziel ist eine eigene Desktop-Anwendung, die das ersetzt und automatisiert. Ein Prototyp der
Freiflächen-Logik steht in `prototype/freiflaechen.html`.

## Grundsätze
- Die Geometrie-Logik (Freiflächen, Kollision, Nummerierung) ist reine, UI-unabhängige Logik mit Unit-Tests
  (`src/core/`).

## Begriffe / Datenmodell
- **Projekt** (z. B. „Schelmenmarkt 2027“) enthält mehrere **Pages**.
- **Start-Page**: immer die erste Page, nicht löschbar. Enthält Statistik und Listen (siehe 7).
- **Festplatz-Page**: eine Page pro Festplatz mit eigener Zeichenfläche. Pages lassen sich
  anlegen, umbenennen, umsortieren (Drag & Drop in der Tab-Leiste), duplizieren und löschen.
- **Hintergrundplan**: pro Festplatz-Page importiert, per Kalibrierung auf Meter skaliert.
- **Grundfläche**: Rechteck, frei rotierbar, mit einer markierten **Vorderseite**.
  Breite = Länge der Vorderseite, Tiefe = senkrecht dazu. [ANPASSEN: nur Rechtecke, keine Polygone]
- **Geschäft (Stand)**: Rechteck B × T in Metern, Position, Rotation, Attribute (siehe unten). Seit M12 (#9) hat er
  eine **Form** (Rechteck, Kreis/Oval oder eine Formvorlage), die nur die Darstellung betrifft; für alle Berechnungen
  bleibt er das Rechteck B × T (Hitbox, §3 „Form“).
- **Formvorlage**: projektweiter, aus Rechtecken und Kreisen/Ovalen zusammengesetzter Umriss mit Vorschlagsmaß
  (§3 „Form“, M12).
- Position ist der Mittelpunkt; gedreht wird um den Mittelpunkt (Grad im Uhrzeigersinn, 0–360).
  Positionen und Maße werden auf 0,01 m gerundet, Drehungen auf 0,1° (beim Übernehmen, nicht während
  des Ziehens). Intern ist die Vorderseite immer die lokale Unterkante; so ist die Breite immer die
  Länge der Vorderseite (Entscheidung 2026-10-10).
- **Kategorie**: Name und Farbe, projektweit. Ein Geschäft hat höchstens eine Kategorie.
- **Freifläche**: wird immer automatisch berechnet, nie manuell gezeichnet und nie gespeichert.
- **Toleranz** für geometrische Vergleiche: 0,01 m (= Speichergenauigkeit). Überlappung erst bei
  mehr als 0,01 m Eindringtiefe; ein Abstand bis 0,01 m gilt als bündig (Entscheidung 2026-10-11).
- **Infrastruktur-Objekte**: mobile Sperre, feste Sperre, Sanitätsdienst, RTW-Platz, Toilette,
  Müllcontainer, enge Durchfahrt (mit Maß der lichten Breite), freier Marker mit Text.
  Jeder Typ hat eine eigene Farbe/Symbol und erscheint in der Legende. Pro Typ ist einstellbar,
  ob er die Fläche belegt (dann entsteht an dieser Stelle keine Freifläche, wie bei einem Geschäft).
  Weitere Typen lassen sich in den Projekteinstellungen anlegen. Details in §11 (Entscheidungen 2026-10-12,
  M7-Planung).
- **Blatt**: pro Festplatz-Page das Papier für Druck und PDF (Format, Ausrichtung, Maßstab, Lage auf dem Plan), auf
  der Zeichenfläche als Rahmen sichtbar (§8).
- **Schriftfeld**: Planbeschriftung pro Festplatz-Page, ein Papier-Element des Blatts (§8).
- **Legende**: automatisch erzeugte Zeichenerklärung pro Festplatz-Page, ein Papier-Element des Blatts (§8).
- **Papier-Elemente** (Schriftfeld, Legende, Maßstabsbalken, Nordpfeil; die beiden letzten seit M8): Maße und
  Schriftgrößen in mm auf dem Papier, Position relativ zu einer Ecke des Blatts. Sie sind in jedem Maßstab gleich groß.
- **Export-Profil**: legt fest, was ein PDF zeigt (Ebenen, Warnungen, Felder, Anhang). Gilt pro Rechner, nicht in der
  Projektdatei (§9).

## Funktionen

### 1. Hintergrund & Maßstab
- Hintergrundplan pro Festplatz-Page importieren: PDF (Seitenauswahl bei mehrseitigen PDFs),
  SVG, JPEG, PNG. Der Plan wird in die Projektdatei eingebettet; bei mehrseitigen PDFs nur die
  gewählte Seite.
- Deckkraft einstellbar, Hintergrund sperrbar, austauschbar ohne Verlust der gezeichneten Objekte.
- Kalibrierung: zwei Punkte auf dem Hintergrund klicken, realen Abstand in m eingeben, der
  Hintergrund wird entsprechend skaliert. Kalibrierung jederzeit wiederholbar. Nach der
  2-Punkt-Kalibrierung wird der Hintergrund automatisch gesperrt; gesperrt sind Position, Drehung
  und Maßstab geschützt (Kalibrieren bleibt möglich). Bei PDFs alternativ: Planmaßstab 1:n direkt
  eingeben (sperrt nicht automatisch).
- Rückfrage bei unplausiblem Maßstab: PDF außerhalb 1:50 bis 1:10.000, Bild/SVG mit Planbreite
  außerhalb 10 m bis 5 km, oder Änderung gegenüber der bisherigen Kalibrierung um mehr als Faktor 2.
- Hintergrund zusätzlich verschieb- und drehbar. Nordrichtung pro Festplatz-Page einstellbar
  (Nordpfeil folgt ihr).
- Raster mit einstellbarer Weite. „Raster ein/aus“ ist eine Ansichtseinstellung (kein Undo-Schritt,
  markiert das Projekt nicht als ungespeichert).
- Deckkraft des Rasters (0–100 %, Schritt 5 %, Standard 100 %) im Bereich „Raster“ der Seitenleiste (#1): gilt auf
  diesem Rechner für alle Projekte und Pages, hell und dunkel; kein Undo-Schritt, keine Änderungsmarkierung, nicht
  in der Projektdatei. Der Raster-Fang hängt nur an „Raster ein/aus“, auch bei 0 %. Das PDF zeichnet das Raster
  unabhängig davon (§9).

### 2. Grundflächen
- Rechteck mit dem Grundflächen-Werkzeug aufziehen, drehen, Vorderseite per Klick auf eine Kante
  festlegen (deutlich markiert). Klick ohne Ziehen legt eine Grundfläche 20 × 8 m an; ebenso ein
  Aufziehen mit weniger als 0,5 m in einer Richtung.
- Vorderseite wechseln: Die Fläche bleibt optisch exakt an derselben Stelle, nur die Markierung der
  Vorderseite wandert. Breite und Tiefe beziehen sich danach auf die neue Vorderseite (können tauschen),
  die angezeigte Drehung kann um 90°/180° springen. Zusätzlich Kantenwähler in der Seitenleiste.
- Größe zusätzlich per Ziehen an 8 Griffen (Ecken, Kantenmitten) änderbar; die gegenüberliegende
  Kante bzw. Ecke bleibt fest. Es gelten dieselben Grenzen wie in den Zahlenfeldern (0,5–2000 m).
  Drehen per Drehgriff (Shift = 15°-Schritte) und numerisch.
- Verschieben: Ein Klick wählt die Grundfläche aus; nur eine bereits ausgewählte Grundfläche wird per
  Ziehen verschoben. Ziehen auf einer nicht ausgewählten Grundfläche zieht ein Auswahlrechteck auf.
- Beschriftung automatisch mit Name und Maßen, z. B. „Grundfläche Nord · 50 × 10 m“: horizontal, feste
  Schriftgröße wie die Standbeschriftung, außerhalb der Fläche vor der Mitte der Vorderseite (kollidiert
  so nicht mit Ständen und Freiflächen).

### 3. Geschäfte
- Mit dem Geschäfts-Werkzeug anlegen (Klick: Standardmaß, anfangs 3 × 3 m, danach das zuletzt
  angelegte plausible Maß, also beide Seiten mindestens 0,5 m; Ziehen: Rechteck aufziehen, unter 0,5 m in
  einer Richtung zählt es als Klick), frei verschieben und drehen (Drehgriff und numerisch,
  Einrasten in 15°-Schritten mit gedrückter Shift-Taste). Die Größe eines Stands ändert sich nur über
  Zahlenfelder, nicht per Griff.
- Fang beim Ziehen (Entscheidung 2026-10-11). Fangabstand 8 Bildschirm-Pixel (zoomunabhängig).
  Drei Umschalter in der Werkzeugleiste (Vorderkante Shift+F, Raster Shift+R, Nachbarstände Shift+N);
  sie sind Ansichtseinstellungen (kein Undo-Schritt, keine Änderungsmarkierung, werden mitgespeichert).
  Standard: Vorderkante und Nachbarstände an, Raster aus.
  - Vorderkante (nur Stände): Liegt die Vorderseite des Stands bei gleicher Drehung wie die Grundfläche
    höchstens 8 px von deren Vorderseite entfernt, legt sie sich an die Vorderseite der Grundfläche und
    der Stand übernimmt deren Drehung. Danach gleitet er entlang der Vorderseite; gelöst wird er erst
    bei mehr als 16 px Abstand, dann bekommt er seine ursprüngliche Drehung zurück. Eingerastet fängt er
    entlang der Vorderseite an deren Enden und (mit Nachbar-Fang) an den Kanten benachbarter Stände, dort mit
    dem Fang-Abstand (siehe unten).
  - Nachbarstände: Ein Stand rastet mit dem Fang-Abstand neben einer Kante eines parallel stehenden Nachbarn
    ein (Anliegen) oder fluchtet mit dessen Kanten (Fluchten ohne Abstand).
  - Fang-Abstand (M10, #2): projektweit in den Projekteinstellungen, Standard 0,3 m, 0–10 m, mit Undo; 0 = bündig.
    Es gibt nur diesen einen Fangpunkt je Kante (kein zusätzliches bündiges Einrasten). Projekte aus der Zeit vor
    Formatversion 6 bekommen beim Öffnen 0,3 m (Entscheidung Laurin 2026-10-23). Die Gasse liegt unter der
    Mindestbreite der Freiflächen und erscheint deshalb nicht als Freifläche; die Frontmeter-Statistik bleibt.
  - Raster (Stände und Grundflächen, nur bei eingeblendetem Raster): Rand oder Mitte des Hüllrechtecks
    der Auswahl rastet je Achse an der nächsten Rasterlinie ein.
  - Priorität: Vorderkante vor Nachbarstand vor Raster; bei gleicher Priorität der nähere Kandidat.
  - Mehrfachauswahl: Der Fang gilt für das gegriffene Objekt und verschiebt die Gruppe nur parallel.
  - Beim Einrasten erscheinen Hilfslinien (wie die intelligenten Hilfslinien in Illustrator).
  - Cmd (macOS) bzw. Strg (Windows) beim Ziehen gedrückt halten schaltet jeden Fang vorübergehend aus.
- Geschäfte dürfen AUCH außerhalb von Grundflächen stehen. Dann Warnung, aber keine Blockade.
  Warnungen (Entscheidung 2026-10-11):
  - Außerhalb (orange): Ein Teil des Stands liegt mehr als 0,01 m außerhalb der Vereinigung aller
    Grundflächen, auch wenn er nur hinten herausragt. Ein Stand über zwei aneinanderliegenden
    Grundflächen ist nicht außerhalb.
  - Überlappung (rot, Vorrang vor orange): zwei Stände dringen mehr als 0,01 m ineinander ein.
  - Doppelte Nummer (orange, Entscheidung 2026-10-12): zwei Stände im selben Nummernkreis (§5) haben dieselbe
    Platznummer („12“ = „012“, Groß-/Kleinschreibung und Leerzeichen am Rand egal). Das Präfix gehört zur Nummer:
    „A-12“ = „A-012“, aber „A-12“ ≠ „B-12“. Leere Nummern sind nie doppelt.
    Die Seitenleiste nennt die anderen Stände mit dieser Nummer (auch auf anderen Pages).
  - Infrastruktur (rot, Entscheidung 2026-10-12): Der Stand dringt mehr als 0,01 m in ein Infrastruktur-Objekt ein,
    dessen Typ „freihalten“ hat (§11). Die Seitenleiste nennt das Objekt.
  - Jede Art ist projektweit abschaltbar und pro Stand ignorierbar („außerhalb ignorieren“,
    „Überlappung ignorieren“, „doppelte Nummer ignorieren“, „Infrastruktur ignorieren“, wirkt nur auf den eigenen
    Stand); alles rückgängig machbar.
  - Der Page-Tab zeigt die Zahl der Objekte mit aktiver Warnung: Stände und Infrastruktur-Objekte (Durchfahrt zu eng,
    §11) zusammen. Er ist rot, sobald eine Überlappung, eine Infrastruktur-Warnung oder eine zu enge Durchfahrt dabei
    ist. So sind Probleme auf anderen Pages sichtbar.
- Attribute (Seitenleiste rechts): Platznummer, Geschäftsname, Eigentümer, Typ/Ware,
  Breite, Tiefe, Stromverbrauch in kW [ANPASSEN], Anschlussart (230 V / CEE 16 A / CEE 32 A),
  Notiz, Farbe/Kategorie.
- Form (M12, #9; Entscheidungen Laurin 2026-10-23): Rechteck (Standard), Kreis/Oval oder eine Formvorlage.
  - Kreis/Oval ist die Ellipse im Rechteck B × T (Kreis bei B = T).
  - Die Form betrifft nur die Darstellung (Zeichenfläche, PDF). Freiflächen (§4), Warnungen, Fang, Treffer (Klick in
    eine Ecke außerhalb der Ellipse wählt den Stand trotzdem), Nummerierung, Frontmeter und Statistik rechnen mit dem
    Rechteck B × T als Hitbox. Die Vorderseite bleibt die Unterkante dieses Rechtecks. Eine echte Belegung mit der
    Form ist ausdrücklich nicht vorgesehen.
  - Ist ein Stand mit anderer Form als Rechteck ausgewählt, zeigt die Zeichenfläche die Hitbox dünn gestrichelt;
    im PDF erscheint sie nie.
  - Formvorlagen legt man in den Projekteinstellungen an (§7). Eine Vorlage besteht aus Teilen (Rechteck oder
    Kreis/Oval, je mit X, Y, B, T in Metern, ohne Drehung); ihr Hüllrechteck ist das **Vorschlagsmaß**. Gespeichert
    werden die Teile relativ zum Hüllrechteck: Ändert man B × T eines Stands, wird die Form gestreckt.
  - Zusammengesetzte Formen erscheinen als ein Umriss: eine gemeinsame Füllung ohne doppelte Tönung, eine Kontur nur
    außen (keine Innenkanten).
  - Auswahl in der Seitenleiste (Feld „Form“, auch bei Mehrfachauswahl, ein Undo-Schritt). Die Wahl einer Vorlage
    übernimmt ihr Vorschlagsmaß (Mittelpunkt bleibt); Rechteck und Kreis/Oval ändern die Maße nicht. Kopieren und
    Duplizieren übernehmen die Form; Händler „noch nicht platziert“ haben keine Form.
  - Wird eine verwendete Vorlage gelöscht, fragt die App nach; die Stände fallen auf ihre Grundform (Rechteck bzw.
    Kreis/Oval) zurück, alles rückgängig machbar.
  - Die Legende ist unverändert (Farbfeld je Kategorie bleibt ein Rechteck).
- Farbe: aus der Kategorie; optional eine eigene Farbe pro Stand, die die Kategoriefarbe überschreibt.
  Ohne beides die Standardfarbe des Projekts (Projekteinstellungen, Bereich „Kategorien“; Standard und nach der
  Migration alter Projekte neutrales Grau #a7adb3; M10, #3). Sie gilt auf Zeichenfläche, im PDF und in der Legende.
- Kategorien werden in den Projekteinstellungen der Start-Page (§7) angelegt, umbenannt, umgefärbt und
  gelöscht (bis M5 in der Seitenleiste; seit M6 nur noch auf der Start-Page, Entscheidung 2026-10-12). In der
  Seitenleiste bleibt die Auswahl der Kategorie eines Stands. Beim Löschen einer verwendeten
  Kategorie fragt die App nach; die Stände verlieren die Kategorie (Farbe fällt auf die eigene Farbe
  bzw. die Standardfarbe zurück), alles rückgängig machbar.
- Kategorielisten (#1): Die App bringt die flachen Listen „Jahrmarkt klein“ (11 grobe Kategorien) und „Jahrmarkt
  groß“ (30 feine im Schema „Gruppe – Art“, z. B. „Süßwaren – Waffeln“; nur ein Name, keine Unterkategorie) mit,
  Farben nach Gruppen und im Druck unterscheidbar. „Neues Projekt“ (Menü, Cmd/Strg+N) fragt nach der Liste
  (Vorauswahl die zuletzt gewählte, anfangs „Jahrmarkt klein“; auch „leer“), der Startbildschirm hat die Auswahl
  direkt neben dem Knopf. In den Projekteinstellungen lädt „Kategorieliste laden …“ eine Liste: **ergänzen** fügt
  nur fehlende Namen hinzu (Vergleich ohne Groß-/Kleinschreibung), **ersetzen** lässt danach genau die Liste gelten;
  gleichnamige Kategorien behalten dabei ihre Stände und übernehmen die Farbe der Liste, für entfallende verwendete
  Kategorien fragt die App wie beim Löschen nach. Ein Undo-Schritt.
- Eigene Kategorielisten (#2): „Kategorien als Liste speichern, Listen verwalten …“ (Projekteinstellungen,
  Bereich „Kategorien“) speichert die Kategorien des Projekts (Name, Farbe) unter einem Namen als eigene Liste.
  Eigene Listen gelten **pro Rechner** (wie die Export-Profile, nicht im Projekt, kein Undo) und erscheinen hinter den
  mitgelieferten in „Kategorieliste laden …“, beim neuen Projekt und auf dem Startbildschirm. Verwalten: umbenennen
  und löschen (mit Rückfrage; nur eigene Listen), jede Liste als Datei exportieren, Dateien importieren. Vergebene
  Namen (auch die der mitgelieferten Listen) bekommen eine Nummer („Markt (2)“). Dateiformat: JSON
  `{ "format": "marktplaner-kategorien", "version": 1, "name", "categories": [{ "name", "color" }] }`; Dateien ohne
  diese Kennung, ohne gültige Kategorie oder mit neuerer Version weist die App mit deutscher Meldung ab, ungültige
  Einträge fallen beim Import weg.
- Beschriftung mittig auf dem Stand aus konfigurierbarer Vorlage, z. B.
  `{nr}` / `{name}` / `{breite}×{tiefe} m`. Platzhalter: `{nr}`, `{name}`, `{eigentuemer}`, `{ware}`,
  `{breite}`, `{tiefe}`, `{strom}`, `{anschluss}`, `{kategorie}`. Zeilen, die nach dem Einsetzen leer
  sind oder deren Platzhalter alle leer sind (z. B. „{strom} kW“ ohne Stromangabe), entfallen. Vorlage und Schriftgröße sind projektweit und stehen in den Projekteinstellungen der
  Start-Page (§7; bis M5 im Seitenleisten-Bereich „Beschriftung“).
- Die Beschriftung ist IMMER horizontal, unabhängig von der Drehung des Stands, und wird über
  dem Stand gezeichnet (oberste Ebene).
- Feste Schriftgröße in Planeinheiten (skaliert mit dem Zoom und erscheint im PDF in passender
  Größe), einstellbar in den Projekteinstellungen. Der Text darf über den Stand hinausragen,
  es wird nichts gekürzt oder verkleinert.

### 4. Freiflächen-Logik (Kern)
- Jede Grundfläche hat eine Achse entlang ihrer Vorderseite, Bereich [0, Breite].
- Jedes Geschäft, das die Grundfläche überlappt, belegt auf dieser Achse das Intervall seiner
  Projektion (Schnittmenge mit der Grundfläche).
- Infrastruktur-Objekte, deren Typ „belegt Fläche“ hat, belegen die Achse genau wie ein Geschäft (alle Regeln dieses
  Abschnitts gelten für sie mit). Bei Linien zählt das Rechteck aus Länge × Strichstärke, bei Linien ohne Stärke die
  Projektion der Linie (gerechnet als 5 cm breiter Streifen, damit die Eindringtiefe über der Toleranz liegt). Punkte (Marker) belegen nie (Entscheidung 2026-10-12).
- Freiflächen = [0, Breite] minus Vereinigung aller belegten Intervalle. Jede Freifläche hat die
  volle Tiefe der Grundfläche. Hinter einem Stand entsteht NIE eine Freifläche, auch wenn der
  Stand weniger tief ist.
- Beispiel: Grundfläche 50 × 10 m, Stand 8 m breit bei x = 20 m → Freiflächen 20 × 10 m (links)
  und 22 × 10 m (rechts).
- Ein Stand belegt eine Grundfläche nur, wenn er mehr als 0,01 m in sie hineinragt; eine bloße
  Berührung von außen belegt nichts. Gedrehte Stände belegen ihre volle Projektion. Ragt ein Stand
  seitlich heraus, zählt nur der Teil innerhalb. Intervalle mit einer Lücke bis 0,01 m werden
  zusammengefasst; Intervallenden näher als 0,01 m an 0 bzw. an der Breite werden dorthin gezogen.
- Überlappende Grundflächen: Die frühere Grundfläche (Reihenfolge der Grundflächen auf der Page)
  gewinnt. Eine spätere rechnet nur mit ihrem Teil außerhalb der früheren: Stände werden darauf
  zugeschnitten, ihre Freiflächen verlieren den Teil in der früheren Fläche (kann L-förmig werden;
  Beschriftung dann mit den Hüllmaßen Breite entlang der Vorderseite × größte Tiefe). Frühere
  Grundflächen ändern sich durch spätere nie (Entscheidung 2026-10-11).
- Freiflächen unter einer Mindestbreite (Standard 0,5 m, einstellbar 0,05–100 m in den Projekteinstellungen
  der Start-Page, §7) werden nicht angezeigt. Dort stehen auch die projektweiten Warnungsschalter (§3).
- Beschriftung der Freiflächen wie bei Ständen: „Frei 20 × 10 m“, immer horizontal, mittig, feste
  Schriftgröße; sie erscheint ab 6 px Schrifthöhe auf dem Bildschirm (darunter unlesbar). Darstellung
  hellgrün getönt und schraffiert.
- Neuberechnung live beim Verschieben (auch während des Ziehens), Drehen, Ändern der Maße, Löschen;
  dabei werden nur die betroffenen Grundflächen neu berechnet.
- Jede Freifläche hat einen stabilen Schlüssel aus Grundfläche und den beiden begrenzenden Ständen
  (bzw. Anfang/Ende der Achse). Er bleibt gleich, solange dieselben Stände die Lücke begrenzen, und
  dient den Sprung-Links der Start-Page (§7).
- **Ausblenden** (M11, #8, Entscheidung Laurin 2026-10-23): Freiflächen, die praktisch nicht vergebbar sind (z. B.
  Restfläche, Zufahrt), lassen sich ausblenden: Rechtsklick auf die Freifläche (Auswahlwerkzeug, Ebene „Freiflächen“
  sichtbar, kein Stand, Infrastruktur-Objekt oder Papier-Element darüber) → „Freifläche nicht mehr anzeigen“, oder Knopf
  „ausblenden“ in der Freiflächenliste (§7). Eine ausgeblendete Freifläche wird nicht gezeichnet, zählt nicht in den
  freien Frontmetern, fehlt in Freiflächenliste (außer mit „ausgeblendete zeigen“), Legende und PDF. Gespeichert wird
  pro Page der stabile Schlüssel zusammen mit dem Achsenintervall (von–bis, auf 0,01 m gerundet). Die Ausblendung
  gilt nur, solange eine Freifläche mit demselben Schlüssel und einem bis auf 0,01 m gleichen Intervall existiert:
  Wird ein angrenzender Stand verschoben, in der Größe geändert oder gelöscht oder ein Stand in die Lücke gestellt,
  verfällt sie im selben Undo-Schritt und die Freifläche erscheint wieder (während des Ziehens schon live).
  Ausblenden und „wieder anzeigen“ sind je ein Undo-Schritt. Beim Duplizieren einer Page bleiben Ausblendungen
  erhalten. Ein normaler Linksklick wählt weiterhin die Grundfläche darunter.

### 5. Standnummern
Entscheidungen 2026-10-12 (M5-Planung).
- Modi pro Festplatz: links → rechts über den Festplatz, Uhrzeigersinn um einen Mittelpunkt, manuell.
- **Links → rechts** (geändert 2026-10-12, Laurin): Alle Stände der Page werden von links nach rechts durchlaufen,
  unabhängig von den Grundflächen. Maßgeblich ist die Mitte des Stands auf dem Plan (x-Achse der Zeichenfläche,
  unabhängig von der Nordrichtung). Stände außerhalb von
  Grundflächen zählen genauso mit. Die Reihenfolge der Grundflächen spielt für die Nummerierung keine Rolle mehr;
  sie entscheidet nur noch, welche Grundfläche bei Überlappung gewinnt (§4), und ist im Seitenleisten-Bereich
  „Grundflächen“ mit ↑/↓ änderbar (Undo-Schritt).
  Reihenfolge ohne Toleranz (Entscheidung 2026-10-12, QA-M5-01; eine Toleranz „bis 0,01 m gleich“ ist nicht
  transitiv und machte das Ergebnis von der Anlegereihenfolge abhängig):
  - Verglichen wird die Standmitte, gerundet auf 0,01 m (die gespeicherte Genauigkeit).
  - Kleineres x zuerst.
  - Bei exakt gleichem x: kleineres y zuerst (weiter oben auf der Zeichenfläche).
  - Bei exakt gleicher Position: nach ID (der Fall ist ohnehin eine Überlappung mit Warnung).
  Das Ergebnis hängt nur vom Plan ab, nicht von der Reihenfolge, in der die Stände angelegt wurden.
- **Uhrzeigersinn:** um einen pro Festplatz gesetzten Mittelpunkt (Klick auf die Zeichenfläche nach „Mittelpunkt
  setzen“ oder Felder X/Y; beim ersten Umschalten die Mitte aller Grundflächen und Stände). Startrichtung in Grad
  im Uhrzeigersinn relativ zum Norden des Plans (Nordrichtung der Page), Standard 0° = Norden. Sortiert wird nach
  dem Winkel der Standmitte ab der Startrichtung, ebenfalls ohne Toleranz (QA-M5-01): Standmitte auf 0,01 m
  gerundet, Winkel auf 0,1° gerundet (359,95° und mehr zählt als 0°); bei gleichem gerundetem Winkel der Stand mit
  dem kleineren, auf 0,01 m gerundeten Abstand zum Mittelpunkt zuerst, danach nach ID. Es zählen alle Stände der
  Page. Mittelpunkt und Startrichtung sind auf der Zeichenfläche als Fadenkreuz
  mit Strahl sichtbar, solange der Modus aktiv ist (nicht im PDF).
- **Manuell:** Die Automatik lässt die Page aus.
- **Format:** Präfix der Page + Zahl, aufgefüllt auf die Stellenzahl (z. B. Präfix „A-“, 2 Stellen → „A-01“).
  Präfix pro Festplatz (Seitenleiste); Startnummer und Stellenzahl (1–4, Standard 1 = ohne führende Nullen)
  projektweit in den Projekteinstellungen der Start-Page (§7).
- **Nummernkreis** (Projekteinstellungen der Start-Page; die Seitenleiste zeigt ihn mit Link dorthin): „pro Festplatz“ (jede Page beginnt bei der Startnummer) oder „global durchgehend“ (Pages in
  der Reihenfolge der Tabs; Pages im Modus „manuell“ werden übersprungen, ihre Nummern gelten als belegt).
- **Fixierte Nummern:** Schloss neben der Platznummer (auch bei Mehrfachauswahl). Die Automatik überspringt
  fixierte Stände und vergibt keine Nummer, die einer fixierten im selben Nummernkreis gleicht (Vergleich wie bei
  der Warnung „doppelte Nummer“, §3). Eine fixierte Nummer bleibt von Hand änderbar; fixiert und leer = der Stand
  bleibt ohne Nummer.
- **Neue Stände** und Kopien bekommen keine Nummer, bis neu nummeriert wird. Der Bereich „Nummerierung“ zeigt die
  Zahl der Stände ohne Nummer.
- **Neu nummerieren** nur per Button bzw. Kurzbefehl, damit vergebene Nummern nicht unbemerkt springen. Bei „pro
  Festplatz“ betrifft es die aktive Page, bei „global“ alle Pages außer den manuellen. Der Dialog bietet zwei
  Optionen (Entscheidung 2026-10-12), beide mit Vorschau alt → neu und der Zahl der fixierten und unveränderten
  Stände, beide ein Undo-Schritt:
  - „Alle neu nummerieren“: alle nicht fixierten Stände der betroffenen Pages in der Reihenfolge des Modus.
  - „Nur Stände ohne Nummer“: Bestehende Nummern bleiben unverändert. Stände ohne Nummer bekommen fortlaufende
    Nummern ab der höchsten vergebenen Nummer im Nummernkreis (Zahl = letzte Ziffernfolge einer Nummer, z. B.
    „A-012“ → 12; mindestens die Startnummer), in der Reihenfolge des gewählten Modus. Nummern, die im Nummernkreis
    schon vorkommen, werden übersprungen.
  - Vorausgewählt ist „Nur Stände ohne Nummer“, sobald im Nummernkreis schon irgendein Stand eine Nummer hat, sonst
    „Alle neu nummerieren“.
  Doppelte Nummern, die danach bleiben (z. B. zwischen fixierten Ständen), nennt die Vorschau.

### 6. Strom
Entscheidungen 2026-10-12 (M5-Planung).
- Optionales Stromlimit pro Festplatz in kW. Es zählen alle Stände der Page, auch außerhalb von Grundflächen, und
  seit M7 der Strom der Infrastruktur-Objekte (§11; Entscheidung 2026-10-12). Für sie gilt alles in diesem Abschnitt
  genauso (Summe, Anschlussarten, Hinweis, Blockieren). Die Anzeigen nennen zusätzlich „davon Infrastruktur x kW“.
- Laufende Summe als Balken (grün / gelb ab 90 % / rot über Limit) mit „84 / 100 kW (84 %)“. Verglichen wird auf
  0,001 kW gerundet (11,7 von 13 kW sind genau 90 %, also gelb). Die Prozentzahl wird abgerundet, damit sie zur
  Farbe passt (89,9 % zeigt „89 %“); über dem Limit erscheint sie mit einer Nachkommastelle, wenn die ganze Zahl
  100 wäre (100,1 %), bei weniger als 0,1 % darüber „über 100 %“. Anzeige auf der Festplatz-Page
  im Seitenleisten-Bereich „Strom“ (immer sichtbar, auch bei Auswahl), auf der Start-Page in den Kennzahlen (§7). Ohne Limit nur
  die Summe. Dazu Anzahl und kW je Anschlussart (230 V, CEE 16 A, CEE 32 A, ohne Angabe).
- Überschreitung: eigenes Blitz-Symbol am Page-Tab (getrennt vom Warnzähler der Stände). Ohne Blockieren erscheint
  ein Hinweis nur, wenn eine Änderung die Summe von „im Limit“ auf „über dem Limit“ bringt (Entscheidung 2026-10-12).
  Solange das Limit überschritten bleibt, reichen roter Balken und Blitz-Symbol.
- Blockieren (pro Festplatz einschaltbar): Eine Änderung, die die Summe der Page erhöht und danach über dem Limit
  liegt, wird mit deutscher Meldung abgewiesen (Strom-Feld, Einfügen, Duplizieren, Alt+Ziehen). Senkungen sind
  immer erlaubt. Nicht blockiert werden Rückgängig/Wiederholen, Öffnen, ein Limit unter der aktuellen Summe und das
  Duplizieren einer Page. Bestehende Überschreitungen bleiben sichtbar und werden nicht korrigiert.

### 7. Start-Page (Statistik & Listen)
Entscheidungen 2026-10-12 (M6-Planung).
- **Aufbau:** Kopf mit Projektname, darunter eine immer sichtbare Kennzahlen-Leiste, darunter die Unter-Tabs
  „Geschäfte“, „Freiflächen“, „Infrastruktur“ und „Einstellungen“ (Cmd/Strg+1/2/3/4 auf der Start-Page; „Infrastruktur“
  seit M7, Entscheidung 2026-10-12); deren Inhalt füllt die
  Resthöhe und scrollt selbst. Die Start-Page hat keine Werkzeug- und keine Seitenleiste.
- **Kennzahlen** als Karten „Gesamt“ und je Festplatz (Reihenfolge der Tabs): Anzahl Geschäfte, Frontmeter
  (Summe der Breiten; das ist die belegte Fläche, eine m²-Angabe gibt es nicht), freie Frontmeter (Summe der Breiten
  aller angezeigten Freiflächen, also ab der Mindestbreite; bei angeschnittenen die Hüllbreite; Entscheidung
  2026-10-12), Strom wie in §6 (Balken mit
  Limit je Festplatz, gesamt nur die Summe), Anzahl und kW je Anschlussart, Zahl der Stände mit aktiver Warnung
  (rot, sobald eine Überlappung dabei ist). Klick auf den Festplatz öffnet die Page; Klick auf die Warnzahl öffnet
  die Geschäftstabelle gefiltert auf diesen Festplatz und „mit Warnung“.
  Seit M7 zusätzlich: Anzahl je Infrastruktur-Typ (nur vorkommende Typen, mit Symbol), der Strom der Infrastruktur
  („davon Infrastruktur x kW“), seit M11 (#7) je Kategorie Anzahl, Frontmeter und Strom der Stände
  („■ Imbiss 12 · 38 m · 45 kW“; nur vorkommende Kategorien in der Reihenfolge der Projekteinstellungen, „ohne
  Kategorie“ zuletzt mit der Standardfarbe; Stände mit nicht mehr vorhandener Kategorie zählen als „ohne“; die Summe
  der Anzahlen ist die Anzahl Geschäfte; ein Klick öffnet die Geschäftstabelle gefiltert auf diesen Festplatz und
  diese Kategorie; nur auf der Start-Page, nicht im PDF/CSV) und die Warnungen getrennt als „n Stände · m Infrastruktur“. Die Infrastruktur-Zahl
  öffnet den Unter-Tab „Infrastruktur“ mit den Filtern Festplatz und „mit Warnung“. Die Warnzahl ist rot, sobald
  eine Überlappung, eine Infrastruktur-Warnung oder eine zu enge Durchfahrt dabei ist.
- **Geschäftstabelle** über alle Festplätze:
  - Spalten: Sprung, Festplatz, Nummer (mit Schloss), Name, Eigentümer, Ware, Kategorie, Breite, Tiefe, Strom,
    Anschlussart, Warnungen, Notiz. Spalten ein-/ausblendbar (Sprung und Name immer sichtbar); die Auswahl gilt pro
    Rechner, nicht in der Projektdatei.
  - Sortieren per Klick auf den Spaltenkopf (erneuter Klick kehrt um, Shift+Klick ergibt eine zweite Stufe);
    Nummern natürlich sortiert („A-2“ vor „A-10“), Stände ohne Nummer zuletzt. Standard: Festplatz, dann Nummer.
    Nach einer Zelländerung bleibt die Reihenfolge stehen, bis Sortierung oder Filter geändert werden (Hinweis
    „Sortierung veraltet“), damit die bearbeitete Zeile nicht wegspringt.
  - Freitextsuche in Name, Eigentümer und Ware (ohne Groß-/Kleinschreibung und Akzente). Filter nach Festplatz,
    Kategorie und Anschlussart (jeweils auch „ohne“), „mit Warnung“, „ohne Nummer“. Suche, Filter und Sortierung
    gelten nur für die Sitzung, werden nicht im Projekt gespeichert (Entscheidung 2026-10-12) und bleiben beim Wechsel der Page erhalten.
  - Summenzeile über die gefilterten Zeilen: Anzahl, Frontmeter, Strom, Anzahl je Anschlussart.
  - Direkt editierbar: Nummer, Schloss, Name, Eigentümer, Ware, Kategorie, Breite, Tiefe, Strom, Anschlussart,
    Notiz. Es gelten dieselben Regeln wie in der Seitenleiste (Grenzen, Rundung, Zahlenformat, Fixierung,
    Stromlimit-Blockieren aus §6). Jede Zelländerung ist genau ein Undo-Schritt und wirkt sofort im Plan.
    Festplatz und Warnungen sind nicht editierbar.
  - Tastatur: Pfeiltasten, Pos1/Ende, Bild↑/↓ bewegen die aktive Zelle; Enter oder F2 bearbeitet, ein getipptes
    Zeichen beginnt die Bearbeitung und ersetzt den Inhalt; im Editor übernimmt Enter (eine Zeile tiefer), Tab/Shift+Tab
    (nächste/vorige Zelle), Esc verwirft. Leertaste schaltet das Schloss, Entf leert eine Textzelle,
    Cmd/Strg+Enter springt zum Stand. Kurzbefehle der Zeichenfläche greifen in der Tabelle nicht.
  - Flüssig mit mindestens 500 Zeilen (nur die sichtbaren Zeilen werden gezeichnet).
  - Sprung (Symbol am Zeilenanfang oder Cmd/Strg+Enter; ein Klick in eine Zelle springt nicht): wechselt auf die
    Festplatz-Page, zoomt auf den Stand (mindestens 30 m Ausschnitt), wählt ihn aus und hebt ihn etwa 1,5 s hervor.
- **Freiflächenliste:** Festplatz, Grundfläche, Breite, Tiefe, Fläche (m²); angeschnittene Freiflächen (§4,
  L-förmig) sind markiert und zeigen die Hüllmaße. Filter nach Festplatz und „passt für einen Stand mit mindestens
  B × T“: Breite ≥ B und Tiefe ≥ T mit 0,01 m Toleranz; bei angeschnittenen Freiflächen zählt die kleinste
  durchgehende Tiefe. Sortierbar, Standard Breite absteigend, bei aktivem Passt-Filter aufsteigend (engste passende
  Lücke zuerst). Klick auf eine Zeile springt wie bei Ständen und hebt die Freifläche hervor. Der Sprung nutzt den
  stabilen Schlüssel aus §4; hat sich die Freifläche inzwischen verändert, wird die passendste Freifläche derselben
  Grundfläche gezeigt; gibt es keine mehr, zeigt die App die Grundfläche mit einem Hinweis.
  Seit M11 (#8): Ausgeblendete Freiflächen (§4) fehlen in Liste, Anzahl und Summe. Der Schalter „ausgeblendete zeigen
  (n)“ (nur für die Sitzung) zeigt sie grau mit Hinweis „ausgeblendet“; sie zählen auch dann nicht in der Summe. Jede
  Zeile hat einen Knopf „ausblenden“ bzw. „wieder anzeigen“ (ein Klick darauf springt nicht). Der CSV-Export bekommt
  bei eingeschaltetem Schalter die Spalte „ausgeblendet“.
- **Infrastrukturliste** (Unter-Tab „Infrastruktur“, seit M7): alle Infrastruktur-Objekte über alle Festplätze.
  - Spalten: Sprung, Festplatz, Typ (mit Symbol), Bezeichnung, Maße (B × T, bei Linien die Länge, bei der Durchfahrt
    die lichte Breite, bei Markern leer), Strom, Anschlussart, Warnung, Notiz.
  - Sortierbar wie die Geschäftstabelle. Standard: Festplatz, dann Typ (Reihenfolge der Typen), dann Bezeichnung.
  - Filter: Festplatz, Typ, „mit Warnung“; nur für die Sitzung.
  - Direkt editierbar: Bezeichnung, Notiz und bei Rechteck-Typen Strom und Anschlussart, in Eingabefeldern der Zeile
    (Enter oder Verlassen übernimmt, Esc verwirft; Tab springt zum nächsten Feld). Jede Änderung ist ein Undo-Schritt,
    das Stromlimit-Blockieren gilt wie in der Geschäftstabelle. Die Zellnavigation mit Pfeiltasten der
    Geschäftstabelle gibt es hier nicht (wenige Zeilen).
  - Sprung wie bei Ständen. CSV-Export wie bei den anderen Listen (Cmd/Strg+Shift+E).
- **Projekteinstellungen** (Unter-Tab „Einstellungen“): Projektname, Nummernkreis (Zählung, Startnummer,
  Stellen; §5), Beschriftung (Vorlage, Schriftgröße; §3), Mindestbreite der Freiflächen und Warnungsschalter (§4,
  §3), Kategorien (§3). Seit M7 außerdem: Mindestbreite der Durchfahrt und die Schalter der Infrastruktur-Warnungen
  (§11), die Infrastruktur-Typen (§11) und das Schriftfeld (Datum, Version; §8). Seit M10: Fang-Abstand zu
  Nachbarständen (§3) und Standardfarbe der Geschäfte ohne Kategorie (§3). Seit M12: Formvorlagen (§3 „Form“) mit
  einfachem Editor (Name, Tabelle der Teile mit Art, X, Y, B, T in Metern, Vorschau mit Vorderseite und
  Hüllrechteck). Alles mit Undo. Seitenbezogenes (Präfix, Modus, Stromlimit, Blockieren) bleibt in der
  Seitenleiste der Festplatz-Page.
- **Export:** Geschäftstabelle und Freiflächenliste als CSV (gefilterte, sortierte Zeilen, sichtbare Spalten;
  UTF-8 mit BOM, Semikolon, Zahlen mit Komma, damit Excel in Deutschland die Datei direkt öffnet; Textzellen, die
  mit = + - @ beginnen, bekommen ein ' vorangestellt). XLSX folgt in Phase 2. Nach einer Leerzeile folgt als
  letzte Zeile der Vermerk „Marktplaner, Version x.y.z, Laurin Ludwig, https://github.com/LaurinLudwig“ (M10, #5).

### 8. Schriftfeld, Blatt und Legende
Entscheidungen 2026-10-12 (M7-Planung). Schriftfeld und Legende sind Papier-Elemente: Ihre Größe ist in mm auf dem
Papier festgelegt, nicht in Metern auf dem Plan. Damit sind sie im PDF bei jedem Maßstab gleich groß und lesbar.

**Blatt** (pro Festplatz-Page):
- Einstellungen: Papierformat A4–A0, Hoch/Quer, Maßstab 1:n oder „an Seite anpassen“.
  - Standard: A3 quer, an Seite anpassen.
  - Einstellbar im Seitenleisten-Bereich „Blatt“ der Page, ohne Auswahl. Jede Änderung ist ein Undo-Schritt.
- Auf der Zeichenfläche ist das Blatt als gestrichelter Rahmen sichtbar, mit der Marke „A1 quer · 1:500“. Es ist
  nicht gedreht; seine Achsen sind die der Zeichenfläche.
- **Fester Maßstab 1:n:** Der Rahmen ist Papiermaß × n groß (A1 quer bei 1:500 = 420,5 × 297 m). Seine Lage (Mitte
  in Metern) ändert man, indem man Rahmen oder Marke mit dem Auswahlwerkzeug zieht (Undo-Schritt). n ist eine ganze
  Zahl von 10 bis 100.000.
- **An Seite anpassen:** Der Inhalt sind alle Grundflächen, Geschäfte und Infrastruktur-Objekte der Page. Gibt es
  keine, ist es der Hintergrund; gibt es den auch nicht, sind es 100 × 100 m um den Ursprung.
  - Der Inhalt wird in den Bereich des Papiers eingepasst, den die sichtbaren Papier-Elemente frei lassen
    (Entscheidung 2026-10-12, M8-Planung, E-49): Papier minus 10 mm Rand, minus jedes sichtbare Papier-Element mit
    3 mm Abstand. Gewählt wird das freie achsenparallele Rechteck, in dem der Inhalt am größten erscheint; darin steht
    er mittig. Ist dieses Rechteck kleiner als 25 % des Papiers, gilt wie zuvor das ganze Papier mit 10 mm Rand.
  - Da die Legende von den sichtbaren Ebenen abhängt, kann das angepasste Blatt im PDF (Ebenen des Profils) leicht von
    der Zeichenfläche (Ebenen der Page) abweichen; die Vorschau im Export-Dialog zeigt das PDF.
  - n wird auf volle 10 aufgerundet, damit ein lesbarer Maßstab entsteht (z. B. 1:440).
  - Der Rahmen folgt dem Inhalt und lässt sich nicht ziehen.
  - Beim Umschalten auf einen festen Maßstab werden die aktuelle Mitte und n (auf volle 10) übernommen.
- Ab M8 exportiert das PDF genau dieses Blatt (§9).

**Papier-Elemente:**
- Anker: Jedes Element hängt an einer Ecke des Blatts (oben links, oben rechts, unten links, unten rechts). Dazu kommt
  ein Abstand in mm von den beiden Blatträndern dieser Ecke.
- Ändern sich Format, Ausrichtung oder Maßstab, bleibt der Abstand zur gewählten Ecke erhalten. Das Element bleibt
  auf dem Papier gleich groß und deckt bei 1:500 mehr Planfläche ab als bei 1:200.
- Elemente ragen nie über den Blattrand (Entscheidung 2026-10-12, QA-M7-01). Passt der gespeicherte Abstand auf
  einem kleineren Format nicht, steht das Element am Blattrand; gespeichert bleibt der Abstand, bei einem größeren
  Format steht es wieder an seiner Stelle. Die Seitenleiste weist darauf hin.
- Auf der Zeichenfläche wird es in Planeinheiten gezeichnet (1 mm = n/1000 m).
- **Auswählen und Verschieben** (Entscheidung 2026-10-12, QA-M7-01; Regel geändert 2026-10-14, Laurin, M8-Nacharbeit):
  Papier-Elemente dürfen die Arbeit auf der Zeichenfläche nicht stören. Wie bei Grundflächen (§2) gilt:
  - Ein Klick (ohne Ziehen) auf ein Papier-Element wählt es aus.
  - Nur ein bereits ausgewähltes Papier-Element wird per Ziehen verschoben.
  - Ziehen, das auf einem nicht ausgewählten Papier-Element beginnt, zieht ein Auswahlrechteck auf wie auf leerer
    Fläche.
  - Dasselbe gilt für Rahmen und Marke des Blatts (bei festem Maßstab ziehbar, wenn das Blatt ausgewählt ist); ein
    angepasstes Blatt lässt sich nicht ziehen, dort zieht Ziehen immer ein Auswahlrechteck auf.
  Beim Ziehen dienen die Blattecken als Fangpunkte: Eine Ecke des Elements
  rastet in 8 Bildschirm-Pixeln an der Blattecke ein, bündig (0 mm) oder mit dem Standardrand von 10 mm;
  Cmd/Strg schaltet den Fang aus. Beim Loslassen wird die nächstgelegene Ecke zur gewählten Ecke; gespeichert
  werden Ecke und Abstand in mm (auf 1 mm gerundet), begrenzt auf das Blatt. Das Format von `project.json` ändert
  sich dadurch nicht.
  - Pfeiltasten verschieben um 1 mm, mit Shift um 10 mm.
  - Jede Verschiebung ist ein Undo-Schritt.
- Einschränkungen: Papier-Elemente kommen nicht in Auswahlrechteck oder Mehrfachauswahl und sind nicht kopierbar.
  Entf blendet ein ausgewähltes Element aus (Undo-Schritt).
- Sichtbarkeit: Pro Page sind Schriftfeld, Legende, Maßstabsbalken und Nordpfeil ein-/ausblendbar (Bereich „Blatt“;
  Legende auch mit Shift+L). Sie gilt auch für das PDF; das Export-Profil ändert sie nicht.
- Alles zum Verschieben, Fangen, Begrenzen und Ausblenden gilt für alle vier Papier-Elemente gleich (seit M8).
- Ebene „Blatt“: Rahmen und Papier-Elemente liegen auf dieser eigenen Ebene. Sie ist ein-/ausblendbar und sperrbar.

**Schriftfeld:**
- Auf jeder Festplatz-Page, einheitliches festes Layout auf allen Pages, 180 mm breit (nach ISO 7200):
  - Zeile 1: Projektname (5 mm Schrifthöhe).
  - Zeile 2: Festplatz (3,5 mm).
  - Zeile 3: „Maßstab 1:500 bei Druck in Originalgröße (A1 quer) · Datum · Version“ (2,5 mm). Leere Angaben
    entfallen. Maßstab und Format kommen aus dem Blatt. Der Zusatz steht da, weil „an Seite anpassen“ im Druckdialog
    den Maßstab zerstört (Entscheidung 2026-10-12, M8-Planung).
  - Darunter der optionale Freitext der Page: bis zu 4 Zeilen à 2,5 mm, weitere Zeilen werden abgeschnitten (mit
    Hinweis in der Seitenleiste). Die Höhe wächst mit dem Freitext.
- Standardposition: unten rechts, 10 mm Abstand.
- **Projektweite Felder:** Datum (freier Text, Knopf „Heute“ setzt das aktuelle Datum TT.MM.JJJJ) und Version. Sie
  gelten für alle Pages und sind in den Projekteinstellungen (Bereich „Schriftfeld“) und in der Seitenleiste
  bearbeitbar, wenn das Schriftfeld ausgewählt ist.
- **Pro Page:** Freitext, Position und Sichtbarkeit.
- **Werkzeug „Schriftfeld“ (T):** Ein Klick auf die Zeichenfläche setzt die linke obere Ecke des Schriftfelds an die
  Klickstelle (Anker wie beim Ziehen) und wählt es aus.

**Legende:**
- Die Einträge entstehen automatisch aus dem, was auf der Page tatsächlich sichtbar vorkommt. Ausgeblendete Ebenen
  fehlen; ab M8 gilt das auch für die Ebenen des Export-Profils.
- Reihenfolge der Einträge:
  1. Grundfläche (wenn es eine gibt)
  2. Freifläche (wenn mindestens eine angezeigt wird)
  3. Kategorien der Stände in Projektreihenfolge
  4. „Geschäft ohne Kategorie“ in der Standardfarbe des Projekts, wenn es Stände ohne Kategorie und ohne eigene
     Farbe gibt
  5. Infrastruktur-Typen in der Reihenfolge der Typen, mit Symbol und Farbe
- Stände mit eigener Farbe erzeugen keinen eigenen Eintrag.
- Layout: Titel „Legende“ (3,5 mm), Spalten von 60 mm Breite, Zeilen von 5 mm mit Farbfeld bzw. Symbol (8 × 5 mm) und
  Text (2,5 mm).
  - Reicht die Blatthöhe abzüglich 20 mm nicht, wird die nächste Spalte angelegt.
  - Lange Namen werden mit „…“ gekürzt.
- Standardposition: unten links, 10 mm Abstand.
- Eine Legende ohne Einträge wird nicht gezeichnet; die Seitenleiste zeigt dann einen Hinweis.

**Maßstabsbalken** (seit M8, Entscheidung 2026-10-12): Papier-Element mit dem Anker-Modell oben.
- Länge 1, 2 oder 5 × 10^k m: die längste, die höchstens 80 mm auf dem Papier ergibt (damit mindestens 32 mm; bei
  1:500 also 20 m = 40 mm). Bei 2 × 10^k vier Felder, sonst fünf, abwechselnd schwarz und weiß. Beschriftung „0“,
  Mitte und Endwert mit „m“ (2,5 mm), darunter „1:n“.
- Feste Größe 92 × 14 mm auf weißem Grund, damit die Lage auf dem Papier nicht vom Maßstab abhängt.
- Standardposition: oben links, 10 mm Abstand.

**Nordpfeil** (seit M8, Entscheidung 2026-10-12): Papier-Element, 20 × 20 mm, gestaltet wie der Nordpfeil der
Zeichenfläche (Kreis, Nadel), gedreht um die Nordrichtung der Page (§1). Das „N“ steht aufrecht an der Spitze.
Standardposition: oben rechts, 10 mm Abstand.

### 9. PDF-Export
Entscheidungen 2026-10-12 (M8-Planung).

**Gleiche Darstellung wie die Zeichenfläche.** Zeichenfläche und PDF entstehen aus derselben Szenenbeschreibung
(`src/core/scene/`): Bausteine je Objekt liefern Grundformen (Polygon, Pfad, Linie, Text, Symbol, Bild) mit
Stilschlüssel. Die Zeichenfläche setzt die Stilschlüssel als CSS-Klassen um (Design hell/dunkel), das PDF über eine
feste Papier-Stiltabelle (Farben des hellen Designs, Strichstärken in mm). Nur auf dem Bildschirm: Auswahl, Griffe,
Fang-Hilfslinien, Blattrahmen und -marke, Fadenkreuz der Nummerierung, Bildratenanzeige, Ausblenden zu kleiner
Schrift.

**Blatt und Maßstab.**
- Jede Page wird als eine PDF-Seite exportiert, genau ihr Blatt (§8): Format A4–A0, Hoch/Quer, Maßstab 1:n oder „an
  Seite anpassen“. Der Export-Dialog zeigt und ändert diese Werte; die Änderung gilt für die Page (Undo-Schritt).
- Seitengröße exakt in mm (1 pt = 25,4/72 mm; A1 quer = 841 × 594 mm). Bei 1:500 ist 1 cm auf dem Papier exakt 5 m.
- Inhalt außerhalb des Blatts wird abgeschnitten.

**Inhalt einer Seite** in dieser Reihenfolge, jeweils gemäß Export-Profil: Hintergrund, Raster, Grundflächen,
Freiflächen, Geschäfte (in ihrer Form, §3; ohne Hitbox), Infrastruktur, Warnungen, Beschriftung; darüber die sichtbaren Papier-Elemente der Page
(Schriftfeld, Legende, Maßstabsbalken, Nordpfeil). Die Ebenen-Sichtbarkeit der Zeichenfläche spielt keine Rolle. Die
Legende entsteht aus den Ebenen des Profils.
- Raster: in der Rasterweite der Page, kräftige Linien alle 10; Linien mit weniger als 2 mm Abstand auf dem Papier
  entfallen. Ob es erscheint, entscheidet nur das Profil („Raster ein/aus“ der Zeichenfläche zählt nicht).
- Objekte, die das Blatt nicht berühren, kommen nicht ins PDF.

**Hintergrund.**
- PDF-Hintergründe werden als Vektor übernommen (Originalseite eingebettet, je Datei nur einmal), mit Lage, Drehung,
  Maßstab und Deckkraft wie auf der Zeichenfläche.
- Rasterbilder (PNG, JPEG): nur der Ausschnitt auf dem Blatt; heruntergerechnet, wenn sie feiner sind als die
  Ziel-Auflösung, nie hochgerechnet. Qualität im Export-Dialog: „E-Mail“, 150, 200, 300 dpi oder Original; Standard
  200 dpi, die zuletzt gewählte merkt sich der Rechner. JPEG bleibt JPEG (Qualität 85 nach libjpeg-Skala; unverändert,
  wenn weder beschnitten noch verkleinert), PNG bleibt PNG.
- **„E-Mail“** (Nacharbeit 2026-10-14, Laurin): 100 dpi, alle Rasterbilder (auch PNG und gerasterte SVG) als JPEG mit
  Qualität 60. Ziel: 8 Pages A1 mit großem Rasterhintergrund unter 20 MB, in Chromium und WebKit.
- **Gleiche Dateigröße in allen Browsern** (Nacharbeit 2026-10-14): Die Browser deuten den JPEG-Qualitätswert
  unterschiedlich (WebKit 0,85 ≈ libjpeg 97). Der Export ermittelt deshalb je Browser einmal den Qualitätswert, dessen
  Quantisierungstabelle der libjpeg-Tabelle für die gewünschte Qualität am nächsten kommt.
- **Geschätzte Dateigröße**: Der Export-Dialog zeigt sie vor dem Export („geschätzt ca. 12 MB“), berechnet aus Umfang,
  Profil, Qualität und den Hintergründen (Ausschnitt, Pixelzahl, Kompression der Quelldatei).
- SVG-Hintergründe werden in M8 in der Ziel-Auflösung gerastert (PNG; Entscheidung Laurin, Vektor siehe Eingang).
- Erwartete Größen: Seite ohne Hintergrund 50–300 KB; Gesamtplan 8 Pages ohne Hintergrund unter 2 MB; ein
  A1-Rasterhintergrund (8000 × 6000 px JPEG) bei 200 dpi 8–15 MB, bei 300 dpi 12–25 MB je Seite.

**Text und Symbole.** Schrift IBM Plex Sans (wie die Oberfläche), eingebettet als Teilmenge; Text ist durchsuchbar
und kopierbar, Umlaute und ß korrekt. Beschriftungen haben im PDF immer einen weißen Rand (Lesbarkeit über dem
Hintergrund; E-23). Symbole (Material Symbols) und alle Formen sind Vektoren.

**Export-Profile** (pro Rechner, nicht in der Projektdatei; Entscheidung Laurin):
- Ein Profil legt fest:
  - Ebenen: Hintergrund, Raster, Grundflächen, Freiflächen, Geschäfte, Infrastruktur, Beschriftung (je an/aus);
  - Warnungen: keine, „Rettungswege“ (nur „Infrastruktur“ = Stand in Freihaltefläche und „Durchfahrt zu eng“) oder
    alle;
  - erlaubte Felder für Standbeschriftung und Anhang: Nummer, Name, Eigentümer, Ware, Breite, Tiefe, Strom,
    Anschlussart, Kategorie, Notiz. Platzhalter nicht erlaubter Felder werden in der Beschriftungsvorlage leer, Zeilen
    entfallen wie in §3. Strom, Anschlussart und Notiz gelten auch für Infrastruktur-Objekte;
  - Anhang: Standliste, Freiflächenliste, Infrastrukturliste (je an/aus).
- Mitgeliefert (bearbeitbar, „Zurücksetzen“ stellt den Auslieferungsstand her, nicht löschbar):
  - „Intern“: alles, alle Warnungen, Anhang mit allen drei Listen.
  - „Sanität/Ordnungsamt“: alle Ebenen außer Raster, Warnungen „Rettungswege“, ohne Eigentümer, Strom,
    Anschlussart und Notiz; Anhang Standliste und Infrastrukturliste.
  - „Händler“: ohne Freiflächen, Raster und Warnungen; nur Nummer und Name; kein Anhang.
- Eigene Profile im Export-Dialog über „Profile verwalten …“ anlegen (als Kopie des gewählten), umbenennen
  („Profilname“), bearbeiten, löschen (mit Rückfrage). Kein Undo-Schritt, keine Änderungsmarkierung am Projekt.
- Die Raster-Auflösung und das zuletzt gewählte Profil merkt sich der Rechner ebenfalls.
- Fehlt in einem gespeicherten Profil eine Angabe, gilt sie als nicht erlaubt. Eine unlesbare Profildatei führt zu
  den mitgelieferten Profilen mit deutscher Meldung.

**Datenschutz.** Nicht erlaubte Felder kommen im PDF überhaupt nicht vor: nicht im sichtbaren Inhalt, nicht im
Textlayer, nicht in ausgeblendeten Objekten, nicht in Lesezeichen und nicht in den Metadaten. Dazu wird vor dem
Export eine Kopie des Projekts erzeugt, in der diese Felder geleert sind; nur sie wird verarbeitet. Die Liste
„noch nicht platziert“ (§10) kommt nie in den Export. Das PDF enthält
keine optionalen Inhalte (Ebenen), Anmerkungen, Formulare, Dateianhänge oder XMP-Metadaten; nicht gezeigte Ebenen
werden nicht gezeichnet. Metadaten: Titel „Projektname – Profilname“, Ersteller „Marktplaner x.y.z – Laurin Ludwig,
https://github.com/LaurinLudwig“, Erzeuger „Marktplaner x.y.z“, kein Autor.
**Vermerk** (M10, #5, Entscheidung Laurin 2026-10-23): Jede Seite, auch der Anhang, trägt mittig 3 mm über der
Unterkante in kleiner grauer Schrift (2 mm, ≈ 5,7 pt) „Marktplaner, Version x.y.z, Laurin Ludwig,
https://github.com/LaurinLudwig“. Die Version kommt beim Bauen aus `package.json`. Der Vermerk liegt im 10-mm-Rand
unter den Papier-Elementen und ist in den Export-Profilen nicht abschaltbar; er steht nicht in der Projektdatei.

**Umfang.**
- „Gesamtplan“: alle Festplatz-Pages in Tab-Reihenfolge. „Auswahl“: einzelne Pages per Häkchen.
- Jede Seite hat das Format ihres Blatts; ein PDF kann verschiedene Formate enthalten.
- Anhang gemäß Profil (im Dialog abwählbar): Standliste (sortiert nach Festplatz, dann Nummer natürlich; Spalten =
  erlaubte Felder), Freiflächenliste (Festplatz, Grundfläche, Breite, Tiefe, Fläche), Infrastrukturliste (Festplatz,
  Typ, Bezeichnung, Maße, erlaubte Felder). A4 quer, Kopfzeile auf jeder Seite, „Anhang – Seite 2 von 5“. Die Listen
  enthalten nur Pages des Exports. Ausgeblendete Freiflächen (§4, M11) fehlen im Plan, in der Legende und im Anhang.
- Lesezeichen je Page und je Liste des Anhangs.

**Bedienung.**
- „Als PDF exportieren …“ im Menü, Kurzbefehl Cmd/Strg+P, auch auf der Start-Page.
- Dialog: Profil (mit „Profile verwalten …“), Umfang, Anhang, Raster-Auflösung, Blatt je Page, Vorschau.
- Vorschau: das echte PDF der gewählten Page (Rasterbilder dafür mit 72 dpi), mit pdf.js gezeichnet, aktualisiert
  kurz nach jeder Änderung.
- Der Export läuft im Hintergrund auf einem Stand des Projekts zum Zeitpunkt des Starts; die Oberfläche bleibt
  bedienbar. Fortschritt unten links, nicht modal („PDF: Page 3 von 8“, Balken, Prozent) mit „Abbrechen“.
- Speichern über den Dateidialog (Desktop) bzw. als Download (Browser). Dateiname-Vorschlag
  „{Projekt} – {Profil} – {JJJJ-MM-TT}.pdf“, bei genau einer Page „{Projekt} – {Festplatz} – {Profil} – {Datum}.pdf“;
  im Dateinamen unzulässige Zeichen werden durch „-“ ersetzt.
- Fehlt die Datei eines Hintergrunds, wird ohne ihn exportiert, mit Hinweis.

**Abnahmekriterium Dauer** (M8): 8 Pages A1 quer mit je einem JPEG-Hintergrund 8000 × 6000 px, 500 Stände, Profil
„Intern“ mit Anhang, 300 dpi: Median aus 3 Läufen höchstens 60 s in Chromium und WebKit, während des Exports kein
Bild der Oberfläche über 200 ms, Datei höchstens 200 MB. Dasselbe mit Qualität „E-Mail“: Datei unter 20 MB in
Chromium und WebKit. Geprüft mit `npm run test:perf`.

### 10. Daten
- Projekt als eine Datei speichern (JSON-basiert, eigenes Dateiformat), Autosave, Undo/Redo.
  Format: ZIP-Container `.mplan` mit `project.json` und den eingebetteten Hintergrunddateien. Dateien mit der
  alten Endung `.schelme` (vor der Umbenennung, #10) lassen sich weiter öffnen (Dialog und Doppelklick); Speichern
  schreibt eine geöffnete `.schelme`-Datei an ihren Pfad, „Speichern unter …“ schlägt `.mplan` vor. Die interne
  Formatkennung `format: "schelmeplaner"` in `project.json` bleibt.
  Einstellungen dieses Rechners (Export-Profile, Spalten, Ansicht) und Sicherungen unbenannter Projekte übernimmt
  die App beim ersten Start einmalig aus den Datenordnern der alten Kennung `de.schelmenmarkt.schelmeplaner`
  (neue Kennung `de.laurinludwig.marktplaner`); die alten Ordner bleiben unangetastet.
- Ein neues Projekt fragt beim ersten Speichern nach Name und Ort; bis dahin liegt nur eine automatische Sicherung im
  App-Datenordner. Exporte (PDF, CSV, später XLSX) schlagen im Speichern-Dialog den Ordner der Projektdatei vor (#4);
  ist das Projekt noch nicht gespeichert, öffnet das Betriebssystem den zuletzt benutzten Ordner. Im Browser-Modus
  (Download) ohne Wirkung.
- Zuletzt geöffnet (#11): Die App merkt sich pro Rechner die letzten 10 geöffneten oder gespeicherten Projektdateien
  (neueste zuerst, nicht in der Projektdatei). Öffnen über Startbildschirm oder Menü wie Cmd/Strg+O (Rückfrage bei
  ungespeicherten Änderungen); fehlt die Datei, meldet die App das und entfernt den Eintrag. Im Browser-Modus gibt es
  keine Dateipfade, die Liste bleibt dort leer.
  Autosave schreibt in eine Sicherungsdatei, die beim Öffnen zur Wiederherstellung angeboten wird.
  Undo/Redo gilt projektweit.
- Das Dateiformat ist versioniert (`schemaVersion` in `project.json`). Jede Formatänderung erhöht die
  Version und bringt eine Migration mit, die ältere Dateien beim Öffnen umwandelt und fehlende Felder mit
  Standardwerten ergänzt. Dateien einer neueren Version, als die App kennt, werden mit einer
  verständlichen Meldung abgewiesen (Entscheidung 2026-10-11; Version 2 seit M4, Version 3 seit M5, Version 4 seit M7, Version 5 seit M8,
  Version 6 seit M10, Version 7 seit M11: ausgeblendete Freiflächen je Page, Version 8 seit M12: Form der Stände und
  Formvorlagen).
- Projekt als Vorlage fürs nächste Jahr duplizieren.
- Import einer Händlerliste aus CSV/XLSX (Spalten zuordnen). Importierte Händler landen in einer
  Liste „noch nicht platziert“ und können per Drag & Drop platziert werden. [Phase 2]

### 11. Infrastruktur
Entscheidungen 2026-10-12 (M7-Planung).

**Geometrie.** Jeder Typ hat eine Geometrie. Gespeichert wird immer ein Rechteck (Mitte, w, d, Drehung), damit
Auswahl, Drehen, Pfeiltasten, Kopieren und Undo wie bei Ständen funktionieren.
- **Rechteck:** Breite × Tiefe, Mitte, Drehung. Die Maße ändert man über die Zahlenfelder, wie bei Ständen.
- **Linie:** Länge (`w`), Richtung (Drehung) und Strichstärke (`d`).
  - Zwei Endpunkt-Griffe ändern Länge und Richtung. Sie fangen an Ecken und Kanten von Objekten (Fang wie beim
    Messwerkzeug; Cmd/Strg schaltet ihn aus, Shift beschränkt auf 15°-Schritte).
  - Die Länge ist 0,5–2000 m, die Stärke 0–5 m.
- **Punkt:** nur Mitte und Text, keine Maße. Symbol und Text sind in Planeinheiten so groß wie die Standbeschriftung.

**Feste Typen.** Sie lassen sich umbenennen, umfärben und in den Einstellungen „belegt Fläche“ und „freihalten“
umstellen; Standardmaß ebenfalls. Geometrie und Symbol fester Typen sind fest, löschen lässt sich ein fester Typ nicht.

| Typ | Geometrie | Standardmaß | Symbol | belegt Fläche | freihalten |
|---|---|---|---|---|---|
| Mobile Sperre | Linie (gestrichelt) | 3,5 m, Stärke 0,3 m | `fence` | nein | ja |
| Feste Sperre | Linie | 4 m, Stärke 0,8 m | `block` | nein | ja |
| Sanitätsdienst | Rechteck | 6 × 3 m | `medical_services` | ja | ja |
| RTW-Platz | Rechteck | 8 × 3,5 m | `ambulance` | ja | ja |
| Toilette | Rechteck | 6 × 2,5 m (Toilettenwagen) | `wc` | ja | ja |
| Müllcontainer | Rechteck | 1,5 × 1,2 m | `delete` | ja | ja |
| Enge Durchfahrt | Linie (Maßlinie) | 3,5 m, Stärke 0 | `arrow_range` | ja | ja |
| Marker | Punkt | – | `location_on` | nein | nein |

**Eigene Typen.** In den Projekteinstellungen werden eigene Typen angelegt, z. B. Bühne, Info-Stand oder
Feuerwehrzufahrt. Felder:
- Name und Geometrie.
- Symbol aus einer festen Auswahl lokal gebündelter Material Symbols.
- Farbe und Standardmaß.
- „belegt Fläche“ und „freihalten“.

Löschen eines verwendeten Typs: Die App fragt nach und löscht seine Objekte mit. Alles mit Undo.

**Anlegen und Attribute.**
- Werkzeug „Infrastruktur“ (I) mit dem gewählten Typ.
  - Ein Klick legt ein Objekt im Standardmaß an (Mitte bzw. bei Linien Anfangspunkt an der Klickstelle, waagerecht).
  - Ziehen zieht bei Rechtecken das Rechteck auf und bei Linien die Linie von A nach B.
  - Unter 0,5 m zählt das als Klick.
- Attribute: Typ (wechselbar innerhalb derselben Geometrie), Bezeichnung (beim Marker der angezeigte Text), Notiz,
  X/Y, Maße, Drehung.
- Bei Rechteck-Typen zusätzlich Strom in kW und Anschlussart. Sie zählen ins Stromlimit des Festplatzes (§6).
- Neue Objekte beginnen ohne Bezeichnung, Notiz und Strom; Kopien (Einfügen, Duplizieren, Alt+Ziehen) übernehmen sie
  vom Original.

**Darstellung.**
- Rechtecke: in Typfarbe getönt, mit Rand und Symbol in der Mitte.
- Linien: in Typfarbe in ihrer Stärke, mindestens 2 px.
- Enge Durchfahrt: als Maßlinie mit Endstrichen und der lichten Breite („3,20 m“).
- Marker: Symbol mit Text daneben.
- Bezeichnungen stehen wie die Standbeschriftung horizontal auf der Ebene „Beschriftung“.

**Enge Durchfahrt.**
- Die Durchfahrt ist eine Linie von Hindernis zu Hindernis; ihre Länge ist die lichte Breite.
- Warnung „Durchfahrt zu eng“ (rot): Die lichte Breite liegt unter der projektweiten Mindestbreite.
  - Die Mindestbreite ist standardmäßig 3,5 m und einstellbar von 0,5 bis 50 m.
  - Verglichen wird auf 0,01 m gerundet.
- Die Warnung hängt am Objekt. Sie ist projektweit abschaltbar und pro Objekt ignorierbar („Breite ignorieren“). Sie
  zählt am Page-Tab und in den Kennzahlen mit (§3, §7).

**Freihalten.**
- Dringt ein Stand mehr als 0,01 m in ein Objekt eines Typs mit „freihalten“ ein, bekommt er die rote Warnung
  „Infrastruktur“ (§3).
- Geprüft wird je nach Geometrie:
  - Rechtecke und Linien mit Stärke: als Rechteck (wie die Überlappung zweier Stände).
  - Linien ohne Stärke: Die Linie reicht mehr als 0,01 m in den Stand hinein (über eine Kante oder parallel zu
    ihr). Eine Linie, die nur eine Standkante berührt oder auf ihr liegt, warnt nicht.
- Infrastruktur-Objekte untereinander und Infrastruktur außerhalb von Grundflächen erzeugen keine Warnungen.

**Nummerierung.** Infrastruktur-Objekte bekommen keine Platznummer und zählen in der Nummerierung nicht mit.

## Bedienung / UI

### Gestaltung
- App-Icon (M10, #6, Wahl Laurin 2026-10-23: Entwurf C): ein Marktstand von vorn, links als Planzeichnung (Raster,
  Maßlinien, Umrisse in Akzentblau), rechts fertig (rot-weiße Markise, Theke), dazwischen ein Verlauf; orange
  Grundlinie wie die Vorderseite einer Grundfläche. Quelle `src-tauri/icons/icon.svg`, auch Favicon im Browser-Modus.
- Orientiert sich an Adobe Illustrator: dunkles, neutrales Grau als Standard (helles Theme
  optional), kompakte Panels, kleine Schrift, viel Platz für die Zeichenfläche.
  Kein Adobe-Branding und keine Adobe-Icons.
- Icons: Google Material Symbols (https://fonts.google.com/icons), lokal eingebunden
  (z. B. per npm-Paket als SVG), NICHT von Googles Servern geladen: die App muss offline laufen,
  und das Nachladen von Google-Servern überträgt die IP-Adresse (DSGVO).

### Layout
- **Oben: Tab-Leiste mit den Pages.** Start-Page ganz links, danach die Festplatz-Pages.
  Durchschalten per Klick oder Shortcut. „+“-Tab legt eine neue Festplatz-Page an,
  Doppelklick benennt um, Rechtsklick öffnet ein Kontextmenü (Duplizieren, Löschen).
- **Darunter: Steuerungsleiste** (wie in Illustrator), kontextabhängig: zeigt X, Y, Breite,
  Tiefe, Drehung des ausgewählten Objekts zum direkten Bearbeiten.
- **Links: vertikale Werkzeugleiste nur aus Icons, ohne Text.** Beim Hovern erscheint ein
  Tooltip mit Name, kurzer Funktionsbeschreibung und Shortcut, z. B.
  „Geschäft erstellen (G) – Neuen Stand auf der Zeichenfläche aufziehen“.
  Aktive Werkzeuge und eingeschaltete Umschalter (z. B. Fang) sind farblich hervorgehoben.
  Enthält mindestens:
  Auswahl, Hand (Verschieben der Ansicht), Zoom, Grundfläche erstellen, Geschäft erstellen,
  Infrastruktur-Objekte (als aufklappbare Werkzeuggruppe: der Knopf zeigt den zuletzt genutzten Typ, Klick auf das
  Dreieck, Rechtsklick oder langes Drücken öffnet die Liste aller Typen), Messwerkzeug, Kalibrierung,
  Schriftfeld, sowie Umschalter für Fang (Vorderkante, Raster, Nachbarstände; einzeln
  schaltbar), Raster ein/aus.
- **Mitte: Zeichenfläche** mit Zoom (Mausrad, Strg/Cmd + / −, „an Fenster anpassen“) und Pan
  („An Fenster anpassen“, Strg/Cmd+0, Nacharbeit M8 2026-10-14: Objekte, Hintergrund und, solange die Ebene „Blatt“
  sichtbar ist, das ganze Blatt samt Marke und Papier-Elementen; eine leere Page zeigt die Standardansicht)
  (Leertaste + Ziehen, Hand-Werkzeug). Trackpad: Pinch zoomt, Zwei-Finger-Wischen verschiebt, in
  der Richtung des Systems; im Menü umkehrbar („Wischrichtung umkehren“, pro Rechner). Rechtsklick auf eine
  Freifläche öffnet das Kontextmenü „Freifläche nicht mehr anzeigen“ (M11, §4).
- **Rechts: Seitenleiste** mit Eigenschaften des ausgewählten Objekts und Ebenen-Panel.
  Einklappbar per Button und per Shortcut (Tab blendet wie in Illustrator alle Panels aus).

### Messwerkzeug
- Zwei Punkte klicken, Abstand in m wird angezeigt. Fängt an Ecken und Kanten von Objekten.
- Die Messung bleibt bis zum nächsten Werkzeugwechsel sichtbar.

### Tastaturkürzel
- Jedes Werkzeug, jede Page und jeder wichtige Button hat einen Shortcut.
- Beim Hovern erscheint ein Tooltip mit Name und Shortcut (bei Werkzeugen zusätzlich die
  Funktionsbeschreibung, siehe Werkzeugleiste).
- Wo sinnvoll Illustrator-Konventionen übernehmen (V Auswahl, H Hand, Z Zoom, Leertaste
  temporär Hand, Strg/Cmd+Z Rückgängig, Strg/Cmd+Shift+Z Wiederholen, Strg/Cmd+0 an Fenster
  anpassen). Auf macOS Cmd statt Strg.
- Alle Shortcuts zentral in einer Konfiguration definiert; eine Übersicht ist per `?` abrufbar. Sie
  nennt auch die Tasten beim Ziehen (Shift, Alt, Cmd/Strg).
- AltGr (Entscheidung 2026-10-12, QA-M5-03): Unter Windows ist AltGr = Strg+Alt. Deshalb keine Kurzbefehle mit
  Strg+Alt (macOS Cmd+Alt) auf Tasten, die auf deutschen Tastaturen per AltGr ein Zeichen erzeugen (u. a. Q @, E €,
  M µ, 2 ², 3 ³, 7 {, 8 [, 9 ], 0 }, ß \, + ~, < |).
- Infrastruktur und Papier-Elemente (M7): I = Infrastruktur mit dem zuletzt genutzten Typ, Shift+I = nächster Typ
  der Gruppe (zyklisch, wie in Illustrator), T = Schriftfeld, Shift+L = Legende ein/aus. Der zuletzt genutzte Typ ist
  eine Ansichtseinstellung (kein Undo-Schritt, nur für die Sitzung).
- PDF-Export (M8): Cmd/Strg+P öffnet den Export-Dialog (wie „Drucken“ in Illustrator), auf allen Pages.
- Start-Page (M6): Tab und Shift+Tab springen dort zwischen Bedienelementen (Panels ausblenden gibt es nur auf
  Festplatz-Pages). Tasten der Geschäftstabelle siehe §7.
- Textfelder (korrigiert 2026-10-12, Laurin): Solange ein Textfeld den Fokus hat, greifen nur Speichern, Speichern
  unter, Öffnen und Neu (jeweils Cmd/Strg ohne Alt). Vorher übernimmt das Feld seinen Wert, damit die letzte Eingabe
  gespeichert wird. Alle anderen Kurzbefehle, insbesondere alle mit Alt, sind in Textfeldern gesperrt.

### Allgemein
- **Startbildschirm** (#11, Entscheidung Laurin 2026-10-23): Startet die Desktop-App ohne Projekt (keine Datei per
  Doppelklick, keine wiederhergestellte Sicherung; die Abfrage der Sicherung kommt zuerst), erscheint ein
  Startbildschirm mit „Neues Projekt“ (mit Wahl der Kategorieliste, §3), „Öffnen …“ und „Zuletzt geöffnet“ (Name, Ordner, Datum; fehlende Dateien
  ausgegraut mit „Datei nicht gefunden“). Pfeiltasten wählen, Enter öffnet, Esc bzw. „Neues Projekt“ schließt ihn
  (das leere Projekt bleibt). Auf dem Startbildschirm greifen von den Kurzbefehlen nur Neu und Öffnen. Im
  Browser-Modus erscheint er nicht.
- **Zuletzt geöffnet** im Menü links oben: Untermenü unter „Öffnen …“ mit Name und Ordner je Projekt, am Ende
  „Liste leeren“; ohne Einträge deaktiviert.
- Ebenen (Hintergrund, Grundflächen, Freiflächen, Geschäfte, Infrastruktur, Beschriftung, Blatt; Blatt seit M7)
  ein-/ausblendbar und sperrbar. Ein-/Ausblenden und Sperren sind Ansichtseinstellungen (kein
  Undo-Schritt). Gesperrte Ebenen sind sichtbar, aber nicht auswählbar; ausgeblendete fangen nicht.
  Die Sperre der Ebene „Hintergrund“ ist dieselbe wie die Hintergrund-Sperre aus §1 und bleibt wie
  dort rückgängig machbar (sie gehört mit zur Kalibrierung).
- Mehrfachauswahl (Shift+Klick, Auswahlrechteck), Kopieren/Einfügen, Duplizieren,
  Verschieben per Pfeiltasten (0,1 m, mit Shift 1 m), Entf zum Löschen.
  - Auswahlrechteck wählt nur Objekte, die vollständig darin liegen; Shift ergänzt.
  - Steuerungsleiste und Seitenleiste bei Mehrfachauswahl: X und Y zeigen die Mitte der Auswahl; eine
    Eingabe verschiebt die Auswahl als Ganzes (wie in Illustrator). Breite, Tiefe, Drehung und Attribute:
    unterschiedliche Werte erscheinen als leeres Feld, eine Eingabe gilt für jedes ausgewählte Objekt;
    die Drehung erfolgt dabei jeweils um den eigenen Mittelpunkt. Der Drehgriff dreht eine
    Mehrfachauswahl um die gemeinsame Mitte (Entscheidung 2026-10-11, QA-M3-07).
  - Griffe (Drehgriff, Größengriffe, Kanten) haben eine Toleranz von 3 px: Bewegungen darunter zählen
    als Klick, ohne Änderung und ohne Undo-Schritt.
  - Kopieren/Einfügen über eine interne Zwischenablage, auch zwischen Pages. Einfügen auf derselben Page
    setzt die Kopie um 1 m nach rechts unten versetzt, jedes weitere Einfügen 1 m weiter; auf einer
    anderen Page landet sie an derselben Position (liegt diese außerhalb des sichtbaren Bereichs, mittig
    in der Ansicht). Kopien erhalten eine leere, nicht fixierte Platznummer. Duplizieren (Cmd/Strg+D)
    setzt die Kopie um 1 m nach rechts unten versetzt.
  - Beim Verschieben beschränkt Shift die Richtung auf waagerecht/senkrecht/45°; ein an der Vorderseite
    eingerasteter Stand bleibt mit Shift an ihr. Alt+Ziehen dupliziert die Auswahl (entscheidend ist Alt
    beim Loslassen; Kopien mit leerer Platznummer, ein Undo-Schritt). Cmd/Strg beim Ziehen schaltet den
    Fang aus (Illustrator-Konventionen; Entscheidungen 2026-10-10 und 2026-10-11).
  - Während eines Ziehens werden Kurzbefehle nicht ausgeführt (außer Esc zum Abbrechen).
  - Ein Ziehen, Drehen oder Aufziehen ist genau ein Undo-Schritt; ebenso eine Feldänderung in der
    Seiten- oder Steuerungsleiste. Jeder einzelne Pfeiltasten-Druck ist ein eigener Undo-Schritt; nur
    eine gedrückt gehaltene Taste (Tastenwiederholung) ergibt zusammen einen Schritt (QA-M3-05).
  - Esc bricht eine laufende Interaktion (Ziehen, Aufziehen, Messen, Kalibrieren) immer zuerst ab, erst
    danach greifen globale Kurzbefehle wie „Auswahl aufheben“ (QA-M3-01).
- Oberfläche auf Deutsch, auch alle Fehlermeldungen.
- Zahleneingaben: Komma als Dezimaltrennzeichen, Punkt wird ebenfalls als Dezimaltrennzeichen
  akzeptiert. Eingabefelder zeigen keine Tausendertrennzeichen (nur reine Anzeigen).

## Nicht-funktionale Anforderungen
- Läuft auf Windows und macOS, komplett offline, kein Server, kein Account.
- Personenbezogene Händlerdaten bleiben lokal (DSGVO).
- Flüssig mit mind. 500 Ständen über alle Festplätze. Abnahmekriterium (präzisiert 2026-10-11, QA-M4-03):
  500 Stände auf einer Page, viele Freiflächen und ein Hintergrundplan mit 8000 × 6000 px; Median aus
  5 Messläufen mindestens 50 Bilder/s beim Zoomen, beim Verschieben der Ansicht und beim Ziehen eines
  Stands (quer über mehrere Grundflächen, mit Freiflächen, Warnungen und Fang), in Chromium und WebKit;
  kein einzelnes Bild über 100 ms. Geprüft mit `npm run test:perf`. Zum Messen in der Desktop-App gibt es
  eine einblendbare Bildraten-Anzeige (Cmd/Strg+Alt+F, standardmäßig aus, nicht im PDF-Export).
- TypeScript strict, Unit-Tests für die Geometrie- und Nummerierungslogik.

## Tech-Stack (Vorschlag)
Tauri 2 + React + TypeScript + Vite, Zeichenfläche mit react-konva (oder SVG, begründen),
State mit Zustand inkl. Undo/Redo, PDF-Import via pdf.js, PDF-Export als Vektor (z. B. jsPDF +
svg2pdf.js), Icons aus Material Symbols lokal gebündelt. Builds für Windows und macOS über
GitHub Actions.

Entschieden (2026-10-10): Zeichenfläche als SVG (Prototyp ist SVG; derselbe SVG-Baum dient dem
Vektor-PDF-Export), Undo/Redo über Immer-Patches, ZIP über fflate, PDF-Hintergründe im Export
als Vektor über pdf-lib.

Präzisiert (2026-10-12, M8-Planung): Statt des SVG-Baums dient eine gemeinsame Szenenbeschreibung in `src/core/scene/`
beiden Ausgaben (§9). Das PDF schreibt pdf-lib direkt (ohne jsPDF/svg2pdf.js), Schriften über `@pdf-lib/fontkit`; der
Export läuft in einem Web Worker.

## Meilensteine
1. Grundgerüst: Projekt, Pages-Tab-Leiste, Start-Page (leer), UI-Layout mit Icon-Werkzeugleiste,
   einklappbarer Seitenleiste und Theme, Zeichenfläche mit Zoom/Pan, Speichern/Laden,
   Shortcut-System mit Tooltips.
2. Hintergrundplan-Import (PDF, SVG, JPEG, PNG) + Kalibrierung + Raster + Messwerkzeug.
3. Grundflächen + Geschäfte + Seitenleiste + Steuerungsleiste + Beschriftung
   (horizontal, feste Schriftgröße).
4. Freiflächen-Logik inkl. Tests (aus dem Prototyp übernommen), Fang-Optionen,
   Warnungen (außerhalb, Überlappung).
5. Nummerierung, Stromlimit.
6. Start-Page: Statistik, Listen mit Sprung-Links, Tabellenbearbeitung, Projekteinstellungen, CSV-Export.
7. Infrastruktur-Objekte, Schriftfeld, Legende.
8. PDF-Export inkl. Export-Profile.
9. Phase 2: Händler-Import, Jahresvorlage, XLSX-Export.