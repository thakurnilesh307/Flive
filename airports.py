"""
Airport lookup for Ask Flive's world tools, from data/airports.csv
(OurAirports, public domain; rebuild with scripts/build_airports.py).

  find("JFK"), find("frankfurt")  -> best matches
  nearest(lat, lon)               -> closest airport + distance
"""
import csv
import re
from functools import lru_cache
from pathlib import Path

from traffic import COMPASS, bearing_deg, distance_nm

DATA = Path(__file__).parent / "data" / "airports.csv"


@lru_cache(maxsize=1)
def _load():
    with DATA.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
    by_code = {}
    for r in rows:
        for code in (r["icao"], r["iata"]):
            if code:
                by_code.setdefault(code, r)       # large airports were sorted first
    return rows, by_code


def label(a):
    code = a["iata"] or a["icao"]
    return f"{a['name']} ({code})"


def public(a):
    return {"code": a["iata"] or a["icao"], "icao": a["icao"] or None, "iata": a["iata"] or None,
            "name": a["name"], "city": a["city"], "country": a["country"], "size": a["size"]}


def find(query, limit=5):
    """Exact IATA/ICAO code first, then name/city matches (large airports first)."""
    rows, by_code = _load()
    q = re.sub(r"[^\w\s-]", "", str(query or "")).strip()[:60]
    if not q:
        return []
    code = q.upper()
    if code in by_code:
        return [by_code[code]]
    ql = q.lower()
    words = [w for w in ql.split() if w not in ("airport", "international", "intl")] or [ql]
    def score(a):
        hay = f"{a['name']} {a['city']}".lower()
        if not all(w in hay for w in words):
            return None
        return (a["city"].lower() != ql, a["size"] != "large", len(a["name"]))
    hits = [(s, a) for a in rows if (s := score(a)) is not None]
    hits.sort(key=lambda t: t[0])
    return [a for _, a in hits[:limit]]


def nearest(lat, lon):
    """(airport, distance_nm) of the closest listed airport."""
    rows, _ = _load()
    best = min(rows, key=lambda a: (a["lat"] - lat) ** 2 + ((a["lon"] - lon) * 0.7) ** 2)
    return best, distance_nm((lat, lon), (best["lat"], best["lon"]))


def describe_position(lat, lon):
    """'near Frankfurt Main Airport (FRA)' or '120 nm NE of London Heathrow Airport (LHR)'."""
    a, d = nearest(lat, lon)
    if d < 15:
        return f"near {label(a)}"
    side = COMPASS[round(bearing_deg((a["lat"], a["lon"]), (lat, lon)) / 45) % 8]
    return f"{round(d)} nm {side} of {label(a)}"
