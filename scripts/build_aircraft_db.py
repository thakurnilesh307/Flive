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
they are often individuals' names. The only thing kept is an airline ICAO code when
the owner IS an airline ("JETBLUE AIRWAYS CORP" -> JBU), so an airliner flying under
its tail number (positioning, test or delivery flights) still shows its airline.
"""
import csv
import gzip
import io
import re
import sqlite3
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
AIRCRAFT_URL = "https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz"
AIRLINES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat"
UA = {"User-Agent": "Flive/0.1 (+https://github.com/thakurnilesh307/Flive)"}


LEGAL_SUFFIXES = {"INC", "CORP", "CORPORATION", "LLC", "LTD", "LIMITED", "CO", "COMPANY", "SA",
                  "AG", "PLC", "GMBH", "NV", "BV", "SPA", "AB", "AS", "ASA", "OY", "SL", "SAS",
                  "LTDA", "PTY", "DAC", "KG", "THE"}
# Airlines whose registered owner name differs from their airline name.
OWNER_ALIASES = {"UNITED PARCEL SERVICE": "UPS", "FEDERAL EXPRESS": "FDX"}


def norm_name(s):
    words = re.sub(r"[^A-Z0-9]+", " ", s.upper()).split()
    while words and words[-1] in LEGAL_SUFFIXES:
        words.pop()
    return " ".join(words)


def airline_name_index():
    """normalised airline name -> ICAO code, skipping names shared by several codes."""
    seen, ambiguous = {}, set()
    with open(DATA / "airlines.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            n = norm_name(r["name"])
            if not n or len(n) < 4:
                continue
            if n in seen and seen[n] != r["icao"]:
                ambiguous.add(n)
            seen[n] = r["icao"]
    index = {n: c for n, c in seen.items() if n not in ambiguous}
    index.update(OWNER_ALIASES)
    return index


def build_aircraft():
    names = airline_name_index()
    print("Downloading aircraft database ...")
    raw = requests.get(AIRCRAFT_URL, headers=UA, timeout=120).content
    text = gzip.decompress(raw).decode("utf-8", "replace")
    rows = []
    for line in text.splitlines():
        f = line.split(";")
        if len(f) < 5 or len(f[0]) != 6:
            continue
        icao, reg, typ, flags, desc = (x.strip() for x in f[:5])
        owner = f[6].strip() if len(f) > 6 else ""
        if not (reg or typ):
            continue  # nothing useful (e.g. "Miscode" placeholder blocks)
        # flags: military, interesting, PIA, LADD. PIA/LADD = the owner asked for
        # privacy (FAA programs); Flive hides registration and photo for those.
        private = 1 if len(flags) >= 4 and ("1" in flags[2:4]) else 0
        op = names.get(norm_name(owner)) if owner else None  # airline code only, never the name
        rows.append((icao.lower(), reg, typ, desc, private, op))
    tmp = DATA / "aircraft.sqlite.tmp"
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.execute("CREATE TABLE ac (icao TEXT PRIMARY KEY, reg TEXT, type TEXT, descr TEXT, private INTEGER, op TEXT) WITHOUT ROWID")
    db.executemany("INSERT OR REPLACE INTO ac VALUES (?,?,?,?,?,?)", rows)
    db.commit()
    db.close()
    try:
        tmp.replace(DATA / "aircraft.sqlite")
    except PermissionError:
        # Windows won't replace a file another process has open.
        sys.exit("data/aircraft.sqlite is in use (is the server running?). Stop it and re-run this script.")
    print(f"  {len(rows):,} aircraft ({sum(1 for r in rows if r[5]):,} matched to an airline) -> data/aircraft.sqlite")


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
    which = sys.argv[1:] or ["airlines", "aircraft"]
    if "airlines" in which:  # first: the aircraft step matches owners against it
        build_airlines()
    if "aircraft" in which:
        build_aircraft()
