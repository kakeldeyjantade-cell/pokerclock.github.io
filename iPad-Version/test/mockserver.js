// Mock für claude.ai: db (Dokumente) + room (Anwesenheit/Ereignisse), dazu die Testseite
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = +process.argv[2] || 8765;
const docs = new Map(); const clients = new Map(); const presence = new Map();
let writes = 0;
function send(res, code, obj) { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }
function broadcast(ev, data) { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients.values()) c.write(s); }
function peers() { return [...clients.keys()].map((p) => ({ peer: p, presence: presence.get(p) || {} })); }
function merge(a, b) { const o = { ...a }; for (const k in b) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && o[k] && typeof o[k] === "object" ? merge(o[k], b[k]) : b[k]; return o; }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/test.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(__dirname, "..", "dist", "test.html")));
  }
  if (u.pathname === "/events") {
    const peer = u.searchParams.get("peer");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write("event: hello\ndata: {}\n\n");
    clients.set(peer, res); broadcast("peers", peers());
    req.on("close", () => { clients.delete(peer); presence.delete(peer); broadcast("peers", peers()); });
    return;
  }
  if (u.pathname === "/stats") return send(res, 200, { writes, docs: docs.size, paths: [...docs.keys()] });
  if (u.pathname === "/dump") return send(res, 200, Object.fromEntries(docs));
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const b = body ? JSON.parse(body) : {};
    switch (u.pathname) {
      case "/db/get": return send(res, 200, { data: docs.has(b.path) ? docs.get(b.path) : null });
      case "/db/set": writes++; if (JSON.stringify(b.data).length > 256 * 1024) return send(res, 200, { error: "invalid_argument" });
        docs.set(b.path, b.data); broadcast("db", { path: b.path }); return send(res, 200, {});
      case "/db/update": if (!docs.has(b.path)) return send(res, 200, { error: "invalid_argument" });
        writes++; docs.set(b.path, merge(docs.get(b.path), b.data)); broadcast("db", { path: b.path }); return send(res, 200, {});
      case "/db/delete": writes++; docs.delete(b.path); broadcast("db", { path: b.path }); return send(res, 200, {});
      case "/db/query": {
        const pre = b.collection + "/";
        const out = [...docs.entries()].filter(([p]) => p.startsWith(pre) && !p.slice(pre.length).includes("/"))
          .map(([p, d]) => ({ id: p.slice(pre.length), data: d })).sort((x, y) => (x.id < y.id ? -1 : 1));
        return send(res, 200, { docs: out });
      }
      case "/room/emit": broadcast("room", { topic: b.topic, data: b.data, peer: b.peer }); return send(res, 200, {});
      case "/room/presence": presence.set(b.peer, b.presence); broadcast("peers", peers()); return send(res, 200, {});
      case "/reset": docs.clear(); writes = 0; return send(res, 200, {});
    }
    send(res, 404, { error: "not found" });
  });
});
server.listen(PORT, () => console.log("mock auf", PORT));
