"""Baut die iPad-Version als eine Datei (Artifact) und eine Testseite mit Mock."""
import os, sys
D = os.path.dirname(os.path.abspath(__file__))
S = lambda f: open(os.path.join(D, "src", f), encoding="utf-8").read()
URL = open(os.path.join(D, "src", "url.txt")).read().strip() if os.path.exists(os.path.join(D, "src", "url.txt")) else ""
QR = S("vendor/qrcode.js")
PEER = S("vendor/peerjs.min.js")

VOICE_FILE = os.environ.get("PC_VOICE_FILE") or os.path.join(D, "stimme", "voice-data.js")
VOICE = open(VOICE_FILE, encoding="utf-8").read() if os.path.exists(VOICE_FILE) else ""

def script(code):
    assert "</script" not in code.lower()
    return "<script>\n" + code + "\n</script>\n"

page = (S("shell.html") +
        '\n<template id="tpl-display"><style>' + S("display.style.css") + "</style>" + S("display.body.html") + "</template>\n" +
        '<template id="tpl-control"><style>' + S("control.style.css") + "</style>" + S("control.body.html") + "</template>\n" +
        script(QR) + script(S("engine.js")) + script(S("shared.js")) + script(S("link.js")) + script(S("host.js")) +
        (script(VOICE) if VOICE else "") + script(S("voice.js")) + script(S("display.js")) + script(S("control.js")) +
        script("window.PC_URL = %r;\n" % URL + S("boot.js")))
# Variante ohne claude.ai: Direktverbindung (PeerJS), eine einzige Datei für eigenes Hosting
p2p = (S("shell.html").replace("Turnieruhr fürs iPad, gesteuert vom Handy", "Turnieruhr fürs iPad, gesteuert vom Handy") +
       '\n<template id="tpl-display"><style>' + S("display.style.css") + "</style>" + S("display.body.html") + "</template>\n" +
       '<template id="tpl-control"><style>' + S("control.style.css") + "</style>" + S("control.body.html") + "</template>\n" +
       script(QR) + script(PEER) + script(S("engine.js")) + script(S("shared.js")) + script(S("link.js")) + script(S("peer-cap.js")) +
       script(S("host.js")) + (script(VOICE) if VOICE else "") + script(S("voice.js")) + script(S("display.js")) + script(S("control.js")) +
       script('window.PC_MODE = "p2p";\n' + S("boot.js")))
HEAD = ('<!doctype html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Pokerclock">'
        '<style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}[hidden]{display:none!important}img{max-width:100%}</style>'
        '</head><body>')
os.makedirs(os.path.join(D, "ohne-claude"), exist_ok=True)
open(os.path.join(D, "ohne-claude", "index.html"), "w", encoding="utf-8").write(HEAD + p2p + "</body></html>")
print("ohne-claude/index.html", len(p2p) // 1024, "KB")
os.makedirs(os.path.join(D, "dist"), exist_ok=True)
open(os.path.join(D, "dist", "pokerclock.html"), "w", encoding="utf-8").write(page)
mock = open(os.path.join(D, "test", "mock-claude.js"), encoding="utf-8").read() if os.path.exists(os.path.join(D, "test", "mock-claude.js")) else ""
test = ('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style>'
        '</head><body>' + script(mock) + page + "</body></html>")
open(os.path.join(D, "dist", "test.html"), "w", encoding="utf-8").write(test)
print("pokerclock.html", len(page) // 1024, "KB")
