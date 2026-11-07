import json
M=60000;S=[]
a=lambda **k: S.append({"action":k}); adv=lambda ms,**k: S.append(dict({"advance":ms},**k))
a(type="set",path="tournament.entries",value=6); a(type="set",path="tournament.remaining",value=6)
a(type="toggle"); adv(5*M); a(type="bust")
S.append({"restart": 90*M})          # iPad 90 min aus: Wechsel nachtragen, nicht ansagen
adv(10*M); a(type="toggle")
S.append({"restart": 5*M})           # aus während pausiert
a(type="toggle"); adv(30*1000)
S.append({"restart": 3000})          # kurzer Neustart direkt nach Levelwechsel
adv(20*M); a(type="finish",winner="Ana"); S.append({"summary":1})
S.append({"restart": 1000}); a(type="nameBust",ref="winner",name="Anna")
json.dump({"t0":1792950000000,"steps":S},open("scenario2.json","w"))
