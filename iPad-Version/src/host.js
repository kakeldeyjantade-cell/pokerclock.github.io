/* Pokerclock – Host (läuft auf dem iPad): Turnierlogik, Speichern, Befehle vom Handy */
(function () {
  "use strict";
  var L = PCLink, P_ = L.PATH;

  function HistStore(db, onDirty) {
    var mem = {}, loaded = {}, written = {}, writers = {}, failedLoad = {};
    var self = this;
    self.events = function (tid) { return mem[tid] || []; };
    self.has = function (tid) { return !!mem[tid]; };
    self.ids = function () { return Object.keys(mem); };
    self.append = function (tid, ev) {
      (mem[tid] = mem[tid] || []).push(ev);
      if (!(tid in loaded)) loaded[tid] = true; // neues Turnier (bestehende werden vorher per ensure geladen)
      onDirty(tid);
    };
    self.seed = function (tid, evs) { mem[tid] = evs.slice(); loaded[tid] = true; written[tid] = evs.length; };
    // Turniere sicher geladen haben, bevor eine Aktion sie braucht
    self.ensure = function (tids) {
      return Promise.all((tids || []).map(function (tid) {
        if (!db || loaded[tid] === true) return null;
        return L.timeout(L.loadEvents(db, tid), 8000).then(function (evs) {
          var local = mem[tid] || [], byId = {};
          evs.concat(local).forEach(function (e) { byId[e.id] = e; });
          var merged = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return a.seq - b.seq; });
          mem[tid] = merged; loaded[tid] = true; written[tid] = evs.length;
          delete failedLoad[tid];
          if (merged.length !== evs.length) onDirty(tid);
        }, function () { failedLoad[tid] = true; loaded[tid] = false; if (!mem[tid]) mem[tid] = []; });
      }));
    };
    self.retryFailed = function () {
      var t = Object.keys(failedLoad);
      if (t.length) self.ensure(t).then(function () { t.forEach(function (x) { if (loaded[x]) onDirty(x); }); });
    };
    function writer(path) { return writers[path] || (writers[path] = new L.Writer(db.doc(path))); }
    // geänderte Teile speichern (nur wenn sicher ist, dass ältere Ereignisse geladen sind)
    self.flush = function (tid, activeId) {
      if (!db || !mem[tid] || loaded[tid] !== true) return;
      var evs = mem[tid], from = Math.floor((written[tid] || 0) / L.CHUNK) * L.CHUNK;
      if (written[tid] > evs.length) from = 0;
      for (var k = from; k < evs.length; k += L.CHUNK) {
        var no = Math.floor(k / L.CHUNK);
        writer(P_.hist + "/" + tid + "/chunks/c" + ("000" + no).slice(-4)).set({ events: evs.slice(k, k + L.CHUNK) });
      }
      written[tid] = evs.length;
      var sm = PCEngine.summarize(evs, activeId, Date.now());
      delete sm.standings; delete sm.poolHistory; delete sm.live;
      sm.updatedAt = Date.now();
      writer(P_.hist + "/" + tid).set(sm);
    };
    self.backup = function (tid) { return tid && mem[tid] ? mem[tid] : []; };
  }

  function Host(opts) {
    var self = this;
    var cap = opts.cap, db = cap.db, room = cap.room, dev = opts.dev;
    self.isHost = false;       // verarbeitet gerade Befehle
    self.ready = false;
    self.voices = [];
    self.audio = false;
    self.controls = 0;          // verbundene Handys
    self.online = false;        // Verbindung zu claude.ai (db-Schreibvorgang klappt)
    self.otherHost = null;      // anderes Gerät ist Host
    var results = {}, resultOrder = [], seen = {}, seenOrder = [];
    var dirtyHist = {}, histTimer = null, ver = 0, lastDocSig = "", pushTimer = null, lastPush = 0;
    var stateWriter = db ? new L.Writer(db.doc(P_.state), function (ok) { self.online = ok; opts.onChange(); }) : null;
    var hostWriter = db ? new L.Writer(db.doc(P_.host)) : null;

    var store = new HistStore(db, function (tid) {
      dirtyHist[tid] = true;
      clearTimeout(histTimer); histTimer = setTimeout(flushHist, 1200);
    });
    function flushHist() {
      if (!self.isHost) return;
      var act = eng.state.history.activeId;
      Object.keys(dirtyHist).forEach(function (tid) { delete dirtyHist[tid]; store.flush(tid, act); });
      backupLocal();
    }
    var eng = new PCEngine.Engine({
      store: store,
      onAnnounce: function (a) { if (self.isHost && opts.onAnnounce) opts.onAnnounce(a, eng.state); },
      onLog: function () {}
    });
    self.engine = eng;

    /* ---- Stand laden ---- */
    function readLocal() { try { return JSON.parse(L.ls("pc-host-backup") || "null"); } catch (e) { return null; } }
    var lastBackup = 0;
    function backupLocal(force) {
      if (!force && Date.now() - lastBackup < 2000) return;
      lastBackup = Date.now();
      var act = eng.state.history.activeId;
      try {
        L.ls("pc-host-backup", JSON.stringify({ savedAt: Date.now(), state: eng.state,
          events: act ? { tid: act, list: store.backup(act) } : null }));
      } catch (e) {}
    }
    self.load = function () {
      var local = readLocal();
      var remote = db ? L.timeout(db.doc(P_.state).get(), 9000).then(function (s) { return s.exists ? s.data() : null; }, function () { return undefined; })
        : Promise.resolve(undefined);
      return remote.then(function (doc) {
        if (doc === undefined) self.loadNote = "Kein Zugriff auf den Online-Speicher – Stand vom iPad geladen.";
        var pick = null;
        if (doc && doc.state && (!local || (doc.savedAt || 0) >= (local.savedAt || 0) - 1000)) pick = doc.state;
        else if (local && local.state) pick = local.state;
        if (pick) eng.load(pick);
        var act = eng.state.history.activeId, last = eng.state.history.lastId;
        if (local && local.events && local.events.tid === act) store.seed(act, local.events.list || []);
        var need = [act, last].filter(Boolean);
        if (doc && doc.results) { results = Object.assign({}, doc.results); resultOrder = Object.keys(results); resultOrder.forEach(function (k) { seen[k] = 1; seenOrder.push(k); }); }
        return store.ensure(need.map(function (x) { return x; })).catch(function () {});
      }).then(function () {
        if (eng.state.history.activeId && !store.has(eng.state.history.activeId)) store.seed(eng.state.history.activeId, []);
        var changed = eng.bootSync();
        self.ready = true;
        return changed;
      });
    };

    /* ---- Payload für die eigene Anzeige ---- */
    self.payload = function () {
      var st = PCEngine.clone(eng.state);
      var h = st.history;
      st.history = { activeId: h.activeId, lastId: h.lastId, status: h.status, lastBust: h.lastBust, openBusts: (h.openBusts || []).length };
      return { state: st, totals: eng.totals(), clients: { display: 1, control: self.controls },
        speakerAudio: self.audio, voices: self.voices, announceInfo: PCEngine.announceInfo() };
    };

    /* ---- Speichern / Verteilen ---- */
    function docBody() {
      return { v: 1, hostId: dev, state: eng.state, totals: eng.totals(), voices: self.voices,
        speakerAudio: self.audio, results: results };
    }
    self.push = function (now) {
      if (!self.isHost) return;
      clearTimeout(pushTimer);
      var wait = now ? 0 : Math.max(0, 250 - (Date.now() - lastPush));
      pushTimer = setTimeout(function () {
        var body = docBody(), sig = JSON.stringify(body);
        if (sig === lastDocSig) return;
        lastDocSig = sig; lastPush = Date.now();
        body.savedAt = Date.now(); body.ver = ++ver;
        if (stateWriter) stateWriter.set(body);
        backupLocal();
      }, wait);
      opts.onChange();
    };

    /* ---- Befehle vom Handy ---- */
    var queue = [], working = false;
    function enqueue(cmd, ref) {
      if (!cmd || typeof cmd.id !== "string" || !cmd.a || typeof cmd.a.type !== "string") { if (ref) ref.delete().catch(function () {}); return; }
      queue.push({ cmd: cmd, ref: ref });
      work();
    }
    function remember(id, res) {
      results[id] = res; resultOrder.push(id);
      while (resultOrder.length > 25) delete results[resultOrder.shift()];
    }
    function work() {
      if (working || !queue.length) return;
      if (!self.isHost || !self.ready) return;
      working = true;
      var item = queue.shift(), cmd = item.cmd;
      var done = function () {
        if (item.ref) item.ref.delete().catch(function () {});
        working = false; work();
      };
      if (seen[cmd.id]) { if (!results[cmd.id]) remember(cmd.id, { ok: true, at: Date.now() }); self.push(true); return done(); }
      seen[cmd.id] = 1; seenOrder.push(cmd.id);
      while (seenOrder.length > 300) delete seen[seenOrder.shift()];
      if (Math.abs(Date.now() - Number(cmd.t || 0)) > 90000) {
        remember(cmd.id, { ok: false, err: "Befehl kam zu spät an und wurde verworfen", at: Date.now() });
        self.push(true); return done();
      }
      store.ensure(eng.needsEvents(cmd.a)).then(function () {
        try { eng.apply(cmd.a); remember(cmd.id, { ok: true, at: Date.now() }); }
        catch (e) { remember(cmd.id, { ok: false, err: e.userError ? e.message : "Fehler: " + e.message, at: Date.now() }); if (!e.userError) console.error(e); }
        if (cmd.a.type === "nameBust" || cmd.a.type === "finish" || cmd.a.type === "reopen") { clearTimeout(histTimer); flushHist(); }
        self.push(true);
        done();
      });
    }
    // Direkte Bedienung am iPad (Schnellsteuerung)
    self.applyLocal = function (action) {
      return store.ensure(eng.needsEvents(action)).then(function () { eng.apply(action); self.push(true); });
    };

    /* ---- Host-Rolle ---- */
    var unsubCmds = null, unsubRoomCmd = null;
    function startListening() {
      if (db && !unsubCmds) {
        unsubCmds = db.collection(P_.cmds).onSnapshot(function (qs) {
          qs.docs.forEach(function (d) { var x = d.data(); if (x) enqueue(x, db.doc(P_.cmds + "/" + d.id)); });
        }, function () { unsubCmds = null; setTimeout(function () { if (self.isHost) startListening(); }, 3000); });
      }
      if (room && !unsubRoomCmd) {
        try { unsubRoomCmd = room.on("cmd", function (m) { if (m && m.data) enqueue(m.data, null); }); } catch (e) {}
      }
    }
    function stopListening() {
      if (unsubCmds) { unsubCmds(); unsubCmds = null; }
      if (unsubRoomCmd) { unsubRoomCmd(); unsubRoomCmd = null; }
    }
    self.becomeHost = function () {
      self.isHost = true; self.otherHost = null;
      if (hostWriter) hostWriter.set({ hostId: dev, at: Date.now() });
      if (room) room.presence({ role: "host", hostId: dev }).catch(function () {});
      startListening();
      lastDocSig = "";
      self.push(true);
      flushHist();
      work();
      opts.onChange();
    };
    self.standDown = function (otherId) {
      self.isHost = false; self.otherHost = otherId || "?";
      stopListening();
      if (room) room.presence({ role: "display", hostId: dev }).catch(function () {});
      opts.onChange();
    };
    function hostPresent(id) {
      if (!room) return false;
      try { return room.peers().some(function (p) { return !p.isMe && p.presence && p.presence.role === "host" && p.presence.hostId === id; }); } catch (e) { return false; }
    }
    // Start: Host-Rolle übernehmen, außer ein anderes Gerät ist gerade aktiv Host
    self.claim = function () {
      if (!db) { self.becomeHost(); return Promise.resolve("host"); }
      return L.timeout(db.doc(P_.host).get(), 8000).then(function (s) { return s.exists ? s.data() : null; }, function () { return null; })
        .then(function (h) {
          if (h && h.hostId && h.hostId !== dev) {
            // kurz warten, bis die Anwesenheit der anderen bekannt ist
            return new Promise(function (r) { setTimeout(r, 2500); }).then(function () {
              if (hostPresent(h.hostId)) { self.standDown(h.hostId); return "other"; }
              self.becomeHost(); return "host";
            });
          }
          self.becomeHost(); return "host";
        }).then(function (res) {
          db.doc(P_.host).onSnapshot(function (s) {
            var h = s.exists ? s.data() : null;
            if (s.metadata && s.metadata.hasPendingWrites) return;
            if (h && h.hostId && h.hostId !== dev && self.isHost) self.standDown(h.hostId);
          }, function () {});
          return res;
        });
    };

    /* ---- Handys zählen ---- */
    if (room) {
      try {
        room.onPeers(function (ch) {
          self.controls = ch.peers.filter(function (p) { return !p.isMe && p.presence && p.presence.role === "control"; }).length;
          opts.onChange();
        });
      } catch (e) {}
    }

    /* ---- Ticker ---- */
    setInterval(function () {
      if (!self.ready) return;
      try { if (self.isHost && eng.detect(Date.now())) self.push(); } catch (e) { console.error(e); }
    }, 200);
    setInterval(function () { if (self.isHost) { store.retryFailed(); work(); } }, 10000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && self.isHost) backupLocal(true);
    });
    window.addEventListener("pagehide", function () { if (self.isHost) backupLocal(true); });

    self.setAudio = function (on, voices) {
      self.audio = !!on;
      if (Array.isArray(voices)) self.voices = voices.slice(0, 300);
      self.push();
    };
  }

  window.PCHost = Host;
})();
