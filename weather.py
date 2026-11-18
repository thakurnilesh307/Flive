"""Local air pressure (QNH) from METARs, to correct barometric altitudes worldwide.

ADS-B reports pressure altitude: height computed as if the air pressure at sea level
were the standard 29.92 inHg (1013.25 hPa). On a high-pressure day that reads too low
(a plane on the runway shows "-400 ft"); on a low-pressure day, too high. Pilots fix
this by setting the local pressure on their altimeter near the ground. Flive does the
same: every 10 minutes the server downloads the latest METAR from every reporting
station (aviationweather.gov's bulk cache, ~250 KB, free, no key) and corrects each
plane below 18,000 ft with the nearest station's altimeter setting (within 100 nm).
"""
import csv
import gzip
import io
import math

import requests

CACHE_URL = "https://aviationweather.gov/data/cache/metars.cache.csv.gz"
UA = "Flive/0.1 (live flight tracker; +https://github.com/thakurnilesh307/Flive)"
CORRECT_BELOW_FT = 18000   # above this the correction stops mattering (and the US flies 29.92)
MAX_STATION_NM = 100
FT_TO_M = 0.3048
CELL = 2.0                 # degrees, for the station grid

_session = requests.Session()
_session.headers["User-Agent"] = UA


def _dist_nm(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(h))


class QnhField:
    """Altimeter settings from every METAR station, with a nearest-station lookup."""

    def __init__(self):
        self.grid = {}
        self.count = 0

    def update(self, stations):
        grid = {}
        for st in stations:
            grid.setdefault((math.floor(st[0] / CELL), math.floor(st[1] / CELL)), []).append(st)
        self.grid, self.count = grid, len(stations)

    def inhg_at(self, lat, lon):
        """Nearest station's altimeter setting (inHg) within 100 nm, or None."""
        cy, cx = math.floor(lat / CELL), math.floor(lon / CELL)
        best, best_d = None, MAX_STATION_NM
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                gx = (cx + dx + 90) % 180 - 90  # wrap across ±180 (cells -90..89)
                for s_lat, s_lon, inhg, _ in self.grid.get((cy + dy, gx), ()):
                    d = _dist_nm(lat, lon, s_lat, s_lon)
                    if d < best_d:
                        best, best_d = inhg, d
        return best


def fetch_stations():
    """[(lat, lon, altim_inhg, station_id)] from the bulk METAR cache."""
    r = _session.get(CACHE_URL, timeout=30)
    r.raise_for_status()
    text = gzip.decompress(r.content).decode("utf-8", "replace")
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            lat, lon, inhg = float(row["latitude"]), float(row["longitude"]), float(row["altim_in_hg"])
        except (KeyError, TypeError, ValueError):
            continue
        if 26.5 <= inhg <= 32.5 and -90 <= lat <= 90 and -180 <= lon <= 180:  # sanity range
            out.append((lat, lon, inhg, row.get("station_id", "")[:4]))
    return out


def corrected_alt_m(baro_alt_m, inhg):
    """Pressure altitude -> height above sea level with the local altimeter setting.
    The rule pilots use: 1 inHg of difference = 1,000 ft."""
    if baro_alt_m is None or inhg is None or baro_alt_m / FT_TO_M >= CORRECT_BELOW_FT:
        return baro_alt_m
    return baro_alt_m + (inhg - 29.92) * 1000 * FT_TO_M


def apply(aircraft, field):
    """Add `alt_qnh_m` to each aircraft (raw `baro_alt_m` is left untouched, so the
    logs keep the original value). None when there's no altitude."""
    for a in aircraft:
        b = a.get("baro_alt_m")
        if b is None or a.get("lat") is None or a.get("lon") is None:
            a["alt_qnh_m"] = None
            continue
        inhg = field.inhg_at(a["lat"], a["lon"]) if b / FT_TO_M < CORRECT_BELOW_FT else None
        a["alt_qnh_m"] = round(corrected_alt_m(b, inhg), 1)
    return aircraft
