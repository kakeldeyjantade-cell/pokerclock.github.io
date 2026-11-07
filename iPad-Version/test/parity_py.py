"""Führt ein Szenario mit dem Original-server.py (simulierte Uhr) aus und schreibt eine Spur als JSON."""
import importlib.util, json, os, shutil, sys, tempfile, uuid

scenario_file, out_file, server_src = sys.argv[1], sys.argv[2], sys.argv[3]
tmp = tempfile.mkdtemp()
shutil.copy(server_src, os.path.join(tmp, "server.py"))

CNT = [0]
class FakeUUID:
    def __init__(self, h): self.hex = h
def fake_uuid4():
    CNT[0] += 1
    return FakeUUID(format(CNT[0], "08x") * 4)
uuid.uuid4 = fake_uuid4

T = [0]
spec = importlib.util.spec_from_file_location("server", os.path.join(tmp, "server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
server.now_ms = lambda: T[0]

sc = json.load(open(scenario_file))
T[0] = sc["t0"]
CNT[0] = 0
clk = server.Clock()
clk.ann.clear()
clk._obs = None
clk.boot_sync() if sc.get("boot") else clk.detect(T[0])

trace = []
seen_ann = 0
def snap(label, err=None):
    global seen_ann
    st = json.loads(json.dumps(clk.state))
    st.pop("security", None)
    anns = [a for a in clk.ann if a["id"] > seen_ann]
    if clk.ann:
        seen_ann = max(a["id"] for a in clk.ann)
    hist = {}
    if os.path.isdir(server.HISTORY_DIR):
        for fn in sorted(os.listdir(server.HISTORY_DIR)):
            hist[fn[:-6]] = clk.read_events(fn[:-6])
    trace.append({"label": label, "t": T[0], "err": err, "state": st, "ann": anns, "hist": hist,
                  "totals": clk.totals(), "cnt": CNT[0]})

def run():
  global clk, seen_ann
  for i, step in enumerate(sc["steps"]):
      if "advance" in step:
          target = T[0] + step["advance"]
          tick = step.get("tick", 200)
          while T[0] < target:
              T[0] = min(target, T[0] + tick)
              if step.get("ticker", True):
                  clk.detect(T[0])
          snap("advance %d" % i)
      elif "action" in step:
          err = None
          try:
              clk.apply(step["action"])
          except ValueError as e:
              err = str(e)
          snap("action %d %s" % (i, step["action"].get("type")), err)
      elif "restart" in step:
          clk.normalize(); clk.save()
          T[0] += step["restart"]
          clk = server.Clock(); clk.boot_sync(); seen_ann = 0
          snap("restart %d" % i)
      elif "summary" in step:
          tid = clk.state["history"].get("lastId")
          trace.append({"label": "summary %d" % i, "summary": server.summarize(clk.read_events(tid), clk.state["history"].get("activeId")) if tid else {}, "t": T[0]})

run()
json.dump(trace, open(out_file, "w"), ensure_ascii=False)
