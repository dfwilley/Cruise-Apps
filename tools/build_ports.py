#!/usr/bin/env python3
"""Builds port-guide/data/places.json (+ .js) for Port Pocket Guide from OpenStreetMap extracts filtered by osmium,
keeping sights and practical places near each port, plus typical weather for each port day (Open-Meteo / ERA5
archive, 10 winters) and saved exchange rates (Frankfurter / ECB). Run by the "Port data" GitHub workflow:
    python3 tools/build_ports.py norway.geojsonseq scotland.geojsonseq ...
Data © OpenStreetMap contributors (ODbL); weather from Open-Meteo.com (CC BY 4.0); rates from the ECB via Frankfurter."""
import json, math, sys, re, pathlib, datetime, urllib.request, statistics

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORTS = json.loads((ROOT / "port-guide/data/ports.json").read_text())["ports"]

def note(m): print(f"::notice::{m}", flush=True)
def warn(m): print(f"::warning::{m}", flush=True)

def km(a_la, a_lo, b_la, b_lo):
    p1, p2 = math.radians(a_la), math.radians(b_la)
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lo - a_lo) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(d))

def point_of(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "Point": return c[1], c[0]
    if t == "LineString": pts = c
    elif t == "Polygon": pts = c[0]
    elif t == "MultiPolygon": pts = max((p[0] for p in c), key=len)
    elif t == "MultiLineString": pts = max(c, key=len)
    else: return None
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)

CHURCH = re.compile(r"kirke|domkirke|katedral|cathedral|church|kirk|abbey|chapel|kapell", re.I)
def classify(t):
    """Returns (group, kind) or None."""
    tour, hist, am = t.get("tourism"), t.get("historic"), t.get("amenity")
    if tour == "museum": return "sight", "museum"
    if tour == "gallery": return "sight", "gallery"
    if tour == "viewpoint": return "sight", "viewpoint"
    if tour == "attraction": return "sight", "attraction"
    if t.get("aerialway") == "station" or t.get("station") == "funicular": return "sight", "cable car"
    if hist in ("castle", "fort", "fortress", "monument", "ruins", "archaeological_site", "ship", "building", "memorial", "church", "city_gate", "manor"):
        if hist == "memorial" and (not t.get("wikidata") or t.get("memorial") in ("stolperstein", "plaque", "stone", "bench")): return None
        return "sight", "historic"
    if am == "place_of_worship":
        if t.get("wikidata") or CHURCH.search(t.get("name", "")): return "sight", "church"
        return None
    if tour == "information" and t.get("information") == "office": return "practical", "tourist info"
    if am == "pharmacy": return "practical", "pharmacy"
    if am == "atm" or am == "bank": return "practical", "cash"
    if am == "toilets": return "practical", "toilets"
    if t.get("shop") in ("supermarket", "convenience"): return "practical", "groceries"
    if t.get("shop") in ("mall", "department_store"): return "practical", "shopping centre"
    if t.get("shop") == "outdoor" or t.get("shop") == "sports": return "practical", "outdoor gear"
    if t.get("railway") in ("station", "halt") and t.get("station") != "subway": return "practical", "train station"
    if am == "taxi": return "practical", "taxi"
    if am == "ferry_terminal" or t.get("man_made") in ("pier", "quay") or t.get("harbour") or t.get("landuse") == "port" or t.get("seamark:type") == "harbour":
        return "berth", "berth"
    return None

def areas(p):
    return [p["area"]] + p.get("extraAreas", [])

found = {p["id"]: [] for p in PORTS}
seen = set()
for path in sys.argv[1:]:
    with open(path) as f:
        for line in f:
            line = line.strip("\x1e \n")
            if not line: continue
            ft = json.loads(line); t = ft.get("properties", {})
            name = t.get("name:en") or t.get("name")
            c = classify(t)
            if not c or not name: continue
            pt = point_of(ft["geometry"])
            if not pt: continue
            for p in PORTS:
                main = km(pt[0], pt[1], p["area"]["lat"], p["area"]["lon"]) <= p["area"]["r"]
                if main or (c[0] != "sight" and any(km(pt[0], pt[1], a["lat"], a["lon"]) <= a["r"] for a in areas(p))):
                    key = (p["id"], name, c[1], round(pt[0], 3), round(pt[1], 3))
                    if key in seen: break
                    seen.add(key)
                    item = {"name": name, "group": c[0], "kind": c[1], "lat": round(pt[0], 5), "lon": round(pt[1], 5)}
                    if t.get("name") and t.get("name") != name: item["local"] = t["name"]
                    for k in ("opening_hours", "website", "wikidata", "fee", "wheelchair", "description", "phone"):
                        if t.get(k): item[{"opening_hours": "hours"}.get(k, k)] = t[k][:200]
                    if not item.get("website") and t.get("contact:website"): item["website"] = t["contact:website"]
                    found[p["id"]].append(item)
                    break

def near_pier(p):
    pier = next((x for x in p["piers"] if x.get("primary")), None)
    if not pier or pier.get("walkFromPier") is False: return p["center"]   # out-of-town terminal: measure from the city
    return pier

