// Führt dasselbe Szenario mit engine.js aus und vergleicht mit der Python-Spur.
const fs = require("fs");
const { Engine, summarize } = require("../src/engine.js");
const [scFile, pyTraceFile] = process.argv.slice(2);
const sc = JSON.parse(fs.readFileSync(scFile, "utf8"));
const py = JSON.parse(fs.readFileSync(pyTraceFile, "utf8"));

let T = sc.t0, CNT = 0;
const uid = (n) => { CNT++; return CNT.toString(16).padStart(8, "0").repeat(4).slice(0, n); };
const anns = [];
let eng = new Engine({ now: () => T, uid, onAnnounce: (a) => anns.push(a) });
// Clock.__init__ ruft default_state einmal auf (wie der Konstruktor hier); Zähler danach wie in Python zurücksetzen
CNT = 0; eng.state = eng.defaultState(); uid(8); // + boot-ID wie in Clock.__init__
if (sc.boot) eng.bootSync(); else eng.detect(T);
anns.length = 0;

const trace = [];
// Neu gegenüber server.py (nicht im Original): Sprecherin-Wahl, Ansage „Hinweis“
function strip(st) { delete st.sound.voiceEngine; delete st.sound.voiceOff; delete st.sound.announce.message; return st; }
function snap(label, err) {
  const hist = {};
  for (const tid of eng.store.ids().sort()) hist[tid] = JSON.parse(JSON.stringify(eng.store.events(tid)));
  trace.push({ label, t: T, err: err || null, state: strip(JSON.parse(JSON.stringify(eng.state))), ann: anns.splice(0).filter((a) => a.type !== "message").slice(-40),
    hist, totals: eng.totals(), cnt: CNT });
}
sc.steps.forEach((step, i) => {
  if ("advance" in step) {
    const target = T + step.advance, tick = step.tick || 200;
    while (T < target) { T = Math.min(target, T + tick); if (step.ticker !== false) eng.detect(T); }
    snap("advance " + i);
  } else if ("action" in step) {
    let err = null;
    try { eng.apply(step.action); } catch (e) { if (!e.userError) throw e; err = e.message; }
    snap("action " + i + " " + step.action.type, err);
  } else if ("restart" in step) {
    eng.normalize(T); const saved = JSON.parse(JSON.stringify(eng.state)), store = eng.store;
    T += step.restart;
    const c0 = CNT; eng = new Engine({ now: () => T, uid, store, onAnnounce: (a) => anns.push(a) }); CNT = c0;
    eng.load(saved); uid(8); eng.bootSync();
    snap("restart " + i);
  } else if ("summary" in step) {
    const tid = eng.state.history.lastId;
    trace.push({ label: "summary " + i, summary: tid ? summarize(eng.readEvents(tid), eng.state.history.activeId, T) : {}, t: T });
  }
});

// Vergleich (Python-Bool-Eigenheit: False/0 und True/1 gleich behandeln; Float-Toleranz)
function norm(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach((k) => { o[k] = norm(v[k]); }); return o; }
  return v;
}
let diffs = 0;
function cmp(a, b, path) {
  if (diffs > 25) return;
  if (typeof a === "number" && typeof b === "number") { if (Math.abs(a - b) > 1e-6) { diffs++; console.log("DIFF", path, a, b); } return; }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    const fl = (x) => typeof x === "string" ? x.replace(/(\d)\.0\b/g, "$1") : x;
    if (JSON.stringify(fl(a)) !== JSON.stringify(fl(b))) { diffs++; console.log("DIFF", path, JSON.stringify(a), JSON.stringify(b)); }
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) cmp(a[k], b[k], path + "." + k);
}
if (py.length !== trace.length) console.log("Länge verschieden", py.length, trace.length);
// Ansage-Nummern verschieben sich durch die neue Hinweis-Ansage – nur Inhalt vergleichen
for (const tr of [py, trace]) for (const x of tr) if (x.ann) x.ann = x.ann.map((a) => { const c = Object.assign({}, a); delete c.id; return c; });
for (let i = 0; i < Math.min(py.length, trace.length); i++) cmp(norm(py[i]), norm(trace[i]), "[" + i + " " + trace[i].label + "]");
const nAnn = trace.reduce((s, x) => s + (x.ann ? x.ann.length : 0), 0);
const lastHist = trace.filter((x) => x.hist).pop().hist;
const nEv = Object.values(lastHist).reduce((s, x) => s + x.length, 0);
console.log(diffs ? "FEHLER: " + diffs + " Abweichungen" : "OK: Parität", "| Schritte", trace.length, "| Ansagen", nAnn,
  "| Ereignisse", nEv, "| Turniere", Object.keys(lastHist).length);
process.exit(diffs ? 1 : 0);
