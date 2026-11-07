"""Schneidet die ElevenLabs-Aufnahmen (A.mp3 = Sätze, B.mp3 = Zahlen) in Bausteine und baut voice-data.js.

Aufruf: python3 cut.py [ordner]   (im Ordner: A.mp3, B.mp3, items.json)
Ablauf: Pegel in 10-ms-Schritten messen, Sprechpausen suchen und die Mindestpause so wählen,
dass genau so viele Bausteine herauskommen wie in items.json stehen. Danach jeden Baustein
mit etwas Luft in eine neue, kompakte MP3 (mono, 64 kbit/s) legen und die Positionen merken.
"""
import base64, json, os, subprocess, sys
import numpy as np

D = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SR = 44100
items = json.load(open(os.path.join(D, "items.json")))


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def segments(x, gap_s, thr_db):
    hop = SR // 100
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    loud = db > thr_db
    segs, start, quiet = [], None, 0
    for i, v in enumerate(loud):
        if v:
            if start is None:
                start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= gap_s * 100:
                segs.append((start, i - quiet + 1))
                start, quiet = None, 0
    if start is not None:
        segs.append((start, n - quiet))
    # sehr kurze Knackser verwerfen
    segs = [(a, b) for a, b in segs if b - a >= 8]
    return [(a * hop, b * hop) for a, b in segs]


def fit(x, want):
    """Alle Kombinationen aus Schwelle und Mindestpause testen, die genau passen; die Mitte des passenden
    Bereichs nehmen (robuster als der erste Treffer)."""
    peak = 20 * np.log10(np.max(np.abs(x)) + 1e-9)
    hits, best = {}, None
    for thr in (peak - 30, peak - 34, peak - 38, peak - 42, peak - 46):
        for gap in np.arange(0.18, 1.6, 0.02):
            s = segments(x, gap, thr)
            if len(s) == want:
                hits.setdefault(thr, []).append((gap, s))
            if best is None or abs(len(s) - want) < abs(len(best[0]) - want):
                best = (s, gap, thr)
    if not hits:
        return best
    thr = max(hits, key=lambda k: len(hits[k]))
    gap, s = hits[thr][len(hits[thr]) // 2]
    return s, gap, thr


def build(part):
    want = len(items[part])
    x = load(os.path.join(D, part + ".mp3"))
    segs, gap, thr = fit(x, want)
    report = {"part": part, "erwartet": want, "gefunden": len(segs), "mindestpause_s": round(float(gap), 2),
              "schwelle_db": round(float(thr), 1), "dauer_s": round(len(x) / SR, 1)}
    if len(segs) != want:
        return None, report
    # Grenzen fein nachziehen: leise Wortanfänge/-enden (s, t, k, Ausatmen) mit tieferer Schwelle mitnehmen,
    # aber nie über die Mitte der Pause zum Nachbarn hinaus
    hop = SR // 100; n = len(x) // hop
    fdb = 20 * np.log10(np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12))
    low = 20 * np.log10(np.max(np.abs(x)) + 1e-9) - 50
    fine = []
    for i, (a, b) in enumerate(segs):
        fa, fb = a // hop, b // hop
        lo = (segs[i - 1][1] // hop + fa) // 2 if i else 0
        hi = (fb + segs[i + 1][0] // hop) // 2 if i + 1 < len(segs) else n
        while fa > lo and fdb[fa - 1] > low: fa -= 1
        while fb < hi and fdb[min(fb, n - 1)] > low: fb += 1
        fine.append((fa * hop, fb * hop))
    segs = fine
    pre, post, pad = int(0.02 * SR), int(0.04 * SR), np.zeros(int(0.25 * SR), dtype=np.float32)
    # gleiche Lautheit für alle Bausteine (RMS der lauten Teile), höchstens ±4 dB angleichen
    def loud_rms(c):
        hop = SR // 100; n = len(c) // hop
        r = np.sqrt(np.mean(c[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
        r = r[r > np.max(r) * 0.2]
        return float(np.sqrt(np.mean(r ** 2))) if len(r) else 1e-6
    target = float(np.median([loud_rms(x[a:b]) for a, b in segs]))
    out, mp, pos = [pad], {}, len(pad)
    for (key, text), (a, b) in zip(items[part], segs):
        a, b = max(0, a - pre), min(len(x), b + post)
        clip = x[a:b].copy()
        gain = min(10 ** (4 / 20), max(10 ** (-4 / 20), target / loud_rms(clip)))
        clip *= gain
        fade = min(len(clip) // 4, int(0.012 * SR))
        if fade:
            clip[:fade] *= np.linspace(0, 1, fade); clip[-fade:] *= np.linspace(1, 0, fade)
        mp[key] = [part, round(pos / SR, 4), round(len(clip) / SR, 4)]
        out += [clip, pad]
        pos += len(clip) + len(pad)
    y = np.concatenate(out)
    wav = os.path.join(D, part + "_sprite.f32")
    y.astype(np.float32).tofile(wav)
    mp3 = os.path.join(D, part + "_sprite.mp3")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", wav,
                    "-c:a", "libmp3lame", "-b:a", "64k", mp3], check=True)
    os.remove(wav)
    report["laengen_s"] = {k: v[2] for k, v in mp.items()}
    # Plausibilität: Dauer je Zeichen sollte ähnlich sein; Ausreißer deuten auf verrutschte Zuordnung
    rate = [(k, v[2] / max(3, len(t))) for (k, t), v in zip(items[part], mp.values())]
    med = float(np.median([r for _, r in rate]))
    report["auffaellig"] = [k for k, r in rate if r > med * 2.2 or r < med / 2.2]
    return (mp, mp3), report


if __name__ == "__main__":
    maps, sprites, reports = {}, {}, []
    for part in ("A", "B"):
        res, rep = build(part)
        reports.append(rep)
        print(json.dumps({k: v for k, v in rep.items() if k != "laengen_s"}, ensure_ascii=False))
        if rep.get("auffaellig"):
            print("Hinweis: auffällige Längen bei", rep["auffaellig"], "– bitte anhören")
        if res is None:
            print("FEHLER: Anzahl der Bausteine passt nicht – Aufnahme prüfen")
            sys.exit(1)
        maps.update(res[0])
        sprites[part] = base64.b64encode(open(res[1], "rb").read()).decode()
    texts = {k: t.rstrip(".:").strip() for part in ("A", "B") for k, t in items[part]}
    data = {"voice": "Liberty X (ElevenLabs)", "sprites": sprites, "map": maps, "text": texts}
    open(os.path.join(D, "voice-data.js"), "w").write("window.PC_VOICE = " + json.dumps(data, separators=(",", ":")) + ";\n")
    json.dump(reports, open(os.path.join(D, "cut-report.json"), "w"), ensure_ascii=False, indent=1)
    print("voice-data.js:", os.path.getsize(os.path.join(D, "voice-data.js")) // 1024, "KB")
