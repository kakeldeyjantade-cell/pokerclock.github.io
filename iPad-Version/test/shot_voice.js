const { chromium, devices } = require("playwright");
(async () => {
  await fetch("http://localhost:8765/reset", { method: "POST" });
  const b = await chromium.launch();
  const H = await (await b.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  await H.goto("http://localhost:8765/#host"); await H.waitForTimeout(3000);
  const C = await (await b.newContext(devices["iPhone 13"])).newPage();
  await C.goto("http://localhost:8765/#steuerung"); await C.waitForTimeout(2500);
  await C.click('nav [data-tab="anzeige"]'); await C.waitForTimeout(500);
  await C.locator("#voiceCard").scrollIntoViewIfNeeded();
  await C.locator("#voiceCard").screenshot({ path: "v_voicecard.png" });
  await b.close();
})();