out = {"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"), "ports": {}}
for p in PORTS:
    items = found[p["id"]]
    pier = near_pier(p)
    for it in items: it["fromPier"] = round(km(pier["lat"], pier["lon"], it["lat"], it["lon"]), 2)
    # Berth check: named piers/quays/terminals close to the piers listed in ports.json.
    for pr in p["piers"]:
        cands = sorted((km(pr["lat"], pr["lon"], b["lat"], b["lon"]), b["name"]) for b in items if b["group"] == "berth")
        match = [c for c in cands if pr["osm"].lower() in c[1].lower()]
        best = match[0] if match else (cands[0] if cands else None)
        if best: note(f"{p['name']} · {pr['name']}: nearest OSM berth “{best[1]}” {best[0]:.2f} km from the listed position")
        if match:
            b = next(b for b in items if b["group"] == "berth" and b["name"] == match[0][1])
            note(f"   → {match[0][1]} at {b['lat']:.4f}, {b['lon']:.4f}")
    sights, names = [], set()
    for i in sorted((i for i in items if i["group"] == "sight"), key=lambda i: i["fromPier"]):
        if i["name"].lower() in names: continue     # one entry per name (several outlines of the same place)
        names.add(i["name"].lower()); sights.append(i)
    # Prefer well-known places (with a Wikidata entry), museums and sights over churches and memorials, then the nearest.
    sights.sort(key=lambda i: ((0 if i.get("wikidata") else 2) + (1 if i["kind"] == "church" else 0), i["fromPier"]))
    sights = sorted(sights[:45], key=lambda i: i["fromPier"])
    practical = []
    for kind in ("tourist info", "pharmacy", "cash", "groceries", "toilets", "shopping centre", "outdoor gear", "train station", "taxi"):
        ks = sorted((i for i in items if i["kind"] == kind), key=lambda i: i["fromPier"])
        practical += ks[:6 if kind == "train station" else 3]
        if p.get("extraAreas") and kind in ("train station", "taxi"):
            pr0 = p["piers"][0]
            extra = sorted((i for i in items if i["kind"] == kind and i not in practical), key=lambda i: km(pr0["lat"], pr0["lon"], i["lat"], i["lon"]))
            practical += extra[:2]
    out["ports"][p["id"]] = {"sights": sights, "practical": practical}
    note(f"{p['name']}: {len(sights)} sights, {len(practical)} practical places (of {len(items)} found)")

# Typical weather for each port day: the same calendar window (±7 days) over the last 10 winters.
def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "PortPocketGuide/1.0 (github.com/dfwilley/Cruise-Apps)"})
    with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)

climate = {}
for p in PORTS:
    c = p["center"]
    d = None
    for attempt in range(3):
      try:
        d = get_json(f"https://archive-api.open-meteo.com/v1/archive?latitude={c['lat']}&longitude={c['lon']}&start_date=2016-01-01&end_date=2025-12-31"
                     "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max&timezone=auto")["daily"]
        break
      except Exception as e:
        warn(f"Weather history for {p['name']} failed (try {attempt + 1}): {e}")
    if d is None: continue
    day = datetime.date.fromisoformat(p["days"][0]["date"])
    idx = []
    for i, s in enumerate(d["time"]):
        t = datetime.date.fromisoformat(s)
        for y in (t.year - 1, t.year, t.year + 1):
            try: ref = day.replace(year=y)
            except ValueError: continue
            if abs((t - ref).days) <= 7: idx.append(i); break
    def vals(k): return [d[k][i] for i in idx if d[k][i] is not None]
    hi, lo, pr, sn, wd, gu = (vals(k) for k in ("temperature_2m_max", "temperature_2m_min", "precipitation_sum", "snowfall_sum", "wind_speed_10m_max", "wind_gusts_10m_max"))
    q = lambda v, n: statistics.quantiles(v, n=10)[n] if len(v) > 10 else None
    climate[p["id"]] = {
        "days": len(idx), "years": "2016–2025",
        "hi": round(statistics.mean(hi), 1), "lo": round(statistics.mean(lo), 1),
        "coldLo": round(q(lo, 0), 1), "warmHi": round(q(hi, 8), 1),
        "wetPct": round(100 * sum(1 for v in pr if v >= 1) / len(pr)), "snowPct": round(100 * sum(1 for v in sn if v >= 1) / len(sn)),
        "wind": round(statistics.mean(wd)), "gust": round(statistics.mean(gu)),
        "freezePct": round(100 * sum(1 for a, b in zip(hi, lo) if b < 0) / len(lo)),
    }
    note(f"{p['name']} typical: high {climate[p['id']]['hi']}°C, low {climate[p['id']]['lo']}°C, wet {climate[p['id']]['wetPct']}% of days, snow {climate[p['id']]['snowPct']}%")
out["climate"] = climate

rates = None
for url in ("https://api.frankfurter.dev/v1/latest?base=USD&symbols=NOK,GBP", "https://api.frankfurter.app/latest?from=USD&to=NOK,GBP"):
    try:
        r = get_json(url); rates = {"date": r["date"], "NOK": r["rates"]["NOK"], "GBP": r["rates"]["GBP"]}; break
    except Exception as e: warn(f"Rates from {url} failed: {e}")
if rates: note(f"Rates {rates['date']}: $1 = {rates['NOK']} NOK, £{rates['GBP']}")
out["rates"] = rates

dst = ROOT / "port-guide/data"
(dst / "places.json").write_text(json.dumps(out, ensure_ascii=False, indent=0))
(dst / "places.js").write_text("window.PORT_PLACES=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
(dst / "ports.js").write_text("window.PORT_FACTS=" + json.dumps(json.loads((dst / "ports.json").read_text()), ensure_ascii=False, separators=(",", ":")) + ";\n")
note("Wrote port-guide/data/places.json")
