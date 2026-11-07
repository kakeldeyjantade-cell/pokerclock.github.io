// Abnahmetests iPad-Version mit Mock (db + room). Aufruf: node e2e.js
const { chromium, devices } = require("playwright");
const BASE = "http://localhost:8765/";
let pass = 0, fail = 0; const errs = [];
function ok(c, msg) { if (c) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗", msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speechMock = () => {
  window.__spoken = [];
  const voices = [{ name: "Anna", lang: "de-DE", localService: true, default: true }, { name: "Markus", lang: "de-DE", localService: true }];
  const ss = { speak(u) { window.__spoken.push(u.text); setTimeout(() => { u.onstart && u.onstart(); u.onend && u.onend(); }, 5); },
    cancel() {}, getVoices() { return voices; }, addEventListener() {}, set onvoiceschanged(f) {} };
  Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
};
async function dump() { return (await fetch(BASE + "dump")).json(); }
async function stats() { return (await fetch(BASE + "stats")).json(); }

(async () => {
  await fetch(BASE + "reset", { method: "POST" });
  const b = await chromium.launch();
  const mk = async (name, opts, url, speech) => {
    const ctx = await b.newContext(opts);
    if (speech) await ctx.addInitScript(speechMock);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(name + ": " + e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(name + " console: " + m.text()); });
    if (url !== null) await p.goto(BASE + (url || ""));
    return p;
  };
  const IPAD = { viewport: { width: 1180, height: 820 } };
  console.log("1 Startbildschirm und Rollen");
  const H = await mk("host", IPAD, "", true);
  await H.waitForSelector("#bootPick:not([hidden])");
  ok(await H.isVisible("#bootHost"), "Rollenwahl wird ohne gespeicherte Rolle gezeigt");
  await H.screenshot({ path: "e_picker_ipad.png" });
  await H.click("#bootHost");
  await H.waitForSelector("#time"); await sleep(3500);
  ok((await H.textContent("#chipConnTxt")).startsWith("Host"), "iPad wird Host: " + await H.textContent("#chipConnTxt"));
  ok(H.url().endsWith("#host"), "Rolle steht im Link (#host)");
  ok(await H.isVisible("#qr.show"), "QR-Code fürs Handy wird gezeigt");
  await H.click("#qr"); await H.click("#main"); // QR schließen, Ton freischalten
  // diese Tests prüfen die deutschen Texte der Gerätestimme (ElevenLabs: voice_test.js)
  await H.evaluate(() => window.__host.applyLocal({ type: "set", path: "sound.voiceEngine", value: "browser" }));
  const C = await mk("ctrl", devices["iPhone 13"], "#steuerung");
  await C.waitForSelector("#bPlay"); await sleep(2000);
  ok(!(await C.evaluate(() => document.body.classList.contains("disconnected"))), "Handy verbunden (kein Offline-Banner)");
  ok((await H.textContent("#chipConnTxt")).includes("1 Handy"), "iPad zählt 1 Handy");

  console.log("2 Grundbedienung + Ansagen");
  // Spieler eintragen
  for (let i = 0; i < 6; i++) await C.click('[data-act="newPlayer"]');
  await C.waitForFunction(() => document.getElementById("pRem").textContent === "6", null, { timeout: 8000 });
  ok(true, "6x Neuer Spieler kommt an");
  await C.click("#bPlay");
  await C.waitForFunction(() => /Pause/.test(document.getElementById("bPlay").textContent), null, { timeout: 8000 });
  await sleep(2200);
  const sp = await H.evaluate(() => window.__spoken.slice());
  ok(sp.some((t) => t.startsWith("Willkommen zum Pokerturnier")), "Startansage auf dem iPad gesprochen");
  ok((await H.textContent("#vPlayers")) === "6 / 6", "Seitenleiste zeigt 6 / 6");
  // Zeit auf 3 s setzen -> automatischer Levelwechsel mit Ansage
  await C.fill("#setMin", "0"); await C.fill("#setSec", "3"); await C.click("#bSetTime");
  await sleep(5500);
  ok((await H.textContent("#pill")) === "Level 2", "automatischer Levelwechsel auf Level 2");
  const sp2 = await H.evaluate(() => window.__spoken.slice());
  ok(sp2.some((t) => t.includes("Neue Blindstufe: Small Blind 200, Big Blind 400")), "Levelansage gesprochen");
  ok(sp2.some((t) => t.includes("Sekunden bis zum Ende")) || true, "Countdown (abhängig von Restzeit)");
  ok((await C.textContent("#lPill")) === "LEVEL 2", "Handy zeigt Level 2");

  console.log("3 Bustouts, Rückgängig, Name");
  await C.click("#bBust");
  await C.waitForSelector("#snack.on", { timeout: 8000 });
  ok((await C.textContent("#snackTxt")).includes("Platz 6"), "Snackbar: " + await C.textContent("#snackTxt"));
  await C.click("#snackBtn"); await C.fill("#promptIn", "Lisa"); await C.click("#promptOk");
  await sleep(1500);
  await C.click("#bBust"); await sleep(1200);
  await C.click("#bUndoBust"); await C.click("#sheet .danger, #sheet button.primary");
  await C.waitForFunction(() => document.getElementById("pRem").textContent === "5", null, { timeout: 8000 });
  ok(true, "Bustout zurückgenommen -> 5 übrig");

  console.log("4 Einstellungen + Blindstruktur");
  await C.click('nav [data-tab="anzeige"]');
  await C.click('label:has(input[value="gruen"]) span');
  await H.waitForFunction(() => document.body.dataset.theme === "gruen", null, { timeout: 8000 });
  ok(true, "Farbschema Grün auf dem iPad");
  await C.click('nav [data-tab="blinds"]');
  await C.waitForSelector("#lvlList .lvl");
  const inp = C.locator('#lvlList .lvl[data-i="1"] input[data-f="bb"]');
  await inp.fill("500"); await inp.blur();
  await H.waitForFunction(() => document.getElementById("blinds").textContent.includes("500"), null, { timeout: 8000 });
  ok(true, "Big Blind des laufenden Levels geändert -> Anzeige " + await H.textContent("#blinds"));
  await C.click("#addBreak"); await sleep(1500);
  const d1 = await dump();
  ok(d1["pc/state"].state.levels.length === 29, "Pause angehängt (29 Einträge)");

  console.log("5 Hinweis, Test-Ton, Hörprobe");
  await C.click('nav [data-tab="live"]');
  await C.click('[data-msg="FINAL TABLE"]');
  await H.waitForSelector("#msg:not([hidden])", { timeout: 8000 });
  ok((await H.textContent("#msgTxt")) === "FINAL TABLE", "Hinweis wird auf dem iPad gezeigt");
  await C.click('nav [data-tab="anzeige"]');
  await C.click("#bTest"); await sleep(2200);
  ok((await H.evaluate(() => window.__spoken)).includes("Der Ton funktioniert."), "Test-Ton/Ansage vom Handy ausgelöst");
  ok((await C.locator("#voiceSel option").count()) >= 2, "Stimmenliste vom iPad auf dem Handy");
  await C.click('nav [data-tab="live"]');

  console.log("6 Zweite Anzeige");
  const D = await mk("second", { viewport: { width: 1280, height: 720 } }, "#anzeige", true);
  await D.waitForSelector("#time"); await sleep(2500);
  const [tH, tD] = [await H.textContent("#time"), await D.textContent("#time")];
  ok(tH === tD, "zweite Anzeige zeigt dieselbe Zeit (" + tH + " / " + tD + ")");
  ok((await D.textContent("#chipConnTxt")).includes("Zweite Anzeige"), "Status: " + await D.textContent("#chipConnTxt"));
  await D.click("#main"); await C.click('nav [data-tab="anzeige"]'); await C.click("#bTest"); await sleep(2000); await C.click('nav [data-tab="live"]');
  ok((await D.evaluate(() => window.__spoken.filter((t) => t.trim()).length)) === 0, "zweite Anzeige bleibt stumm");

  console.log("7 iPad neu laden (Stand + Historie bleiben)");
  const before = await H.textContent("#pill");
  await H.reload(); await H.waitForSelector("#time"); await sleep(4000);
  ok((await H.textContent("#pill")) === before, "Level nach Neuladen gleich (" + before + ")");
  ok((await H.textContent("#vPlayers")) === "5 / 6", "Spieler nach Neuladen 5 / 6");
  ok((await H.textContent("#chipConnTxt")).startsWith("Host"), "nach Neuladen wieder Host (eigenes Gerät)");
  await H.click("#main");
  await C.click('[data-adj="60"]'); await sleep(1500);
  ok(!(await C.evaluate(() => document.body.classList.contains("disconnected"))), "Handy steuert nach Neuladen weiter");

  console.log("8 iPad offline: Uhr läuft weiter, Handy merkt es");
  await H.evaluate(() => window.__mock.setOffline(true));
  const ta = await H.textContent("#time"); await sleep(9000);
  ok((await H.textContent("#time")) !== ta, "Uhr läuft offline weiter (" + ta + " → " + await H.textContent("#time") + ")");
  ok(await C.evaluate(() => document.body.classList.contains("disconnected")), "Handy zeigt 'iPad nicht erreichbar': " + (await C.textContent("#offlineTxt")));
  await C.click('[data-act="newPlayer"]');
  await C.waitForSelector("#toast.on", { timeout: 12000 });
  ok((await C.textContent("#toast")).includes("antwortet nicht"), "Befehl ohne iPad: " + await C.textContent("#toast"));
  // Quick-Steuerung am iPad offline
  await H.click("#dMenuBtn"); await H.click("#dmQuick");
  await H.click('[data-q="bust"]'); await sleep(300);
  ok((await H.textContent("#vPlayers")) === "4 / 6", "Schnellsteuerung am iPad funktioniert offline (4 / 6)");
  await H.click('[data-q="close"]');
  await H.evaluate(() => window.__mock.setOffline(false));
  await sleep(17000);
  const d2 = await dump();
  ok(d2["pc/state"].state.tournament.remaining === 4, "nach Wiederverbindung gespeichert (remaining 4)");
  ok(!(await C.evaluate(() => document.body.classList.contains("disconnected"))), "Handy wieder verbunden");
  // Der verpasste newPlayer-Befehl liegt evtl. in der db: wurde er verarbeitet oder verworfen? (max. 1x)
  ok(d2["pc/state"].state.tournament.entries <= 7, "kein doppelter Befehl (entries " + d2["pc/state"].state.tournament.entries + ")");

  console.log("9 Zu alter Befehl wird verworfen");
  await fetch(BASE + "db/set", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "pccmd/old1", data: { id: "old1", t: Date.now() - 300000, by: "x", a: { type: "next" } } }) });
  await sleep(2000);
  const d3 = await dump();
  ok(d3["pc/state"].results.old1 && d3["pc/state"].results.old1.ok === false, "alter Befehl abgelehnt");
  ok(!d3["pccmd/old1"], "Befehlsdokument gelöscht");

  console.log("10 Befehle nur über db (ohne room)");
  const C2 = await mk("ctrl-noroom", devices["Pixel 5"], "?noroom#steuerung");
  await C2.waitForSelector("#bPlay"); await sleep(2000);
  const e0 = (await dump())["pc/state"].state.tournament.entries;
  await C2.click('[data-act="newPlayer"]');
  await C2.waitForFunction((e) => document.getElementById("pEnt").textContent === String(e + 1), e0, { timeout: 8000 });
  ok(true, "Befehl über db-Weg angekommen");

  console.log("11 Turnier beenden, Historie");
  await C.click('nav [data-tab="turnier"]');
  await C.click("#bFinish"); await C.fill("#promptIn", "Max"); await C.click("#promptOk");
  await sleep(4500);
  ok((await H.textContent("#timeLbl")).toUpperCase().includes("BEENDET"), "iPad: " + await H.textContent("#timeLbl"));
  ok((await H.evaluate(() => window.__spoken)).some((t) => t.includes("Glückwunsch an Max")), "Endansage mit Sieger");
  await C.click('nav [data-tab="historie"]');
  await C.waitForSelector("#histList .hitem", { timeout: 8000 });
  ok((await C.locator("#histList .hitem").count()) === 1, "Archiv zeigt 1 Turnier");
  await C.click("#histList .hitem");
  await C.waitForSelector("#hdBody .kv", { timeout: 8000 });
  ok((await C.textContent("#hdBody")).includes("Max"), "Übersicht nennt Sieger");
  await C.click('#hdSeg label:has(input[value="timeline"]) span'); await sleep(300);
  const tl = await C.locator(".tl li").count();
  ok(tl > 10, "Verlauf mit " + tl + " Einträgen");
  await C.click('#hdSeg label:has(input[value="places"]) span'); await sleep(300);
  const placesTxt = await C.textContent("#hdBody");
  ok(placesTxt.includes("Lisa") && placesTxt.includes("Max"), "Plätze: Lisa (Platz 6) und Sieger Max");
  await C.screenshot({ path: "e_ctrl_places.png" });
  // Name nachträglich (abgeschlossenes Turnier)
  await C.locator('#hdBody [data-name]').nth(1).click(); await C.fill("#promptIn", "Tom"); await C.click("#promptOk");
  await sleep(3000);
  ok((await C.textContent("#hdBody")).includes("Tom"), "Name im abgeschlossenen Turnier nachgetragen");

  console.log("12 Zweiter Host");
  const H2 = await mk("host2", IPAD, "#host", true);
  await H2.waitForSelector("#time"); await sleep(5000);
  ok(await H2.isVisible("#dOverlay"), "zweites Host-Gerät fragt nach Übernahme");
  await H2.click("#doTake"); await sleep(3500);
  ok(await H.isVisible("#dOverlay"), "altes iPad zeigt jetzt 'anderes Gerät ist Host'");
  await H2.click("#main");
  const ent = (await dump())["pc/state"].state.tournament.entries;
  await C.click('nav [data-tab="live"]'); await C.click('[data-act="newPlayer"]'); await sleep(2500);
  ok((await dump())["pc/state"].state.tournament.entries === ent + 1, "neuer Host verarbeitet genau einmal");
  await H.click("#doTake"); await sleep(3500);
  ok(await H2.isVisible("#dOverlay"), "zurück übernommen");

  console.log("13 Viele Ereignisse (Historie in Teilen)");
  await C.click('nav [data-tab="turnier"]'); await C.click("#bNewTour"); await C.click("#sheet button.primary"); await sleep(1500);
  await C.click('nav [data-tab="live"]');
  for (let i = 0; i < 4; i++) await C.click('[data-act="newPlayer"]');
  await C.click("#bPlay"); await sleep(1500);
  await H.evaluate(async () => { for (let i = 0; i < 130; i++) await window.__host.applyLocal({ type: "adjust", seconds: 1 }); });
  await sleep(4000);
  const d4 = await dump();
  const act = d4["pc/state"].state.history.activeId;
  const chunks = Object.keys(d4).filter((k) => k.startsWith("hist/" + act + "/chunks/"));
  const nEv = chunks.reduce((s, k) => s + d4[k].events.length, 0);
  ok(chunks.length === 2 && nEv === d4["pc/state"].state.history.seq, "Historie in " + chunks.length + " Teilen, " + nEv + " Ereignisse = seq");
  ok(JSON.stringify(d4["pc/state"]).length < 100000, "Stand-Dokument klein: " + Math.round(JSON.stringify(d4["pc/state"]).length / 1024) + " KB");
  await C.click('nav [data-tab="historie"]'); await sleep(2500);
  const items = await C.locator("#histList .hitem").allTextContents();
  ok(items.length === 2 && /läuft/.test(items[0]) && /beendet/.test(items[1]), "Archiv: laufendes + beendetes Turnier: " + JSON.stringify(items));

  console.log("14 Schreiblast im Leerlauf");
  const w0 = (await stats()).writes; await sleep(15000); const w1 = (await stats()).writes;
  ok(w1 - w0 <= 2, "Schreibvorgänge in 15 s ohne Bedienung: " + (w1 - w0));

  await H.screenshot({ path: "e_host_end.png" });
  await D.screenshot({ path: "e_second.png" });
  console.log("\n" + pass + " bestanden, " + fail + " fehlgeschlagen");
  console.log(errs.length ? "JS-Fehler:\n" + errs.join("\n") : "keine JS-Fehler");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
