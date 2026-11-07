/* Pokerclock – Anzeige (iPad als Host oder zweite Anzeige) */
window.startDisplay = function (mode, cap, dev) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var P = null;              // letzter Server-Stand
  var lastText = {};         // Cache, um DOM nur bei Änderungen anzufassen
  var qrManual = null;       // null = automatisch, true/false = per Taste Q

  /* ---------- Text einpassen ---------- */
  function setText(id, txt, html) {
    if (lastText[id] === txt) return false;
    lastText[id] = txt;
    var el = $(id);
    if (html) el.innerHTML = txt; else el.textContent = txt;
    fit(el);
    return true;
  }
  function fit(el) {
    if (!el || !el.classList.contains("fit")) return;
    el.style.transform = "";
    var box = el.parentElement;
    var cs = getComputedStyle(box);
    var avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (box.classList.contains("sub")) avail = $("main").clientWidth * 0.86 - 12 * remPx();
    if (box.classList.contains("stat")) avail = box.clientWidth;
    if (el.id === "title") avail = $("main").clientWidth * 0.94;
    if (el.id === "time") avail = $("main").clientWidth * 0.92;
    if (el.id === "msgTxt") avail = $("main").clientWidth * 0.86;
    var w = el.scrollWidth;
    if (w > avail && avail > 0) {
      var s = avail / w;
      el.style.transform = "scale(" + s + ")";
      el.style.transformOrigin = "center center";
      el.style.marginLeft = el.style.marginRight = (-(w - avail) / 2) + "px";
    } else {
      el.style.marginLeft = el.style.marginRight = "";
    }
  }
  function remPx() { return parseFloat(getComputedStyle(document.documentElement).fontSize); }
  function refitAll() { document.querySelectorAll(".fit").forEach(fit); }
  window.addEventListener("resize", function () { lastText = {}; render(true); refitAll(); });

  /* ---------- Ton ---------- */
  // Diese Anzeige hat eine eigene Kennung. Nur das "Sprecher"-Fenster spielt Töne und Ansagen ab,
  // damit bei zwei offenen Fenstern nichts doppelt kommt.
  var actx = null, master = null, audioOn = false;
  function amSpeaker() { return mode === "host" && !!host && host.isHost; }
  function unlockAudio() {
    var wasOn = audioOn;
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        actx = new AC(); master = actx.createGain(); master.connect(actx.destination);
      }
      if (actx.state === "suspended") actx.resume();
      audioOn = true;
      if (window.speechSynthesis && !wasOn) { var u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); }
    } catch (e) {}
    report(true);
    if (window.PCVoice && actx) { try { PCVoice.init(actx); } catch (e) {} }
    updateSoundChip();
  }
  function snd() { return P ? P.state.sound : { enabled: false }; }
  function vol() { return Math.max(0, Math.min(1, (snd().volume || 0) / 100)); }
  function canPlay() { return actx && audioOn && snd().enabled && amSpeaker(); }
  function tone(freq, start, dur, type, gain) {
    try {
      if (!canPlay()) return;
      var t0 = actx.currentTime + start;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "sine"; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime((gain || 0.5) * vol() + 0.0001, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) {}
  }
  function bell(freq, start, dur, gain) { // Glocke = Grundton + Obertöne
    tone(freq, start, dur, "sine", gain);
    tone(freq * 2.01, start, dur * 0.6, "sine", (gain || 0.5) * 0.35);
    tone(freq * 3.02, start, dur * 0.35, "sine", (gain || 0.5) * 0.15);
  }
  var SOUNDS = {
    level: function () { bell(659.3, 0, 1.4, .5); bell(784, .22, 1.4, .5); bell(1046.5, .44, 2.2, .55); },
    brk: function () { bell(1046.5, 0, 1.4, .5); bell(784, .25, 1.4, .5); bell(523.3, .5, 2.4, .55); },
    warn: function () { tone(880, 0, .18, "square", .18); tone(880, .3, .18, "square", .18); },
    tick: function () { tone(1200, 0, .07, "square", .12); },
    done: function () { bell(523.3, 0, 1, .5); bell(659.3, .2, 1, .5); bell(784, .4, 1, .5); bell(1046.5, .6, 2.4, .6); }
  };
  function play(name) { try { if (SOUNDS[name]) SOUNDS[name](); } catch (e) {} }
  function chime(name) { if (snd().chimes !== false) play(name); }

  /* ---------- Sprachansagen ---------- */
  function allVoices() {
    try { return window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { return []; }
  }
  function pickVoice(name) {
    var vs = allVoices();
    if (name) { var f = vs.find(function (v) { return v.name === name; }); if (f) return f; }
    return PC.bestVoice(vs.map(function (v) { return { name: v.name, lang: v.lang, localService: v.localService, ref: v }; }));
  }
  // Ersatz für fehlende ElevenLabs-Bausteine: englische Frauenstimme des Geräts
  var EN_F = /samantha|karen|moira|serena|tessa|fiona|victoria|allison|ava|susan|zoe|kate|martha|catherine|google us english|google uk english female/i;
  function pickEnglish() {
    var vs = allVoices().filter(function (v) { return /^en([-_]|$)/i.test(v.lang || ""); });
    return vs.find(function (v) { return EN_F.test(v.name) && v.localService !== false; }) || vs.find(function (v) { return EN_F.test(v.name); }) || vs[0] || null;
  }
  var groupGen = {}, current = null, currentSince = 0;
  // opt: group (neuere Ansage derselben Gruppe ersetzt ältere), delay, voice (Name), force (auch wenn Ansagen aus)
  function speak(text, opt) {
    opt = opt || {};
    try {
      if (!text || !window.speechSynthesis || !audioOn || !amSpeaker()) return;
      var s = snd();
      if (!s.enabled || (!s.voice && !opt.force)) return;
      var g = opt.group, gen = 0;
      if (g) gen = groupGen[g] = (groupGen[g] || 0) + 1;
      setTimeout(function () {
        try {
          if (g && groupGen[g] !== gen) return;               // inzwischen überholt
          if (g && current && current._group === g) speechSynthesis.cancel();
          var s2 = snd();
          var u = new SpeechSynthesisUtterance(text);
          var pv = opt.en ? pickEnglish() : pickVoice(opt.voice != null ? opt.voice : s2.voiceName);
          var voice = pv && (pv.ref || pv);
          if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "de-DE";
          u.rate = Math.max(0.5, Math.min(1.5, (s2.voiceRate || 100) / 100));
          u.volume = Math.max(0, Math.min(1, (s2.voiceVolume != null ? s2.voiceVolume : 100) / 100));
          u._group = g;
          u.onstart = function () { current = u; currentSince = Date.now(); };
          u.onend = u.onerror = function () { if (current === u) current = null; };
          speechSynthesis.speak(u);
        } catch (e) {}
      }, opt.delay || 0);
    } catch (e) {}
  }
  // Schutz gegen hängende Sprachausgabe (bekannter Browserfehler): nach 20 s abbrechen
  setInterval(function () {
    try { if (current && Date.now() - currentSince > 20000) { speechSynthesis.cancel(); current = null; } } catch (e) {}
  }, 5000);

  // Englische Stimme (ElevenLabs-Bausteine) oder Gerätestimme mit den eigenen deutschen Texten
  function say(a, st, txtDe, opt) {
    opt = opt || {};
    var s = st.sound;
    if (s.voiceEngine !== "browser" && window.PCVoice && PCVoice.available()) {
      if (!audioOn || !amSpeaker() || !s.enabled || (!s.voice && !opt.force)) return;
      var A = s.announce || {};
      PCVoice.setOff(s.voiceOff);
      var seq = PCVoice.plan(a, function (k) { var c = A[k]; return opt.force || (c ? !!c.on : true); });
      if (!seq) return;
      if (seq.direct) { // Hörprobe eines einzelnen Bausteins (auch wenn abgeschaltet)
        if (PCVoice.ready()) PCVoice.play(seq.direct, { group: "preview", volume: Math.max(0, Math.min(1, (s.voiceVolume != null ? s.voiceVolume : 100) / 100)) });
        return;
      }
      var r = PCVoice.resolve(seq);
      var vol = Math.max(0, Math.min(1, (s.voiceVolume != null ? s.voiceVolume : 100) / 100));
      if (r.ok && PCVoice.ready()) {
        var g = opt.group || "x", gen = groupGen[g] = (groupGen[g] || 0) + 1;
        setTimeout(function () { if (groupGen[g] === gen) PCVoice.play(r.items, { group: g, volume: vol }); }, opt.delay || 0);
      } else speak(r.text, Object.assign({}, opt, { en: true, force: true }));
      return;
    }
    speak(txtDe, opt);
  }
  function onAnnouncement(a, st) {
    var s = st.sound, A = s.announce || {}, d = a.data || {};
    var txt = function (key, data) { var c = A[key]; return c && c.on ? PC.fillAnnounce(c.text, data || d) : ""; };
    var join = function () { return Array.prototype.filter.call(arguments, Boolean).join(" "); };
    switch (a.type) {
      case "start": chime("level"); say(a, st, txt("start"), { group: "state", delay: 1500 }); break;
      case "level": chime("level"); say(a, st, join(d.fromBreak ? txt("breakEnd") : "", txt("level")), { group: "state", delay: 1500 }); break;
      case "break": chime("brk"); say(a, st, txt("breakStart"), { group: "state", delay: 1600 }); break;
      case "warn":
        if (s.warning) play("warn");
        say(a, st, txt(d.inBreak ? "warnBreakEnd" : d.nextIsBreak ? "warnBreak" : "warnLevel"), { group: "warn", delay: 700 });
        break;
      case "countdown": say(a, st, txt("countdown"), { group: "warn" }); break;
      case "tick": if (s.countdown) play("tick"); break;
      case "pause": say(a, st, txt("clockPause"), { group: "state", delay: 150 }); break;
      case "resume": say(a, st, txt("clockResume"), { group: "state", delay: 150 }); break;
      case "restart": say(a, st, txt("restart"), { group: "state", delay: 150 }); break;
      case "bust": say(a, st, txt("bust"), { group: "bust", delay: 150 }); break;
      case "message": say(a, st, txt("message"), { group: "msg", delay: 300 }); break;
      case "timeout": play("done"); say(a, st, txt("timeout"), { group: "state", delay: 2400 }); break;
      case "end": play("done"); say(a, st, txt("end"), { group: "state", delay: 2600 }); break;
      case "test": play("level"); say(a, st, "Der Ton funktioniert.", { delay: 1300, force: true }); break;
      case "clip": say(a, st, "", { group: "preview", force: true }); break;
      case "preview":
        var c = A[d.event];
        say(a, st, c ? PC.fillAnnounce(c.text, d) : "", { group: "preview", force: true });
        break;
      case "voicetest":
        if (s.voiceEngine !== "browser" && window.PCVoice && PCVoice.available()) { say(a, st, "", { group: "preview", force: true }); break; }
        speak("Hallo, so klinge ich. Neue Blindstufe: Small Blind 200, Big Blind 400, Ante 400.",
          { group: "preview", force: true, voice: d.voice || "" });
        break;
    }
  }

  // Stimmen und Ton-Freigabe dieses Geräts an den Host melden (das Handy zeigt sie an)
  function report() {
    if (!host) return;
    try {
      var vs = allVoices().map(function (v) { return { name: v.name, lang: v.lang, local: v.localService, "default": v["default"] }; });
      host.setAudio(audioOn, vs);
    } catch (e) {}
  }
  if (window.speechSynthesis) {
    try { speechSynthesis.addEventListener("voiceschanged", function () { report(); }); } catch (e) {}
  }
  setTimeout(report, 1500);

  function updateSoundChip() {
    var chip = $("chipSound"), txt = $("chipSoundTxt");
    var enabled = snd().enabled;
    if (!enabled) { chip.classList.remove("off"); txt.textContent = "Ton deaktiviert"; }
    else if (!audioOn) { chip.classList.add("off"); txt.textContent = "Ton aus – antippen"; }
    else if (mode !== "host") { chip.classList.add("off"); txt.textContent = "Zweite Anzeige – ohne Ton"; }
    else if (P && !amSpeaker()) { chip.classList.add("off"); txt.textContent = "Ton nur beim Host"; }
    else { chip.classList.remove("off"); txt.textContent = "Ton aktiv"; }
  }

  /* ---------- Bedienung am Mac (nur Anzeige) ---------- */
  function goFullscreen() {
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !(document.fullscreenElement || document.webkitFullscreenElement)) { try { req.call(el); } catch (e) {} }
  }
  function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else goFullscreen();
  }
  document.addEventListener("click", function () {
    var first = !audioOn;
    unlockAudio();
    $("hint").classList.add("gone");
    if (first) goFullscreen();
  });
  document.addEventListener("keydown", function (e) {
    unlockAudio(); $("hint").classList.add("gone");
    var k = e.key.toLowerCase();
    if (k === "f") toggleFullscreen();
    if (k === "q") { qrManual = !qrVisible(); updateQr(); }
    if (k === "escape" && qrVisible()) { qrManual = false; updateQr(); }
  });
  var cursorTimer = null;
  document.addEventListener("mousemove", function () {
    body.classList.remove("hide-cursor"); clearTimeout(cursorTimer);
    cursorTimer = setTimeout(function () { body.classList.add("hide-cursor"); }, 3000);
  });

  // Bildschirm wach halten
  var wakeLock = null;
  function keepAwake() {
    if (navigator.wakeLock && !document.hidden) {
      navigator.wakeLock.request("screen").then(function (w) { wakeLock = w; }).catch(function () {});
    }
  }
  document.addEventListener("visibilitychange", keepAwake);
  keepAwake();

  /* ---------- QR-Code ---------- */
  var qrUrl = null;
  function qrVisible() {
    if (!P) return false;
    if (qrManual !== null) return qrManual;
    if (!cap.db) return false; // ohne Online-Verbindung kann sich kein Handy verbinden
    return P.state.display.showQr || (P.clients.control === 0 && !P.state.clock.startedOnce);
  }
  var P2P = !!cap.p2p;
  function baseUrl() {
    if (!P2P) return window.PC_URL || "";
    if (!/^https?:$/.test(location.protocol)) return "";
    return location.origin + location.pathname;
  }
  function updateQr() {
    var b = baseUrl(), code = P2P ? cap.p2p.code : "";
    var urls = b ? [b + "#steuerung" + (code ? "-" + code : "")] : [];
    var vis = qrVisible() && (urls.length > 0 || !!code);
    if (P2P && $("qrCodeTxt").hidden) {
      $("qrCodeTxt").hidden = false;
      $("qrCodeTxt").innerHTML = "<small>Code des iPads</small>" + code;
      $("qrNote").innerHTML = "iPad und Handy brauchen zum Verbinden Internet (WLAN oder Hotspot), danach reicht dasselbe WLAN.<br>Dieses Fenster verschwindet, sobald das Handy verbunden ist – oder einfach antippen.";
    }
    if (!urls.length) $("qrCode").innerHTML = "";
    $("qr").classList.toggle("show", vis);
    if (!vis) return;
    var url = urls[0];
    if (url && url !== qrUrl) {
      qrUrl = url;
      var q = qrcode(0, "M"); q.addData(url); q.make();
      var n = q.getModuleCount(), m = 2, d = "";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + (c + m) + " " + (r + m) + "h1v1h-1z";
      $("qrCode").innerHTML = '<svg viewBox="0 0 ' + (n + 2 * m) + ' ' + (n + 2 * m) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#0b1640"/></svg>';
    }
    $("qrUrls").innerHTML = urls.map(function (u) { return '<div class="url">' + u.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</div>"; }).join("");
  }

  /* ---------- Darstellung ---------- */
  function applyStatic() {
    var st = P.state, d = st.display, t = st.tournament;
    if (body.dataset.theme !== d.theme) { body.dataset.theme = d.theme; }
    body.classList.toggle("no-spade", !d.showSpade);
    body.classList.toggle("no-status", !d.showStatus);
    var anySide = false;
    document.querySelectorAll(".stat").forEach(function (el) {
      var on = !!d.sidebar[el.dataset.k];
      el.style.display = on ? "" : "none";
      if (on) anySide = true;
    });
    // Trennlinien nur zwischen sichtbaren Einträgen
    var firstShown = true;
    document.querySelectorAll(".stat").forEach(function (el) {
      if (el.style.display === "none") return;
      el.classList.toggle("first", firstShown); firstShown = false;
    });
    var nShown = 0;
    document.querySelectorAll(".stat").forEach(function (el) { if (el.style.display !== "none") nShown++; });
    var side = $("side"), nc = nShown >= 7 ? "n7" : nShown === 6 ? "n6" : nShown === 5 ? "n5" : "";
    if (side.dataset.nc !== nc) {
      side.classList.remove("n5", "n6", "n7"); if (nc) side.classList.add(nc);
      side.dataset.nc = nc; lastText = {};
    }
    var noSide = !d.showSidebar || !anySide;
    if (body.classList.contains("no-side") !== noSide) { body.classList.toggle("no-side", noSide); lastText = {}; }
    setText("title", t.title || " ");
    body.classList.toggle("no-subtitle", !t.subtitle);
    setText("subtitle", t.subtitle || "");
    body.classList.toggle("no-type", !t.type);
    setText("ttype", t.type || "");
    var showMsg = d.showMessage && d.message.trim() !== "";
    $("msg").hidden = !showMsg;
    if (showMsg) setText("msgTxt", d.message);
    updateSoundChip();
    updateQr();
  }

  function blindsText(lv, fmt) {
    return PC.fmtNum(lv.sb, fmt) + " / " + PC.fmtNum(lv.bb, fmt);
  }

  function render(force) {
    if (!P) return;
    var st = P.state, d = st.display, t = st.tournament, fmt = d.numberFormat;
    var now = Date.now();
    var v = PC.computeView(st, now);
    var lv = v.level;

    // Timer
    setText("time", PC.fmtTime(v.remainingMs));
    var timeEl = $("time"), lbl = $("timeLbl");
    var paused = !v.running && !v.finished;
    timeEl.classList.toggle("paused", paused);
    var warn = d.warnLastMinute && !v.isBreak && v.running && v.remainingMs <= 60000;
    timeEl.classList.toggle("warn", warn);
    var hs = st.history || {};
    var lblTxt = (!hs.activeId && hs.status === "finished" && v.startedOnce && !v.running) ? "Turnier beendet" :
      v.finished ? "Zeit abgelaufen" :
      !v.startedOnce ? "Turnier startet gleich" :
      paused ? "Pausiert" :
      v.isBreak ? "Verbleibende Pausenzeit" : "Verbleibende Zeit";
    setText("timeLbl", lblTxt);
    lbl.classList.toggle("paused", paused && v.startedOnce);

    // Level / Blinds
    if (v.isBreak) {
      setText("pill", "Pause");
      setText("blinds", "PAUSE");
      setText("ante", d.breakText ? escapeHtml(d.breakText) : "", true);
    } else {
      setText("pill", "Level " + v.levelNumber);
      setText("blinds", blindsText(lv, fmt));
      setText("ante", lv.ante > 0 ? escapeHtml(d.anteLabel || "Ante") + ": " + PC.fmtNum(lv.ante, fmt) : "", true);
    }
    var nx = v.next, nxTxt;
    if (!nx) nxTxt = "Letztes Level";
    else if (nx.type === "break") nxTxt = "Pause (" + fmtMin(nx.minutes) + ")";
    else nxTxt = blindsText(nx, fmt) + (nx.ante > 0 ? "  ·  Ante " + PC.fmtNum(nx.ante, fmt) : "");
    setText("next", "<b>Nächstes Level:</b> " + escapeHtml(nxTxt), true);

    // Seitenleiste
    var tot = P.totals || PC.totals(t);
    setText("vPlayers", t.remaining + " / " + t.entries);
    setText("vAverage", tot.avg == null ? "–" : PC.fmtNum(tot.avg, fmt));
    setText("vChips", PC.fmtNum(tot.chips, fmt));
    var br;
    if (v.isBreak) br = "Jetzt";
    else if (v.nextBreakMs == null) br = "–";
    else if (d.nextBreakMode === "time") br = PC.fmtClockTime(new Date(now + v.nextBreakMs)) + " Uhr";
    else br = PC.fmtTime(v.nextBreakMs);
    setText("vBreak", br);
    setText("vPool", PC.fmtMoney(tot.pool, t.currency));
    setText("vRebuys", (t.rebuysEnabled ? t.rebuys : 0) + " / " + (t.addonsEnabled ? t.addons : 0));
    setText("vElapsed", PC.fmtElapsed(v.playMs));
    setText("vClock", PC.fmtClockTime(new Date()));
  }
  function fmtMin(m) { m = Number(m); return (m % 1 === 0 ? m : String(m).replace(".", ",")) + " min"; }
  function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------- Verbindung / Rolle ---------- */
  var host = null, docP = null, peersCtl = 0, hostOnlineSeen = false;
  function setConn(ok, txt) {
    $("chipConn").classList.toggle("bad", !ok);
    $("chipConnTxt").textContent = txt;
  }
  function connState() {
    if (mode === "host") {
      if (!host) return;
      if (!cap.db) return setConn(false, "Ohne Online-Verbindung – Handy kann nicht steuern");
      if (P2P) {
        var sg = cap.p2p.state.signal, nc = host.controls, cd = "Code " + cap.p2p.code + " · ";
        if (sg === "online") return setConn(true, cd + (nc === 1 ? "1 Handy verbunden" : nc + " Handys verbunden"));
        if (sg === "besetzt") return setConn(false, cd + "Code noch belegt – versuche erneut …");
        if (sg === "fehlt") return setConn(false, "Verbindungsbibliothek fehlt");
        if (sg === "offline") return setConn(nc > 0, cd + (nc > 0 ? nc + " Handy verbunden · kein Internet für neue Geräte" : "kein Internet – Uhr läuft weiter"));
        return setConn(false, cd + "verbinde …");
      }
      if (host.otherHost) return setConn(false, "Anderes Gerät ist Host");
      if (!host.online && host.ready && Date.now() - started > 12000) return setConn(false, "Offline – Uhr läuft weiter");
      var n = host.controls;
      setConn(true, n === 1 ? "Host · 1 Handy verbunden" : "Host · " + n + " Handys verbunden");
    } else {
      if (!cap.db) return setConn(false, "Ohne Online-Verbindung");
      if (P2P && !cap.room.connected()) return setConn(false, cap.p2p.state.error || "Verbinde mit iPad " + cap.p2p.code + " …");
      if (!docP) return setConn(false, "Warte auf das iPad …");
      setConn(hostOnline(), hostOnline() ? "Zweite Anzeige · verbunden" : "Zweite Anzeige · iPad nicht erreichbar");
    }
  }
  function hostOnline() {
    if (!cap.room) return true;
    try {
      return cap.room.peers().some(function (p) { return p.presence && p.presence.role === "host" && (!docP || p.presence.hostId === docP.hostId); });
    } catch (e) { return true; }
  }
  var started = Date.now();
  function refreshFromHost() {
    if (!host) return;
    P = host.payload(); applyStatic(); render(); connState(); updateOverlay(); updateMenu();
  }
  function onAnn(a, st) {
    if (Date.now() - a.t > 10000) return; // verspätet (z. B. nach dem Aufwachen): nicht mehr ansagen
    try { onAnnouncement(a, st); } catch (e) {}
  }

  if (mode === "host") {
    host = new PCHost({ cap: cap, dev: dev, onChange: function () { refreshFromHost(); }, onAnnounce: onAnn });
    window.__host = host;
    P = host.payload(); applyStatic(); render();
    setConn(false, "Starte …");
    host.load().then(function () { return host.claim(); }).then(function () {
      refreshFromHost();
      if (host.loadNote) showNote(host.loadNote);
    }).catch(function (e) { console.error(e); host.becomeHost(); refreshFromHost(); });
  } else {
    if (cap.room) cap.room.presence({ role: "display" }).catch(function () {});
    if (cap.db) {
      cap.db.doc(PCLink.PATH.state).onSnapshot(function (snap) {
        if (!snap.exists) { connState(); return; }
        docP = PCLink.payloadFromDoc(snap.data());
        docP.clients = { display: 1, control: peersCtl };
        P = docP; applyStatic(); render(); connState();
      }, function () { setConn(false, "Keine Verbindung"); });
    }
    setConn(false, "Verbinde …");
  }
  if (cap.room) {
    try {
      cap.room.onPeers(function (ch) {
        peersCtl = ch.peers.filter(function (p) { return !p.isMe && p.presence && p.presence.role === "control"; }).length;
        if (docP) docP.clients.control = peersCtl;
        connState(); if (P) updateQr();
      });
    } catch (e) {}
  }
  setInterval(function () { render(); }, 200);
  setInterval(connState, 3000);
  setTimeout(function () { $("hint").classList.add("gone"); }, 60000);

  /* ---------- Menü am iPad ---------- */
  function showNote(txt) {
    var n = $("dNote"); n.textContent = txt; n.hidden = false;
    clearTimeout(showNote._t); showNote._t = setTimeout(function () { n.hidden = true; }, 9000);
  }
  function stop(e) { e.stopPropagation(); }
  $("dMenuBtn").addEventListener("click", function (e) { stop(e); unlockAudio(); $("hint").classList.add("gone"); $("dMenu").hidden = !$("dMenu").hidden; updateMenu(); });
  $("dMenu").addEventListener("click", stop);
  $("dQuick").addEventListener("click", stop);
  $("dOverlay").addEventListener("click", stop);
  document.addEventListener("click", function () { $("dMenu").hidden = true; });
  $("qr").addEventListener("click", function (e) { stop(e); unlockAudio(); qrManual = false; updateQr(); });
  function updateMenu() {
    var isHost = mode === "host";
    $("dmQuick").hidden = !isHost || !host || !host.isHost;
    $("dmRole").textContent = (isHost ? "Dieses Gerät: Anzeige + Host" : "Dieses Gerät: zweite Anzeige") + (P2P ? " · Code " + cap.p2p.code : "");
    $("dmCode").hidden = !P2P || isHost;
    $("dmNewCode").hidden = !P2P || !isHost;
  }
  $("dmQr").addEventListener("click", function () { $("dMenu").hidden = true; qrManual = !qrVisible(); updateQr(); });
  $("dmFull").addEventListener("click", function () { $("dMenu").hidden = true; toggleFullscreen(); });
  $("dmQuick").addEventListener("click", function () { $("dMenu").hidden = true; $("dQuick").hidden = false; quickRender(); });
  $("dmSwitch").addEventListener("click", function () { $("dMenu").hidden = true; window.PCBoot.chooseRole(); });
  $("dmCode").addEventListener("click", function () { $("dMenu").hidden = true; window.PCBoot.changeCode(); });
  $("dmNewCode").addEventListener("click", function () {
    $("dMenu").hidden = true;
    $("dncOverlay").hidden = false;
  });
  $("dncYes").addEventListener("click", function () { PCLink.ls("pc-hostcode", PCPeer.newCode()); try { location.reload(); } catch (e) {} });
  $("dncNo").addEventListener("click", function () { $("dncOverlay").hidden = true; });
  $("dncOverlay").addEventListener("click", stop);
  window.__pcStatus = function () { connState(); updateMenu(); };

  /* ---------- Schnellsteuerung am iPad (z. B. wenn das Handy leer ist) ---------- */
  function quick(action) {
    if (!host || !host.isHost) return;
    host.applyLocal(action).catch(function (e) { showNote(e.message || "Fehler"); });
    setTimeout(quickRender, 50);
  }
  function quickRender() {
    if (!P || $("dQuick").hidden) return;
    var v = PC.computeView(P.state, Date.now()), t = P.state.tournament;
    $("dqPlay").textContent = v.running ? "⏸ Pause" : (v.startedOnce ? "▶ Weiter" : "▶ Turnier starten");
    $("dqPlay").classList.toggle("warn", v.running);
    $("dqPlayers").textContent = t.remaining + " / " + t.entries + " Spieler";
  }
  setInterval(quickRender, 500);
  $("dQuick").addEventListener("click", function (e) {
    var b = e.target.closest("[data-q]"); if (!b) return;
    var q = b.dataset.q;
    if (q === "close") { $("dQuick").hidden = true; return; }
    if (q === "adj") return quick({ type: "adjust", seconds: Number(b.dataset.s) });
    quick({ type: q });
  });

  /* ---------- Anderes Gerät ist Host ---------- */
  function updateOverlay() {
    var o = $("dOverlay");
    var show = mode === "host" && host && host.otherHost;
    o.hidden = !show;
  }
  $("doTake").addEventListener("click", function () {
    $("doTake").disabled = true;
    host.load().then(function () { host.becomeHost(); $("doTake").disabled = false; refreshFromHost(); });
  });
  $("doSecond").addEventListener("click", function () { window.PCBoot.setRole("display"); });
};
