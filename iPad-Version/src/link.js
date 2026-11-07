/* Pokerclock – Verbindung über claude.ai (db = Speicher, room = wer gerade da ist) */
(function () {
  "use strict";
  var L = {};
  L.PATH = { state: "pc/state", host: "pc/host", cmds: "pccmd", hist: "hist" };
  L.CHUNK = 100; // Ereignisse je Historien-Dokument

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  L.ls = ls;
  L.deviceId = function () {
    var id = ls("pc-dev");
    if (!id) { id = "g" + Math.random().toString(36).slice(2, 10); ls("pc-dev", id); }
    return id;
  };
  L.newId = function (dev) { return dev + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); };

  // Fähigkeiten holen (null = auf diesem Gerät nicht verfügbar)
  L.init = function () {
    var c = window.claude;
    if (!c || typeof c.use !== "function") return Promise.resolve({ db: null, room: null });
    var get = function (n) { try { return Promise.resolve(c.use(n)).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); } };
    return Promise.all([get("db"), get("room")]).then(function (r) { return { db: r[0], room: r[1] }; });
  };

  // Ein Dokument schreiben: immer nur ein Schreibvorgang gleichzeitig, neuester Stand gewinnt,
  // bei Netzfehlern später erneut versuchen.
  L.Writer = function (ref, onStatus) {
    var pending = null, busy = false, retryT = null, delay = 1500, self = this;
    self.ok = true; self.lastOk = 0;
    function status(ok, err) { self.ok = ok; if (ok) self.lastOk = Date.now(); if (onStatus) try { onStatus(ok, err); } catch (e) {} }
    function kick() {
      if (busy || !pending || retryT) return;
      busy = true;
      var item = pending; pending = null;
      Promise.resolve().then(function () { return item.del ? ref.delete() : ref.set(item.data); }).then(function () {
        busy = false; delay = 1500; status(true);
        item.done.forEach(function (f) { try { f(true); } catch (e) {} });
        kick();
      }, function (e) {
        busy = false;
        var code = e && e.code;
        status(false, e);
        if (code === "invalid_argument" || code === "quota_exceeded" || code === "revoked" || code === "not_granted") {
          item.done.forEach(function (f) { try { f(false, e); } catch (x) {} });
          kick(); return;
        }
        if (!pending) pending = item; else pending.done = item.done.concat(pending.done);
        retryT = setTimeout(function () { retryT = null; kick(); }, delay);
        delay = Math.min(15000, delay * 2);
      });
    }
    self.set = function (data, done) {
      var prev = pending;
      pending = { data: data, done: (prev ? prev.done : []).concat(done ? [done] : []) };
      kick();
    };
    self.del = function (done) { pending = { del: true, done: done ? [done] : [] }; kick(); };
    self.idle = function () { return !busy && !pending; };
  };

  // Mit Zeitlimit warten (db antwortet offline evtl. nie)
  L.timeout = function (p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej({ code: "timeout", message: "Zeitüberschreitung" }); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  };

  // Ereignisse eines Turniers aus der Historie laden
  L.loadEvents = function (db, tid) {
    return db.collection(L.PATH.hist + "/" + tid + "/chunks").get().then(function (qs) {
      var evs = [];
      qs.docs.forEach(function (d) { var x = d.data(); if (x && Array.isArray(x.events)) evs = evs.concat(x.events); });
      evs.sort(function (a, b) { return a.seq - b.seq; });
      return evs;
    });
  };

  // Öffentliche Sicht auf den Stand (für Handy und zweite Anzeige)
  L.payloadFromDoc = function (doc) {
    var st = PCEngine.clone(doc.state);
    var h = st.history || {};
    st.history = { activeId: h.activeId || "", lastId: h.lastId || "", status: h.status || "", lastBust: h.lastBust || null,
      openBusts: (h.openBusts || []).length };
    st.pinRequired = false;
    return { state: st, totals: doc.totals, voices: doc.voices || [], speakerAudio: !!doc.speakerAudio,
      announceInfo: PCEngine.announceInfo(), hostId: doc.hostId || "", savedAt: doc.savedAt || 0, results: doc.results || {} };
  };

  window.PCLink = L;
})();
