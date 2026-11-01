#!/usr/bin/env python3
"""Builds fjord-spotter/data/landmarks.json from OpenStreetMap extracts (Geofabrik) filtered by osmium,
keeping what lies near the voyage track. Run by the "Landmark data" GitHub workflow:
    python3 tools/build_landmarks.py norway.geojsonseq scotland.geojsonseq ...

Data © OpenStreetMap contributors, available under the Open Database License (ODbL)."""
import json, math, sys, time, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
route = json.loads((ROOT / "fjord-spotter/data/route.json").read_text())
track = [(p[0], p[1]) for p in route["track"]]

def note(msg):
    print(f"::notice::{msg}", flush=True)

# Distance from a point to the track, in km (flat-earth approximation per segment is fine at these scales).
SEGS = list(zip(track, track[1:]))
def dist_to_track(la, lo):
    best = 1e9
    for (a_la, a_lo), (b_la, b_lo) in SEGS:
        k = math.cos(math.radians((a_la + b_la) / 2)) * 111.32
        ax, ay, bx, by, px, py = a_lo * k, a_la * 110.57, b_lo * k, b_la * 110.57, lo * k, la * 110.57
        dx, dy = bx - ax, by - ay
        t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        d = math.hypot(px - ax - t * dx, py - ay - t * dy)
        if d < best: best = d
    return best

# Sea legs across the open North Sea have no landmarks; skip their segments so towns far inland aren't picked up.
def is_sea(a, b):
    return math.hypot(b[0] - a[0], (b[1] - a[1]) * math.cos(math.radians(a[0]))) * 111 > 150
SEGS = [s for s in SEGS if not is_sea(*s)]

RADIUS = {"peak": 40, "glacier": 40, "lighthouse": 25, "light": 25, "city": 20, "town": 20, "village": 20, "island": 20, "fjord": 20, "bay": 20, "strait": 20, "cape": 20, "wreck": 20}

def point_of(geom):
    """A representative point: the point itself, or the average of a line/area's outline."""
    t, c = geom["type"], geom["coordinates"]
    if t == "Point": return c[1], c[0]
    if t == "LineString": pts = c
    elif t == "Polygon": pts = c[0]
    elif t == "MultiPolygon": pts = max((p[0] for p in c), key=len)
    elif t == "MultiLineString": pts = max(c, key=len)
    else: return None
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)

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
for path in sys.argv[1:]:   # GeoJSON-sequence files exported by osmium
    for line in open(path, encoding="utf-8"):
        line = line.strip().lstrip("\x1e")
        if not line: continue
        f = json.loads(line)
        t = f.get("properties", {})
        k = kind(t)
        if not k: continue
        p = point_of(f["geometry"])
        if not p: continue
        la, lo = p
        if dist_to_track(la, lo) > RADIUS.get(k, 20): continue
        name = t.get("name") or t.get("seamark:name") or t.get("name:en")
        li = light_info(t) if k in ("lighthouse", "light") else None
        if k == "light" and not (name and li): continue        # skip unnamed small lights
        if k == "lighthouse" and not (name or li): continue
        if k in ("peak", "city", "town", "village", "island", "fjord", "bay", "strait", "cape", "glacier", "wreck") and not name: continue
        e = num(t.get("ele"))
        if k == "peak" and (e is None or e < 300): continue      # small hills clutter the view
        key = (k, name, round(la, 3), round(lo, 3))
        if key in seen: continue
        seen.add(key)
        it = {"k": k, "n": name or "Unnamed light", "la": round(la, 5), "lo": round(lo, 5)}
        if t.get("name:en") and t.get("name:en") != name: it["en"] = t["name:en"]
        if e is not None and k in ("peak", "glacier", "lighthouse"): it["e"] = round(e)
        if li: it["l"] = li
        if k == "wreck" and t.get("description"): it["d"] = t["description"][:200]
        if k in ("city", "town") and t.get("population"): it["p"] = num(t["population"])
        items.append(it)

counts = {}
for it in items: counts[it["k"]] = counts.get(it["k"], 0) + 1
out = {"generated": time.strftime("%Y-%m-%d"), "source": "© OpenStreetMap contributors, ODbL (openstreetmap.org/copyright)", "counts": counts, "items": items}
p = ROOT / "fjord-spotter/data/landmarks.json"
p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
# Same data as a script file, so the app can load it from inside the iPhone app without a web server.
(ROOT / "fjord-spotter/data/landmarks.js").write_text("window.FJORD_LANDMARKS=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
(ROOT / "fjord-spotter/data/route.js").write_text("window.FJORD_ROUTE=" + json.dumps(route, ensure_ascii=False) + ";\n")
note(f"Wrote {p.name}: {p.stat().st_size // 1024} KB, {counts}")
