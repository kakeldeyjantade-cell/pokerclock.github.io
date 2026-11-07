// Abnahmetests der Version ohne claude.ai (Direktverbindung). Aufruf: node p2p_e2e.js
const { chromium, devices } = require("playwright");
const BASE = "http://localhost:8770/?peerhost=127.0.0.1&peerport=9000";
let pass = 0, fail = 0; const errs = [];
function ok(c, msg) { if (c) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗", msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speechMock = () => {
  window.__spoken = [];
  const ss = { speak(u) { window.__spoken.push(u.text); setTimeout(() => { u.onend && u.onend(); }, 5); }, cancel() {},
    getVoices() { return [{ name: "Anna", lang: "de-DE", localService: true }]; }, addEventListener() {} };
  Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
};
(async () => {
  const b = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  const mk = async (name, opts, hash, speech) => {
    const ctx = await b.newContext(opts);
    if (speech) await ctx.addInitScript(speechMock);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(name + ": " + e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/peer|WebSocket|ERR_/i.test(m.text())) errs.push(name + " console: " + m.text()); });
    await p.goto(BASE + hash);
    return { p, ctx };
  };
  console.log("1 iPad als Host mit Code");
  const { p: H, ctx: Hctx } = await mk("host", { viewport: { width: 1180, height: 820 } }, "#host", true);
  await H.waitForSelector("#time"); await sleep(2500);
  const chip = await H.textContent("#chipConnTxt");
  const code = (chip.match(/Code ([A-Z0-9]+)/) || [])[1];
  ok(!!code && /0 Handys/.test(chip), "Host online: " + chip);
  ok(await H.isVisible("#qr.show"), "QR-Code mit Code wird gezeigt");
  const qrUrl = await H.textContent("#qrUrls");
  ok(qrUrl.includes("#steuerung-" + code), "QR-Link: " + qrUrl);
  await H.screenshot({ path: "p_qr.png" });
  await H.click("#qr"); await H.click("#main");
  // diese Tests prüfen die deutschen Texte der Gerätestimme (ElevenLabs: voice_test.js)
  await H.evaluate(() => window.__host.applyLocal({ type: "set", path: "sound.voiceEngine", value: "browser" }));

  console.log("2 Handy per QR-Link");
  const { p: C } = await mk("ctrl", devices["iPhone 13"], "#steuerung-" + code);
  await C.waitForSelector("#bPlay"); await sleep(3000);
  ok(!(await C.evaluate(() => document.body.classList.contains("disconnected"))), "Handy verbunden");
  ok((await H.textContent("#chipConnTxt")).includes("1 Handy"), "iPad: " + await H.textContent("#chipConnTxt"));
  for (let i = 0; i < 5; i++) await C.click('[data-act="newPlayer"]');
  await C.waitForFunction(() => document.getElementById("pRem").textContent === "5", null, { timeout: 8000 });
  const t0 = Date.now(); await C.click("#bPlay");
  await C.waitForFunction(() => /Pause/.test(document.getElementById("bPlay").textContent), null, { timeout: 8000 });
  ok(true, "Start bestätigt nach " + (Date.now() - t0) + " ms");
  await sleep(2200);
  ok((await H.evaluate(() => window.__spoken)).some((t) => t.startsWith("Willkommen")), "Startansage auf dem iPad");
  await C.click("#bBust"); await C.waitForSelector("#snack.on", { timeout: 8000 });
  ok((await H.textContent("#vPlayers")) === "4 / 5", "Bustout auf dem iPad: 4 / 5");

  console.log("3 Handy mit Code-Eingabe + zweite Anzeige");
  const { p: C2 } = await mk("ctrl2", devices["Pixel 5"], "");
  await C2.click("#bootControl");
  await C2.waitForSelector("#bootCode:not([hidden])");
  await C2.fill("#bootCodeIn", code.toLowerCase()); await C2.click("#bootCodeOk");
  await C2.waitForSelector("#bPlay"); await sleep(3000);
  ok((await C2.textContent("#pRem")) === "4", "zweites Handy per Code verbunden, sieht 4 Spieler");
  await C2.screenshot({ path: "p_ctrl2.png" });
  const { p: D } = await mk("second", { viewport: { width: 1280, height: 720 } }, "#anzeige-" + code, true);
  await D.waitForSelector("#time"); await sleep(3000);
  ok((await D.textContent("#time")) === (await H.textContent("#time")), "zweite Anzeige synchron: " + await D.textContent("#time"));
  ok((await H.textContent("#chipConnTxt")).includes("2 Handys"), "iPad zählt 2 Handys: " + await H.textContent("#chipConnTxt"));

  console.log("4 Historie über die Direktverbindung");
  await C.click('nav [data-tab="turnier"]'); await C.click("#bFinish"); await C.fill("#promptIn", "Max"); await C.click("#promptOk");
  await sleep(2500);
  await C.click('nav [data-tab="historie"]'); await sleep(2000);
  ok((await C.locator("#histList .hitem").count()) === 1, "Archiv: 1 Turnier");
  await C.click("#histList .hitem"); await C.waitForSelector("#hdBody .kv", { timeout: 8000 });
  ok((await C.textContent("#hdBody")).includes("Max"), "Detail mit Sieger");

  console.log("5 iPad neu laden: Daten bleiben (IndexedDB), Handy verbindet sich neu");
  await H.reload(); await H.waitForSelector("#time"); await sleep(4000);
  ok((await H.textContent("#timeLbl")).toUpperCase().includes("BEENDET"), "Stand nach Neuladen: " + await H.textContent("#timeLbl"));
  const chip2 = await H.textContent("#chipConnTxt");
  ok(chip2.includes("Code " + code), "gleicher Code nach Neuladen: " + chip2);
  await sleep(12000);
  ok(!(await C.evaluate(() => document.body.classList.contains("disconnected"))), "Handy automatisch wieder verbunden");
  await C.click('nav [data-tab="turnier"]'); await C.click("#bNewTour"); await C.click("#sheet button.primary");
  await H.waitForFunction(() => /startet gleich/i.test(document.getElementById("timeLbl").textContent), null, { timeout: 8000 });
  ok(true, "Befehl nach Wiederverbindung kommt an");

  console.log("6 Handy ohne iPad");
  await Hctx.close(); await sleep(20000);
  ok(await C.evaluate(() => document.body.classList.contains("disconnected")), "Handy merkt fehlendes iPad: " + await C.textContent("#offlineTxt"));

  await C.screenshot({ path: "p_ctrl_offline.png" });
  console.log("\n" + pass + " bestanden, " + fail + " fehlgeschlagen");
  console.log(errs.length ? "JS-Fehler:\n" + errs.join("\n") : "keine JS-Fehler");
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
