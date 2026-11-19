"""
Build data/runways.csv from OurAirports (public domain, https://ourairports.com/data/)
for every airport in data/airports.csv (scheduled service) plus airport_geo.CONFIG:
the prediction airports use it for their detailed models, the global landing model
for "which runway is it lined up with" anywhere. Open runways with coordinates for
both ends only (no helipads). Run again after adding an airport:

  python scripts/build_runways.py
"""
import csv
import io
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from airport_geo import CONFIG, RUNWAYS_CSV  # noqa: E402

SOURCE = "https://davidmegginson.github.io/ourairports-data/runways.csv"
FIELDS = ["airport", "le_ident", "le_lat", "le_lon", "he_ident", "he_lat", "he_lon", "elev_ft"]


def main():
    r = requests.get(SOURCE, timeout=60, headers={"User-Agent": "Flive/0.1 (+https://github.com/thakurnilesh307/Flive)"})
    r.raise_for_status()
    with open(ROOT / "data" / "airports.csv", encoding="utf-8") as f:
        keep = {a["icao"] for a in csv.DictReader(f)} | set(CONFIG)
    out = []
    for row in csv.DictReader(io.StringIO(r.content.decode("utf-8"))):
        if row["airport_ident"] not in keep or row.get("closed") == "1":
            continue
        if row["le_ident"].upper().startswith("H"):
            continue
        try:
            coords = [round(float(row[k]), 6) for k in
                      ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]
        except ValueError:
            continue   # missing threshold coordinates
        if abs(coords[0] - coords[2]) + abs(coords[1] - coords[3]) < 1e-4:
            continue   # both ends at the same spot (bad data)
        elevs = [float(row[k]) for k in ("le_elevation_ft", "he_elevation_ft") if row.get(k)]
        out.append({"airport": row["airport_ident"], "le_ident": row["le_ident"], "le_lat": coords[0],
                    "le_lon": coords[1], "he_ident": row["he_ident"], "he_lat": coords[2], "he_lon": coords[3],
                    "elev_ft": round(sum(elevs) / len(elevs)) if elevs else ""})
    out.sort(key=lambda x: (x["airport"], x["le_ident"]))
    with open(RUNWAYS_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(out)
    for icao in CONFIG:
        rws = [f"{x['le_ident']}/{x['he_ident']}" for x in out if x["airport"] == icao]
        print(f"{icao}: {len(rws)} runways {', '.join(rws)}")
    print(f"{len(out)} runways at {len({x['airport'] for x in out})} airports -> {RUNWAYS_CSV.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
