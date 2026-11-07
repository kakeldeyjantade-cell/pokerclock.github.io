/* Pokerclock – Turnierlogik (Port von server.py, V2) für den iPad-Host.
   Läuft im Browser (window.PCEngine) und in Node (module.exports) für die Paritätstests. */
(function (root) {
  "use strict";

  /* ---------------- Hilfen (Python-Semantik) ---------------- */
  function pyRound(x) { // round() wie Python: halbe Werte zur geraden Zahl
    var f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  function round2(x) { return Number((Math.round((x + Number.EPSILON) * 100) / 100).toFixed(2)); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function num(v, fallback) {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === null || v === undefined) return fallback;
    if (typeof v === "string") { v = v.replace(",", ".").trim(); if (v === "") return fallback; }
    var f = Number(v);
    if (typeof v === "object" || !isFinite(f)) return fallback;
    return f;
  }
  function int(v, fallback) { var f = num(v, null); return f === null ? fallback : pyRound(f); }
  function isObj(o) { return o !== null && typeof o === "object" && !Array.isArray(o); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  var FLOAT_KEYS = { rebuyPrice: 1, addonPrice: 1, buyIn: 1 };
  function coerce(value, like, key) {
    if (typeof like === "boolean") {
      if (typeof value === "string") return ["1", "true", "ja", "on", "yes"].indexOf(value.toLowerCase()) >= 0;
      return !!value;
    }
    if (typeof like === "number") {
      if (FLOAT_KEYS[key]) return num(value, like);
      return int(value, like);
    }
    return String(value !== null && value !== undefined ? value : "").slice(0, 200);
  }

  /* ---------------- Standard-Turnier ---------------- */
  var ANNOUNCE = [
    ["start", "Turnierstart", true,
      "Willkommen zum Pokerturnier! Das Turnier beginnt jetzt mit Small Blind {sb} und Big Blind {bb}. Viel Glück!"],
    ["level", "Neue Blindstufe", true, "Neue Blindstufe: Small Blind {sb}, Big Blind {bb}{ante_teil}."],
    ["warnLevel", "Vorwarnung vor der nächsten Blindstufe", true, "Noch {zeit} bis zur nächsten Blindstufe."],
    ["warnBreak", "Vorwarnung vor der Pause", true, "Noch {zeit} bis zur Pause."],
    ["countdown", "Countdown am Levelende", true, "Noch {sekunden} Sekunden bis zum Ende des Levels."],
    ["breakStart", "Pause beginnt", true, "Die Pause beginnt jetzt und dauert {dauer}."],
    ["warnBreakEnd", "Vorwarnung Pausenende", true, "Die Pause endet in {zeit}."],
    ["breakEnd", "Pausenende", true, "Die Pause ist vorbei. Das Turnier wird fortgesetzt."],
    ["clockPause", "Uhr angehalten", true, "Die Uhr ist angehalten."],
    ["clockResume", "Uhr läuft weiter", true, "Die Uhr läuft weiter."],
    ["restart", "Level neu gestartet", true, "Das Level wird neu gestartet."],
    ["bust", "Spieler ausgeschieden", false, "Ein Spieler ist ausgeschieden. Noch {spieler} Spieler im Turnier."],
    ["timeout", "Letztes Level abgelaufen", true, "Das letzte Level ist abgelaufen."],
    ["end", "Turnierende", true, "Das Turnier ist beendet. Herzlichen Glückwunsch{sieger_teil}!"],
    ["message", "Hinweis auf der Anzeige (Last hand, Final table …)", true, "{hinweis}"]
  ];
  function defaultAnnounce() {
    var o = {};
    ANNOUNCE.forEach(function (a) { o[a[0]] = { on: a[2], text: a[3] }; });
    return o;
  }
  function announceInfo() {
    return ANNOUNCE.map(function (a) { return { key: a[0], label: a[1], on: a[2], text: a[3] }; });
  }
  function defaultHistory() {
    return { activeId: "", lastId: "", status: "", seq: 0, bustCount: 0, openBusts: [], lastLevelId: "",
      clockPausedAt: 0, breakStartedAt: 0, lastBust: null };
  }

  /* ---------------- Engine ---------------- */
  // opts: now() -> ms, uid(n) -> n Hex-Zeichen, store: {events(tid), append(tid, ev), has(tid)},
  //       onAnnounce(ann), onLog(ev)
  function Engine(opts) {
    var self = this;
    opts = opts || {};
    self.now = opts.now || function () { return Date.now(); };
    self.uid = opts.uid || function (n) {
      var s = ""; while (s.length < n) s += Math.random().toString(16).slice(2); return s.slice(0, n);
    };
    self.store = opts.store || memoryStore();
    self.onAnnounce = opts.onAnnounce || function () {};
    self.onLog = opts.onLog || function () {};
    self.ann = [];
    self.annSeq = 0;
    self._obs = null;
    self._lastLevelInfo = null;
    self.state = self.defaultState();
  }
  var E = Engine.prototype;

  function memoryStore() {
    var m = {};
    return {
      events: function (tid) { return m[tid] || []; },
      append: function (tid, ev) { (m[tid] = m[tid] || []).push(ev); },
      has: function (tid) { return !!m[tid]; },
      ids: function () { return Object.keys(m); }
    };
  }

  E._lvl = function (sb, bb, ante, minutes) {
    return { id: this.uid(8), type: "level", sb: sb, bb: bb, ante: ante || 0, minutes: minutes || 20 };
  };
  E._brk = function (minutes) {
    return { id: this.uid(8), type: "break", sb: 0, bb: 0, ante: 0, minutes: minutes || 10 };
  };
  E.defaultLevels = function () {
    var L = this._lvl.bind(this), B = this._brk.bind(this);
    return [
      L(100, 300), L(200, 400), L(300, 600), L(400, 800),
      B(10),
      L(500, 1000, 1000), L(600, 1200, 1200), L(800, 1600, 1600), L(1000, 2000, 2000),
      B(10),
      L(1200, 2400, 2400), L(1500, 3000, 3000), L(2000, 4000, 4000), L(2500, 5000, 5000),
      B(10),
      L(3000, 6000, 6000), L(4000, 8000, 8000), L(5000, 10000, 10000), L(6000, 12000, 12000),
      B(10),
      L(8000, 16000, 16000), L(10000, 20000, 20000), L(12000, 24000, 24000), L(15000, 30000, 30000),
      L(20000, 40000, 40000), L(25000, 50000, 50000), L(30000, 60000, 60000), L(40000, 80000, 80000)
    ];
  };
  E.defaultState = function () {
    var levels = this.defaultLevels();
    return {
      schema: 1,
      tournament: {
        title: "NF POKER OPEN", subtitle: "105. AUSGABE", type: "MULTI FREEZEOUT TOURNAMENT",
        startStack: 30000, entries: 0, remaining: 0,
        rebuysEnabled: false, rebuys: 0, rebuyChips: 30000, rebuyPrice: 0,
        addonsEnabled: false, addons: 0, addonChips: 30000, addonPrice: 0,
        buyIn: 0, currency: "€", extraChips: 0
      },
      display: {
        theme: "blau", showSidebar: true,
        sidebar: { players: true, average: true, chips: true, nextBreak: true, prizepool: false,
          clock: false, elapsed: false, rebuys: false },
        nextBreakMode: "countdown", numberFormat: "full", anteLabel: "BIG BLIND ANTE",
        breakText: "Gleich geht's weiter", warnLastMinute: true, showSpade: true, showStatus: true,
        showQr: false, message: "", showMessage: false
      },
      sound: {
        enabled: true, volume: 80, chimes: true, warning: true, warningSeconds: 60, countdown: false,
        voice: true, voiceEngine: "eleven", voiceOff: {}, voiceName: "", voiceRate: 100, voiceVolume: 100, countdownSeconds: 10,
        announce: defaultAnnounce()
      },
      levels: levels,
      clock: { running: false, levelIndex: 0, remainingMs: levels[0].minutes * 60000, anchor: this.now(),
        startedOnce: false, playMs: 0 },
      ping: { id: 0, kind: "" },
      history: defaultHistory()
    };
  };

  /* ---- Laden (wie Clock._load) ---- */
  E.load = function (saved) {
    var base = this.defaultState();
    if (!isObj(saved)) { this.state = base; return; }
    var merged = mergeDefaults(base, saved);
    delete merged.security; delete merged.pinRequired;
    if (!Array.isArray(merged.levels) || !merged.levels.length) merged.levels = base.levels;
    merged.levels = this.sanitizeLevels(merged.levels);
    if (!merged.levels.length) merged.levels = base.levels;
    var c = merged.clock;
    c.levelIndex = Math.max(0, Math.min(int(c.levelIndex, 0), merged.levels.length - 1));
    this.state = merged;
  };
  function mergeDefaults(base, saved) {
    if (!isObj(saved)) return base;
    var out = clone(base);
    Object.keys(saved).forEach(function (k) {
      var v = saved[k];
      if (k in out && isObj(out[k]) && isObj(v)) out[k] = mergeDefaults(out[k], v);
      else out[k] = v;
    });
    return out;
  }

  /* ---- Uhrlogik ---- */
  E.dur = function (i) { return pyRound(Number(this.state.levels[i].minutes) * 60000); };
  E.normalize = function (t) {
    t = t === undefined ? this.now() : t;
    var c = this.state.clock, levels = this.state.levels;
    if (c.running) {
      var elapsed = Math.max(0, t - Number(c.anchor));
      c.playMs = Number(c.playMs || 0) + elapsed;
      var i = Number(c.levelIndex), rem = Number(c.remainingMs);
      while (elapsed >= rem && i < levels.length - 1) { elapsed -= rem; i += 1; rem = this.dur(i); }
      rem -= elapsed;
      if (rem <= 0) { rem = 0; c.running = false; }
      c.levelIndex = i; c.remainingMs = rem;
    }
    c.anchor = t;
  };
  E.totals = function (tour) {
    var t = tour || this.state.tournament;
    var reb = !!t.rebuysEnabled, add = !!t.addonsEnabled;
    var chips = Number(t.entries) * Number(t.startStack) +
      (reb ? Number(t.rebuys) * Number(t.rebuyChips) : 0) +
      (add ? Number(t.addons) * Number(t.addonChips) : 0) + Number(t.extraChips || 0);
    var pool = Number(t.entries) * Number(t.buyIn) +
      (reb ? Number(t.rebuys) * Number(t.rebuyPrice) : 0) +
      (add ? Number(t.addons) * Number(t.addonPrice) : 0);
    var rem = Number(t.remaining);
    return { chips: Math.max(0, chips), pool: round2(pool),
      avg: rem > 0 ? pyRound(Math.max(0, chips) / rem) : null };
  };
  E.view = function (t) {
    var st = this.state, c = st.clock, levels = st.levels;
    var i = Number(c.levelIndex), rem = Number(c.remainingMs), running = !!c.running;
    if (running) {
      var elapsed = Math.max(0, t - Number(c.anchor));
      while (elapsed >= rem && i < levels.length - 1) { elapsed -= rem; i += 1; rem = this.dur(i); }
      rem -= elapsed;
      if (rem <= 0) { rem = 0; running = false; }
    }
    var lv = levels[i];
    return { index: i, levelId: lv.id, rem: rem, running: running,
      finished: !running && rem <= 0 && i === levels.length - 1,
      isBreak: lv.type === "break", t: t };
  };
  E.levelInfo = function (i) {
    var levels = this.state.levels;
    if (!(i >= 0 && i < levels.length)) return null;
    var lv = levels[i], n = null;
    if (lv.type !== "break") { n = 0; for (var k = 0; k <= i; k++) if (levels[k].type !== "break") n++; }
    return { index: i, id: lv.id, type: lv.type, number: n, sb: lv.sb, bb: lv.bb, ante: lv.ante, minutes: lv.minutes };
  };

  /* ---- Ansagen ---- */
  E.announce = function (typ, data, t) {
    var d;
    try { d = this.voiceData(); } catch (e) { d = {}; }
    Object.assign(d, data || {});
    this.annSeq += 1;
    var a = { id: this.annSeq, t: t || this.now(), type: typ, data: d };
    this.ann.push(a);
    if (this.ann.length > 40) this.ann.shift();
    try { this.onAnnounce(a); } catch (e) {}
  };
  E.voiceData = function (i) {
    var st = this.state;
    if (i === undefined || i === null) i = this.view(this.now()).index;
    var info = this.levelInfo(i) || {};
    var nxt = this.levelInfo(i + 1);
    if (info.type === "break") {
      for (var k = i + 1; k < st.levels.length; k++) {
        if (st.levels[k].type !== "break") {
          info = Object.assign({}, this.levelInfo(k), { type: "break", minutes: st.levels[i].minutes });
          break;
        }
      }
    }
    return { level: info.number === undefined ? null : info.number, sb: info.sb || 0, bb: info.bb || 0,
      ante: info.ante || 0, minutes: st.levels[i].minutes,
      nextIsBreak: !!(nxt && nxt.type === "break"), inBreak: st.levels[i].type === "break",
      remaining: Number(st.tournament.remaining), title: st.tournament.title,
      warningSeconds: Number(st.sound.warningSeconds), countdownSeconds: Number(st.sound.countdownSeconds) };
  };

  /* ---- Historie ---- */
  E.snapshot = function () {
    var t = this.state.tournament, tot = this.totals(), v = this.view(this.now());
    var info = this.levelInfo(v.index) || {};
    return { entries: Number(t.entries), remaining: Number(t.remaining),
      rebuys: t.rebuysEnabled ? Number(t.rebuys) : 0, addons: t.addonsEnabled ? Number(t.addons) : 0,
      pool: tot.pool, chips: tot.chips, level: info.number === undefined ? null : info.number,
      levelType: info.type === undefined ? null : info.type,
      sb: info.sb === undefined ? null : info.sb, bb: info.bb === undefined ? null : info.bb,
      ante: info.ante === undefined ? null : info.ante };
  };
  E.log = function (typ, data, t, tid, snap) {
    var h = this.state.history;
    tid = tid || h.activeId;
    if (!tid) return null;
    var seq;
    if (tid === h.activeId) { h.seq = Number(h.seq || 0) + 1; seq = h.seq; }
    else seq = this.readEvents(tid).length + 1;
    var ev = { id: tid + "-" + seq, seq: seq, tid: tid, type: typ, t: Math.trunc(t || this.now()), data: data || {} };
    if (snap !== false) ev.snap = this.snapshot();
    this.store.append(tid, ev);
    try { this.onLog(ev); } catch (e) {}
    return ev;
  };
  E.readEvents = function (tid) { return this.store.events(tid) || []; };
  E.makeTid = function (t) {
    var d = new Date(t);
    return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + "-" + this.uid(4);
  };
  E.startRecord = function (t) {
    var h = this.state.history;
    var tid = this.makeTid(t);
    Object.assign(h, { activeId: tid, lastId: tid, status: "running", seq: 0, lastBust: null,
      bustCount: 0, openBusts: [], clockPausedAt: 0, breakStartedAt: 0 });
    var tour = clone(this.state.tournament);
    var v = this.view(t);
    h.lastLevelId = v.levelId;
    if (v.isBreak) h.breakStartedAt = t;
    this.log("start", { config: tour, levels: clone(this.state.levels), startLevel: this.levelInfo(v.index),
      totals: this.totals() }, t);
  };
  E.abortRecord = function (reason, t) {
    var h = this.state.history;
    if (h.activeId) {
      this.log("abort", { reason: reason }, t);
      Object.assign(h, { activeId: "", status: "aborted", openBusts: [], lastBust: null });
    }
  };

  /* ---- Ereignis-Erkennung ---- */
  E._levelChanged = function (fromIdx, toIdx, tEv, cause, speak) {
    var st = this.state, h = st.history;
    var frm = this._lastLevelInfo, to = this.levelInfo(toIdx);
    if (h.activeId) {
      if (frm && frm.type === "break" && h.breakStartedAt) {
        this.log("break_end", { plannedMinutes: frm.minutes, actualMs: Math.max(0, tEv - Number(h.breakStartedAt)) }, tEv);
        h.breakStartedAt = 0;
      }
      this.log("level", { from: frm, to: to, cause: cause }, tEv);
      if (to && to.type === "break") {
        h.breakStartedAt = tEv;
        this.log("break_start", { minutes: to.minutes }, tEv);
      }
    }
    h.lastLevelId = to ? to.id : "";
    this._lastLevelInfo = to;
    if (speak && st.clock.startedOnce) {
      var d = this.voiceData(toIdx);
      d.fromBreak = !!(frm && frm.type === "break");
      this.announce(to.type === "break" ? "break" : "level", d, tEv);
    }
  };
  var CAUSE_LABEL = { next: "manuell: Level vor", prev: "manuell: Level zurück", jump: "manuell: zu Level gesprungen",
    levels: "Struktur geändert", start: "Start nach abgelaufenem Level", toggle: "Start nach abgelaufenem Level",
    resetClock: "Uhr zurückgesetzt", newTournament: "Neues Turnier", resetAll: "Alles zurückgesetzt" };
  E.detect = function (t, cause) {
    var v = this.view(t), o = this._obs, changed = false;
    if (o === null) { this._obs = v; this._lastLevelInfo = this.levelInfo(v.index); return false; }
    if (v.levelId !== o.levelId) {
      if (!cause && v.index > o.index) {
        var starts = [], ts = t - (this.dur(v.index) - v.rem);
        for (var k = v.index; k > o.index; k--) { starts.push([k, ts]); ts -= this.dur(k - 1); }
        starts.reverse();
        for (var n = 0; n < starts.length; n++) {
          var last = n === starts.length - 1;
          this._levelChanged(starts[n][0] - 1, starts[n][0], starts[n][1], "automatisch",
            last && (t - starts[n][1]) < 5000);
        }
      } else {
        var label = CAUSE_LABEL[cause] || (cause ? "manuell" : "automatisch");
        this._levelChanged(o.index, v.index, t, label,
          ["resetClock", "resetAll", "newTournament"].indexOf(cause) < 0);
      }
      changed = true;
    } else if (!cause && o.running && v.running && (t - o.t) < 1500) {
      var snd = this.state.sound;
      var thr = Number(snd.warningSeconds) * 1000;
      if (o.rem > thr && thr >= v.rem && v.rem > 0) {
        var d = this.voiceData(v.index);
        d.seconds = Number(snd.warningSeconds);
        this.announce("warn", d, t);
        changed = true;
      }
      var cs = Number(snd.countdownSeconds) * 1000;
      if (!v.isBreak && o.rem > cs && cs >= v.rem && v.rem > 0) {
        this.announce("countdown", { seconds: Number(snd.countdownSeconds) }, t);
        changed = true;
      }
      [5, 4, 3, 2, 1].forEach(function (sec) {
        if (o.rem > sec * 1000 && sec * 1000 >= v.rem && v.rem > 0) { this.announce("tick", { seconds: sec }, t); changed = true; }
      }, this);
    }
    if (v.levelId === o.levelId) this._lastLevelInfo = this.levelInfo(v.index);
    if (v.finished && !o.finished && !cause) {
      this.announce("timeout", {}, t);
      this.log("timeout", { level: this.levelInfo(v.index) }, t);
      changed = true;
    }
    this._obs = v;
    return changed;
  };
  // Beim Start des Hosts: verpasste Levelwechsel (iPad war aus) nachtragen. true = Stand geändert
  E.bootSync = function () {
    var t = this.now(), h = this.state.history, v = this.view(t), levels = this.state.levels;
    var lastId = h.lastLevelId, idx = null, changed = false;
    for (var k = 0; k < levels.length; k++) if (levels[k].id === lastId) { idx = k; break; }
    this._obs = Object.assign({}, v);
    this._lastLevelInfo = this.levelInfo(idx !== null ? idx : v.index);
    if (h.activeId && idx !== null && idx < v.index) {
      this._obs.index = idx; this._obs.levelId = lastId;
      this.detect(t);
      changed = true;
    }
    this._obs = this.view(t);
    return changed;
  };

  /* ---- Aktionen ---- */
  // Vor apply aufrufen: welche Turniere müssen geladen sein?
  E.needsEvents = function (action) {
    var h = this.state.history, k = action && action.type;
    if (k === "nameBust") return [String(action.tid || h.activeId || h.lastId || "")].filter(Boolean);
    if (k === "reopen" && h.lastId) return [h.lastId];
    if (k === "finish" && h.activeId) return [h.activeId];
    return [];
  };
  E.apply = function (action) {
    var t = this.now(), kind = action.type, st = this.state, c = st.clock;
    this.normalize(t);
    this.detect(t);
    var n = st.levels.length;
    var before = { tour: clone(st.tournament), totals: this.totals(), running: c.running, rem: c.remainingMs,
      index: c.levelIndex, startedOnce: !!c.startedOnce };
    var h = st.history;
    var fail = function (msg) { var e = new Error(msg); e.userError = true; throw e; };

    if (kind === "start" || kind === "pause" || kind === "toggle") {
      var run = kind === "toggle" ? !c.running : kind === "start";
      if (run && c.remainingMs <= 0) {
        if (c.levelIndex < n - 1) c.levelIndex += 1;
        c.remainingMs = this.dur(c.levelIndex);
      }
      c.running = run;
      if (run) c.startedOnce = true;
    } else if (kind === "next") {
      if (c.levelIndex < n - 1) c.levelIndex += 1;
      c.remainingMs = this.dur(c.levelIndex);
    } else if (kind === "prev") {
      if (c.levelIndex > 0) c.levelIndex -= 1;
      c.remainingMs = this.dur(c.levelIndex);
    } else if (kind === "jump") {
      var i = int(action.index, c.levelIndex);
      c.levelIndex = Math.max(0, Math.min(i, n - 1));
      c.remainingMs = this.dur(c.levelIndex);
    } else if (kind === "restartLevel") {
      c.remainingMs = this.dur(c.levelIndex);
    } else if (kind === "adjust") {
      var delta = Math.trunc(num(action.seconds, 0) * 1000);
      c.remainingMs = Math.max(0, c.remainingMs + delta);
      this.normalize(t);
    } else if (kind === "setRemaining") {
      var sec = num(action.seconds, null);
      if (sec === null || sec < 0) fail("Ungültige Zeit");
      c.remainingMs = Math.trunc(sec * 1000);
      this.normalize(t);
    } else if (kind === "players") {
      var field = action.field;
      if (["entries", "remaining", "rebuys", "addons"].indexOf(field) < 0) fail("Ungültiges Feld");
      st.tournament[field] = Math.max(0, Number(st.tournament[field] || 0) + int(action.delta, 0));
    } else if (kind === "newPlayer") {
      st.tournament.entries = Number(st.tournament.entries) + 1;
      st.tournament.remaining = Number(st.tournament.remaining) + 1;
    } else if (kind === "removeEntry") {
      st.tournament.entries = Math.max(0, Number(st.tournament.entries) - 1);
      st.tournament.remaining = Math.max(0, Number(st.tournament.remaining) - 1);
    } else if (kind === "bust") {
      if (Number(st.tournament.remaining) <= 0) fail("Keine Spieler mehr übrig");
      st.tournament.remaining = Number(st.tournament.remaining) - 1;
    } else if (kind === "undoBust") {
      if (!h.openBusts || !h.openBusts.length) fail("Kein Bustout zum Rückgängigmachen");
      st.tournament.remaining = Number(st.tournament.remaining) + 1;
    } else if (kind === "nameBust") {
      // wird unten protokolliert
    } else if (kind === "set") {
      this.setPath(action.path || "", action.value);
    } else if (kind === "resetAnnounce") {
      st.sound.announce = defaultAnnounce();
    } else if (kind === "levels") {
      this.replaceLevels(action.levels);
    } else if (kind === "voiceClip") {
      // einzelnen ElevenLabs-Baustein an- oder abschalten
      var ck = String(action.key || "");
      if (!/^[A-Za-z0-9_]{1,30}$/.test(ck)) fail("Ungültiger Baustein");
      if (!isObj(st.sound.voiceOff)) st.sound.voiceOff = {};
      if (action.on === false) st.sound.voiceOff[ck] = true; else delete st.sound.voiceOff[ck];
    } else if (kind === "voiceClipsReset") {
      st.sound.voiceOff = {};
    } else if (kind === "ping" || kind === "preview" || kind === "voicePreview" || kind === "clipPreview") {
      // nur Ansage
    } else if (kind === "finish") {
      if (!h.activeId) fail("Es läuft kein Turnier");
      c.running = false;
    } else if (kind === "reopen") {
      if (h.activeId || !h.lastId || h.status !== "finished") fail("Kein beendetes Turnier zum Wiederöffnen");
    } else if (kind === "resetClock") {
      this.abortRecord("Uhr zurückgesetzt", t);
      Object.assign(c, { running: false, levelIndex: 0, remainingMs: this.dur(0), startedOnce: false, playMs: 0, anchor: t });
    } else if (kind === "newTournament") {
      this.abortRecord("Neues Turnier vorbereitet", t);
      Object.assign(c, { running: false, levelIndex: 0, remainingMs: this.dur(0), startedOnce: false, playMs: 0, anchor: t });
      Object.assign(st.tournament, { entries: 0, remaining: 0, rebuys: 0, addons: 0, extraChips: 0 });
      st.display.showMessage = false;
    } else if (kind === "resetAll") {
      this.abortRecord("Alles zurückgesetzt", t);
      var hist = { lastId: h.lastId, status: h.status };
      this.state = this.defaultState();
      Object.assign(this.state.history, hist);
    } else {
      fail("Unbekannte Aktion: " + kind);
    }
    this.state.clock.anchor = t;
    this._afterAction(kind, action, before, t);
    this.detect(t, kind);
  };

  var TOUR_LABELS = { title: "Titel", subtitle: "Untertitel", type: "Turnierart", startStack: "Startstack",
    entries: "Teilnehmer", remaining: "Übrige Spieler", rebuysEnabled: "Rebuys erlaubt", rebuys: "Rebuys",
    rebuyChips: "Chips je Rebuy", rebuyPrice: "Preis je Rebuy", addonsEnabled: "Add-ons erlaubt", addons: "Add-ons",
    addonChips: "Chips je Add-on", addonPrice: "Preis je Add-on", buyIn: "Buy-in", currency: "Währung",
    extraChips: "Chips-Korrektur" };

  E._afterAction = function (kind, action, before, t) {
    var self = this, st = this.state, h = st.history, c = st.clock, tour = st.tournament;
    var oldT = before.totals, newT = this.totals(), pool = null;
    if (Math.abs(newT.pool - oldT.pool) > 1e-9) pool = { old: oldT.pool, "new": newT.pool, diff: round2(newT.pool - oldT.pool) };
    function plog(typ, data) { if (pool) data = Object.assign({}, data, { pool: pool }); return self.log(typ, data, t); }

    if (kind === "start" || kind === "pause" || kind === "toggle") {
      if (c.running && !before.startedOnce) {
        if (h.activeId) this.abortRecord("Neues Turnier gestartet", t);
        this.startRecord(t);
        this.announce("start", this.voiceData(c.levelIndex), t);
      } else if (c.running && !before.running && !h.activeId && !h.lastId) {
        this.startRecord(t);
        this.log("clock_resume", { pausedMs: null, note: "Aufzeichnung beim Fortsetzen begonnen" }, t);
        this.announce("resume", {}, t);
      } else if (c.running && !before.running) {
        var pausedMs = h.clockPausedAt ? t - Number(h.clockPausedAt) : null;
        h.clockPausedAt = 0;
        this.log("clock_resume", { pausedMs: pausedMs }, t);
        this.announce("resume", {}, t);
      } else if (!c.running && before.running) {
        h.clockPausedAt = t;
        this.log("clock_pause", {}, t);
        this.announce("pause", {}, t);
      }
      return;
    }
    if (kind === "restartLevel") {
      this.log("time", { kind: "Level neu gestartet", oldMs: before.rem, newMs: c.remainingMs }, t);
      if (c.startedOnce) this.announce("restart", {}, t);
      return;
    }
    if (kind === "adjust" || kind === "setRemaining") {
      this.log("time", { kind: "Zeit korrigiert", oldMs: before.rem, newMs: c.remainingMs, diffMs: c.remainingMs - before.rem }, t);
      return;
    }
    if (kind === "bust") {
      var place = Number(before.tour.remaining);
      h.bustCount = Number(h.bustCount || 0) + 1;
      var ev = plog("bust", { place: place, order: h.bustCount, remainingAfter: Number(tour.remaining),
        level: this.levelInfo(this.view(t).index) });
      if (ev) {
        (h.openBusts = h.openBusts || []).push(ev.id);
        h.lastBust = { ref: ev.id, place: place, tid: h.activeId };
      }
      this.announce("bust", this.voiceData(), t);
      return;
    }
    if (kind === "undoBust") {
      var ref = h.openBusts.pop();
      plog("bust_revert", { ref: ref, remainingAfter: Number(tour.remaining) });
      h.lastBust = null;
      return;
    }
    if (kind === "nameBust") {
      var tid = String(action.tid || h.activeId || h.lastId || "");
      if (!tid) { var e = new Error("Kein Turnier"); e.userError = true; throw e; }
      this.log("name", { ref: String(action.ref || "").slice(0, 60), name: String(action.name || "").trim().slice(0, 40) },
        t, tid, false);
      return;
    }
    if (kind === "newPlayer") { plog("entry", { delta: 1, entries: Number(tour.entries) }); return; }
    if (kind === "removeEntry") { plog("entry", { delta: -1, entries: Number(tour.entries) }); return; }
    if (kind === "players") {
      var field = action.field, old = Number(before.tour[field] || 0), nw = Number(tour[field] || 0);
      if (old === nw) return;
      if (field === "rebuys" || field === "addons") plog(field === "rebuys" ? "rebuy" : "addon", { delta: nw - old, count: nw });
      else plog("correction", { field: field, label: TOUR_LABELS[field] || field, old: old, "new": nw, source: "Handy (Plus/Minus)" });
      return;
    }
    if (kind === "set") {
      var parts = String(action.path || "").split(".");
      if (parts[0] === "tournament" && parts.length === 2) {
        var f = parts[1], o = before.tour[f], nv = tour[f];
        if (o !== nv) plog("correction", { field: f, label: TOUR_LABELS[f] || f, old: o, "new": nv, source: "Handy (Einstellung)" });
      } else if (parts[0] === "display" && parts[1] === "showMessage") {
        if (st.display.showMessage && String(st.display.message).trim()) {
          this.log("message", { text: st.display.message }, t);
          this.announce("message", { text: st.display.message }, t);
        }
      } else if (parts[0] === "display" && parts[1] === "message" && st.display.showMessage &&
                 String(st.display.message).trim() && action.value !== undefined) {
        this.announce("message", { text: st.display.message }, t);
      }
      return;
    }
    if (kind === "levels") { this.log("structure", { levels: st.levels.length }, t); return; }
    if (kind === "ping") { this.announce("test", {}, t); return; }
    if (kind === "preview") {
      var d = this.voiceData();
      Object.assign(d, { event: String(action.event || "level").slice(0, 30), seconds: d.warningSeconds, winner: "" });
      this.announce("preview", d, t);
      return;
    }
    if (kind === "clipPreview") { this.announce("clip", { key: String(action.key || "").slice(0, 30) }, t); return; }
    if (kind === "voicePreview") { this.announce("voicetest", { voice: String(action.voice || "").slice(0, 80) }, t); return; }
    if (kind === "finish") {
      var evs = this.readEvents(h.activeId);
      var winner = String(action.winner || "").trim().slice(0, 40);
      var sm = summarize(evs.concat([{ type: "end", t: t, data: { winner: winner }, snap: this.snapshot() }]), null, t);
      this.log("end", { winner: winner, durationMs: sm.durationMs, standings: sm.standings, totals: this.totals(), payouts: null }, t);
      Object.assign(h, { activeId: "", status: "finished", clockPausedAt: 0, openBusts: [] });
      this.announce("end", { winner: winner }, t);
      return;
    }
    if (kind === "reopen") {
      Object.assign(h, { activeId: h.lastId, status: "running" });
      h.seq = this.readEvents(h.lastId).length;
      this.log("reopen", {}, t);
      return;
    }
  };

  E.setPath = function (path, value) {
    var parts = String(path).split(".").filter(Boolean);
    var bad = function () { var e = new Error("Ungültige Einstellung"); e.userError = true; throw e; };
    if (!parts.length || ["tournament", "display", "sound"].indexOf(parts[0]) < 0) bad();
    var dflt = this.defaultState(), target = this.state;
    for (var i = 0; i < parts.length - 1; i++) {
      var p = parts[i];
      if (!(p in dflt) || !isObj(dflt[p])) bad();
      dflt = dflt[p];
      if (!isObj(target[p])) target[p] = {};
      target = target[p];
    }
    var key = parts[parts.length - 1];
    if (!Object.prototype.hasOwnProperty.call(dflt, key) || isObj(dflt[key])) bad();
    target[key] = coerce(value, dflt[key], key);
    var s0 = parts[0];
    var clamp = function (lo, hi) { target[key] = Math.max(lo, Math.min(hi, target[key])); };
    if (s0 === "sound" && key === "volume") clamp(0, 100);
    if (s0 === "sound" && key === "warningSeconds") clamp(5, 600);
    if (s0 === "sound" && key === "countdownSeconds") clamp(3, 60);
    if (s0 === "sound" && key === "voiceRate") clamp(50, 150);
    if (s0 === "sound" && key === "voiceVolume") clamp(0, 100);
    if (s0 === "tournament" && typeof target[key] === "number" && key !== "extraChips") target[key] = Math.max(0, target[key]);
  };

  E.sanitizeLevels = function (raw) {
    if (!Array.isArray(raw)) { var e = new Error("Levels fehlen"); e.userError = true; throw e; }
    var out = [], seen = {};
    for (var k = 0; k < raw.length && k < 300; k++) {
      var item = raw[k];
      if (!isObj(item)) continue;
      var typ = item.type === "break" ? "break" : "level";
      var lid = String(item.id || "").slice(0, 24);
      if (!lid || seen[lid]) lid = this.uid(8);
      seen[lid] = true;
      var minutes = num(item.minutes, 20);
      minutes = Math.max(0.1, Math.min(600, minutes));
      out.push({ id: lid, type: typ,
        sb: typ === "level" ? Math.max(0, int(item.sb, 0)) : 0,
        bb: typ === "level" ? Math.max(0, int(item.bb, 0)) : 0,
        ante: typ === "level" ? Math.max(0, int(item.ante, 0)) : 0,
        minutes: minutes });
    }
    return out;
  };
  E.replaceLevels = function (raw) {
    var nw = this.sanitizeLevels(raw);
    if (!nw.length) { var e = new Error("Mindestens ein Level nötig"); e.userError = true; throw e; }
    var c = this.state.clock, old = this.state.levels, i = c.levelIndex;
    var cur = i >= 0 && i < old.length ? old[i] : null;
    var oldDur = cur ? this.dur(i) : 0, newI = null;
    if (cur) for (var k = 0; k < nw.length; k++) if (nw[k].id === cur.id) { newI = k; break; }
    this.state.levels = nw;
    if (newI !== null) {
      var newDur = this.dur(newI);
      var rem = c.remainingMs + (newDur - oldDur);
      c.remainingMs = Math.max(0, Math.min(rem, newDur));
      c.levelIndex = newI;
    } else {
      c.levelIndex = Math.max(0, Math.min(i, nw.length - 1));
      c.remainingMs = this.dur(c.levelIndex);
    }
  };

  /* ---------------- Zusammenfassung eines Turniers (nur aus Ereignissen) ---------------- */
  function reason(e) {
    var d = e.data || {}, typ = e.type;
    if (typ === "entry") return (d.delta || 0) > 0 ? "Neuer Spieler (Entry)" : "Entry entfernt";
    if (typ === "rebuy") return (d.delta || 0) > 0 ? "Rebuy" : "Rebuy storniert";
    if (typ === "addon") return (d.delta || 0) > 0 ? "Add-on" : "Add-on storniert";
    if (typ === "correction") return "Korrektur: " + (d.label || d.field) + " " + pyStr(d.old) + " → " + pyStr(d["new"]);
    if (typ === "bust" || typ === "bust_revert") return typ === "bust" ? "Bustout" : "Bustout zurückgenommen";
    return typ;
  }
  function pyStr(v) {
    if (v === true) return "True"; if (v === false) return "False"; if (v === null || v === undefined) return "None";
    return String(v);
  }
  function summarize(events, liveId, tNow) {
    if (!events || !events.length) return {};
    if (tNow === undefined) tNow = Date.now();
    var start = events.find(function (e) { return e.type === "start"; }) || events[0];
    var sd = start.data || {}, cfg = sd.config || {}, tid = start.tid;
    var status = "running", endEv = null, winner = "";
    var busts = {}, bustOrder = [], reverted = {}, names = {}, poolHist = [];
    var breakMs = 0, pausedMs = 0, openBreak = null, openPause = null;
    var lastSnap = start.snap || {};
    events.forEach(function (e) {
      var typ = e.type, d = e.data || {};
      if (e.snap) lastSnap = e.snap;
      if (d.pool) poolHist.push(Object.assign({}, d.pool, { t: e.t, reason: reason(e) }));
      if (typ === "bust") {
        if (!(e.id in busts)) bustOrder.push(e.id);
        busts[e.id] = { ref: e.id, place: d.place, order: d.order, t: e.t, level: d.level, name: "" };
      } else if (typ === "bust_revert") reverted[d.ref] = true;
      else if (typ === "name") names[d.ref] = d.name || "";
      else if (typ === "break_start") openBreak = e.t;
      else if (typ === "break_end") { breakMs += Number(d.actualMs || 0); openBreak = null; }
      else if (typ === "clock_pause") openPause = e.t;
      else if (typ === "clock_resume") {
        pausedMs += Number(d.pausedMs || (openPause ? e.t - openPause : 0));
        openPause = null;
      } else if (typ === "end") { status = "finished"; endEv = e; winner = d.winner || winner; }
      else if (typ === "abort") { status = "aborted"; endEv = e; }
      else if (typ === "reopen") { status = "running"; endEv = null; }
    });
    var tEnd = endEv ? endEv.t : (status === "running" ? tNow : events[events.length - 1].t);
    if (openBreak && status === "running") breakMs += Math.max(0, tEnd - openBreak);
    if (openPause) pausedMs += Math.max(0, tEnd - openPause);
    if (names.winner) winner = names.winner;
    var standings = [];
    bustOrder.forEach(function (ref) {
      if (reverted[ref]) return;
      var b = busts[ref]; b.name = names[ref] || ""; standings.push(b);
    });
    standings.sort(function (a, b) { return ((a.place || 0) - (b.place || 0)) || ((a.order || 0) - (b.order || 0)); });
    if (status === "finished" && (Number(lastSnap.remaining || 0) === 1 || winner)) {
      standings.unshift({ ref: "winner", place: 1, t: tEnd, name: winner, winner: true, level: null });
    }
    var g = function (o, k) { return o[k] === undefined ? null : o[k]; };
    var ss = start.snap || {};
    return {
      id: tid, title: cfg.title || "", subtitle: cfg.subtitle || "", type: cfg.type || "", currency: cfg.currency || "€",
      status: status, live: !!(liveId && liveId === tid),
      startedAt: g(start, "t"), endedAt: endEv ? endEv.t : null,
      durationMs: Math.max(0, tEnd - (start.t || tEnd)), breakMs: breakMs, pausedMs: pausedMs,
      entriesStart: ss.entries !== undefined ? ss.entries : g(cfg, "entries"), poolStart: g(ss, "pool"),
      entries: g(lastSnap, "entries"), remaining: g(lastSnap, "remaining"), rebuys: g(lastSnap, "rebuys"),
      addons: g(lastSnap, "addons"), pool: g(lastSnap, "pool"), chips: g(lastSnap, "chips"),
      startLevel: g(sd, "startLevel"),
      lastLevel: { number: g(lastSnap, "level"), type: g(lastSnap, "levelType"), sb: g(lastSnap, "sb"),
        bb: g(lastSnap, "bb"), ante: g(lastSnap, "ante") },
      winner: winner, standings: standings, poolHistory: poolHist,
      busts: standings.length - (standings.length && standings[0].winner ? 1 : 0),
      remainingAtEnd: status !== "running" ? g(lastSnap, "remaining") : null,
      payouts: null, eventCount: events.length
    };
  }

  var API = { Engine: Engine, summarize: summarize, announceInfo: announceInfo, defaultAnnounce: defaultAnnounce,
    memoryStore: memoryStore, pyRound: pyRound, clone: clone };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.PCEngine = API;
})(typeof window !== "undefined" ? window : this);
