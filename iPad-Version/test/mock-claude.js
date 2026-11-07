/* Test-Ersatz für window.claude (db + room) – nur in dist/test.html */
(function () {
  var q = new URLSearchParams(location.search);
  var LAT = +q.get("lat") || 0, me = "p" + Math.random().toString(36).slice(2, 8);
  var offline = false;
  var docL = [], roomH = {}, peersH = [], connH = [], peersList = [], myPres = {}, conn = false;
  function wait() { return new Promise(function (r) { setTimeout(r, LAT); }); }
  function post(u, b) {
    return wait().then(function () {
      if (offline) throw { code: "unavailable", message: "offline" };
      return fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    }).then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw { code: j.error, message: j.error }; return j; });
  }
  function snap(path, data) {
    return { id: path.split("/").pop(), exists: data != null, data: function () { return data == null ? undefined : JSON.parse(JSON.stringify(data)); },
      metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function rid() { return Math.random().toString(36).slice(2, 12); }
  function docRef(path) {
    var r = {
      id: path.split("/").pop(), path: path,
      get: function () { return post("/db/get", { path: path }).then(function (j) { return snap(path, j.data); }); },
      set: function (d) { return post("/db/set", { path: path, data: d }).then(function () {}); },
      update: function (d) { return post("/db/update", { path: path, data: d }).then(function () {}); },
      "delete": function () { return post("/db/delete", { path: path }).then(function () {}); },
      onSnapshot: function (fn, err) { var l = { path: path, coll: false, fn: fn }; docL.push(l); r.get().then(fn).catch(function () {}); return function () { docL.splice(docL.indexOf(l), 1); }; },
      collection: function (p) { return collRef(path + "/" + p); }
    };
    return r;
  }
  function collRef(path) {
    var c = {
      path: path,
      doc: function (id) { return docRef(path + "/" + (id || rid())); },
      add: function (d) { var ref = c.doc(); return ref.set(d).then(function () { return ref; }); },
      where: function () { return c; }, orderBy: function () { return c; }, limit: function () { return c; },
      get: function () {
        return post("/db/query", { collection: path }).then(function (j) {
          var ds = j.docs.map(function (d) { return snap(path + "/" + d.id, d.data); });
          return { docs: ds, size: ds.length, empty: !ds.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: function () { return []; } };
        });
      },
      onSnapshot: function (fn) { var l = { path: path, coll: true, fn: fn }; docL.push(l); c.get().then(fn).catch(function () {}); return function () { docL.splice(docL.indexOf(l), 1); }; }
    };
    return c;
  }
  var es;
  function connectES() {
  es = new EventSource("/events?peer=" + me);
  es.addEventListener("hello", function () { conn = true; connH.forEach(function (f) { f(true); }); });
  es.addEventListener("db", function (e) {
    if (offline) return;
    var p = JSON.parse(e.data).path, parent = p.slice(0, p.lastIndexOf("/"));
    docL.slice().forEach(function (l) {
      if (!l.coll && l.path === p) wait().then(function () { return docRef(p).get(); }).then(l.fn).catch(function () {});
      if (l.coll && l.path === parent) wait().then(function () { return collRef(l.path).get(); }).then(l.fn).catch(function () {});
    });
  });
  es.addEventListener("room", function (e) {
    if (offline) return;
    var m = JSON.parse(e.data);
    setTimeout(function () {
      (roomH[m.topic] || []).forEach(function (f) { f({ topic: m.topic, data: m.data, peer: m.peer, isMe: m.peer === me, sameTab: m.peer === me, kind: "viewer", by: "u_owner", guest: false }); });
    }, LAT);
  });
  es.addEventListener("peers", function (e) {
    var list = JSON.parse(e.data);
    peersList = Object.freeze(list.map(function (p) { return Object.freeze({ peer: p.peer, presence: p.presence, isMe: p.peer === me, sameTab: p.peer === me, kind: "viewer", by: "u_owner", guest: false, updatedAt: Date.now() }); }));
    peersH.forEach(function (f) { f({ peers: peersList, joined: [], left: [], updated: [] }); });
  });
  }
  connectES();
  var room = {
    emit: function (topic, data) { if (offline) return Promise.resolve(); return post("/room/emit", { peer: me, topic: topic, data: data }).then(function () {}); },
    on: function (topic, fn) { (roomH[topic] = roomH[topic] || []).push(fn); return function () { roomH[topic].splice(roomH[topic].indexOf(fn), 1); }; },
    presence: function (patch) { myPres = Object.assign({}, myPres, patch); return post("/room/presence", { peer: me, presence: myPres }).then(function () {}); },
    peers: function () { return offline ? [] : peersList; },
    onPeers: function (fn) { peersH.push(fn); setTimeout(function () { fn({ peers: peersList, joined: peersList, left: [], updated: [] }); }); return function () {}; },
    connected: function () { return conn && !offline; },
    onConnection: function (fn) { connH.push(fn); setTimeout(function () { fn(conn); }); return function () {}; }
  };
  var db = { doc: docRef, collection: collRef };
  window.claude = { use: function (n) { return new Promise(function (r) { setTimeout(function () { r(n === "db" && !q.has("nodb") ? db : n === "room" && !q.has("noroom") ? room : null); }, 30); }); } };
  window.__mock = { me: me, setOffline: function (v) {
    offline = !!v;
    if (v) { es.close(); conn = false; connH.forEach(function (f) { f(false); }); }
    else { connectES(); setTimeout(function () { post("/room/presence", { peer: me, presence: myPres }); }, 200); }
  } };
})();
