# Pokerclock ohne claude.ai

Eine einzige Datei: `index.html`. Das **iPad ist der Host**: Es zeigt die Uhr, macht Töne und Ansagen und speichert Turniere und Historie. **Handys steuern** über eine Direktverbindung. Ein Konto oder Login braucht man dafür nicht.

## Einmalig: Datei online stellen (kostenlos, ca. 5 Minuten)
Die Seite braucht eine Adresse, die iPad und Handy öffnen können. Am einfachsten geht das mit **GitHub Pages**:
1. Auf github.com ein kostenloses Konto anlegen und anmelden.
2. Oben rechts auf **+ → New repository** gehen. Als Name `pokerclock` eintragen, **Public** wählen und auf **Create repository** klicken.
3. Auf **„uploading an existing file“** klicken, `index.html` hineinziehen und **Commit changes** wählen.
4. Unter **Settings → Pages → Branch: main / (root) → Save** speichern.
5. Nach etwa 1 Minute läuft die Seite unter `https://DEINNAME.github.io/pokerclock/`.

Diese Adresse kann jeder öffnen, auch dein Kollege. Steuern kann aber nur, wer den **Code des iPads** hat. Turnierdaten liegen nie im Internet, sondern nur auf dem iPad.

Andere Hoster funktionieren genauso, z. B. Netlify oder ein eigener Webspace. Wichtig ist nur, dass die Adresse mit `https://` beginnt.

## Im Turnier
1. **iPad:** Adresse öffnen und **„Anzeige + Host“** wählen. Oben rechts steht dann z. B. „Code AB12CD“. Einmal auf die Anzeige tippen, damit der Ton an ist.
2. **Handy:** den QR-Code auf dem iPad scannen. Oder die Adresse öffnen, **„Steuerung“** wählen und den Code eintippen.
3. **Optional:** ein weiteres Gerät als **„Zweite Anzeige“** (ohne Ton).
4. Am iPad die **automatische Sperre auf „Nie“** stellen: Einstellungen → Anzeige & Helligkeit.

Tipp: In Safari über **Teilen → Zum Home-Bildschirm** ablegen. Dann öffnet sich die Pokerclock wie eine App, ohne Adressleiste.

## Internet
- **Zum Verbinden** brauchen iPad und Handy kurz Internet (WLAN oder Hotspot).
- **Danach** reicht dasselbe WLAN. Fällt das Internet aus, läuft die Uhr mit Ansagen weiter, und bereits verbundene Handys bleiben meist verbunden.
- **Notfall:** Über ⋯ unten rechts auf dem iPad gibt es eine **Schnellsteuerung**: Start/Pause, Level, Zeit, Spieler raus/neu.

## Sicherheit
- Wer den Code hat, kann steuern. Gib ihn nur an Leute, die mitsteuern sollen.
- Unter ⋯ → **„Neuen Code erzeugen“** trennst du alle verbundenen Geräte. Danach müssen sie sich mit dem neuen Code neu verbinden.

## Technik (für Neugierige)
- Die Direktverbindung läuft über WebRTC mit PeerJS (MIT-Lizenz, in der Datei enthalten). Zum Finden der Geräte nutzt sie den kostenlosen PeerJS-Vermittlungsserver. Die Turnierdaten selbst gehen direkt von Gerät zu Gerät.
- Das iPad speichert alles im Browser (IndexedDB). Wer die Browserdaten von Safari löscht, löscht damit auch Stand und Historie.
- Der Quellcode liegt im Ordner `iPad-Version/src`. Neu bauen mit `python3 build.py`.
