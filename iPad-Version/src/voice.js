/* Pokerclock – englische Ansagen mit ElevenLabs-Bausteinen (Stimme „Liberty X“).
   Die Aufnahmen stecken als MP3 in der Datei (window.PC_VOICE), abgespielt wird per Web Audio,
   Baustein für Baustein mit kurzen Sprechpausen. Fehlt ein Baustein, spricht die Gerätestimme auf Englisch. */
(function () {
  "use strict";
  var V = {}, data = window.PC_VOICE || null;
  var actx = null, out = null, buffers = {}, decoding = null, active = {}; // group -> [sources]
  var GAP = { label: 180, sentence: 420 }; // Pausen in ms: nach „Small blind:“ bzw. zwischen Sätzen

  V.available = function () { return !!(data && data.map && data.sprites); };
  V.ready = function () { return V.available() && Object.keys(buffers).length === Object.keys(data.sprites).length; };
  var off = {}; // in der Steuerung abgeschaltete Bausteine
  V.setOff = function (o) { off = o && typeof o === "object" ? o : {}; };
  V.isOff = function (key) { return !!off[key]; };
  V.has = function (key) { return !!(data && data.map[key]) && !off[key]; };
  // Liste aller Bausteine mit Text (für die Schalter in der Steuerung)
  V.list = function () {
    if (!data) return [];
    var t = data.text || {};
    return Object.keys(data.map).map(function (k) { return { key: k, text: t[k] || TXT[k] || k, part: data.map[k][0] }; });
  };

  function b64ToBuf(b64) {
    var bin = atob(b64), len = bin.length, u = new Uint8Array(len);
    for (var i = 0; i < len; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  // nach dem ersten Antippen (AudioContext aus der Anzeige) einmal dekodieren
  V.init = function (ctx) {
    if (!V.available() || !ctx) return Promise.resolve(false);
    if (decoding && actx === ctx) return decoding;
    actx = ctx; out = actx.createGain(); out.connect(actx.destination);
    decoding = Promise.all(Object.keys(data.sprites).map(function (k) {
      return new Promise(function (res) {
        try {
          actx.decodeAudioData(b64ToBuf(data.sprites[k]), function (b) { buffers[k] = b; res(); }, function () { res(); });
        } catch (e) { res(); }
      });
    })).then(function () { return V.ready(); });
    return decoding;
  };

  /* ---------- Zahlen und Dauern ---------- */
  function numKey(n) { n = Number(n); return n % 1 === 0 && V.has("n" + n) ? "n" + n : null; }
  var DUR = { 5: "d_s5", 10: "d_s10", 15: "d_s15", 20: "d_s20", 30: "d_s30", 60: "d_m1", 120: "d_m2", 180: "d_m3",
    300: "d_m5", 600: "d_m10", 900: "d_m15", 1200: "d_m20", 1800: "d_m30" };
  function durKey(sec) { var k = DUR[Math.round(Number(sec))]; return k && V.has(k) ? k : null; }

  // Text für die Gerätestimme (Rückfall), gleiche Wörter wie die Aufnahmen
  var TXT = { blindsUp: "Blinds up.", sb: "Small blind:", bb: "Big blind:", ante: "Ante:", start: "Shuffle up and deal.",
    blindsUpIn: "Blinds up in", breakIn: "Break in", breakEndsIn: "Break ends in", "break": "Break.",
    breakOver: "Break over. Take your seats.", clockPaused: "Clock paused.", clockRunning: "Clock running.",
    levelRestarted: "Level restarted.", playerOut: "Player out.", playersRemaining: "Players remaining:",
    finalLevel: "Final level complete.", tournamentOver: "Tournament over.", soundCheck: "Sound check.",
    lastHand: "Last hand.", finalTable: "Final table.", chipRace: "Chip race.", rebuysClosed: "Rebuys closed.",
    takeSeats: "Take your seats.", tablesCombined: "Tables are being combined.", headsUp: "Heads up." };
  function durText(sec) {
    sec = Math.round(Number(sec) || 0);
    if (sec < 60 || sec % 60) return sec + " seconds.";
    var m = sec / 60; return m === 1 ? "one minute." : m + " minutes.";
  }

  // Folge aus Bausteinen bauen. Elemente: Schlüssel | {num} | {dur} | Pause in ms
  function blinds(d) {
    var s = [{ k: "sb" }, GAP.label, { num: d.sb }, GAP.sentence, { k: "bb" }, GAP.label, { num: d.bb }];
    if (Number(d.ante) > 0) s.push(GAP.sentence, { k: "ante" }, GAP.label, { num: d.ante });
    return s;
  }
  var MSG = [[/letzte hand|last hand/i, "lastHand"], [/final table|finaltisch/i, "finalTable"], [/platz nehmen|take your seat/i, "takeSeats"],
    [/chip.?race/i, "chipRace"], [/rebuy/i, "rebuysClosed"], [/tische|tables/i, "tablesCombined"], [/heads.?up/i, "headsUp"]];
  V.messageKey = function (text) {
    for (var i = 0; i < MSG.length; i++) if (MSG[i][0].test(String(text || ""))) return MSG[i][1];
    return null;
  };

  // Ansage -> Bausteine. on(key) prüft die Schalter aus der Steuerung (Turnierstart, Neue Blindstufe, …)
  V.plan = function (a, on) {
    var d = a.data || {}, s = null;
    switch (a.type) {
      case "start": if (on("start")) s = [{ k: "start" }, GAP.sentence].concat(blinds(d)); break;
      case "level":
        s = [];
        if (d.fromBreak && on("breakEnd")) s.push({ k: "breakOver" }, GAP.sentence);
        if (on("level")) s.push({ k: "blindsUp" }, GAP.sentence), s = s.concat(blinds(d));
        if (!s.length) s = null;
        break;
      case "break": if (on("breakStart")) { s = [{ k: "break" }]; if (d.minutes) s.push(GAP.label, { dur: Number(d.minutes) * 60 }); } break;
      case "warn": {
        var k = d.inBreak ? "warnBreakEnd" : d.nextIsBreak ? "warnBreak" : "warnLevel";
        if (on(k)) s = [{ k: d.inBreak ? "breakEndsIn" : d.nextIsBreak ? "breakIn" : "blindsUpIn" }, GAP.label, { dur: d.seconds != null ? d.seconds : d.warningSeconds }];
        break;
      }
      case "countdown": if (on("countdown")) s = [{ dur: d.seconds }]; break;
      case "pause": if (on("clockPause")) s = [{ k: "clockPaused" }]; break;
      case "resume": if (on("clockResume")) s = [{ k: "clockRunning" }]; break;
      case "restart": if (on("restart")) s = [{ k: "levelRestarted" }]; break;
      case "bust": if (on("bust")) s = [{ k: "playerOut" }, GAP.sentence, { k: "playersRemaining" }, GAP.label, { num: d.remaining }]; break;
      case "timeout": if (on("timeout")) s = [{ k: "finalLevel" }]; break;
      case "end": if (on("end")) s = [{ k: "tournamentOver" }]; break;
      case "message": { var mk = V.messageKey(d.text); if (mk && on("message")) s = [{ k: mk }]; break; }
      case "test": s = [{ k: "soundCheck" }]; break;
      case "clip": if (data && data.map[d.key]) return { direct: [d.key] }; break;
      case "voicetest": s = [{ k: "blindsUp" }, GAP.sentence].concat(blinds({ sb: 500, bb: 1000, ante: 1000 })); break;
      case "preview": {
        var ev = d.event, map = { start: "start", level: "level", warnLevel: "warn", warnBreak: "warn", warnBreakEnd: "warn",
          countdown: "countdown", breakStart: "break", breakEnd: "level", clockPause: "pause", clockResume: "resume",
          restart: "restart", bust: "bust", timeout: "timeout", end: "end", message: "message" };
        var dd = Object.assign({}, d, { inBreak: ev === "warnBreakEnd", nextIsBreak: ev === "warnBreak", fromBreak: ev === "breakEnd",
          seconds: ev === "countdown" ? d.countdownSeconds : d.warningSeconds, text: "Final table" });
        if (ev === "breakEnd") return [{ k: "breakOver" }];
        return map[ev] ? V.plan({ type: map[ev], data: dd }, function () { return true; }) : null;
      }
    }
    return s;
  };

  // Folge auflösen: Clips + Ersatztext; ok=false, wenn ein Baustein fehlt
  // Abgeschaltete Satz-Bausteine werden weggelassen (samt Pause danach);
  // fehlt eine Zahl oder Zeitangabe, spricht die Gerätestimme die ganze Ansage.
  V.resolve = function (seq) {
    var items = [], text = [], ok = true, skipGap = false;
    (seq || []).forEach(function (x) {
      if (typeof x === "number") { if (!skipGap) items.push(x); skipGap = false; return; }
      skipGap = false;
      if (x.k && off[x.k] && data && data.map[x.k]) { skipGap = true; return; }
      if (x.k) { if (!V.has(x.k)) ok = false; items.push(x.k); text.push(TXT[x.k] || ""); }
      else if (x.num != null) { var nk = numKey(x.num); if (!nk) ok = false; items.push(nk); text.push(Number(x.num).toLocaleString("en-US") + "."); }
      else if (x.dur != null) { var dk = durKey(x.dur); if (!dk) ok = false; items.push(dk); text.push(durText(x.dur)); }
    });
    while (items.length && typeof items[0] === "number") items.shift();
    while (items.length && typeof items[items.length - 1] === "number") items.pop();
    return { ok: ok, items: items, text: text.join(" ").replace(/: (\d)/g, " $1") };
  };

  V.stop = function (group) {
    (active[group] || []).forEach(function (src) { try { src.stop(); } catch (e) {} });
    active[group] = [];
  };
  // abspielen; liefert Dauer in ms
  V.play = function (items, opt) {
    opt = opt || {};
    if (!V.ready() || !actx) return 0;
    var g = opt.group || "x";
    V.stop(g);
    if (actx.state === "suspended") { try { actx.resume(); } catch (e) {} }
    out.gain.value = Math.max(0, Math.min(1, opt.volume == null ? 1 : opt.volume));
    var t = actx.currentTime + (opt.delay || 0) / 1000 + 0.05, t0 = t, list = active[g] = [];
    items.forEach(function (it) {
      if (typeof it === "number") { t += it / 1000; return; }
      var m = data.map[it]; if (!m) return;
      var buf = buffers[m[0]]; if (!buf) return;
      var src = actx.createBufferSource();
      src.buffer = buf; src.connect(out);
      src.start(t, m[1], m[2]);
      list.push(src);
      t += m[2];
    });
    return Math.round((t - t0) * 1000);
  };

  V.info = function () { return data ? { voice: data.voice || "", clips: Object.keys(data.map).length } : null; };
  window.PCVoice = V;
})();
