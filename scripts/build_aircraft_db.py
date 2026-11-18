"""Download the aircraft and airline lookup tables Flive uses for type, registration
and operator names.

    python scripts/build_aircraft_db.py

Writes:
  data/aircraft.sqlite  icao24 -> registration, type code, description, privacy flag.
                        From wiedehopf/tar1090-db (Mictronics database + FAA records),
                        ~650k aircraft, updated about daily. NOT committed: the source
                        has no explicit licence, so Flive only shows lookup results and
                        never redistributes the file. Re-run this weekly or so.
  data/airlines.csv     ICAO airline designator -> name, country. From OpenFlights
                        (Open Database License, credited on the About page). Committed.

Owner/operator names in tar1090-db are deliberately NOT stored: for private aircraft
they are often individuals' names.
"""
import csv
import gzip
import io
import sqlite3
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
AIRCRAFT_URL = "https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz"
AIRLINES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat"
UA = {"User-Agent": "Flive/0.1 (+https://github.com/thakurnilesh307/Flive)"}


def build_aircraft():
    print("Downloading aircraft database ...")
    raw = requests.get(AIRCRAFT_URL, headers=UA, timeout=120).content
    text = gzip.decompress(raw).decode("utf-8", "replace")
    rows = []
    for line in text.splitlines():
        f = line.split(";")
        if len(f) < 5 or len(f[0]) != 6:
            continue
        icao, reg, typ, flags, desc = (x.strip() for x in f[:5])
        if not (reg or typ):
            continue  # nothing useful (e.g. "Miscode" placeholder blocks)
        # flags: military, interesting, PIA, LADD. PIA/LADD = the owner asked for
        # privacy (FAA programs); Flive hides registration and photo for those.
        private = 1 if len(flags) >= 4 and ("1" in flags[2:4]) else 0
        rows.append((icao.lower(), reg, typ, desc, private))
    tmp = DATA / "aircraft.sqlite.tmp"
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.execute("CREATE TABLE ac (icao TEXT PRIMARY KEY, reg TEXT, type TEXT, descr TEXT, private INTEGER) WITHOUT ROWID")
    db.executemany("INSERT OR REPLACE INTO ac VALUES (?,?,?,?,?)", rows)
    db.commit()
    db.close()
    tmp.replace(DATA / "aircraft.sqlite")
    print(f"  {len(rows):,} aircraft -> data/aircraft.sqlite")


def build_airlines():
    print("Downloading airline list ...")
    text = requests.get(AIRLINES_URL, headers=UA, timeout=60).text
    best = {}
    for r in csv.reader(io.StringIO(text)):
        if len(r) < 8:
            continue
        name, icao, country, active = r[1], r[4], r[6], r[7]
        if len(icao) != 3 or not icao.isalpha() or not icao.isupper() or name in ("", "\\N"):
            continue
        # Several airlines can share a code over the years: prefer the active one.
        if icao not in best or (active == "Y" and best[icao][2] != "Y"):
            best[icao] = (name, "" if country == "\\N" else country, active)
    with open(DATA / "airlines.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["icao", "name", "country"])
        for icao in sorted(best):
            w.writerow([icao, best[icao][0], best[icao][1]])
    print(f"  {len(best):,} airlines -> data/airlines.csv")


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    which = sys.argv[1:] or ["aircraft", "airlines"]
    if "aircraft" in which:
        build_aircraft()
    if "airlines" in which:
        build_airlines()
