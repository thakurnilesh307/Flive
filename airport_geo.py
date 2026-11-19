"""The airports Flive makes predictions for, and their runway geometry.

Everything that used to be hardcoded for Logan (reference point, field elevation,
time zone, runway ends, the flat nm projection) lives on an `Airport` object, so the
detector (events.py), the features (dataset.py), training and the live predictor
(eta.py) all work the same way for any airport in CONFIG.

Runways come from OurAirports (public domain) via scripts/build_runways.py ->
data/runways.csv. Adding an airport = add it to CONFIG, rebuild runways, import
history, train.
"""
import csv
import math
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
RUNWAYS_CSV = HERE / "data" / "runways.csv"

# icao: (short name, reference lat, lon, time zone, live log file prefix)
CONFIG = {
    "KBOS": ("Logan", 42.3656, -71.0096, "America/New_York", "logan"),
    "KJFK": ("JFK", 40.6398, -73.7789, "America/New_York", "kjfk"),
    "EGLL": ("Heathrow", 51.4706, -0.4619, "Europe/London", "egll"),
}
HEADING_TOL = 25        # degrees
CROSS_TRACK_NM = 0.35   # max distance from the extended centreline


def angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


@dataclass
class RunwayEnd:
    ident: str
    x0: float          # threshold, nm from the airport reference point
    y0: float
    ux: float          # unit vector along the landing direction
    uy: float
    heading: float     # true degrees
    length: float      # nm
    ap: "Airport" = field(repr=False, default=None)

    def offsets(self, lat, lon):
        """(along-track from threshold, cross-track) in nm for a point."""
        x, y = self.ap.xy(lat, lon)
        dx, dy = x - self.x0, y - self.y0
        return dx * self.ux + dy * self.uy, abs(-dx * self.uy + dy * self.ux)


class Airport:
    def __init__(self, icao, name, lat, lon, tz, log_prefix, runways, elev_ft):
        self.icao, self.name, self.lat, self.lon = icao, name, lat, lon
        self.tz, self.log_prefix, self.elev_ft = ZoneInfo(tz), log_prefix, elev_ft
        self._cos = math.cos(math.radians(lat))
        self.ends = []
        for le, la1, lo1, he, la2, lo2 in runways:
            for ident, a, b in ((le, (la1, lo1), (la2, lo2)), (he, (la2, lo2), (la1, lo1))):
                x0, y0 = self.xy(*a)
                x1, y1 = self.xy(*b)
                length = math.hypot(x1 - x0, y1 - y0)
                ux, uy = (x1 - x0) / length, (y1 - y0) / length
                heading = math.degrees(math.atan2(ux, uy)) % 360
                self.ends.append(RunwayEnd(ident, x0, y0, ux, uy, heading, length, self))
        self.by_ident = {r.ident: r for r in self.ends}
        self.idents = sorted(self.by_ident)

    def __repr__(self):
        return f"Airport({self.icao}, {len(self.ends)} runway ends)"

    def xy(self, lat, lon):
        """Flat local projection around the airport, in nm (fine within ~50 nm)."""
        return (lon - self.lon) * 60 * self._cos, (lat - self.lat) * 60

    def dist_nm(self, lat, lon):
        x, y = self.xy(lat, lon)
        return math.hypot(x, y)

    def bearing(self, lat, lon):
        """Degrees true from the airport to the point."""
        p1, p2 = math.radians(self.lat), math.radians(lat)
        dl = math.radians(lon - self.lon)
        y = math.sin(dl) * math.cos(p2)
        x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
        return (math.degrees(math.atan2(y, x)) + 360) % 360

    def match_runway(self, lat, lon, track, before=3.0, after=0.5):
        """The runway end the aircraft is lined up with, or None: heading within 25 deg
        AND within 0.35 nm of the extended centreline (position matters because
        parallel runways share a heading). `before`: how far before the threshold
        still counts (nm); `after`: past the far end."""
        if track is None or lat is None or lon is None:
            return None
        best = None
        for r in self.ends:
            if angle_diff(track, r.heading) > HEADING_TOL:
                continue
            along, cross = r.offsets(lat, lon)
            if cross <= CROSS_TRACK_NM and -before <= along <= r.length + after:
                if best is None or cross < best[1]:
                    best = (r.ident, cross)
        return best[0] if best else None


def _runway_rows():
    rows = {}
    if RUNWAYS_CSV.exists():
        with open(RUNWAYS_CSV, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows.setdefault(r["airport"], []).append(r)
    return rows


def _make(icao, name, lat, lon, tz, prefix, rws):
    elevs = [float(r["elev_ft"]) for r in rws if r["elev_ft"]]
    return Airport(icao, name, lat, lon, tz, prefix,
                   [(r["le_ident"], float(r["le_lat"]), float(r["le_lon"]),
                     r["he_ident"], float(r["he_lat"]), float(r["he_lon"])) for r in rws],
                   sum(elevs) / len(elevs) if elevs else 0.0)


_WORLD = None


def world_airports():
    """Every scheduled-service airport (data/airports.csv) that has runway coordinates,
    as Airport objects, for the global landing model. Time zone is UTC (unused there)."""
    global _WORLD
    if _WORLD is None:
        rows = _runway_rows()
        out = {}
        with open(HERE / "data" / "airports.csv", encoding="utf-8") as f:
            for a in csv.DictReader(f):
                if a["icao"] in rows and a["icao"] not in out:
                    out[a["icao"]] = _make(a["icao"], a["name"], float(a["lat"]), float(a["lon"]),
                                           "UTC", "", rows[a["icao"]])
        _WORLD = out
    return _WORLD


def _load():
    rows = {}
    if RUNWAYS_CSV.exists():
        with open(RUNWAYS_CSV, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rows.setdefault(r["airport"], []).append(r)
    out = {}
    for icao, (name, lat, lon, tz, prefix) in CONFIG.items():
        rws = rows.get(icao, [])
        elevs = [float(r["elev_ft"]) for r in rws if r["elev_ft"]]
        out[icao] = Airport(icao, name, lat, lon, tz, prefix,
                            [(r["le_ident"], float(r["le_lat"]), float(r["le_lon"]),
                              r["he_ident"], float(r["he_lat"]), float(r["he_lon"])) for r in rws],
                            sum(elevs) / len(elevs) if elevs else 0.0)
    return out


AIRPORTS = _load()


def get(icao):
    try:
        return AIRPORTS[icao.upper()]
    except KeyError:
        raise SystemExit(f"Unknown airport {icao!r}; configured: {', '.join(AIRPORTS)}")
