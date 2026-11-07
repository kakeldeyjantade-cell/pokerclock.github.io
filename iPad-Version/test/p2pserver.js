// Testumgebung ohne claude.ai: statischer Server für ohne-claude/index.html + lokaler PeerJS-Server
const http = require("http"), fs = require("fs"), path = require("path");
const M = "/home/claude/p2p/node_modules/";
const express = require(M + "express"), { ExpressPeerServer } = require(M + "peer");
const app = express(), srv = http.createServer(app);
app.use("/", ExpressPeerServer(srv, { path: "/" }));
srv.listen(9000, "127.0.0.1");
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(__dirname, "..", "ohne-claude", "index.html")));
}).listen(8770, "127.0.0.1", () => console.log("p2p test auf 8770, peer auf 9000"));
