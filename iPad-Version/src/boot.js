/* Pokerclock – Start: Rolle dieses Geräts wählen und passende Ansicht laden.
   PC_MODE "claude": Verbindung über claude.ai. PC_MODE "p2p": Direktverbindung, das iPad hat einen Code. */
(function () {
  "use strict";
  var L = PCLink, P2P = window.PC_MODE === "p2p";
  var ROLES = { host: 1, control: 1, display: 1 };
  // Rolle (und Code) können im Link stehen: #steuerung, #host, #anzeige bzw. #steuerung-AB12CD
  var HASH = { steuerung: "control", host: "host", anzeige: "display" };
  var TOHASH = { control: "steuerung", host: "host", display: "anzeige" };
  function fromHash() {
    var m = /^#(steuerung|host|anzeige)(?:-([a-z0-9]+))?$/i.exec(location.hash || "");
    return m ? { role: HASH[m[1].toLowerCase()], code: m[2] ? m[2].toUpperCase() : "" } : null;
  }
  var $ = function (id) { return document.getElementById(id); };
  function setHash(role, code) {
    var h = "#" + TOHASH[role] + (P2P && code && role !== "host" ? "-" + code : "");
    try { history.replaceState(null, "", h); } catch (e) {}
  }
  function clientCode() { return P2P ? (L.ls("pc-code") || "") : ""; }

  var claudeCap = P2P ? null : L.init();
  function capFor(role) {
    if (!P2P) return claudeCap;
    var code = role === "host" ? PCPeer.hostCode() : clientCode();
    return PCPeer.start(role, code, function () { if (window.__pcStatus) window.__pcStatus(); });
  }

  function launch(role) {
    if (P2P && role !== "host" && !clientCode()) { askCode(role); return; }
    $("boot").hidden = false;
    $("bootPick").hidden = true; $("bootCode").hidden = true; $("bootWait").hidden = false;
    capFor(role).then(function (cap) {
      var tpl = $(role === "control" ? "tpl-control" : "tpl-display");
      document.body.appendChild(tpl.content.cloneNode(true));
      $("boot").hidden = true;
      document.documentElement.dataset.role = role;
      var dev = L.deviceId();
      if (role === "control") window.startControl(cap, dev);
      else window.startDisplay(role === "host" ? "host" : "display", cap, dev);
    });
  }
  function showPicker(current) {
    $("boot").hidden = false; $("bootWait").hidden = true; $("bootCode").hidden = true; $("bootPick").hidden = false;
    document.querySelectorAll("[data-role]").forEach(function (b) { b.classList.toggle("cur", b.dataset.role === current); });
    $("bootCancel").hidden = !current;
    if (!P2P) claudeCap.then(function (cap) { $("bootNoCap").hidden = !!cap.db; });
  }
  // Direktverbindung: Code des iPads eingeben (steht oben rechts auf der Anzeige)
  var codeRole = null;
  function askCode(role) {
    codeRole = role;
    $("boot").hidden = false; $("bootPick").hidden = true; $("bootWait").hidden = true; $("bootCode").hidden = false;
    $("bootCodeIn").value = clientCode();
    setTimeout(function () { try { $("bootCodeIn").focus(); } catch (e) {} }, 50);
  }
  if ($("bootCodeOk")) {
    $("bootCodeOk").addEventListener("click", function () {
      var c = PCPeer.cleanCode($("bootCodeIn").value);
      if (c.length < 4) { $("bootCodeErr").hidden = false; return; }
      L.ls("pc-code", c);
      var running = document.documentElement.dataset.role;
      setHash(codeRole, c);
      if (running) { L.ls("pc-role", codeRole); try { location.reload(); } catch (e) {} }
      else { L.ls("pc-role", codeRole); launch(codeRole); }
    });
    $("bootCodeIn").addEventListener("keydown", function (e) { if (e.key === "Enter") $("bootCodeOk").click(); });
    $("bootCodeBack").addEventListener("click", function () { showPicker(document.documentElement.dataset.role || null); });
  }

  window.PCBoot = {
    setRole: function (r) {
      L.ls("pc-role", r);
      setHash(r, clientCode());
      try { location.reload(); } catch (e) {}
    },
    chooseRole: function () { showPicker(document.documentElement.dataset.role || L.ls("pc-role")); },
    changeCode: function () { askCode(document.documentElement.dataset.role || "control"); }
  };
  document.querySelectorAll("[data-role]").forEach(function (b) {
    b.addEventListener("click", function () {
      var r = b.dataset.role, cur = document.documentElement.dataset.role;
      if (cur && cur === r) { $("boot").hidden = true; return; }
      if (P2P && r !== "host" && (!clientCode() || cur)) { askCode(r); return; }
      if (cur) window.PCBoot.setRole(r);
      else { L.ls("pc-role", r); setHash(r, clientCode()); launch(r); }
    });
  });
  $("bootCancel").addEventListener("click", function () { $("boot").hidden = true; });

  var h = fromHash();
  if (h && h.code && P2P) L.ls("pc-code", h.code);
  var role = (h && h.role) || L.ls("pc-role");
  if (role && ROLES[role]) { L.ls("pc-role", role); setHash(role, clientCode()); launch(role); } else showPicker(null);
})();
