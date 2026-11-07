/* Pokerclock – gemeinsame Logik für Anzeige und Steuerung */
(function () {
  "use strict";
  var PC = {};
  var NF = new Intl.NumberFormat("de-DE");

  PC.fmtNum = function (n, mode) {
    n = Number(n) || 0;
    if (mode === "short") {
      var a = Math.abs(n);
      if (a >= 1e6) return trim(n / 1e6) + "M";
      if (a >= 1e3) return trim(n / 1e3) + "K";
      return String(n);
    }
    return NF.format(Math.round(n));
  };
  function trim(x) {
    return (Math.round(x * 100) / 100).toString().replace(".", ",");
  }

  PC.fmtMoney = function (n, cur) {
    var s = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0);
    return s + " " + (cur || "€");
  };

  // ms -> "mm:ss" bzw. "h:mm:ss"
  PC.fmtTime = function (ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + ":" + pad(m) + ":" + pad(sec);
    return pad(m) + ":" + pad(sec);
  };
  PC.fmtElapsed = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h + ":" + pad(m) + " h";
  };
  PC.fmtClockTime = function (date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  };
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  PC.pad = pad;

  PC.durMs = function (lv) { return Math.round(Number(lv.minutes) * 60000); };

  PC.levelNumber = function (levels, i) {
    var n = 0;
    for (var k = 0; k <= i && k < levels.length; k++) if (levels[k].type !== "break") n++;
    return n;
  };

  /* Berechnet den aktuellen Uhrzustand aus dem gespeicherten Zustand + Zeit.
     (Gleiche Logik wie normalize() im Server, aber ohne etwas zu verändern.) */
  PC.computeView = function (st, now) {
    var levels = st.levels, c = st.clock;
    var i = c.levelIndex, rem = c.remainingMs, play = c.playMs || 0;
    var running = c.running;
    if (running) {
      var elapsed = Math.max(0, now - c.anchor);
      play += elapsed;
      while (elapsed >= rem && i < levels.length - 1) {
        elapsed -= rem; i++; rem = PC.durMs(levels[i]);
      }
      rem -= elapsed;
      if (rem <= 0) { rem = 0; running = false; }
    }
    var lv = levels[i];
    var isBreak = lv.type === "break";
    var next = i < levels.length - 1 ? levels[i + 1] : null;
    // Zeit bis zur nächsten Pause
    var nextBreakMs = null;
    if (isBreak) nextBreakMs = 0;
    else {
      var acc = rem;
      for (var k = i + 1; k < levels.length; k++) {
        if (levels[k].type === "break") { nextBreakMs = acc; break; }
        acc += PC.durMs(levels[k]);
      }
    }
    return {
      index: i,
      level: lv,
      levelNumber: PC.levelNumber(levels, i),
      isBreak: isBreak,
      remainingMs: rem,
      running: running,
      finished: !running && rem <= 0 && i === levels.length - 1,
      next: next,
      nextNumber: next ? PC.levelNumber(levels, i + 1) : null,
      nextBreakMs: nextBreakMs,
      playMs: play,
      startedOnce: !!c.startedOnce
    };
  };

  PC.totals = function (t) {
    var chips = t.entries * t.startStack + (t.rebuysEnabled ? t.rebuys * t.rebuyChips : 0) +
      (t.addonsEnabled ? t.addons * t.addonChips : 0) + (t.extraChips || 0);
    var pool = t.entries * t.buyIn + (t.rebuysEnabled ? t.rebuys * t.rebuyPrice : 0) +
      (t.addonsEnabled ? t.addons * t.addonPrice : 0);
    var avg = t.remaining > 0 ? Math.round(chips / t.remaining) : null;
    return { chips: Math.max(0, chips), pool: pool, avg: avg };
  };

  /* ---------- Verbindung zum Server (Server-Sent Events) ---------- */
  /* ---------- Stimmen (Sprachausgabe im Browser des Macs) ---------- */
  // Browser liefern kein Geschlecht der Stimme. Deshalb eine Namensliste bekannter Stimmen
  // (macOS, Chrome, Windows). Unbekannte Namen bleiben "?" – dafür gibt es die Hörprobe.
  var FEMALE = ["anna", "petra", "helena", "katja", "vicki", "marlene", "hedda", "sandy", "shelley", "flo",
    "grandma", "amala", "seraphina", "louisa", "ingrid", "gisela", "elke", "tanja", "katharina", "maja", "klara",
    "leonie", "sophie", "marie", "claudia", "steffi", "hanna", "yvonne", "julia", "lena", "nora", "emma",
    "mia", "clara", "tanja", "elena", "martha", "carla"];
  var MALE = ["markus", "yannick", "martin", "viktor", "stefan", "conrad", "killian", "eddy", "grandpa", "reed",
    "rocko", "jonas", "florian", "kasimir", "bernd", "ralf", "hans", "klaus", "daniel", "thomas", "lukas", "jörg",
    "jorg", "michael", "ben", "tim", "paul", "felix"];
  PC.voiceGender = function (name) {
    var n = String(name || "").toLowerCase();
    if (/google deutsch/.test(n)) return "f";
    var tokens = n.split(/[^a-zäöüß]+/);
    for (var i = 0; i < tokens.length; i++) {
      if (FEMALE.indexOf(tokens[i]) >= 0) return "f";
      if (MALE.indexOf(tokens[i]) >= 0) return "m";
    }
    return "";
  };
  PC.isGerman = function (lang) { return /^de([-_]|$)/i.test(lang || ""); };
  PC.voiceQuality = function (name) {
    var n = String(name || "").toLowerCase();
    if (/premium|natural|neural/.test(n)) return "premium";
    if (/enhanced|erweitert|verbessert/.test(n)) return "enhanced";
    return "";
  };
  PC.voiceScore = function (v) {
    var sc = 0, g = PC.voiceGender(v.name), q = PC.voiceQuality(v.name);
    if (/^de[-_]de/i.test(v.lang || "")) sc += 30; else if (PC.isGerman(v.lang)) sc += 25;
    if (g === "f") sc += 20; else if (g === "m") sc -= 40;
    if (v.local !== false && v.localService !== false) sc += 8;   // funktioniert offline
    if (q === "premium") sc += 6; else if (q === "enhanced") sc += 4;
    if (/^anna|^petra|^helena/i.test(v.name)) sc += 2;
    return sc;
  };
  PC.bestVoice = function (voices) {
    var best = null, bs = -1e9;
    (voices || []).forEach(function (v) { var sc = PC.voiceScore(v); if (sc > bs) { bs = sc; best = v; } });
    return best;
  };

  /* ---------- Ansagetexte ---------- */
  function sayNum(n) { n = Number(n) || 0; return String(n % 1 === 0 ? n : n.toFixed(2)).replace(".", ","); }
  PC.spokenDuration = function (sec) {
    sec = Math.round(Number(sec) || 0);
    var m = Math.floor(sec / 60), s = sec % 60;
    var mt = m === 1 ? "eine Minute" : m + " Minuten";
    var st = s === 1 ? "eine Sekunde" : s + " Sekunden";
    if (m && s) return mt + " und " + st;
    return m ? mt : st;
  };
  PC.ANNOUNCE_PLACEHOLDERS = [
    ["{level}", "Levelnummer"], ["{sb}", "Small Blind"], ["{bb}", "Big Blind"], ["{ante}", "Ante"],
    ["{ante_teil}", "„, Ante 400“ – nur wenn es eine Ante gibt"], ["{zeit}", "Vorwarnzeit, z. B. „eine Minute“"],
    ["{sekunden}", "Countdown-Sekunden"], ["{dauer}", "Pausendauer, z. B. „zehn Minuten“"],
    ["{spieler}", "übrige Spieler"], ["{titel}", "Turniername"], ["{sieger}", "Name des Siegers"],
    ["{sieger_teil}", "„ an Lisa“ – nur wenn ein Name eingetragen ist"], ["{hinweis}", "Text des Hinweises auf der Anzeige"]];
  PC.fillAnnounce = function (tpl, d) {
    d = d || {};
    var map = {
      level: d.level != null ? String(d.level) : "", sb: sayNum(d.sb), bb: sayNum(d.bb), ante: sayNum(d.ante),
      ante_teil: Number(d.ante) > 0 ? ", Ante " + sayNum(d.ante) : "",
      zeit: PC.spokenDuration(d.seconds != null ? d.seconds : d.warningSeconds),
      sekunden: String(d.seconds != null ? d.seconds : d.countdownSeconds || ""),
      dauer: PC.spokenDuration((Number(d.minutes) || 0) * 60),
      minuten: sayNum(d.minutes), spieler: String(d.remaining != null ? d.remaining : ""),
      titel: d.title || "", sieger: d.winner || "", sieger_teil: d.winner ? " an " + d.winner : "", hinweis: d.text || ""
    };
    return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) { return k in map ? map[k] : m; }).trim();
  };

  window.PC = PC;
})();
