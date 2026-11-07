/* Pokerclock – Direktverbindung ohne claude.ai (PeerJS / WebRTC).
   Stellt dieselbe Schnittstelle bereit wie claude.ai (db + room), damit Host, Anzeige und Steuerung unverändert bleiben.
   Das iPad (Host) hält die Daten selbst (IndexedDB) und bedient Handy und zweite Anzeige direkt. */
(function () {
  "use strict";
  var ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  var PREFIX = "pokerclock-v1-";
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function parent(p) { return p.slice(0, p.lastIndexOf("/")); }
  function snapDoc(path, data) {
    return { id: path.split("/").pop(), exists: data != null, data: function () { return data == null ? undefined : clone(data); },
      metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function snapColl(coll, docs) {
    var ds = docs.map(function (d) { return snapDoc(coll + "/" + d.id, d.data); });
    return { docs: ds, size: ds.length, empty: !ds.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: function () { return []; } };
  }
  function rid(n) { var s = ""; for (var i = 0; i < n; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)]; return s; }

  function peerOptions() {
    var q = new URLSearchParams(location.search), o = { debug: 0 };
    if (q.get("peerhost")) { o.host = q.get("peerhost"); o.port = +(q.get("peerport") || 9000); o.path = q.get("peerpath") || "/"; o.secure = q.get("peersecure") === "1"; }
    return o;
  }

  /* ---------------- Speicher auf dem Host ---------------- */
  function Store() {
    var docs = new Map(), idb = null, self = this;
    self.listeners = new Set(); // {path, coll, fn(snapshot)}
    self.ready = new Promise(function (res) {
      try {
        var rq = indexedDB.open("pokerclock", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("docs"); };
        rq.onsuccess = function () {
          idb = rq.result;
          var tx = idb.transaction("docs", "readonly"), st = tx.objectStore("docs"), cur = st.openCursor();
          cur.onsuccess = function () { var c = cur.result; if (c) { docs.set(c.key, c.value); c.continue(); } else res(); };
          cur.onerror = function () { res(); };
        };
        rq.onerror = function () { res(); };
      } catch (e) { res(); }
    });
    function persist(path, data) {
      if (!idb) return;
      try { var tx = idb.transaction("docs", "readwrite"); if (data == null) tx.objectStore("docs").delete(path); else tx.objectStore("docs").put(data, path); } catch (e) {}
    }
    self.get = function (path) { return docs.has(path) ? docs.get(path) : null; };
    self.query = function (coll) {
      var pre = coll + "/", out = [];
      docs.forEach(function (d, p) { if (p.indexOf(pre) === 0 && p.slice(pre.length).indexOf("/") < 0) out.push({ id: p.slice(pre.length), data: d }); });
      out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      return out;
    };
    self.write = function (path, data) {
      if (data == null) docs.delete(path); else docs.set(path, clone(data));
      persist(path, data == null ? null : docs.get(path));
      var par = parent(path);
      self.listeners.forEach(function (l) {
        if (!l.coll && l.path === path) l.fn(snapDoc(path, self.get(path)), path, self.get(path));
        if (l.coll && l.path === par) l.fn(snapColl(par, self.query(par)), par, self.query(par));
      });
    };
    self.update = function (path, data) {
      if (!docs.has(path)) throw { code: "invalid_argument", message: "Dokument fehlt" };
      var merge = function (a, b) { var o = Object.assign({}, a); Object.keys(b).forEach(function (k) {
        o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && o[k] && typeof o[k] === "object" ? merge(o[k], b[k]) : b[k]; }); return o; };
      self.write(path, merge(docs.get(path), data));
    };
  }

  function localDb(store) {
    function later(fn) { return new Promise(function (r) { setTimeout(function () { r(fn()); }, 0); }); }
    function docRef(path) {
      var r = {
        id: path.split("/").pop(), path: path,
        get: function () { return later(function () { return snapDoc(path, store.get(path)); }); },
        set: function (d) { return later(function () { store.write(path, d); }); },
        update: function (d) { return later(function () { store.update(path, d); }); },
        "delete": function () { return later(function () { store.write(path, null); }); },
        onSnapshot: function (fn) {
          var l = { path: path, coll: false, fn: function (s) { setTimeout(function () { fn(s); }, 0); } };
          store.listeners.add(l); l.fn(snapDoc(path, store.get(path)));
          return function () { store.listeners.delete(l); };
        },
        collection: function (p) { return collRef(path + "/" + p); }
      };
      return r;
    }
    function collRef(path) {
      var c = {
        path: path,
        doc: function (id) { return docRef(path + "/" + (id || rid(12))); },
        add: function (d) { var ref = c.doc(); return ref.set(d).then(function () { return ref; }); },
        where: function () { return c; }, orderBy: function () { return c; }, limit: function () { return c; },
        get: function () { return later(function () { return snapColl(path, store.query(path)); }); },
        onSnapshot: function (fn) {
          var l = { path: path, coll: true, fn: function (s) { setTimeout(function () { fn(s); }, 0); } };
          store.listeners.add(l); l.fn(snapColl(path, store.query(path)));
          return function () { store.listeners.delete(l); };
        }
      };
      return c;
    }
    return { doc: docRef, collection: collRef };
  }

  /* ---------------- Room (wer ist da, kurze Nachrichten) ---------------- */
  function RoomBase() {
    var self = this;
    self.handlers = {}; self.peersH = []; self.connH = []; self.peerList = Object.freeze([]); self.conn = false;
    self.api = {
      emit: function (topic, data) { return self.emit(topic, data); },
      on: function (topic, fn) { (self.handlers[topic] = self.handlers[topic] || []).push(fn);
        return function () { var a = self.handlers[topic]; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; },
      presence: function (patch) { return self.presence(patch); },
      peers: function () { return self.peerList; },
      onPeers: function (fn) { self.peersH.push(fn); setTimeout(function () { fn({ peers: self.peerList, joined: self.peerList, left: [], updated: [] }); }, 0); return function () {}; },
      connected: function () { return self.conn; },
      onConnection: function (fn) { self.connH.push(fn); setTimeout(function () { fn(self.conn); }, 0); return function () {}; }
    };
    self.deliver = function (m) { (self.handlers[m.topic] || []).slice().forEach(function (f) { try { f(m); } catch (e) {} }); };
    self.setPeers = function (list, me) {
      self.peerList = Object.freeze(list.map(function (p) {
        return Object.freeze({ peer: p.peer, presence: p.presence || {}, isMe: p.peer === me, sameTab: p.peer === me, kind: "viewer", by: null, guest: false, updatedAt: Date.now() });
      }));
      self.peersH.forEach(function (f) { try { f({ peers: self.peerList, joined: [], left: [], updated: [] }); } catch (e) {} });
    };
    self.setConn = function (v) { if (v === self.conn) return; self.conn = v; self.connH.forEach(function (f) { try { f(v); } catch (e) {} }); };
  }

  /* ---------------- Host ---------------- */
  function startHost(code, status) {
    var store = new Store(), db = localDb(store), room = new RoomBase();
    var conns = new Map(); // peerId -> {conn, presence, subs: Map(sid -> unsubscribe), last}
    var myPresence = {}, peer = null, retryT = null;
    function peersList() {
      var l = [{ peer: "host", presence: myPresence }];
      conns.forEach(function (c, id) { if (c.hello) l.push({ peer: id, presence: c.presence || {} }); });
      return l;
    }
    function broadcastPeers() {
      var l = peersList();
      room.setPeers(l, "host");
      conns.forEach(function (c) { send(c, { t: "peers", peers: l }); });
    }
    function send(c, m) { try { if (c.conn.open) c.conn.send(m); } catch (e) {} }
    room.emit = function (topic, data) {
      var m = { topic: topic, data: clone(data), peer: "host" };
      room.deliver(Object.assign({ isMe: true, sameTab: true, kind: "viewer", by: null, guest: false }, m));
      conns.forEach(function (c) { send(c, Object.assign({ t: "room" }, m)); });
      return Promise.resolve();
    };
    room.presence = function (patch) {
      Object.keys(patch).forEach(function (k) { if (patch[k] === null) delete myPresence[k]; else myPresence[k] = patch[k]; });
      broadcastPeers();
      return Promise.resolve();
    };
    room.setConn(true);

    function onConn(conn) {
      var c = { conn: conn, presence: {}, subs: new Map(), last: Date.now(), hello: false };
      conns.set(conn.peer, c);
      conn.on("data", function (m) {
        c.last = Date.now();
        if (!m || typeof m !== "object") return;
        try { handle(c, m); } catch (e) { if (m.id) send(c, { t: "res", id: m.id, ok: false, err: { code: "invalid_argument", message: String(e && e.message || e) } }); }
      });
      var drop = function () {
        if (conns.get(conn.peer) !== c) return;
        c.subs.forEach(function (u) { u(); });
        conns.delete(conn.peer); broadcastPeers(); status();
      };
      conn.on("close", drop); conn.on("error", drop);
    }
    function handle(c, m) {
      switch (m.t) {
        case "hello": c.hello = true; c.role = m.role; broadcastPeers(); status(); send(c, { t: "welcome", peer: c.conn.peer }); break;
        case "ping": send(c, { t: "pong" }); break;
        case "op": {
          var p = m.path, res;
          if (m.op === "get") res = store.get(p);
          else if (m.op === "query") res = store.query(p);
          else if (m.op === "set") store.write(p, m.data);
          else if (m.op === "update") store.update(p, m.data);
          else if (m.op === "delete") store.write(p, null);
          send(c, { t: "res", id: m.id, ok: true, data: res === undefined ? null : res });
          break;
        }
        case "sub": {
          var l = { path: m.path, coll: !!m.coll, fn: function (s, path, raw) { send(c, { t: "snap", sid: m.sid, data: raw }); } };
          store.listeners.add(l);
          c.subs.set(m.sid, function () { store.listeners.delete(l); });
          send(c, { t: "snap", sid: m.sid, data: m.coll ? store.query(m.path) : store.get(m.path) });
          break;
        }
        case "unsub": { var u = c.subs.get(m.sid); if (u) { u(); c.subs.delete(m.sid); } break; }
        case "emit": {
          var msg = { topic: String(m.topic), data: m.data, peer: c.conn.peer };
          room.deliver(Object.assign({ isMe: false, sameTab: false, kind: "viewer", by: null, guest: false }, msg));
          conns.forEach(function (o) { send(o, Object.assign({ t: "room" }, msg)); });
          break;
        }
        case "presence": c.presence = m.presence || {}; broadcastPeers(); break;
      }
    }
    // tote Verbindungen aufräumen
    setInterval(function () {
      conns.forEach(function (c, id) { if (Date.now() - c.last > 25000) { try { c.conn.close(); } catch (e) {} } });
    }, 5000);

    var state = { signal: "verbinde", conns: conns };
    function connectSignal() {
      clearTimeout(retryT);
      try { if (peer) peer.destroy(); } catch (e) {}
      peer = new Peer(PREFIX + code, peerOptions());
      peer.on("open", function () { state.signal = "online"; status(); });
      peer.on("connection", onConn);
      peer.on("disconnected", function () { state.signal = "offline"; status(); retryT = setTimeout(function () { try { peer.reconnect(); } catch (e) { connectSignal(); } }, 3000); });
      peer.on("error", function (e) {
        var t = e && e.type;
        if (t === "unavailable-id") { state.signal = "besetzt"; status(); retryT = setTimeout(connectSignal, 6000); }
        else if (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed") { state.signal = "offline"; status(); retryT = setTimeout(connectSignal, 5000); }
      });
    }
    window.addEventListener("online", function () { if (state.signal !== "online") connectSignal(); });
    return store.ready.then(function () {
      if (typeof Peer === "function") connectSignal(); else state.signal = "fehlt";
      return { db: db, room: room.api, p2p: { role: "host", code: code, state: state } };
    });
  }

  /* ---------------- Handy / zweite Anzeige ---------------- */
  function startClient(code, status) {
    var room = new RoomBase(), peer = null, conn = null, me = null;
    var pending = new Map(), subs = new Map(), seq = 0, myPresence = {}, lastPong = 0, backoff = 1500, retryT = null;
    var state = { signal: "verbinde", host: false, error: "" };
    function send(m) { try { if (conn && conn.open) { conn.send(m); return true; } } catch (e) {} return false; }
    function rpc(op, path, data) {
      return new Promise(function (res, rej) {
        if (!room.conn) return rej({ code: "unavailable", message: "Keine Verbindung zum iPad" });
        var id = ++seq;
        var t = setTimeout(function () { pending.delete(id); rej({ code: "unavailable", message: "Zeitüberschreitung" }); }, 10000);
        pending.set(id, { res: res, rej: rej, t: t });
        if (!send({ t: "op", id: id, op: op, path: path, data: data })) { clearTimeout(t); pending.delete(id); rej({ code: "unavailable", message: "Keine Verbindung" }); }
      });
    }
    function sub(path, coll, fn) {
      var sid = ++seq;
      subs.set(sid, { path: path, coll: coll, fn: fn });
      send({ t: "sub", sid: sid, path: path, coll: coll });
      return function () { subs.delete(sid); send({ t: "unsub", sid: sid }); };
    }
    function docRef(path) {
      var r = {
        id: path.split("/").pop(), path: path,
        get: function () { return rpc("get", path).then(function (d) { return snapDoc(path, d); }); },
        set: function (d) { return rpc("set", path, d).then(function () {}); },
        update: function (d) { return rpc("update", path, d).then(function () {}); },
        "delete": function () { return rpc("delete", path).then(function () {}); },
        onSnapshot: function (fn) { return sub(path, false, function (d) { fn(snapDoc(path, d)); }); },
        collection: function (p) { return collRef(path + "/" + p); }
      };
      return r;
    }
    function collRef(path) {
      var c = {
        path: path,
        doc: function (id) { return docRef(path + "/" + (id || rid(12))); },
        add: function (d) { var ref = c.doc(); return ref.set(d).then(function () { return ref; }); },
        where: function () { return c; }, orderBy: function () { return c; }, limit: function () { return c; },
        get: function () { return rpc("query", path).then(function (docs) { return snapColl(path, docs || []); }); },
        onSnapshot: function (fn) { return sub(path, true, function (docs) { fn(snapColl(path, docs || [])); }); }
      };
      return c;
    }
    room.emit = function (topic, data) { send({ t: "emit", topic: topic, data: data }); return Promise.resolve(); };
    room.presence = function (patch) {
      Object.keys(patch).forEach(function (k) { if (patch[k] === null) delete myPresence[k]; else myPresence[k] = patch[k]; });
      send({ t: "presence", presence: myPresence });
      return Promise.resolve();
    };
    function onData(m) {
      if (!m || typeof m !== "object") return;
      lastPong = Date.now();
      if (m.t === "res") { var p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.t); if (m.ok) p.res(m.data); else p.rej(m.err || { code: "unavailable" }); } }
      else if (m.t === "snap") { var s = subs.get(m.sid); if (s) try { s.fn(m.data); } catch (e) { console.error(e); } }
      else if (m.t === "room") room.deliver({ topic: m.topic, data: m.data, peer: m.peer, isMe: m.peer === me, sameTab: m.peer === me, kind: "viewer", by: null, guest: false });
      else if (m.t === "peers") room.setPeers(m.peers || [], me);
      else if (m.t === "welcome") me = m.peer;
    }
    function connectHost() {
      clearTimeout(retryT);
      if (!peer || peer.destroyed) return;
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} retryT = setTimeout(connectHost, backoff); return; }
      try { if (conn) conn.close(); } catch (e) {}
      state.signal = "suche"; status();
      var c = conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
      var opened = false;
      var to = setTimeout(function () { if (!opened && conn === c) { try { c.close(); } catch (e) {} lost(); } }, 12000);
      c.on("open", function () {
        if (conn !== c) return;
        opened = true; clearTimeout(to); backoff = 1500; lastPong = Date.now();
        me = peer.id;
        send({ t: "hello", role: myPresence.role || "" });
        send({ t: "presence", presence: myPresence });
        subs.forEach(function (s, sid) { send({ t: "sub", sid: sid, path: s.path, coll: s.coll }); });
        state.signal = "online"; state.host = true; state.error = ""; status();
        room.setConn(true);
      });
      c.on("data", function (m) { if (conn === c) onData(m); });
      c.on("close", function () { if (conn === c) lost(); });
      c.on("error", function () { if (conn === c) lost(); });
    }
    function lost() {
      if (room.conn) room.setConn(false);
      room.setPeers([], me);
      state.host = false; status();
      pending.forEach(function (p) { clearTimeout(p.t); p.rej({ code: "unavailable", message: "Verbindung verloren" }); });
      pending.clear();
      clearTimeout(retryT);
      retryT = setTimeout(connectHost, backoff);
      backoff = Math.min(10000, backoff * 1.6);
    }
    setInterval(function () {
      if (!room.conn) return;
      send({ t: "ping" });
      if (Date.now() - lastPong > 15000) { try { conn.close(); } catch (e) {} lost(); }
    }, 5000);
    if (typeof Peer === "function") {
      peer = new Peer(undefined, peerOptions());
      peer.on("open", function () { connectHost(); });
      peer.on("disconnected", function () { setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
      peer.on("error", function (e) {
        var t = e && e.type;
        if (t === "peer-unavailable") { state.error = "iPad mit Code " + code + " nicht gefunden"; state.host = false; status(); lost(); }
        else if (t === "network" || t === "server-error" || t === "socket-error") { state.error = "Kein Internet zum Verbinden"; status(); lost(); }
      });
      document.addEventListener("visibilitychange", function () { if (!document.hidden && !room.conn) { backoff = 1500; connectHost(); } });
      window.addEventListener("online", function () { if (!room.conn) { backoff = 1500; connectHost(); } });
    } else { state.error = "Verbindungsbibliothek fehlt"; }
    return Promise.resolve({ db: { doc: docRef, collection: collRef }, room: room.api, p2p: { role: "client", code: code, state: state } });
  }

  window.PCPeer = {
    PREFIX: PREFIX,
    newCode: function () { return rid(6); },
    cleanCode: function (s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); },
    hostCode: function () {
      var c = ls("pc-hostcode");
      if (!c) { c = rid(6); ls("pc-hostcode", c); }
      return c;
    },
    start: function (role, code, onStatus) {
      var status = function () { try { if (onStatus) onStatus(); } catch (e) {} };
      return role === "host" ? startHost(code, status) : startClient(code, status);
    }
  };
})();
