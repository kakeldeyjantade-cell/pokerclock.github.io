# Pokerclock – iPad-Version

**Zwei Varianten aus demselben Code:**
- **Ohne claude.ai** (`ohne-claude/index.html`): Direktverbindung iPad ↔ Handy per Code oder QR-Code. Jeder mit der Datei bzw. dem Link kann sie nutzen, z. B. dein Kollege. Wie das geht, steht in `ohne-claude/LIESMICH.md`.
- **Mit claude.ai** (`dist/pokerclock.html`): als Artefakt in deinem Konto, siehe unten.

Stand: 06.11.2026. Die Mac-Version im Ordner darüber bleibt unverändert und funktioniert weiter offline.

## Benutzen
1. Öffne die Pokerclock auf claude.ai, angemeldet mit deinem Konto: https://claude.ai/artifact/C5K5mmVEiomPKPdaz3VCf2
2. Auf dem **iPad** wählst du **„Anzeige + Host“**. Dann einmal auf die Anzeige tippen, damit Ton und Ansagen an sind.
3. Auf dem **Handy** wählst du **„Steuerung“**. Alternativ den QR-Code auf dem iPad scannen, der Link endet auf `#steuerung`.
4. Optional: ein weiteres Gerät als **„Zweite Anzeige“**, ohne Ton (z. B. Mac oder Fernseher).

Jedes Gerät merkt sich seine Rolle. Ändern kannst du sie auf der Anzeige über **⋯ → „Gerät anders nutzen …“** und in der Steuerung unter **Turnier → Zugriff**.

**Tipp fürs iPad:** Einstellungen → Anzeige & Helligkeit → Automatische Sperre → **Nie**. Sonst geht das Display im Turnier aus und die Seite schläft ein. Die Uhr rechnet zwar beim Aufwachen richtig nach, aber die Ansagen fehlen in dieser Zeit.

## So funktioniert es
- Das **iPad rechnet alles**: Uhr, Levelwechsel, Ansagen und Turnierhistorie. Die Logik ist 1:1 aus `server.py` (V2) nach JavaScript portiert (`src/engine.js`).
- Das **Handy schickt Befehle**. Der schnelle Weg ist `room` (live an alle offenen Geräte), der sichere Weg ist die `db`. Das iPad verarbeitet jeden Befehl genau einmal und antwortet im Stand-Dokument. Befehle, die älter als 90 s sind, werden verworfen.
- **Gespeichert wird in der Datenbank des Artefakts:**
  - `pc/state`: Stand, Antworten und Stimmenliste
  - `pc/host`: welches Gerät Host ist
  - `hist/<Turnier>`: Kurzinfo für das Archiv
  - `hist/<Turnier>/chunks/cNNNN`: je 100 Ereignisse
- Zusätzlich legt das iPad eine Sicherung im eigenen Browser ab. **Ohne Internet** läuft die Uhr mit Ansagen weiter, und die Schnellsteuerung (⋯) funktioniert am iPad. Sobald die Verbindung wieder da ist, wird alles nachgespeichert.
- **Nur ein Gerät ist Host.** Ein zweites fragt nach, bevor es übernimmt.
- **Zugriff:** Schreiben dürfen nur der Besitzer und Editoren (db-Regel `write: admin`). Wer den Link nur zum Ansehen bekommt, kann zuschauen, aber nicht steuern. Deshalb gibt es keine PIN mehr.

## Stimme „Liberty X“ (ElevenLabs, englisch)
- Die Ansagen sind kurz und ohne Füllwörter, z. B. „Blinds up. … Small blind: five hundred. … Big blind: one thousand.“ Sie werden aus 119 Bausteinen zusammengesetzt, die als Audio in der Datei stecken. Im Turnier braucht die Stimme deshalb weder Internet noch Credits.
- Auf dem Handy wählst du unter Anzeige → Sprachansagen → **Sprecherin** zwischen „Liberty X (englisch)“ und „iPad-Stimme (deutsch)“.
- Im Bereich **„Liberty X – einzelne Bausteine“** kann jeder Baustein per Schalter aus- und wieder eingeschaltet werden. Mit ▶ hörst du ihn auf dem iPad an.
  - Abgeschaltete Sätze lässt die Ansage weg.
  - Fehlt eine Zahl oder Zeitangabe, spricht die englische iPad-Stimme diese eine Ansage komplett.
- Die Schalter unter „Welche Ansagen?“ gelten für beide Stimmen.
- Die Aufnahmen und Werkzeuge liegen in `stimme/`:
  - `A.mp3` und `B.mp3` sind die Original-Aufnahmen.
  - `items.json` legt die Reihenfolge fest.
  - `cut.py` schneidet die Aufnahmen und gleicht die Lautstärke an.
  - `render.py` erzeugt eine Hörprobe.
  - `voice-data.js` wird von `build.py` eingebaut.

## Unterschiede zur Mac-Version
- Die Stimmen kommen vom iPad, nicht vom Mac. Bessere Stimmen lädst du unter Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen.
- Keine PIN (siehe Zugriff).
- Neu: Schnellsteuerung am iPad, zweite Anzeige, Rolle per Link (`#host`, `#steuerung`, `#anzeige`).
- Die Turnierhistorie vom Mac wird nicht übernommen. Beide Versionen haben eigene Daten.

## Neu bauen und testen (Mac, Terminal)
```
cd iPad-Version
python3 build.py                # erzeugt dist/pokerclock.html (Artefakt) und dist/test.html (mit Mock)
node test/mockserver.js 8765    # Mock für claude.ai, Testseite unter http://localhost:8765/
node test/e2e.js                # 53 Abnahmetests claude.ai-Variante (braucht Playwright)
node test/p2pserver.js & node test/p2p_e2e.js   # 18 Tests der Variante ohne claude.ai (braucht npm-Pakete peer + express)
TZ=Europe/Berlin python3 test/parity_py.py test/scenario1.json /tmp/py1.json ../server.py && node test/parity_js.js test/scenario1.json /tmp/py1.json
```
Der Paritätstest vergleicht `engine.js` Schritt für Schritt mit dem Original-`server.py`. Verglichen werden 78 Schritte mit simulierter Uhr sowie ein zweites Szenario mit Neustarts. Ergebnis: keine Abweichung. Einzige Ausnahme ist die Schreibweise „0“ statt „0.0“ in Korrektur-Texten.

## Grenzen
- Funktioniert nur innerhalb von claude.ai (angemeldet). Als einzelne Datei geöffnet, läuft die Seite nur als Host ohne Handy.
- Ob Vollbild und „Display wach halten“ im claude.ai-Rahmen auf dem iPad gehen, entscheidet die App bzw. Safari. Deshalb im Zweifel die automatische Sperre ausschalten.
- Mit echtem iPad, echtem iPhone und echten iOS-Stimmen konnte ich nicht testen. Getestet ist alles im Browser mit Mock-Verbindung.
