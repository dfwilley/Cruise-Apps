#!/usr/bin/env python3
"""Downloads landmarks along the voyage track from OpenStreetMap (Overpass API) and writes
fjord-spotter/data/landmarks.json. Run by the "Landmark data" GitHub workflow.

Data © OpenStreetMap contributors, available under the Open Database License (ODbL)."""
import json, math, sys, time, urllib.request, urllib.parse, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
route = json.loads((ROOT / "fjord-spotter/data/route.json").read_text())
track = [(p[0], p[1]) for p in route["track"]]
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]

def legs():
    """Split the track at open-sea stretches (no landmarks out there) into coastal pieces of ≤ 8 points."""
    pieces, cur = [], [track[0]]
    for a, b in zip(track, track[1:]):
        dist = math.hypot(b[0] - a[0], (b[1] - a[1]) * math.cos(math.radians(a[0]))) * 111
        if dist > 150:  # North Sea crossing: start a new piece
            pieces.append(cur); cur = [b]; continue
        cur.append(b)
        if len(cur) >= 8: pieces.append(cur); cur = [b]
    pieces.append(cur)
    return [p for p in pieces if p]

def around(r, pts):
    return f"around:{r}," + ",".join(f"{la:.4f},{lo:.4f}" for la, lo in pts)

def query(pts):
    a40, a25, a20 = around(40000, pts), around(25000, pts), around(20000, pts)
    return f"""[out:json][timeout:240];
(
  node["natural"="peak"]["name"](if: number(t["ele"]) >= 300)({a40});
  node["natural"="volcano"]["name"]({a40});
  node["place"~"^(city|town|village)$"]["name"]({a20});
  nwr["place"="island"]["name"]({a20});
  nwr["natural"~"^(bay|strait|cape)$"]["name"]({a20});
  nwr["natural"="glacier"]["name"]({a40});
  node["man_made"="lighthouse"]({a25});
  node["seamark:type"~"^(light_major|light_minor|lighthouse)$"]({a25});
  node["historic"="wreck"]["name"]({a20});
  node["seamark:type"="wreck"]["seamark:name"]({a20});
);
out center tags;"""

def fetch(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(3):
        for s in SERVERS:
            try:
                req = urllib.request.Request(s, data=data, headers={"User-Agent": "FjordSpotter/1.0 (personal cruise app; github.com/dfwilley/Cruise-Apps)"})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.loads(r.read())
            except Exception as e:
                print(f"  {s} failed: {e}", file=sys.stderr)
        time.sleep(20 * (attempt + 1))
    raise SystemExit("All Overpass servers failed")

def num(v):
    if v is None: return None
    m = re.match(r"\s*(-?\d+(?:[.,]\d+)?)", str(v))
    return float(m.group(1).replace(",", ".")) if m else None

def light_info(t):
    """Collect light character, group, period, colours (all sectors) and range from seamark tags."""
    ch = t.get("seamark:light:character"); grp = t.get("seamark:light:group"); per = t.get("seamark:light:period"); rng = t.get("seamark:light:range")
    cols = set()
    for k, v in t.items():
        m = re.match(r"seamark:light(?::(\d+))?:(\w+)$", k)
        if not m: continue
        field = m.group(2)
        if field == "colour": cols.update(c.strip() for c in re.split(r"[;,]", v) if c.strip())
        elif field == "character" and not ch: ch = v
        elif field == "group" and not grp: grp = v
        elif field == "period" and not per: per = v
        elif field == "range": rng = max(num(rng) or 0, num(v) or 0) or rng
    if not ch and not cols: return None
    return {k: v for k, v in {"ch": ch, "grp": grp, "per": num(per), "col": sorted(cols) or None, "rng": num(rng), "h": num(t.get("seamark:light:height"))}.items() if v not in (None, "", [])}

def kind(t):
    if t.get("natural") in ("peak", "volcano"): return "peak"
    if t.get("natural") == "glacier": return "glacier"
    if t.get("place") == "island": return "island"
    if t.get("natural") == "cape": return "cape"
    if t.get("natural") in ("bay", "strait"): return "fjord" if re.search(r"fjord|fjorden|sund|sundet|leia|firth", t.get("name", ""), re.I) else t["natural"]
    if t.get("place") in ("city", "town", "village"): return t["place"]
    if t.get("man_made") == "lighthouse" or t.get("seamark:type") == "lighthouse" or t.get("seamark:type") == "light_major": return "lighthouse"
    if t.get("seamark:type") == "light_minor": return "light"
    if t.get("historic") == "wreck" or t.get("seamark:type") == "wreck": return "wreck"
    return None

items, seen = [], set()
for i, pts in enumerate(legs()):
    print(f"Leg {i + 1}: {len(pts)} points from {pts[0]} to {pts[-1]}", flush=True)
    res = fetch(query(pts))
    for el in res.get("elements", []):
        t = el.get("tags", {})
        la = el.get("lat") or (el.get("center") or {}).get("lat"); lo = el.get("lon") or (el.get("center") or {}).get("lon")
        if la is None: continue
        k = kind(t)
        if not k: continue
        name = t.get("name") or t.get("seamark:name") or t.get("name:en")
        li = light_info(t) if k in ("lighthouse", "light") else None
        if k == "light" and not (name and li): continue        # skip unnamed small lights
        if k == "lighthouse" and not (name or li): continue
        key = (el["type"], el["id"])
        if key in seen: continue
        seen.add(key)
        it = {"k": k, "n": name or "Unnamed light", "la": round(la, 5), "lo": round(lo, 5)}
        if t.get("name:en") and t.get("name:en") != name: it["en"] = t["name:en"]
        e = num(t.get("ele"))
        if e is not None and k in ("peak", "glacier", "lighthouse"): it["e"] = round(e)
        if li: it["l"] = li
        if k == "wreck" and t.get("description"): it["d"] = t["description"][:200]
        if k in ("city", "town") and t.get("population"): it["p"] = num(t["population"])
        items.append(it)
    time.sleep(5)

counts = {}
for it in items: counts[it["k"]] = counts.get(it["k"], 0) + 1
out = {"generated": time.strftime("%Y-%m-%d"), "source": "© OpenStreetMap contributors, ODbL (openstreetmap.org/copyright)", "counts": counts, "items": items}
p = ROOT / "fjord-spotter/data/landmarks.json"
p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print("Wrote", p, f"{p.stat().st_size // 1024} KB", counts)
