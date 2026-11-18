"""
Build data/airports.csv from OurAirports (public domain, https://ourairports.com/data/).

Keeps large and medium airports with scheduled passenger service: the places
people ask Ask Flive about ("planes near JFK", "near Frankfurt"). Run again any
time to refresh:

  python scripts/build_airports.py
"""
import csv
import io
import re
import sys
from pathlib import Path

import requests

SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv"
OUT = Path(__file__).resolve().parent.parent / "data" / "airports.csv"
KEEP_TYPES = {"large_airport", "medium_airport"}
FIELDS = ["icao", "iata", "name", "city", "country", "lat", "lon", "size"]


def clean(s, n):
    """Provider text is untrusted: drop control characters and cap the length."""
    return re.sub(r"[\x00-\x1f\x7f]", "", (s or "").strip())[:n]


def main():
    r = requests.get(SOURCE, timeout=60, headers={"User-Agent": "Flive/0.1 (+https://github.com/thakurnilesh307/Flive)"})
    r.raise_for_status()
    rows = []
    for a in csv.DictReader(io.StringIO(r.content.decode("utf-8"))):
        if a.get("type") not in KEEP_TYPES or a.get("scheduled_service") != "yes":
            continue
        try:
            lat, lon = float(a["latitude_deg"]), float(a["longitude_deg"])
        except (KeyError, ValueError):
            continue
        icao = clean(a.get("icao_code") or a.get("gps_code") or a.get("ident"), 4).upper()
        iata = clean(a.get("iata_code"), 3).upper()
        if not re.fullmatch(r"[A-Z0-9]{3,4}", icao):
            icao = ""
        if not re.fullmatch(r"[A-Z]{3}", iata):
            iata = ""
        if not (icao or iata):
            continue
        rows.append({
            "icao": icao, "iata": iata, "name": clean(a.get("name"), 80),
            "city": clean(a.get("municipality"), 60), "country": clean(a.get("iso_country"), 2).upper(),
            "lat": f"{lat:.4f}", "lon": f"{lon:.4f}",
            "size": "large" if a["type"] == "large_airport" else "medium",
        })
    rows.sort(key=lambda x: (x["size"] != "large", x["icao"] or x["iata"]))
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    large = sum(1 for x in rows if x["size"] == "large")
    print(f"wrote {OUT} ({len(rows)} airports, {large} large, {OUT.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
