// Prüft die ElevenLabs-Wiedergabe: welche Bausteine bei welchen Ansagen gespielt werden
const { chromium, devices } = require("playwright");
const BASE = "http://localhost:8770/?peerhost=127.0.0.1&peerport=9000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", m); };
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => {
    window.__played = []; window.__spoken = [];
    const st = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, off, dur) {
      const m = window.PC_VOICE && Object.entries(window.PC_VOICE.map).find(([k, v]) => Math.abs(v[1] - off) < 1e-3);
      window.__played.push(m ? m[0] : "?" + off);
      return st.call(this, when, off, dur);
    };
    const ss = { speak(u) { window.__spoken.push(u.text); }, cancel() {}, getVoices() { return [{ name: "Samantha", lang: "en-US", localService: true }]; }, addEventListener() {} };
    Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  const H = await ctx.newPage(); const errs = []; H.on("pageerror", (e) => errs.push(e.message));
  await H.goto(BASE + "#host"); await H.waitForSelector("#time"); await sleep(2000);
  await H.click("#qr").catch(() => {}); await H.click("#main"); await sleep(1500);
  ok(await H.evaluate(() => PCVoice.ready()), "Bausteine dekodiert: " + JSON.stringify(await H.evaluate(() => PCVoice.info())));
  const run = async (fn, wait) => { await H.evaluate(() => { window.__played = []; window.__spoken = []; }); await H.evaluate(fn); await sleep(wait || 2500); return H.evaluate(() => ({ p: window.__played, s: window.__spoken })); };
  let r = await run(() => __host.applyLocal({ type: "set", path: "tournament.remaining", value: 9 }).then(() => __host.applyLocal({ type: "toggle" })));
  ok(r.p.join(",") === "start,sb,n100,bb,n300", "Start: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "next" }));
  ok(r.p.join(",") === "blindsUp,sb,n200,bb,n400", "Level 2: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "jump", index: 5 }));
  ok(r.p.join(",") === "blindsUp,sb,n500,bb,n1000,ante,n1000", "Level mit Ante: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "jump", index: 4 }));
  ok(r.p.join(",") === "break,d_m10", "Pause: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "next" }));
  ok(r.p.join(",") === "breakOver,blindsUp,sb,n500,bb,n1000,ante,n1000", "Pausenende + Level: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "set", path: "sound.announce.bust.on", value: true }).then(() => __host.applyLocal({ type: "bust" })));
  ok(r.p.join(",") === "playerOut,playersRemaining,n8", "Bustout: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "set", path: "display.message", value: "FINAL TABLE" }).then(() => __host.applyLocal({ type: "set", path: "display.showMessage", value: true })));
  ok(r.p.join(",") === "finalTable", "Hinweis Final Table: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "setRemaining", seconds: 62 }), 4500);
  ok(r.p.join(",") === "blindsUpIn,d_m1", "Vorwarnung 1 min: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "setRemaining", seconds: 12 }), 4000);
  ok(r.p.join(",") === "d_s10", "Countdown 10 s: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "toggle" }));
  ok(r.p.join(",") === "clockPaused", "Uhr angehalten: " + r.p.join(","));
  // Zahl nicht in der Liste -> englische Gerätestimme
  r = await run(() => __host.applyLocal({ type: "levels", levels: __host.engine.state.levels.map((l, i) => i === __host.engine.state.clock.levelIndex ? Object.assign({}, l, { sb: 700, bb: 1400, ante: 0 }) : l) }).then(() => __host.applyLocal({ type: "restartLevel" })).then(() => __host.applyLocal({ type: "prev" })).then(() => __host.applyLocal({ type: "next" })));
  ok(r.s.some((t) => /Small blind 700\. Big blind 1,400\./.test(t)), "Fehlende Zahl -> Gerätestimme Englisch: " + JSON.stringify(r.s));
  // Schalter aus -> stumm
  r = await run(() => __host.applyLocal({ type: "set", path: "sound.announce.clockResume.on", value: false }).then(() => __host.applyLocal({ type: "toggle" })));
  ok(r.p.length === 0 && r.s.length === 0, "Schalter aus respektiert");
  // Bausteine einzeln abschalten
  await H.evaluate(() => __host.applyLocal({ type: "set", path: "sound.announce.clockResume.on", value: true }));
  r = await run(() => __host.applyLocal({ type: "voiceClip", key: "blindsUp", on: false }).then(() => __host.applyLocal({ type: "jump", index: 6 })));
  ok(r.p.join(",") === "sb,n600,bb,n1200,ante,n1200", "„Blinds up“ aus -> weggelassen: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "voiceClip", key: "n600", on: false }).then(() => __host.applyLocal({ type: "restartLevel" })).then(() => __host.applyLocal({ type: "prev" })).then(() => __host.applyLocal({ type: "next" })));
  ok(r.p.length === 0 && r.s.some((t) => /Small blind 600/.test(t)) && !r.s.some((t) => /Blinds up/.test(t)), "Zahl aus -> Gerätestimme, ohne abgeschalteten Satz: " + JSON.stringify(r.s));
  r = await run(() => __host.applyLocal({ type: "clipPreview", key: "n600" }));
  ok(r.p.join(",") === "n600", "Hörprobe spielt auch abgeschalteten Baustein: " + r.p.join(","));
  r = await run(() => __host.applyLocal({ type: "voiceClipsReset" }).then(() => __host.applyLocal({ type: "next" })));
  ok(r.p[0] === "blindsUp", "Alle wieder an: " + r.p.join(","));
  ok(JSON.stringify(await H.evaluate(() => __host.engine.state.sound.voiceOff)) === "{}", "voiceOff leer");
  // Deutsche Gerätestimme gewählt
  r = await run(() => __host.applyLocal({ type: "set", path: "sound.voiceEngine", value: "browser" }).then(() => __host.applyLocal({ type: "toggle" })));
  ok(r.p.length === 0 && r.s.some((t) => /angehalten/.test(t)), "iPad-Stimme deutsch: " + JSON.stringify(r.s));
  console.log(pass + " bestanden, " + fail + " fehlgeschlagen", errs.length ? errs : "keine JS-Fehler");
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
