#!/usr/bin/env python3
"""Builds port-side-quests/data/quests.js for Port Side Quests from OpenStreetMap extracts filtered by osmium.

For every port in port-guide/data/ports.json it keeps real places that fit the four quest themes:
  waterfront - boatyards, shipyards, marinas, harbours, piers, lighthouses, historic ships, maritime museums
  taste      - bakeries, pastry and chocolate shops, cheese and deli counters, fish shops, markets, ice cream
  mechanism  - canal/river locks, water and wind mills, old cranes, public clocks, funiculars, technical museums
  story      - historic buildings, plaques with inscriptions, city gates, memorials and monuments with history
Run by the "Quest data" GitHub workflow:
    python3 tools/build_quests.py osm/norway.geojsonseq osm/hessen.geojsonseq ...
Data © OpenStreetMap contributors (ODbL)."""
import json, math, re, sys, pathlib, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "port-side-quests/data/quests.js"
PER_THEME = 18          # places kept per theme per port
WALK_KM = 3.0           # straight-line limit from the pier or town centre

def km(a_la, a_lo, b_la, b_lo):
    p1, p2 = math.radians(a_la), math.radians(b_la)
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b_lo - a_lo) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, d)))

def point_of(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "Point": return c[1], c[0]
    if t == "LineString": pts = c
    elif t == "Polygon": pts = c[0]
    elif t == "MultiPolygon": pts = max((p[0] for p in c), key=len)
    elif t == "MultiLineString": pts = max(c, key=len)
    else: return None
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)

MARITIME = re.compile(r"maritim|ship|schiff|boat|boot|båt|harbou?r|hafen|havn|seefahrt|sjøfart|fisher|fiske|polar|naval|marine|werft|verft|ferry|fähre|kai\b|brygge", re.I)
TECHNICAL = re.compile(r"techn|engine|railway|eisenbahn|jernbane|tram|mühle|mill|uhr|clock|verkehr|transport|industrie|industri|kraftwerk|wasserwerk|power", re.I)

def classify(t):
    """Returns (theme, kind label, name required?) or None."""
    g = t.get
    man, hist, shop, am, tour = g("man_made"), g("historic"), g("shop"), g("amenity"), g("tourism")
    # Working waterfront
    if g("craft") == "boatbuilder" or g("industrial") == "shipyard" or g("landuse") == "shipyard" or g("waterway") == "boatyard":
        return "waterfront", "boatyard", False
    if hist == "ship" or g("historic:railway") == "ship": return "waterfront", "historic ship", True
    if man == "lighthouse": return "waterfront", "lighthouse", False
    if g("leisure") == "marina": return "waterfront", "marina", True
    if g("harbour") in ("yes", "fishing") or g("seamark:type") == "harbour": return "waterfront", "harbour", True
    if man in ("pier", "quay") and g("name"): return "waterfront", "quay", True
    if g("leisure") == "slipway" or man == "slipway": return "waterfront", "slipway", False
    if tour == "museum" and MARITIME.search(g("name", "") + " " + g("museum", "")): return "waterfront", "maritime museum", True
    # Taste something unexpected
    if shop in ("bakery", "pastry"): return "taste", "bakery", True
    if shop in ("confectionery", "chocolate"): return "taste", "sweets", True
    if shop in ("cheese", "deli"): return "taste", "deli", True
    if shop == "seafood": return "taste", "fish shop", True
    if shop == "butcher": return "taste", "butcher", True
    if shop == "farm": return "taste", "farm shop", True
    if am == "marketplace": return "taste", "market", True
    if am == "ice_cream" or shop == "ice_cream": return "taste", "ice cream", True
    if am == "cafe" and g("cuisine") in ("coffee_shop;cake", "cake", "regional", "pastry", "waffle", "crepe"): return "taste", "café", True
    # Ingenious mechanism
    if g("lock") == "yes" or g("waterway") == "lock_gate": return "mechanism", "lock", False
    if man == "watermill" or hist == "watermill" or g("watermill"): return "mechanism", "watermill", False
    if man == "water_wheel": return "mechanism", "water wheel", False
    if man == "windmill" or hist == "windmill": return "mechanism", "windmill", False
    if hist == "mill" or (g("mill") and hist): return "mechanism", "mill", False
    if man == "crane" and (hist or g("heritage")): return "mechanism", "historic crane", False
    if am == "clock" and (g("name") or g("heritage") or g("wikidata") or hist): return "mechanism", "public clock", False
    if g("tower:type") == "clock" or (man == "tower" and "uhr" in g("name", "").lower()): return "mechanism", "clock tower", True
    if g("railway") == "funicular" or g("aerialway") == "station": return "mechanism", "funicular / cable car", True
    if g("bridge:movable") or (man == "bridge" and g("bridge:structure") in ("swing", "bascule", "lift")): return "mechanism", "movable bridge", False
    if hist in ("technical_monument", "industrial", "railway", "locomotive", "aircraft"): return "mechanism", "technical monument", True
    if tour == "museum" and TECHNICAL.search(g("name", "") + " " + g("museum", "")): return "mechanism", "technical museum", True
    if man == "water_well" and hist: return "mechanism", "historic well", True
    # Uncover a hidden story. Memorials to individual victims (Stolpersteine and similar) are left out:
    # they deserve respect, not a playful quest.
    if hist == "memorial" and (g("memorial") in ("stolperstein", "stele", "war_memorial", "ghost_bike", "grave")
                               or g("memorial:type") == "stolperstein" or "stolperstein" in (g("name", "") + g("description", "")).lower()):
        return None
    if hist == "memorial" and g("memorial") == "plaque" and g("inscription"): return "story", "plaque", False
    if hist in ("building", "house", "manor", "city_gate", "citywalls", "tower", "castle", "fort", "ruins", "archaeological_site",
                "monument", "palace", "church", "monastery", "boundary_stone", "milestone", "pillory"):
        return "story", {"citywalls": "city wall", "city_gate": "city gate", "archaeological_site": "archaeological site"}.get(hist, hist), True
    if hist == "memorial" and (g("wikidata") or g("inscription")): return "story", "memorial", True
    if g("heritage") and g("name") and (g("building") or hist): return "story", "listed building", True
    return None

