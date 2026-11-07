"""Setzt Beispiel-Ansagen genau so zusammen wie die Pokerclock (gleiche Bausteine, gleiche Pausen) – zum Anhören."""
import json, re, subprocess, sys, numpy as np
SR = 44100
data = json.loads(re.search(r"window\.PC_VOICE = (.*);\s*$", open("voice-data.js").read(), re.S).group(1))
spr = {}
for k in data["sprites"]:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", k + "_sprite.mp3", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    spr[k] = np.frombuffer(raw, dtype=np.float32)
L, S = 180, 420  # wie GAP in voice.js
def clip(key):
    p, a, d = data["map"][key]
    return spr[p][int(a * SR): int((a + d) * SR)]
def seq(items):
    out = []
    for it in items:
        out.append(np.zeros(int(it / 1000 * SR), np.float32) if isinstance(it, int) else clip(it))
    return np.concatenate(out)
def blinds(sb, bb, ante=0):
    s = ["sb", L, "n%d" % sb, S, "bb", L, "n%d" % bb]
    return s + ([S, "ante", L, "n%d" % ante] if ante else [])
DEMO = [
    ["start", S] + blinds(100, 300),
    ["blindsUpIn", L, "d_m1"],
    ["blindsUp", S] + blinds(500, 1000, 1000),
    ["break", L, "d_m10"],
    ["breakEndsIn", L, "d_m1"],
    ["breakOver", S, "blindsUp", S] + blinds(1500, 3000, 3000),
    ["d_s10"],
    ["playerOut", S, "playersRemaining", L, "n12"],
    ["finalTable"],
    ["blindsUp", S] + blinds(25000, 50000, 50000),
]
parts = []
for d in DEMO:
    parts += [seq(d), np.zeros(int(1.3 * SR), np.float32)]
y = np.concatenate(parts)
y.tofile("demo.f32")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "demo.f32", "-b:a", "128k", sys.argv[1] if len(sys.argv) > 1 else "Hoerprobe.mp3"], check=True)
print("Dauer", round(len(y) / SR, 1), "s")
