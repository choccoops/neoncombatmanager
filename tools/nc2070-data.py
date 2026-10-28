"""Build scripts/hub/data.js (the City & NCART hub's 2070 data) from the map renderer's geodata and
the Night City 2070 sourcebook. Both sources are git-excluded; the generated file is committed.

usage: python3 tools/nc2070-data.py [MAPS_SOURCE] [CITY_BOOK_CONTENT]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "night-city-2070-maps", "_source")
BOOK = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "cpr-2070-books", "source", "content_city")
sys.path.insert(0, MAPS)
import geodata as G  # noqa: E402  (plain data, no dependencies)

MD = re.compile(r"\*\*(.+?)\*\*|\*(.+?)\*")


def plain(s):
    """Book markup to plain text: **bold** and *italic* lose their stars, {{Skill}} its braces."""
    s = MD.sub(lambda m: m.group(1) or m.group(2), s)
    return re.sub(r"\{\{(.+?)\}\}", r"\1", s).strip()


def read_book():
    """Places (#n → {sc, text}) and districts (code → {rows, intro}) from the sourcebook."""
    places, districts = {}, {}
    for name in sorted(os.listdir(BOOK)):
        if not name.endswith(".txt"):
            continue
        code = None
        for line in open(os.path.join(BOOK, name), encoding="utf-8"):
            line = line.rstrip("\n")
            h = re.match(r"^# (.+?) \(([A-R])\)\s*$", line)
            if h:
                code = h.group(2)
                districts[code] = {"rows": {}, "intro": ""}
                continue
            if line.startswith("# "):
                code = None
            entry = re.match(r"^- \*\*(?:#(\d+) (.+?)|(.+?) \(#(\d+)\)|(.+?))\.\*\* (.*)$", line)
            if entry and entry.group(6).startswith("SC "):
                num = entry.group(1) or entry.group(4)
                rest = entry.group(6)
                sc = re.match(r"^SC (\d+)(?::\s*([^.]+(?:\([^)]*\))?))?\.\s*(.*)$", rest)
                info = {
                    "sc": int(sc.group(1)) if sc else None,
                    "guard": plain(sc.group(2)) if sc and sc.group(2) else "",
                    "text": plain(sc.group(3) if sc else rest),
                }
                if num:
                    places[int(num)] = info
                else:
                    places[plain(entry.group(5))] = info
            if not code:
                continue
            row = re.match(r"^\| \*\*(.+?)\*\* \| (.+?) \|$", line)
            if row:
                districts[code]["rows"][row.group(1)] = plain(row.group(2))
                continue
            if not districts[code]["intro"] and line and not line.startswith(("@", "|", "#", "-")):
                districts[code]["intro"] = plain(line)
    return places, districts


def main():
    book_places, book_districts = read_book()
    zones = G.ZONES_2070
    districts = []
    for d in G.DISTRICTS:
        z = zones.get(d["code"], {})
        b = book_districts.get(d["code"], {"rows": {}, "intro": ""})
        districts.append({
            "code": d["code"], "name": d["name"], "boro": d["boro"].title(),
            "poly": [[round(x, 1), round(y, 1)] for x, y in d["poly"]],
            "label": [d["label"][0], d["label"][1]],
            "zone": z.get("zone"), "rating": z.get("rating"), "second": z.get("second"),
            "sc": z.get("sc"), "provider": z.get("prov"), "intensity": z.get("inten"), "uc": z.get("uc"),
            "was": z.get("was"), "dossier": z.get("text"), "note": z.get("note"),
            "ncart": b["rows"].get("NCART", ""), "turf": b["rows"].get("Turf", ""),
        })
    outside = [{"name": o["name"], "rating": o["rating"], "sc": o["sc"], "provider": o["prov"],
                "intensity": o["inten"], "uc": o["uc"], "was": o["was"], "dossier": o["text"]} for o in G.ZONES_OUTSIDE]
    places = []
    for i, (name, cat, x, y, code) in enumerate(G.NOTABLE_PLACES, start=1):
        b = book_places.get(i, {})
        places.append({"n": i, "name": name, "cat": cat, "x": x, "y": y, "district": None if code == "-" else code,
                       "sc": b.get("sc"), "guard": b.get("guard", ""), "text": b.get("text", "")})
    # The two badge places (no number on the map).
    for key, name, _ in G.NOTABLE:
        lm = next(l for l in G.LANDMARKS if l[2] == key)
        code = "J" if key == "ncu" else "C"
        b = next((v for k, v in book_places.items() if isinstance(k, str) and k.startswith(name)), {})
        places.append({"n": None, "id": key, "name": name, "cat": "civic" if key == "ncu" else "med", "x": lm[0], "y": lm[1],
                       "district": code, "sc": b.get("sc"), "guard": b.get("guard", ""), "text": b.get("text", ""), "badge": key})
    stations = {}
    for sid, (name, x, y, status) in G.STATIONS.items():
        sp = None
        try:
            import metromap  # needs cairo/shapely; schematic positions are copied below when it can't load
            sp = metromap.SP.get(sid)
        except Exception:
            sp = SCHEMATIC.get(sid)
        stations[sid] = {"name": name.title().replace("Ncx", "NCX").replace("N.", "N."), "x": x, "y": y, "status": status,
                         "sx": sp[0] if sp else None, "sy": sp[1] if sp else None}
    lines = {}
    for lid in G.LINE_ORDER:
        L = G.LINES[lid]
        lines[lid] = {"name": L["name"].title(), "color": L["color"], "summary": L["summary"].title(),
                      "segs": L.get("segs", []), "closed": L.get("closed_segs", []), "uc": L.get("uc_segs", []),
                      "planned": L.get("planned_segs", []), "suspended": L.get("suspended_segs", [])}
    data = {
        "world": {"w": 1294, "h": 2000}, "schematic": {"w": 1500, "h": 2000},
        "threat": {k: {"label": v[0], "short": v[1], "color": "#" + v[2], "text": v[3]} for k, v in G.THREAT.items()},
        "threatOrder": G.THREAT_ORDER,
        "cats": {k: {"label": v[0], "color": "#" + v[1]} for k, v in G.NP_CATS.items()},
        "districts": districts, "outside": outside, "places": places, "stations": stations, "lines": lines,
        "landmarks": [{"x": l[0], "y": l[1], "kind": l[2], "name": l[3].replace("\n", " ")} for l in G.LANDMARKS],
        "laguna": {"x": 1100, "y": 1340, "r": 150},
    }
    out = os.path.join(ROOT, "scripts", "hub", "data.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("/**\n * Night City 2070: districts and NCZTA-70 threat zones, the Notable Places, and NCART.\n"
                " * Generated by tools/nc2070-data.py from the 2070 map source and the Night City 2070\n"
                " * sourcebook. World coordinates are the city map's 1294 x 2000 grid (the map images are\n"
                " * 4x that); `sx, sy` place a station on the NCART poster (1500 x 2000, images 3x).\n */\n")
        f.write("export const NC2070 = ")
        f.write(json.dumps(data, ensure_ascii=False, indent=1))
        f.write(";\n")
    missing = [p["name"] for p in places if not p["text"]]
    print(f"{out}: {len(districts)} districts, {len(places)} places ({len(missing)} without book text), {len(stations)} stations")
    if missing:
        print("  no text:", ", ".join(missing))


# metromap.SP, for machines without cairo (kept in step by hand; the renderer is the source of truth)
SCHEMATIC = {'indn': (800, 260), 'kmkt': (720, 380), 'kcen': (720, 540), 'medc': (520, 300), 'ngate': (200, 340), 'eis': (400, 420), 'cart': (400, 520), 'lchina': (400, 620), 'leur': (400, 740), 'cplaza': (640, 740), 'jtown': (880, 740), 'repw': (320, 820), 'morro': (200, 820), 'ncx': (90, 820), 'corpst': (400, 860), 'univ': (320, 940), 'glenn': (480, 1060), 'cityh': (640, 1060), 'pajaro': (800, 1060), 'silk': (960, 900), 'bulw': (320, 1060), 'port': (320, 1180), 'parq': (440, 1300), 'glens': (640, 1300), 'sonora': (800, 1300), 'arind': (960, 1380), 'docks': (1120, 1060), 'ebay': (1340, 1060), 'scruz': (1120, 1220), 'rcn': (1120, 1380), 'ash': (1120, 1540), 'lincoln': (1040, 740), 'noakg': (1180, 740), 'colum': (1300, 620), 'diam': (1040, 580), 'longs': (1040, 440), 'pnorth': (640, 1460), 'coast': (560, 1540), 'gim': (480, 1620), 'wwind': (260, 1700), 'playland': (400, 1700), 'stad': (760, 1620)}

if __name__ == "__main__":
    main()