def label_name(t, kind):
    name = t.get("name:en") or t.get("name")
    return name or kind.capitalize()

def score(it):
    """Lower is better: well-documented places first, then nearer."""
    s = 0 if it.get("wikidata") else 2
    if it.get("inscription") or it.get("description"): s -= 1
    if it["kind"] in ("café", "ice cream", "butcher"): s += 2
    if it["kind"] in ("quay", "marina", "slipway"): s += 1
    if it["kind"] in ("historic well",): s += 2
    if it["name"].lower() == it["kind"].lower(): s += 1      # unnamed things after named ones
    return (s, it["fromPier"])

def main(paths):
    ports = [p for v in json.loads((ROOT / "port-guide/data/ports.json").read_text())["voyages"] for p in v["ports"]]
    uniq = {}
    for p in ports: uniq.setdefault(p["id"], p)
    ports = list(uniq.values())
    found = {p["id"]: [] for p in ports}
    for path in paths:
        with open(path) as f:
            for line in f:
                line = line.strip("\x1e \n")
                if not line: continue
                ft = json.loads(line); t = ft.get("properties", {})
                c = classify(t)
                if not c: continue
                theme, kind, needs_name = c
                if needs_name and not (t.get("name") or t.get("name:en")): continue
                pt = point_of(ft["geometry"]) if ft.get("geometry") else None
                if not pt: continue
                for p in ports:
                    pier = next((x for x in p["piers"] if x.get("primary")), p["piers"][0]) if p.get("piers") else p["center"]
                    if min(km(pt[0], pt[1], pier["lat"], pier["lon"]), km(pt[0], pt[1], p["center"]["lat"], p["center"]["lon"])) > WALK_KM:
                        continue
                    it = {"name": label_name(t, kind)[:120], "theme": theme, "kind": kind, "lat": round(pt[0], 5), "lon": round(pt[1], 5),
                          "fromPier": round(km(pier["lat"], pier["lon"], pt[0], pt[1]), 2)}
                    if t.get("name") and t.get("name:en") and t["name"] != t["name:en"]: it["local"] = t["name"][:120]
                    for k, out in (("opening_hours", "hours"), ("wikidata", "wikidata"), ("inscription", "inscription"),
                                   ("description", "description"), ("start_date", "built"), ("website", "website")):
                        if t.get(k): it[out] = t[k][:300]
                    found[p["id"]].append(it)
    data = {"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
            "source": "© OpenStreetMap contributors (ODbL)", "ports": {}}
    for p in ports:
        keep = {}
        for theme in ("waterfront", "taste", "mechanism", "story"):
            items = sorted((i for i in found[p["id"]] if i["theme"] == theme), key=score)
            chosen = []
            for i in items:   # drop duplicates: same name nearby, or unnamed things within 60 m of each other
                if any((c["name"].lower() == i["name"].lower() and km(c["lat"], c["lon"], i["lat"], i["lon"]) < 0.4)
                       or km(c["lat"], c["lon"], i["lat"], i["lon"]) < 0.06 for c in chosen):
                    continue
                chosen.append(i)
                if len(chosen) >= PER_THEME: break
            keep[theme] = chosen
        data["ports"][p["id"]] = keep
        print(f"::notice::{p['name']}: " + ", ".join(f"{k} {len(v)}" for k, v in keep.items()), flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("window.QUEST_PLACES=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main(sys.argv[1:])
