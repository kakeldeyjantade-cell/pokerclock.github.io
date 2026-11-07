/* Pokerclock – Steuerung (Handy) */
window.startControl = function (cap, dev) {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var P = null, ST = null;
  var DEV = dev, db = cap.db, room = cap.room;

  /* ---------- Helfer ---------- */
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("on"); }, 1800);
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function getPath(o, path) { return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function buzz() { if (navigator.vibrate) navigator.vibrate(12); }

  /* ---------- Befehle ans iPad ----------
     Schneller Weg über „room“ (alle, die die Seite gerade offen haben), sicherer Weg über die db.
     Das iPad antwortet im Stand-Dokument (results); erst dann gilt ein Befehl als erledigt. */
  var pending = {};
  function hostPresent() {
    if (!room || !P) return false;
    try { return room.peers().some(function (p) { return p.presence && p.presence.role === "host" && p.presence.hostId === P.hostId; }); } catch (e) { return false; }
  }
  function writeCmd(cmd) {
    if (!db) return Promise.reject(new Error("offline"));
    return db.collection(PCLink.PATH.cmds).doc(cmd.id).set(cmd);
  }
  function act(type, extra) {
    var a = Object.assign({ type: type }, extra || {});
    if (!db) { toast("Keine Online-Verbindung – Seite in claude.ai öffnen"); return Promise.reject(new Error("__shown")); }
    var cmd = { id: PCLink.newId(DEV), t: Date.now(), by: DEV, a: a };
    return new Promise(function (resolve, reject) {
      var pd = pending[cmd.id] = { resolve: resolve, reject: reject, viaDb: false };
      var toDb = function () {
        if (pd.viaDb || !pending[cmd.id]) return;
        pd.viaDb = true;
        writeCmd(cmd).catch(function (e) {
          if (!pending[cmd.id]) return;
          delete pending[cmd.id]; clearTimeout(pd.t1); clearTimeout(pd.t2);
          var m = e && e.code === "invalid_argument" ? "Nur dein eigenes claude.ai-Konto darf steuern" : "Keine Verbindung – Internet prüfen";
          toast(m); reject(new Error("__shown"));
        });
      };
      var size = 0; try { size = JSON.stringify(cmd).length; } catch (e) {}
      if (room && hostPresent() && size < 3500) {
        room.emit("cmd", cmd).catch(function () { toDb(); });
        pd.t1 = setTimeout(toDb, 1500);
      } else toDb();
      pd.t2 = setTimeout(function () {
        if (!pending[cmd.id]) return;
        delete pending[cmd.id];
        toast("Das iPad antwortet nicht – ist die Pokerclock dort geöffnet?");
        reject(new Error("__shown"));
      }, 9000);
    }).catch(function (e) {
      if (e.message !== "__shown") toast(e.message);
      throw e;
    });
  }
  function settle(results) {
    Object.keys(pending).forEach(function (id) {
      var r = results[id]; if (!r) return;
      var pd = pending[id]; delete pending[id];
      clearTimeout(pd.t1); clearTimeout(pd.t2);
      if (r.ok) pd.resolve(P); else pd.reject(new Error(r.err || "Fehler"));
    });
  }
  function actQuiet(type, extra) { return act(type, extra).catch(function () {}); }

  /* ---------- Sheet (Auswahl / Bestätigung) ---------- */
  function sheet(title, text, buttons) {
    var s = $("sheet");
    s.innerHTML = "<h3>" + esc(title) + "</h3>" + (text ? "<p>" + esc(text) + "</p>" : "") +
      '<div class="grid"></div>';
    var g = s.querySelector(".grid");
    buttons.concat([{ label: "Abbrechen", cls: "ghost" }]).forEach(function (b) {
      var el = document.createElement("button");
      el.textContent = b.label; if (b.cls) el.className = b.cls;
      el.onclick = function () { closeSheet(); if (b.fn) b.fn(); };
      g.appendChild(el);
    });
    $("sheetBg").classList.add("on");
  }
  function closeSheet() { $("sheetBg").classList.remove("on"); }
  $("sheetBg").addEventListener("click", function (e) { if (e.target === this) closeSheet(); });
  function confirmDo(title, text, label, fn, cls) { sheet(title, text, [{ label: label, cls: cls || "danger", fn: fn }]); }

  // Abfrage mit Textfeld (z. B. Name eintragen)
  function promptSheet(title, text, placeholder, okLabel, value, cb) {
    var s = $("sheet");
    s.innerHTML = "<h3>" + esc(title) + "</h3>" + (text ? "<p>" + esc(text) + "</p>" : "") +
      '<input type="text" id="promptIn" autocomplete="off" maxlength="40" style="margin-bottom:10px" placeholder="' + esc(placeholder || "") + '">' +
      '<div class="grid"><button class="primary" id="promptOk"></button><button class="ghost" id="promptNo">Abbrechen</button></div>';
    $("promptOk").textContent = okLabel || "OK";
    $("promptIn").value = value || "";
    $("sheetBg").classList.add("on");
    setTimeout(function () { $("promptIn").focus(); }, 60);
    $("promptOk").onclick = function () { var v = $("promptIn").value.trim(); closeSheet(); cb(v); };
    $("promptIn").onkeydown = function (e) { if (e.key === "Enter") $("promptOk").click(); };
    $("promptNo").onclick = closeSheet;
  }

  /* ---------- Tabs ---------- */
  function showTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("on", t.id === "tab-" + name); });
    document.querySelectorAll("nav.tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === name); });
    document.body.classList.toggle("not-live", name !== "live");
    try { sessionStorage.setItem("pokerclock-tab", name); } catch (e) {}
    window.scrollTo(0, 0);
    if (name === "blinds") renderLevels(true);
    if (name === "historie") { histShowArchive(); }
  }
  document.querySelectorAll("nav.tabs button").forEach(function (b) {
    b.addEventListener("click", function () { showTab(b.dataset.tab); });
  });

  /* ---------- Einstellungen binden ---------- */
  var timers = {};
  function sendSet(path, val) { delete timers[path]; actQuiet("set", { path: path, value: val }); }
  function readVal(el) {
    if (el.type === "checkbox") return el.checked;
    if (el.type === "number" || el.type === "range") {
      if (el.value === "" || isNaN(Number(el.value))) return undefined;
      return Number(el.value);
    }
    return el.value;
  }
  var LIVE_LABEL = { "sound.volume": "volVal", "sound.voiceRate": "rateVal", "sound.voiceVolume": "vvolVal" };
  function bindEl(el) {
    if (el._bound) return; el._bound = true;
    var path = el.dataset.bind;
    var instant = el.type === "checkbox" || el.type === "radio";
    el.addEventListener(instant ? "change" : "input", function () {
      if (el.type === "radio" && !el.checked) return;
      var v = readVal(el);
      if (v === undefined) return;
      if (LIVE_LABEL[path]) $(LIVE_LABEL[path]).textContent = v;
      clearTimeout(timers[path]);
      if (instant) sendSet(path, v);
      else timers[path] = setTimeout(function () { sendSet(path, v); }, el.type === "range" ? 150 : 550);
    });
    if (!instant) el.addEventListener("change", function () {
      var v = readVal(el);
      if (v === undefined) return;
      if (timers[path]) { clearTimeout(timers[path]); sendSet(path, v); }
    });
  }
  document.querySelectorAll("[data-bind]").forEach(bindEl);
  function fillBinds() {
    document.querySelectorAll("[data-bind]").forEach(function (el) {
      var path = el.dataset.bind;
      if (el === document.activeElement || timers[path]) return;
      var v = getPath(ST, path);
      if (v === undefined) return;
      if (el.type === "checkbox") el.checked = !!v;
      else if (el.type === "radio") el.checked = el.value === String(v);
      else if (String(el.value) !== String(v)) el.value = v;
    });
    Object.keys(LIVE_LABEL).forEach(function (k) { $(LIVE_LABEL[k]).textContent = getPath(ST, k); });
    document.querySelectorAll("#annList .ann").forEach(function (row) {
      var c = (ST.sound.announce || {})[row.dataset.k];
      row.classList.toggle("off", !(c && c.on));
    });
  }

  // Hinweis, wenn am iPad der Ton noch nicht freigeschaltet ist
  function soundToast(okText) {
    if (!P || !P.clients || !P.clients.display) toast("Die Anzeige am iPad ist nicht geöffnet");
    else if (!P.speakerAudio) toast("Am iPad einmal auf die Anzeige tippen – Ton ist noch gesperrt");
    else toast(okText);
  }

  /* ---------- Sprachansagen: Liste der Ansagen ---------- */
  var annKeys = "";
  function buildAnnList() {
    var info = P.announceInfo || [];
    var keys = info.map(function (x) { return x.key; }).join(",");
    if (keys === annKeys) return;
    annKeys = keys;
    $("annList").innerHTML = info.map(function (x) {
      return '<div class="ann" data-k="' + x.key + '"><div class="ann-top"><span class="ann-lbl">' + esc(x.label) + '</span>' +
        '<button class="ann-play" data-prev="' + x.key + '" aria-label="Vorhören">▶</button>' +
        '<label class="sw"><input type="checkbox" data-bind="sound.announce.' + x.key + '.on"><i></i></label></div>' +
        '<textarea rows="2" data-bind="sound.announce.' + x.key + '.text"></textarea></div>';
    }).join("");
    $("annList").querySelectorAll("[data-bind]").forEach(bindEl);
    $("phList").innerHTML = PC.ANNOUNCE_PLACEHOLDERS.map(function (p) {
      return '<div class="ph"><code>' + esc(p[0]) + '</code><span>' + esc(p[1]) + '</span></div>';
    }).join("");
  }
  $("annList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-prev]"); if (!b) return;
    var k = b.dataset.prev;
    var go = function () { actQuiet("preview", { event: k }).then(function () { soundToast("Spielt auf dem iPad …"); }); };
    // geänderten Text erst speichern, dann vorhören
    var path = "sound.announce." + k + ".text";
    if (timers[path]) { clearTimeout(timers[path]); var ta = document.querySelector('[data-bind="' + path + '"]');
      act("set", { path: path, value: ta.value }).then(go).catch(function () {}); delete timers[path]; }
    else go();
  });
  $("bAnnReset").addEventListener("click", function () {
    confirmDo("Alle Ansagetexte zurücksetzen?", "Die Schalter und Texte gehen auf die Standardwerte zurück.", "Zurücksetzen",
      function () { actQuiet("resetAnnounce").then(function () { toast("Standardtexte wiederhergestellt"); }); }, "primary");
  });

  /* ---------- Sprachansagen: Stimme ---------- */
  var voicesSig = "";
  function voiceLabel(v) {
    var g = PC.voiceGender(v.name), q = PC.voiceQuality(v.name);
    return v.name + " (" + v.lang + ")" + (g === "f" ? " ♀" : g === "m" ? " ♂" : "") +
      (q === "premium" ? " · Premium" : q === "enhanced" ? " · erweitert" : "") + (v.local === false ? " · braucht Internet" : "");
  }
  function buildVoices(force) {
    var vs = P.voices || [], sel = $("voiceSel");
    var fem = $("vFemale").checked, all = $("vAll").checked;
    var sig = JSON.stringify(vs) + fem + all + ST.sound.voiceName;
    if (!force && sig === voicesSig) return;
    voicesSig = sig;
    if (document.activeElement === sel) return;
    var best = PC.bestVoice(vs);
    var list = vs.filter(function (v) { return all || PC.isGerman(v.lang); });
    var femList = list.filter(function (v) { return PC.voiceGender(v.name) === "f"; });
    var shown = fem && femList.length ? femList : list;
    shown = shown.slice().sort(function (a, b) { return PC.voiceScore(b) - PC.voiceScore(a); });
    var cur = ST.sound.voiceName || "";
    if (cur && !shown.some(function (v) { return v.name === cur; })) {
      var c = vs.find(function (v) { return v.name === cur; });
      shown.unshift(c || { name: cur, lang: "?", local: true });
    }
    sel.innerHTML = '<option value="">Automatisch' + (best ? " – " + esc(best.name) : "") + '</option>' +
      shown.map(function (v) { return '<option value="' + esc(v.name) + '">' + esc(voiceLabel(v)) + '</option>'; }).join("");
    sel.value = cur;
    var info;
    if (!vs.length) info = "Noch keine Stimmenliste vom iPad. Die Anzeige am iPad öffnen und einmal antippen.";
    else if (fem && !femList.length) info = "Keine Stimme eindeutig als Frauenstimme erkannt – alle deutschen Stimmen werden gezeigt. Bitte per Hörprobe auswählen.";
    else info = vs.filter(function (v) { return PC.isGerman(v.lang); }).length + " deutsche Stimmen auf dem iPad. ♀/♂ wird am Namen erkannt – im Zweifel die Hörprobe nutzen.";
    $("voiceInfo").textContent = info;
  }
  $("voiceSel").addEventListener("change", function () { actQuiet("set", { path: "sound.voiceName", value: this.value }); });
  $("vFemale").addEventListener("change", function () { buildVoices(true); });
  $("vAll").addEventListener("change", function () { buildVoices(true); });
  $("bVoiceTest").addEventListener("click", function () {
    actQuiet("voicePreview", { voice: $("voiceSel").value }).then(function () { soundToast("Hörprobe läuft auf dem iPad …"); });
  });

  // ElevenLabs-Stimme (eingebaut) oder Gerätestimme
  function updateEngine() {
    var av = !!(window.PCVoice && PCVoice.available());
    var eleven = av && ST.sound.voiceEngine !== "browser";
    $("engineRow").classList.toggle("hidden", !av);
    $("browserVoice").classList.toggle("hidden", eleven);
    $("engineInfo").textContent = !av ? "" : eleven
      ? "Feste englische Kurz-Ansagen, z. B. „Blinds up. Small blind: 500. Big blind: 1,000.“ Die Schalter unten gelten, die Texte nur für die iPad-Stimme."
      : "Die iPad-Stimme spricht deine eigenen Texte unten.";
    document.querySelectorAll("#annList textarea").forEach(function (t) { t.classList.toggle("hidden", eleven); });
    $("clipCard").classList.toggle("hidden", !eleven);
    if (eleven) { buildClips(); updateClips(); }
    var rate = document.querySelector('#voiceCard [data-bind="sound.voiceRate"]');
    if (rate) rate.closest("label").classList.toggle("hidden", eleven);
    document.querySelectorAll("#voiceCard details.tip").forEach(function (d) { d.classList.toggle("hidden", eleven); });
  }

  /* ---------- Liberty X: einzelne Bausteine an/aus ---------- */
  var clipsBuilt = false;
  function clipGroup(k) { return /^n\d+$/.test(k) ? "num" : /^d_/.test(k) ? "dur" : "phr"; }
  function buildClips() {
    if (clipsBuilt || !(window.PCVoice && PCVoice.available())) return;
    clipsBuilt = true;
    var html = { phr: "", dur: "", num: "" };
    PCVoice.list().forEach(function (c) {
      var g = clipGroup(c.key);
      var lbl = g === "num" ? PC.fmtNum(Number(c.key.slice(1))) + "<small>" + esc(c.text) + "</small>" : "„" + esc(c.text) + "“";
      html[g] += '<div class="ann" data-ck="' + esc(c.key) + '"><div class="ann-top"><span class="ann-lbl">' + lbl + "</span>" +
        '<button class="ann-play" data-cprev="' + esc(c.key) + '" aria-label="Vorhören">▶</button>' +
        '<label class="sw"><input type="checkbox" data-clip="' + esc(c.key) + '" checked><i></i></label></div></div>';
    });
    document.querySelectorAll(".clipgrp").forEach(function (d) { d.querySelector(".cliplist").innerHTML = html[d.dataset.grp]; });
  }
  function updateClips() {
    if (!clipsBuilt) return;
    var off = (ST.sound && ST.sound.voiceOff) || {}, cnt = { phr: 0, dur: 0, num: 0 };
    document.querySelectorAll("[data-clip]").forEach(function (cb) {
      var k = cb.dataset.clip, isOff = !!off[k];
      if (cb !== document.activeElement) cb.checked = !isOff;
      cb.closest(".ann").classList.toggle("off", isOff);
      if (isOff) cnt[clipGroup(k)]++;
    });
    document.querySelectorAll(".clipgrp").forEach(function (d) {
      var n = cnt[d.dataset.grp]; d.querySelector(".cnt").textContent = n ? n + " aus" : "";
    });
  }
  $("clipCard").addEventListener("change", function (e) {
    var cb = e.target.closest("[data-clip]"); if (!cb) return;
    cb.closest(".ann").classList.toggle("off", !cb.checked);
    actQuiet("voiceClip", { key: cb.dataset.clip, on: cb.checked });
  });
  $("clipCard").addEventListener("click", function (e) {
    var b = e.target.closest("[data-cprev]"); if (!b) return;
    actQuiet("clipPreview", { key: b.dataset.cprev }).then(function () { soundToast("Spielt auf dem iPad …"); });
  });
  $("bClipReset").addEventListener("click", function () {
    confirmDo("Alle Bausteine einschalten?", "Abgeschaltete Bausteine werden wieder verwendet.", "Einschalten",
      function () { actQuiet("voiceClipsReset").then(function () { toast("Alle Bausteine an"); }); }, "primary");
  });

  /* ---------- Live-Bedienung ---------- */
  function togglePlay() { buzz(); actQuiet("toggle"); }
  $("bPlay").addEventListener("click", togglePlay);
  $("mPlay").addEventListener("click", togglePlay);
  document.querySelectorAll("[data-act]").forEach(function (b) {
    b.addEventListener("click", function () {
      buzz();
      var go = function () { actQuiet(b.dataset.act); };
      if (b.dataset.confirm) confirmDo(b.dataset.confirm, "", "Ja", go, "primary"); else go();
    });
  });
  document.querySelectorAll("[data-adj]").forEach(function (b) {
    b.addEventListener("click", function () { buzz(); actQuiet("adjust", { seconds: Number(b.dataset.adj) }); });
  });
  document.querySelectorAll("[data-pl]").forEach(function (b) {
    b.addEventListener("click", function () { buzz(); actQuiet("players", { field: b.dataset.pl, delta: Number(b.dataset.d) }); });
  });
  $("bSetTime").addEventListener("click", function () {
    var m = Number($("setMin").value || 0), s = Number($("setSec").value || 0);
    if (isNaN(m) || isNaN(s) || m < 0 || s < 0) return toast("Ungültige Zeit");
    act("setRemaining", { seconds: m * 60 + s }).then(function () {
      toast("Zeit gesetzt: " + PC.fmtTime((m * 60 + s) * 1000)); $("setMin").value = ""; $("setSec").value = "";
      document.activeElement && document.activeElement.blur();
    }).catch(function () {});
  });
  document.querySelectorAll("[data-msg]").forEach(function (b) {
    b.addEventListener("click", function () {
      var ta = document.querySelector('[data-bind="display.message"]');
      ta.value = b.dataset.msg;
      act("set", { path: "display.message", value: b.dataset.msg }).then(function () {
        return act("set", { path: "display.showMessage", value: true });
      }).then(function () { toast("Hinweis wird angezeigt"); }).catch(function () {});
    });
  });

  /* ---------- Blindstruktur ---------- */
  var NICE = [10, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000,
    6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000, 120000, 150000, 200000, 250000,
    300000, 400000, 500000, 600000, 800000, 1000000, 1200000, 1500000, 2000000];
  var draft = null, levelsDirty = false, levelsTimer = null;

  function uid() { return Math.random().toString(16).slice(2, 10); }
  function suggestAfter(levels, i) {
    var base = null;
    for (var k = i; k >= 0; k--) if (levels[k] && levels[k].type !== "break") { base = levels[k]; break; }
    if (!base) return { id: uid(), type: "level", sb: 100, bb: 200, ante: 0, minutes: 20 };
    var bb = NICE.find(function (n) { return n > base.bb * 1.15; }) || Math.round(base.bb * 1.5);
    return { id: uid(), type: "level", sb: Math.round(bb / 2), bb: bb, ante: base.ante > 0 ? bb : 0, minutes: base.minutes };
  }
  function lastBreakMinutes(levels) {
    for (var k = levels.length - 1; k >= 0; k--) if (levels[k].type === "break") return levels[k].minutes;
    return 10;
  }
  function sendLevels(immediate) {
    clearTimeout(levelsTimer);
    var go = function () {
      levelsTimer = null;
      var snapshot = draft.map(function (l) { return Object.assign({}, l); });
      act("levels", { levels: snapshot }).then(function () { levelsDirty = false; maybeRerender(); })
        .catch(function () { levelsDirty = false; });
    };
    if (immediate) go(); else levelsTimer = setTimeout(go, 700);
  }
  function maybeRerender() {
    var ae = document.activeElement;
    if (levelsTimer || (ae && ae.closest && ae.closest("#lvlList"))) return;
    renderLevels(true);
  }
  function structural(fn) { // Änderung an der Struktur, sofort senden
    if (!draft) draft = ST.levels.map(function (l) { return Object.assign({}, l); });
    clearTimeout(levelsTimer); levelsTimer = null;
    fn(draft);
    renderLevels(false);
    sendLevels(true);
  }

  function renderLevels(fromServer) {
    if (!ST) return;
    if (fromServer) draft = ST.levels.map(function (l) { return Object.assign({}, l); });
    var cur = curView ? curView.index : ST.clock.levelIndex;
    var html = "", n = 0;
    draft.forEach(function (lv, i) {
      var cls = "lvl" + (lv.type === "break" ? " brk" : "") + (i === cur ? " current" : i < cur ? " past" : "");
      if (lv.type === "break") {
        html += '<div class="' + cls + '" data-i="' + i + '"><div class="no">☕</div>' +
          '<div class="brk-lbl">Pause</div>' +
          '<input type="number" inputmode="decimal" data-f="minutes" value="' + lv.minutes + '">' +
          '<button class="more" data-more="' + i + '" aria-label="Optionen">⋯</button></div>';
      } else {
        n++;
        html += '<div class="' + cls + '" data-i="' + i + '"><div class="no">' + n + '</div>' +
          '<input type="number" inputmode="numeric" data-f="sb" value="' + lv.sb + '">' +
          '<input type="number" inputmode="numeric" data-f="bb" value="' + lv.bb + '">' +
          '<input type="number" inputmode="numeric" data-f="ante" value="' + lv.ante + '">' +
          '<input type="number" inputmode="decimal" data-f="minutes" value="' + lv.minutes + '">' +
          '<button class="more" data-more="' + i + '" aria-label="Optionen">⋯</button></div>';
      }
    });
    $("lvlList").innerHTML = html;
    updateSummary();
  }
  function updateLevelClasses() {
    if (!curView) return;
    var cur = curView.index;
    document.querySelectorAll("#lvlList .lvl").forEach(function (row) {
      var i = Number(row.dataset.i);
      row.classList.toggle("current", i === cur);
      row.classList.toggle("past", i < cur);
    });
  }
  function updateSummary() {
    if (!draft) return;
    var nl = 0, nb = 0, total = 0, rest = 0;
    draft.forEach(function (l, i) {
      if (l.type === "break") nb++; else nl++;
      total += Number(l.minutes) || 0;
    });
    if (curView) {
      rest = curView.remainingMs;
      for (var k = curView.index + 1; k < draft.length; k++) rest += PC.durMs(draft[k]);
    }
    var hm = function (min) { var h = Math.floor(min / 60), m = Math.round(min % 60); return h + ":" + PC.pad(m) + " h"; };
    var end = new Date(Date.now() + rest);
    $("bSum").innerHTML = nl + " Level · " + nb + " Pausen · gesamt " + hm(total) +
      (curView ? "<br>Restdauer " + hm(rest / 60000) + " · Ende ca. " + PC.fmtClockTime(end) + " Uhr" : "");
  }
  $("lvlList").addEventListener("input", function (e) {
    var inp = e.target; if (!inp.dataset.f) return;
    var i = Number(inp.closest(".lvl").dataset.i);
    var v = inp.value === "" ? null : Number(inp.value);
    if (v === null || isNaN(v) || v < 0) return;
    if (inp.dataset.f === "minutes" && v <= 0) return;
    draft[i][inp.dataset.f] = v;
    // Small Blind automatisch = halber Big Blind, wenn er vorher genau die Hälfte war
    levelsDirty = true;
    sendLevels(false);
    updateSummary();
  });
  $("lvlList").addEventListener("focusout", function () {
    setTimeout(function () {
      if (levelsTimer) { sendLevels(true); }
      else maybeRerender();
    }, 30);
  });
  $("lvlList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-more]"); if (!b) return;
    var i = Number(b.dataset.more), lv = draft[i];
    var name = lv.type === "break" ? "Pause" : "Level " + PC.levelNumber(draft, i) + " (" + PC.fmtNum(lv.sb) + " / " + PC.fmtNum(lv.bb) + ")";
    sheet(name, "", [
      { label: "▶ Jetzt zu " + (lv.type === "break" ? "dieser Pause" : "diesem Level") + " springen", cls: "primary", fn: function () { actQuiet("jump", { index: i }); } },
      { label: "Level darunter einfügen", fn: function () { structural(function (d) { d.splice(i + 1, 0, suggestAfter(d, i)); }); } },
      { label: "Pause darunter einfügen", fn: function () { structural(function (d) { d.splice(i + 1, 0, { id: uid(), type: "break", sb: 0, bb: 0, ante: 0, minutes: lastBreakMinutes(d) }); }); } },
      { label: "↑ Nach oben", fn: function () { if (i > 0) structural(function (d) { var t = d[i]; d[i] = d[i - 1]; d[i - 1] = t; }); } },
      { label: "↓ Nach unten", fn: function () { if (i < draft.length - 1) structural(function (d) { var t = d[i]; d[i] = d[i + 1]; d[i + 1] = t; }); } },
      { label: "Löschen", cls: "danger", fn: function () {
        if (draft.length <= 1) return toast("Mindestens ein Level nötig");
        structural(function (d) { d.splice(i, 1); });
      } }
    ]);
  });
  $("addLevel").addEventListener("click", function () {
    structural(function (d) { d.push(suggestAfter(d, d.length - 1)); });
    toast("Level hinzugefügt");
  });
  $("addBreak").addEventListener("click", function () {
    structural(function (d) { d.push({ id: uid(), type: "break", sb: 0, bb: 0, ante: 0, minutes: lastBreakMinutes(d) }); });
    toast("Pause hinzugefügt");
  });
  $("tLvlApply").addEventListener("click", function () {
    var m = Number($("tLvlMin").value); if (!(m > 0)) return toast("Ungültige Dauer");
    structural(function (d) { d.forEach(function (l) { if (l.type !== "break") l.minutes = m; }); });
    toast("Alle Level: " + m + " min");
  });
  $("tBrkApply").addEventListener("click", function () {
    var m = Number($("tBrkMin").value); if (!(m > 0)) return toast("Ungültige Dauer");
    structural(function (d) { d.forEach(function (l) { if (l.type === "break") l.minutes = m; }); });
    toast("Alle Pausen: " + m + " min");
  });
  $("tAnteApply").addEventListener("click", function () {
    var from = Number($("tAnteFrom").value); if (!(from >= 1)) return toast("Ungültiges Level");
    structural(function (d) {
      var n = 0;
      d.forEach(function (l) { if (l.type === "break") return; n++; l.ante = n >= from ? l.bb : 0; });
    });
    toast("Ante = Big Blind ab Level " + from);
  });
  $("tAnteNone").addEventListener("click", function () {
    confirmDo("Alle Antes entfernen?", "", "Entfernen", function () {
      structural(function (d) { d.forEach(function (l) { l.ante = 0; }); });
    });
  });
  $("tDefault").addEventListener("click", function () {
    confirmDo("Standard-Struktur laden?", "Deine aktuelle Blindstruktur wird ersetzt.", "Standard laden", function () {
      var d = defaultLevels();
      draft = d; renderLevels(false); sendLevels(true);
    });
  });
  function defaultLevels() {
    var L = function (sb, bb, a) { return { id: uid(), type: "level", sb: sb, bb: bb, ante: a || 0, minutes: 20 }; };
    var B = function () { return { id: uid(), type: "break", sb: 0, bb: 0, ante: 0, minutes: 10 }; };
    return [L(100, 300), L(200, 400), L(300, 600), L(400, 800), B(),
      L(500, 1000, 1000), L(600, 1200, 1200), L(800, 1600, 1600), L(1000, 2000, 2000), B(),
      L(1200, 2400, 2400), L(1500, 3000, 3000), L(2000, 4000, 4000), L(2500, 5000, 5000), B(),
      L(3000, 6000, 6000), L(4000, 8000, 8000), L(5000, 10000, 10000), L(6000, 12000, 12000), B(),
      L(8000, 16000, 16000), L(10000, 20000, 20000), L(12000, 24000, 24000), L(15000, 30000, 30000),
      L(20000, 40000, 40000), L(25000, 50000, 50000), L(30000, 60000, 60000), L(40000, 80000, 80000)];
  }

  /* ---------- Turnier-Tab ---------- */
  $("bResetClock").addEventListener("click", function () {
    confirmDo("Uhr zurücksetzen?", "Zurück auf Level 1, Uhr gestoppt. Struktur und Einstellungen bleiben.", "Zurücksetzen", function () { actQuiet("resetClock"); });
  });
  $("bResetAll").addEventListener("click", function () {
    confirmDo("Alles zurücksetzen?", "Struktur, Turnierdaten und Anzeige-Einstellungen gehen auf Standard zurück.", "Alles zurücksetzen", function () {
      act("resetAll").then(function () { renderLevels(true); toast("Zurückgesetzt"); }).catch(function () {});
    });
  });
  $("bTest").addEventListener("click", function () { actQuiet("ping", { kind: "test" }).then(function () { soundToast("Test-Ton gesendet"); }); });

  /* ---------- Turnierablauf: Bustouts, Ende, neues Turnier ---------- */
  var snackTimer = null, snackRef = null;
  function snack(text, ref) {
    $("snackTxt").textContent = text; snackRef = ref;
    $("snackBtn").style.display = ref ? "" : "none";
    $("snack").classList.add("on");
    clearTimeout(snackTimer); snackTimer = setTimeout(function () { $("snack").classList.remove("on"); }, 7000);
  }
  $("snackBtn").addEventListener("click", function () {
    $("snack").classList.remove("on");
    if (!snackRef) return;
    var r = snackRef;
    promptSheet("Name eintragen", "Platz " + r.place + " – der Name erscheint in der Turnierhistorie.", "Name", "Speichern", "", function (name) {
      if (name) actQuiet("nameBust", { tid: r.tid, ref: r.ref, name: name }).then(function () { toast("Name gespeichert"); });
    });
  });
  $("bBust").addEventListener("click", function () {
    buzz();
    act("bust").then(function (p) {
      var h = p.state.history || {}, t = p.state.tournament;
      var lb = h.lastBust;
      if (h.activeId && t.remaining === 1) { askFinish(); return; }
      snack((lb ? "Platz " + lb.place + " ausgeschieden" : "Spieler ausgeschieden") + " · noch " + t.remaining, h.activeId ? lb : null);
    }).catch(function () {});
  });
  $("bUndoBust").addEventListener("click", function () {
    confirmDo("Letzten Bustout zurücknehmen?", "Der Spieler zählt wieder als im Turnier. Der Bustout bleibt in der Historie als zurückgenommen sichtbar.",
      "Zurücknehmen", function () { act("undoBust").then(function () { toast("Bustout zurückgenommen"); }).catch(function () {}); }, "primary");
  });
  function askFinish() {
    var one = ST && ST.tournament.remaining === 1;
    promptSheet(one ? "Nur noch 1 Spieler – Turnier beenden?" : "Turnier beenden?",
      "Das Turnier wird abgeschlossen und im Archiv gespeichert. Name des Siegers (optional):", "Name des Siegers", "🏁 Turnier beenden", "",
      function (name) { act("finish", { winner: name }).then(function () { toast("Turnier beendet und archiviert"); }).catch(function () {}); });
  }
  $("bFinish").addEventListener("click", askFinish);
  $("bNewTour").addEventListener("click", function () {
    var active = ST && ST.history && ST.history.activeId;
    confirmDo("Neues Turnier vorbereiten?", (active ? "Das laufende Turnier wird als abgebrochen archiviert. " : "") +
      "Uhr auf Level 1, Spieler, Rebuys und Add-ons auf 0. Blindstruktur und Einstellungen bleiben.", "Vorbereiten",
      function () { actQuiet("newTournament").then(function () { toast("Bereit für ein neues Turnier"); }); }, "primary");
  });
  function updateLifecycle() {
    var h = ST.history || {}, active = !!h.activeId;
    $("bFinish").classList.toggle("hidden", !active);
    $("bUndoBust").disabled = !active || !h.openBusts;
    $("lifeState").textContent = active ? "Turnier läuft und wird aufgezeichnet." :
      h.status === "finished" ? "Letztes Turnier ist beendet und archiviert." :
      ST.clock.startedOnce ? "Uhr läuft ohne Aufzeichnung." : "Die Aufzeichnung startet automatisch mit „Turnier starten“.";
  }

  /* ---------- Historie (nur in der Steuerung) ---------- */
  var histOpenId = null, histData = null, histTimer = null, histView = "summary";
  function histIndex() {
    if (!db) return Promise.reject(new Error("offline"));
    return PCLink.timeout(db.collection(PCLink.PATH.hist).get(), 10000).then(function (qs) {
      var act = ST && ST.history ? ST.history.activeId : "";
      var items = qs.docs.map(function (d) { var x = Object.assign({}, d.data()); x.id = x.id || d.id; x.live = !!act && act === x.id; return x; })
        .filter(function (x) { return x.startedAt; });
      items.sort(function (a, b) { return (b.startedAt || 0) - (a.startedAt || 0); });
      return { items: items, activeId: act };
    });
  }
  function histDetail(id) {
    return PCLink.timeout(PCLink.loadEvents(db, id), 10000).then(function (evs) {
      if (!evs.length) throw new Error("Turnier nicht gefunden");
      return { summary: PCEngine.summarize(evs, ST && ST.history ? ST.history.activeId : "", Date.now()), events: evs };
    });
  }
  function fmtDate(ms) { var d = new Date(ms); return PC.pad(d.getDate()) + "." + PC.pad(d.getMonth() + 1) + "." + d.getFullYear() + ", " + PC.fmtClockTime(d) + " Uhr"; }
  function fmtTimeS(ms) { var d = new Date(ms); return PC.fmtClockTime(d) + ":" + PC.pad(d.getSeconds()); }
  function fmtDur(ms) {
    if (ms == null) return "–";
    var m = Math.round(ms / 60000), h = Math.floor(m / 60);
    return h ? h + " h " + PC.pad(m % 60) + " min" : m + " min";
  }
  function fmtMS(ms) { var sgn = ms < 0 ? "−" : ""; return sgn + PC.fmtTime(Math.abs(ms)); }
  function money(v, cur) { return v == null ? "–" : PC.fmtMoney(v, cur); }
  var STATUS = { running: "läuft", finished: "beendet", aborted: "abgebrochen" };
  function badge(st) { return '<span class="badge ' + st + '">' + (STATUS[st] || st) + "</span>"; }

  function histShowArchive() {
    histOpenId = null;
    $("histDetail").hidden = true; $("histArchive").hidden = false;
    histIndex().then(function (j) {
      var items = j.items || [];
      if (!items.length) { $("histList").innerHTML = '<div class="muted">Noch keine Turniere aufgezeichnet. Die Aufzeichnung beginnt mit „Turnier starten“.</div>'; return; }
      $("histList").innerHTML = items.map(function (it) {
        return '<button class="hitem" data-hid="' + esc(it.id) + '"><b>' + esc(it.title || "Turnier") + "</b>" + badge(it.status) +
          '<div class="meta">' + fmtDate(it.startedAt) + "</div>" +
          '<div class="meta">' + (it.entries != null ? it.entries + " Teilnehmer" : "") + " · " + fmtDur(it.durationMs) +
          (it.pool ? " · Preispool " + money(it.pool, it.currency) : "") + (it.winner ? " · 🏆 " + esc(it.winner) : "") + "</div></button>";
      }).join("");
    }).catch(function () { $("histList").innerHTML = '<div class="muted">Historie konnte nicht geladen werden – Internet prüfen und erneut öffnen.</div>'; });
  }
  $("histList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-hid]"); if (!b) return;
    histOpen(b.dataset.hid);
  });
  $("histBack").addEventListener("click", function () { histShowArchive(); window.scrollTo(0, 0); });
  document.querySelectorAll('#hdSeg input').forEach(function (r) {
    r.addEventListener("change", function () { if (r.checked) { histView = r.value; histRender(); } });
  });
  function histOpen(id) {
    histOpenId = id;
    $("histArchive").hidden = true; $("histDetail").hidden = false;
    $("hdHead").innerHTML = '<div class="muted">Lade …</div>'; $("hdBody").innerHTML = "";
    window.scrollTo(0, 0);
    histRefresh();
  }
  function histRefresh() {
    if (!histOpenId) return;
    var id = histOpenId;
    histDetail(id).then(function (j) {
      if (histOpenId !== id) return;
      histData = j; histRender();
    }).catch(function () { if (histOpenId === id) $("hdHead").innerHTML = '<div class="muted">Konnte nicht geladen werden – Internet prüfen.</div>'; });
  }
  // nach einer Änderung: kurz warten, bis das iPad die Historie gespeichert hat
  function histRefreshSoon() { histRefresh(); setTimeout(histRefresh, 900); setTimeout(histRefresh, 2500); }
  // läuft das geöffnete Turnier noch, bei Änderungen nachladen (ohne den Livebetrieb zu berühren)
  function histMaybeRefresh() {
    if (!histOpenId || !document.getElementById("tab-historie").classList.contains("on")) return;
    if (!histData || histData.summary.status !== "running") return;
    clearTimeout(histTimer); histTimer = setTimeout(histRefresh, 1200);
  }

  function lvTxt(l) {
    if (!l) return "–";
    if (l.type === "break") return "Pause (" + l.minutes + " min)";
    return "Level " + l.number + ": " + PC.fmtNum(l.sb) + " / " + PC.fmtNum(l.bb) + (l.ante ? " · Ante " + PC.fmtNum(l.ante) : "");
  }
  function evText(e, names, byId, cur) {
    var d = e.data || {}, sn = e.snap || {};
    var poolTxt = d.pool ? "<small>Preispool " + money(d.pool.old, cur) + " → " + money(d.pool.new, cur) + " (" + (d.pool.diff > 0 ? "+" : "") + money(d.pool.diff, cur) + ")</small>" : "";
    switch (e.type) {
      case "start": return ["🚦", "Turnier gestartet – " + (d.config ? d.config.entries : "?") + " Teilnehmer<small>" + lvTxt(d.startLevel) + (d.totals && d.totals.pool ? " · Preispool " + money(d.totals.pool, cur) : "") + "</small>"];
      case "level":
        if (d.to && d.to.type === "break") return ["☕", "Pause beginnt (" + d.to.minutes + " min geplant)<small>" + esc(d.cause || "") + "</small>"];
        return ["⬆️", lvTxt(d.to) + "<small>" + esc(d.cause || "") + "</small>"];
      case "break_start": return null;   // steht schon beim Levelwechsel in die Pause
      case "break_end": return ["▶️", "Pause vorbei<small>Dauer " + fmtMS(d.actualMs || 0) + "</small>"];
      case "clock_pause": return ["⏸", "Uhr angehalten"];
      case "clock_resume": return ["▶️", "Uhr läuft weiter" + (d.pausedMs != null ? "<small>angehalten für " + fmtMS(d.pausedMs) + "</small>" : "")];
      case "time": return ["⏱", esc(d.kind) + "<small>" + fmtMS(d.oldMs) + " → " + fmtMS(d.newMs) + "</small>"];
      case "bust": return ["❌", "Platz " + d.place + " ausgeschieden" + (names[e.id] ? " – " + esc(names[e.id]) : "") +
        "<small>Bustout Nr. " + d.order + " · noch " + d.remainingAfter + " Spieler · " + lvTxt(d.level) + "</small>" + poolTxt];
      case "bust_revert": var b = byId[d.ref]; return ["↶", "Bustout zurückgenommen" + (b ? " (Platz " + b.data.place + ")" : "") + "<small>wieder " + d.remainingAfter + " Spieler</small>" + poolTxt];
      case "name": var bb = byId[d.ref]; return ["✏️", "Name eingetragen: " + esc(d.name) + "<small>" + (d.ref === "winner" ? "Sieger" : bb ? "Platz " + bb.data.place : "") + "</small>"];
      case "entry": return ["➕", (d.delta > 0 ? "Neuer Spieler (Entry)" : "Entry entfernt") + "<small>jetzt " + d.entries + " Teilnehmer</small>" + poolTxt];
      case "rebuy": return ["🔁", (d.delta > 0 ? "Rebuy" : "Rebuy storniert") + "<small>gesamt " + d.count + "</small>" + poolTxt];
      case "addon": return ["➕", (d.delta > 0 ? "Add-on" : "Add-on storniert") + "<small>gesamt " + d.count + "</small>" + poolTxt];
      case "correction": return ["✏️", "Korrektur " + esc(d.label) + ": " + esc(String(d.old)) + " → " + esc(String(d.new)) + "<small>" + esc(d.source || "") + "</small>" + poolTxt];
      case "message": return ["💬", "Hinweis angezeigt: „" + esc(d.text) + "“"];
      case "structure": return ["🧩", "Blindstruktur geändert<small>" + d.levels + " Einträge</small>"];
      case "timeout": return ["⌛", "Letztes Level abgelaufen"];
      case "end": return ["🏁", "Turnier beendet" + (d.winner ? " – Sieger: " + esc(d.winner) : "") + "<small>Dauer " + fmtDur(d.durationMs) + (d.totals ? " · Preispool " + money(d.totals.pool, cur) : "") + "</small>"];
      case "abort": return ["⛔", "Aufzeichnung beendet: " + esc(d.reason || "")];
      case "reopen": return ["🔓", "Turnier wieder geöffnet"];
    }
    return ["•", esc(e.type)];
  }
  var tlNewest = false;
  function histRender() {
    if (!histData) return;
    var sm = histData.summary, evs = histData.events, cur = sm.currency;
    var names = {}, byId = {};
    evs.forEach(function (e) { byId[e.id] = e; if (e.type === "name") names[e.data.ref] = e.data.name; });
    var latestFinished = ST && ST.history && !ST.history.activeId && ST.history.lastId === sm.id && sm.status === "finished";
    $("hdHead").innerHTML = "<b style='font-size:18px'>" + esc(sm.title || "Turnier") + "</b>" + badge(sm.status) +
      '<div class="muted" style="margin-top:4px">' + fmtDate(sm.startedAt) + "</div>" +
      (sm.live ? '<button class="warnbtn" id="hdFinish" style="width:100%;margin-top:10px">🏁 Turnier beenden</button>' : "") +
      (latestFinished ? '<button class="ghost" id="hdReopen" style="width:100%;margin-top:10px">Turnier wieder öffnen</button>' : "");
    if ($("hdFinish")) $("hdFinish").onclick = askFinish;
    if ($("hdReopen")) $("hdReopen").onclick = function () {
      confirmDo("Turnier wieder öffnen?", "Die Aufzeichnung läuft dann weiter, z. B. wenn das Turnier aus Versehen beendet wurde.", "Wieder öffnen",
        function () { act("reopen").then(histRefreshSoon).catch(function () {}); }, "primary");
    };
    var html = "";
    if (histView === "summary") {
      var kv = function (k, v) { return '<div class="kv"><span>' + k + "</span><b>" + v + "</b></div>"; };
      html = '<div class="card">' +
        kv("Start", fmtDate(sm.startedAt)) +
        kv("Ende", sm.endedAt ? fmtDate(sm.endedAt) : (sm.status === "running" ? "läuft noch" : "–")) +
        kv("Gesamtdauer", fmtDur(sm.durationMs)) +
        kv("Pausen (planmäßig)", fmtDur(sm.breakMs)) +
        kv("Uhr angehalten", fmtDur(sm.pausedMs)) +
        kv("Teilnehmer", (sm.entriesStart != null && sm.entriesStart !== sm.entries ? sm.entriesStart + " → " : "") + (sm.entries != null ? sm.entries : "–")) +
        kv(sm.status === "running" ? "Noch im Turnier" : "Bei Ende im Turnier", sm.remaining != null ? sm.remaining : "–") +
        kv("Bustouts", sm.busts) +
        kv("Rebuys / Add-ons", (sm.rebuys || 0) + " / " + (sm.addons || 0)) +
        kv("Preispool", money(sm.pool, cur)) +
        kv("Start-Level", lvTxt(sm.startLevel)) +
        kv(sm.status === "running" ? "Aktuelles Level" : "Letztes Level", sm.lastLevel && sm.lastLevel.type === "break" ? "Pause" : sm.lastLevel && sm.lastLevel.number ? lvTxt(sm.lastLevel) : "–") +
        kv("Sieger", sm.winner ? "🏆 " + esc(sm.winner) : (sm.status === "finished" ? "–" : "noch offen")) +
        kv("Auszahlungen", "nicht hinterlegt") +
        "</div>";
    } else if (histView === "timeline") {
      var list = evs.slice();
      if (tlNewest) list.reverse();
      html = '<div class="card"><label class="chk" style="margin-bottom:8px"><input type="checkbox" id="tlNew"' + (tlNewest ? " checked" : "") + '><span>Neueste zuerst</span></label><ul class="tl">' +
        list.map(function (e) { var x = evText(e, names, byId, cur); if (!x) return "";
          return '<li><span class="tm">' + fmtTimeS(e.t) + '</span><span class="ic">' + x[0] + '</span><span class="tx">' + x[1] + "</span></li>"; }).join("") +
        "</ul></div>";
    } else if (histView === "places") {
      var st = sm.standings || [];
      html = '<div class="card">' + (st.length ? st.map(function (p) {
        var ref = p.ref, nm = p.name ? esc(p.name) : '<span class="muted">ohne Namen</span>';
        return '<div class="place' + (p.winner ? " win" : "") + '"><span class="pn">' + (p.winner ? "🏆" : p.place + ".") + '</span><span class="nm">' + nm +
          "<small>" + (p.winner ? "Sieger · " + fmtTimeS(p.t) : "raus um " + fmtTimeS(p.t) + " · " + lvTxt(p.level)) + "</small></span>" +
          '<button class="ghost" data-name="' + esc(ref) + '" data-place="' + p.place + '" data-cur="' + esc(p.name || "") + '">' + (p.name ? "Ändern" : "Name") + "</button></div>";
      }).join("") : '<div class="muted">Noch keine Bustouts.</div>') +
        (sm.status !== "finished" && sm.remaining ? '<p class="muted" style="margin:10px 2px 0">' + (sm.status === "running" ? "Noch im Turnier: " : "Bei Turnierende noch im Turnier: ") + sm.remaining + " Spieler</p>" :
          (sm.status === "finished" && sm.remainingAtEnd > 1 ? '<p class="muted" style="margin:10px 2px 0">Bei Turnierende waren noch ' + sm.remainingAtEnd + " Spieler im Turnier (Plätze 1–" + sm.remainingAtEnd + " ohne Bustout).</p>" : "")) +
        "</div>";
    } else if (histView === "pool") {
      var ph = sm.poolHistory || [];
      html = '<div class="card">' +
        '<div class="kv"><span>Preispool beim Start</span><b>' + money(sm.poolStart, cur) + "</b></div>" +
        (ph.length ? '<ul class="tl" style="margin-top:6px">' + ph.map(function (x) {
          return '<li><span class="tm">' + fmtTimeS(x.t) + '</span><span class="ic">' + (x.diff > 0 ? "➕" : "➖") + '</span><span class="tx">' + esc(x.reason) +
            "<small>" + money(x.old, cur) + " → " + money(x.new, cur) + " (" + (x.diff > 0 ? "+" : "") + money(x.diff, cur) + ")</small></span></li>";
        }).join("") + "</ul>" : '<p class="muted" style="margin:8px 2px">Keine Änderungen am Preispool.</p>') +
        '<div class="kv"><span>' + (sm.status === "running" ? "Preispool aktuell" : "Preispool final") + "</span><b>" + money(sm.pool, cur) + "</b></div>" +
        '<p class="muted" style="margin:8px 2px 0">Es gibt keine Auszahlungsstruktur in der Pokerclock – angezeigt wird der Preispool aus Buy-ins, Rebuys und Add-ons.</p></div>';
    }
    $("hdBody").innerHTML = html;
    if ($("tlNew")) $("tlNew").onchange = function () { tlNewest = this.checked; histRender(); };
  }
  $("hdBody").addEventListener("click", function (e) {
    var b = e.target.closest("[data-name]"); if (!b || !histData) return;
    var ref = b.dataset.name, place = b.dataset.place;
    promptSheet(ref === "winner" ? "Name des Siegers" : "Name für Platz " + place, "", "Name", "Speichern", b.dataset.cur, function (name) {
      act("nameBust", { tid: histData.summary.id, ref: ref, name: name }).then(function () { histRefreshSoon(); toast("Name gespeichert"); }).catch(function () {});
    });
  });

  /* ---------- Darstellung ---------- */
  var curView = null, levelsSig = "";
  function onState(p) {
    var firstLoad = !P;
    P = p; ST = p.state;
    fillBinds();
    $("hTitle").textContent = ST.tournament.title || "Pokerclock";
    var t = ST.tournament;
    document.querySelectorAll('[data-show="rebuys"]').forEach(function (e) { e.classList.toggle("hidden", !t.rebuysEnabled); });
    document.querySelectorAll('[data-show="addons"]').forEach(function (e) { e.classList.toggle("hidden", !t.addonsEnabled); });
    document.querySelectorAll('[data-show="pool"]').forEach(function (e) { e.classList.toggle("hidden", !(t.buyIn > 0)); });
    document.querySelectorAll('[data-show="warning"]').forEach(function (e) { e.classList.toggle("hidden", !ST.sound.warning); });
    buildAnnList(); fillBinds(); buildVoices(false); updateLifecycle(); histMaybeRefresh(); updateEngine();
    tick();
    var sig = JSON.stringify(ST.levels);
    if (firstLoad || (sig !== levelsSig && !levelsDirty && !levelsTimer)) { levelsSig = sig; maybeRerender(); }
  }
  function tick() {
    if (!ST) return;
    var v = PC.computeView(ST, Date.now());
    var prevIdx = curView ? curView.index : -1;
    curView = v;
    var fmt = ST.display.numberFormat;
    var t = ST.tournament, tot = P.totals || PC.totals(t);
    var timeTxt = PC.fmtTime(v.remainingMs);
    var paused = !v.running && !v.finished;
    var warn = !v.isBreak && v.running && v.remainingMs <= 60000;
    var lvTxt = v.isBreak ? "PAUSE" : "LEVEL " + v.levelNumber;
    var bl = v.isBreak ? "Pause" : PC.fmtNum(v.level.sb, fmt) + " / " + PC.fmtNum(v.level.bb, fmt);

    $("lTime").textContent = timeTxt; $("mTime").textContent = timeTxt;
    $("lTime").classList.toggle("warn", warn); $("mTime").classList.toggle("warn", warn);
    $("lTime").classList.toggle("paused", paused); $("mTime").classList.toggle("paused", paused);
    $("lPill").textContent = lvTxt; $("mPill").textContent = lvTxt;
    $("lPill").classList.toggle("brk", v.isBreak); $("mPill").classList.toggle("brk", v.isBreak);
    $("lBlinds").textContent = bl; $("mBlinds").textContent = bl;
    $("lAnte").textContent = !v.isBreak && v.level.ante > 0 ? (ST.display.anteLabel || "Ante") + ": " + PC.fmtNum(v.level.ante, fmt) : "";
    var nx = v.next;
    $("lNext").innerHTML = "<b>Nächstes:</b> " + (!nx ? "Letztes Level" : nx.type === "break" ? "Pause (" + nx.minutes + " min)" :
      "Level " + v.nextNumber + " – " + PC.fmtNum(nx.sb, fmt) + " / " + PC.fmtNum(nx.bb, fmt) + (nx.ante > 0 ? " · Ante " + PC.fmtNum(nx.ante, fmt) : ""));
    var full = PC.durMs(v.level);
    $("lProg").style.width = (full > 0 ? Math.max(0, Math.min(100, 100 - v.remainingMs / full * 100)) : 0) + "%";
    var stEl = $("lStatus");
    stEl.classList.toggle("run", v.running);
    stEl.querySelector("span").textContent = v.finished ? "Abgelaufen" : v.running ? "Läuft" : v.startedOnce ? "Pausiert" : "Bereit";
    var playLbl = v.running ? "⏸ Pause" : (v.startedOnce ? "▶ Weiter" : "▶ Turnier starten");
    $("bPlay").textContent = playLbl;
    $("bPlay").className = v.running ? "warnbtn" : "primary";
    $("mPlay").textContent = v.running ? "⏸" : "▶";
    $("mPlay").className = v.running ? "warnbtn" : "primary";

    $("pRem").textContent = t.remaining; $("pEnt").textContent = t.entries;
    $("sRem").textContent = t.remaining; $("sEnt").textContent = t.entries;
    $("sReb").textContent = t.rebuys; $("sAdd").textContent = t.addons;
    $("pAvg").textContent = tot.avg == null ? "–" : PC.fmtNum(tot.avg);
    $("pChips").textContent = PC.fmtNum(tot.chips);
    $("pPool").textContent = PC.fmtMoney(tot.pool, t.currency);
    if (prevIdx !== v.index) updateLevelClasses();
  }

  /* ---------- Verbindung ---------- */
  var connOk = null, firstSnap = false;
  function onConn(ok, why) {
    $("conn").classList.toggle("bad", !ok);
    document.body.classList.toggle("disconnected", !ok);
    if (why) $("offlineTxt").textContent = why;
    connOk = ok;
  }
  var bootAt = Date.now();
  function checkConn() {
    if (!db) return onConn(false, "Keine Online-Verbindung – diese Seite in claude.ai öffnen (angemeldet).");
    if (!firstSnap) return onConn(Date.now() - bootAt < 10000, "Noch kein Stand vom iPad – ist die Pokerclock dort als „Anzeige + Host“ geöffnet?");
    if (room) {
      var rc = true; try { rc = room.connected(); } catch (e) {}
      if (cap.p2p && !rc) return onConn(false, cap.p2p.state.error ? cap.p2p.state.error + " – Code prüfen (Turnier → Zugriff)" : "Verbinde mit dem iPad (Code " + cap.p2p.code + ") …");
      if (!rc && Date.now() - bootAt > 6000) return onConn(false, "Keine Internetverbindung");
      if (Date.now() - bootAt > 6000 && !hostPresent()) return onConn(false, "iPad nicht erreichbar – ist die Pokerclock dort geöffnet und online?");
    }
    onConn(true);
  }
  var peersDisplay = 0;
  if (room) {
    room.presence({ role: "control", dev: DEV }).catch(function () {});
    try {
      room.onPeers(function (ch) {
        peersDisplay = ch.peers.filter(function (p) { return p.presence && p.presence.role === "host"; }).length;
        if (P) P.clients = { display: hostPresent() ? 1 : 0, control: 1 };
        checkConn();
      });
    } catch (e) {}
  }
  if (db) {
    db.doc(PCLink.PATH.state).onSnapshot(function (snap) {
      if (!snap.exists) { checkConn(); return; }
      firstSnap = true;
      var p = PCLink.payloadFromDoc(snap.data());
      p.clients = { display: (!room || hostPresent()) ? 1 : 0, control: 1 };
      onState(p);
      settle(p.results);
      checkConn();
    }, function () { onConn(false, "Verbindung unterbrochen – Seite neu laden"); });
  }
  setInterval(checkConn, 2000);
  checkConn();
  setInterval(tick, 250);
  setInterval(updateSummary, 15000);

  var startTab = "live";
  try { startTab = sessionStorage.getItem("pokerclock-tab") || "live"; } catch (e) {}
  $("bRole").addEventListener("click", function () { window.PCBoot.chooseRole(); });
  if (cap.p2p) {
    $("accessTxt").textContent = "Verbunden mit dem iPad mit Code " + cap.p2p.code + ". Wer diesen Code oder den QR-Code hat, kann steuern. Gib ihn nur Leuten, die mitsteuern sollen. Auf dem iPad kannst du über ⋯ jederzeit einen neuen Code erzeugen.";
    $("bCode").hidden = false;
    $("bCode").addEventListener("click", function () { window.PCBoot.changeCode(); });
    window.__pcStatus = checkConn;
  }
  showTab(startTab);};
