const { chromium, devices } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const ipad = await b.newContext({ viewport: { width: 1180, height: 820 } });
  const phone = await b.newContext({ ...devices["iPhone 13"] });
  const H = await ipad.newPage(), C = await phone.newPage();
  const errs = [];
  for (const [n, p] of [["host", H], ["ctrl", C]]) {
    p.on("pageerror", (e) => errs.push(n + ": " + e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(n + " console: " + m.text()); });
  }
  await fetch("http://localhost:8765/reset", { method: "POST" });
  await H.goto("http://localhost:8765/#host");
  await H.waitForTimeout(4000);
  await H.screenshot({ path: "s_host1.png" });
  await C.goto("http://localhost:8765/#steuerung");
  await C.waitForTimeout(2500);
  await C.screenshot({ path: "s_ctrl1.png" });
  const t0 = Date.now();
  await C.click("#bPlay");
  await C.waitForFunction(() => document.getElementById("bPlay").textContent.includes("Pause"), null, { timeout: 8000 });
  console.log("Start bestätigt nach", Date.now() - t0, "ms");
  await H.waitForTimeout(1500);
  console.log("Host-Zeit:", await H.textContent("#time"), "| Label:", await H.textContent("#timeLbl"), "| Conn:", await H.textContent("#chipConnTxt"));
  console.log("Ctrl-Zeit:", await C.textContent("#lTime"), "| offline-Banner:", await C.evaluate(() => document.body.classList.contains("disconnected")));
  await H.screenshot({ path: "s_host2.png" });
  console.log(errs.length ? errs.join("\n") : "keine Fehler");
  await b.close();
})();
