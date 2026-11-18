"""Aircraft and airline lookups: icao24 -> type, registration, description, and
callsign -> operator name.

Data comes from scripts/build_aircraft_db.py (data/aircraft.sqlite, data/airlines.csv).
If the aircraft DB hasn't been built, everything still works, just without types for
worldwide planes. All text is sanitised here, because it ends up in the UI and in
Ask Flive's tool results.

Privacy: owner names are never stored. Aircraft whose owners opted into the FAA
privacy programs (PIA/LADD) get their type only, with no registration or photo.
"""
import csv
import re
import sqlite3
import threading
from pathlib import Path

import traffic

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "data" / "aircraft.sqlite"
AIRLINES_PATH = HERE / "data" / "airlines.csv"
# Hand-checked additions/corrections for airlines newer than the OpenFlights list.
AIRLINES_EXTRA_PATH = HERE / "data" / "airlines_extra.csv"

_REG = re.compile(r"[^A-Z0-9-]")
_TYPE = re.compile(r"[^A-Z0-9]")
_TEXT = re.compile(r"[^A-Za-z0-9 .,/()&'+!-]")
# Airliner type codes: a tail-number callsign on one of these is an airline plane
# (positioning/test flight), not a private one.
_AIRLINER = re.compile(r"^(A[1-3]\d[\dNK]|B7\d[\dMX]|B3[89]M|B3XM|E1[79]\d|E[2-9]\d|E29\d|CRJ\d|BCS\d|DH8D|AT[4-7]\d|MD\d\d|C919|A3\dN)$")
_KEEP_UPPER = {"II", "III", "IV", "SA", "AG", "AB", "BV", "NV", "UK", "USA", "US"}


def _load_airlines():
    names = {}
    for path in (AIRLINES_PATH, AIRLINES_EXTRA_PATH):  # later files win
        try:
            with open(path, encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    name = _TEXT.sub("", r["name"]).strip()[:40]
                    if name:
                        names[r["icao"]] = name
        except FileNotFoundError:
            pass
    names.update(traffic.AIRLINES)  # hand-checked names for Boston regulars win
    return names


AIRLINES = _load_airlines()

_local = threading.local()
_cache: dict[str, dict | None] = {}
_CACHE_MAX = 60000


def _conn():
    c = getattr(_local, "conn", None)
    if c is None and DB_PATH.exists():
        c = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
        _local.conn = c
    return c


def available():
    return DB_PATH.exists()


def tidy_desc(desc):
    """'BOEING 737-800' -> 'Boeing 737-800', 'DASSAULT Falcon 6X' -> 'Dassault Falcon 6X'."""
    desc = _TEXT.sub("", desc or "").strip()[:40]
    words = []
    for w in desc.split():
        if w == "DE":
            w = "de"  # de Havilland
        elif w.isalpha() and w.isupper() and len(w) > 3 and w not in _KEEP_UPPER:
            w = w.capitalize()
        words.append(w)
    return " ".join(words) or None


def _row(reg, typ, descr, private, op=None):
    reg = _REG.sub("", (reg or "").upper())[:10] or None
    return {
        "op": op if op in AIRLINES else None,
        "registration": None if private else reg,
        "aircraft_type": _TYPE.sub("", (typ or "").upper())[:4] or None,
        "type_desc": tidy_desc(descr),
        "private": bool(private),
        # kept server-side only, to recognise "the callsign is just the tail number"
        "_reg": reg,
    }


def _op_col(conn):
    """'op' if the DB has the airline column (built by the current script), else NULL."""
    if not hasattr(_local, "has_op"):
        _local.has_op = any(r[1] == "op" for r in conn.execute("PRAGMA table_info(ac)"))
    return "op" if _local.has_op else "NULL"


def lookup_many(icaos):
    """{icao24: info or None} for many aircraft at once (cached)."""
    out, missing = {}, []
    for i in icaos:
        if i in _cache:
            out[i] = _cache[i]
        else:
            missing.append(i)
    conn = _conn()
    if missing and conn is not None:
        for k in range(0, len(missing), 900):
            chunk = missing[k:k + 900]
            q = f"SELECT icao, reg, type, descr, private, {_op_col(conn)} FROM ac WHERE icao IN ({','.join('?' * len(chunk))})"
            found = {r[0]: _row(*r[1:]) for r in conn.execute(q, chunk)}
            for i in chunk:
                out[i] = found.get(i)
        if len(_cache) > _CACHE_MAX:
            _cache.clear()
        _cache.update({i: out[i] for i in missing})
    return out


def lookup(icao):
    return lookup_many([icao]).get(icao)


def operator_code(callsign, owner_airline=None):
    """ICAO code of the airline operator_name() picked (for the logo), or None."""
    m = re.match(r"^([A-Z]{3})\d", callsign or "")
    if m and m.group(1) in AIRLINES:
        return m.group(1)
    return owner_airline if owner_airline in AIRLINES else None


def operator_name(callsign, reg=None, owner_airline=None, aircraft_type=None):
    """Who the flight is operating as.
    1. Airline callsign: 'DLH400' -> 'Lufthansa'.
    2. Tail-number callsign ('N806JB', 'GSPMI' for G-SPMI, or none at all):
       the airline that owns the plane if it's an airline ('JETBLUE AIRWAYS CORP'),
       unknown if it's an airliner type (probably leased to an airline),
       otherwise 'Private / general aviation'.
    None = unknown."""
    cs = callsign or ""
    m = re.match(r"^([A-Z]{3})\d", cs)
    if m and m.group(1) in AIRLINES:
        return AIRLINES[m.group(1)]
    tail = not cs or (reg and cs == reg.replace("-", "")) or re.match(r"^N\d[0-9A-Z]{0,4}$", cs)
    if not tail:
        return None
    if owner_airline:
        return AIRLINES[owner_airline]
    if aircraft_type and _AIRLINER.match(aircraft_type):
        return None
    return "Private / general aviation"


def enrich(aircraft):
    """Fill in type/registration where the feed lacks them, and add `operator` and
    `type_desc`, in place. Used for both the Boston and the worldwide feed."""
    info = lookup_many([a["icao24"] for a in aircraft])
    for a in aircraft:
        i = info.get(a["icao24"])
        reg = a.get("registration")
        if i:
            if i["private"]:
                a["registration"] = None
            elif not reg:
                a["registration"] = i["registration"]
            if not a.get("aircraft_type"):
                a["aircraft_type"] = i["aircraft_type"]
            a["type_desc"] = i["type_desc"]
            reg = reg or i["_reg"]
        else:
            a.setdefault("type_desc", None)
        op = i["op"] if i else None
        a["operator"] = operator_name(a.get("callsign"), reg, op, a.get("aircraft_type"))
        a["operator_icao"] = operator_code(a.get("callsign"), op) if a["operator"] and not a["operator"].startswith("Private") else None
    return aircraft
