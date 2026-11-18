"""
Worldwide aircraft from OpenSky /states/all, for the world map (roadmap: worldwide).

The Boston feed (adsb_feed.py, adsb.fi every 5 s) stays the source for
everything Logan-specific: statuses, Ask Flive deep tools, logs, predictions.
This feed only adds every other aircraft on Earth, at a much slower rate:

  OpenSky charges 4 credits per global call. Standard account: 4,000/day
  -> one call every ~86 s. Anonymous: 400/day -> every ~15 min.

World snapshots are never logged (~675 KB each: ~4 GB/day at the Boston log's
15 s cadence). They live in memory in a grid index so "which aircraft are in
this map view" is cheap.
"""
import math
import os
import re
import time
from collections import defaultdict

import requests

import opensky_auth
from adsb_feed import USER_AGENT, RateLimited, _ident

STATES_URL = "https://opensky-network.org/api/states/all"
CREDITS_PER_CALL = 4
CELL_DEG = 5                  # grid cell size for the spatial index

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT


def poll_interval():
    """Seconds between world calls that stay inside the daily credit budget."""
    override = os.getenv("WORLD_POLL_SECONDS")
    if override:
        return max(45, int(override))       # 8,000-credit feeders can go down to ~45 s
    return 90 if opensky_auth.has_credentials() else 900


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def convert(s):
    """OpenSky state vector (list) -> Flive snapshot aircraft dict (same field names
    as adsb_feed.convert; OpenSky has no type or registration)."""
    squawk = s[14] if len(s) > 14 else None
    category = s[17] if len(s) > 17 else None
    return {
        "icao24": str(s[0] or "").lower()[:7],
        "callsign": _ident(s[1], 8),
        "lat": _num(s[6]),
        "lon": _num(s[5]),
        "baro_alt_m": None if s[8] else _num(s[7]),
        "on_ground": bool(s[8]),
        "velocity_ms": _num(s[9]),
        "track_deg": _num(s[10]),
        "vert_rate_ms": _num(s[11]),
        "geo_alt_m": _num(s[13]),
        "squawk": squawk if isinstance(squawk, str) and squawk.isdigit() else None,
        "time_position": _num(s[3]),
        "last_contact": _num(s[4]),
        "pos_source": s[16] if len(s) > 16 and isinstance(s[16], int) else None,
        "category": category if isinstance(category, int) else None,
        "aircraft_type": None,
        "registration": None,
    }


def poll_once():
    """One global call. Returns (snapshot, credits_remaining_or_None)."""
    def get():
        return _session.get(STATES_URL, params={"extended": 1},
                            headers=opensky_auth.auth_headers(), timeout=60)
    r = get()
    if r.status_code == 401 and opensky_auth.has_credentials():
        opensky_auth.invalidate()
        r = get()
    remaining = r.headers.get("X-Rate-Limit-Remaining")
    remaining = int(remaining) if remaining and remaining.isdigit() else None
    if r.status_code == 429:
        retry = r.headers.get("X-Rate-Limit-Retry-After-Seconds")
        raise RateLimited(int(retry) if retry and retry.isdigit() else None)
    r.raise_for_status()
    data = r.json()
    aircraft = [convert(s) for s in data.get("states") or [] if isinstance(s, list) and len(s) >= 17]
    aircraft = [a for a in aircraft if a["lat"] is not None and a["lon"] is not None and a["icao24"]]
    snap = {"fetched_at": time.time(), "api_time": data.get("time") or time.time(),
            "aircraft": aircraft, "bytes": len(r.content)}
    return snap, remaining


# --- compact wire format ----------------------------------------------------
# A world view can hold thousands of aircraft, so the WebSocket sends rows as
# arrays with a field list instead of full objects (~4x smaller), rounded to
# what the map needs. Same field names as the snapshot format, SI units.
COMPACT_FIELDS = ["icao24", "callsign", "lat", "lon", "baro_alt_m", "on_ground",
                  "velocity_ms", "track_deg", "vert_rate_ms", "time_position", "category"]


def _r(v, nd):
    return None if v is None else (round(v, nd) if nd else int(round(v)))


def compact_row(a):
    return [a["icao24"], a["callsign"], _r(a["lat"], 4), _r(a["lon"], 4), _r(a["baro_alt_m"], 0),
            1 if a["on_ground"] else 0, _r(a["velocity_ms"], 1), _r(a["track_deg"], 0),
            _r(a["vert_rate_ms"], 1), _r(a["time_position"], 0), a["category"]]


def _wrap(x):
    return ((x + 180) % 360) - 180


_HEX = re.compile(r"^~?[0-9a-f]{6}$")


def parse_keep(msg):
    """Optional 'keep' list in a view message: ICAO hex ids (max 3) the client
    wants included even if thinning would drop them, e.g. the selected plane."""
    keep = msg.get("keep") if isinstance(msg, dict) else None
    if not isinstance(keep, list):
        return ()
    return tuple(k for k in keep[:3] if isinstance(k, str) and _HEX.match(k))


def parse_view(msg):
    """Validate a client 'view' message -> (visible, padded) boxes, or None.
    Each box is (west, south, east, north) with longitudes in -180..180
    (west > east means it crosses the antimeridian). The padded box is grown
    25% each way so short pans don't run off the data; counts use `visible`."""
    try:
        w, s, e, n = (float(v) for v in msg["bbox"])
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (w, s, e, n)) or s > n or e < w:
        return None
    s, n = max(-90.0, s), min(90.0, n)
    span, pad_y = e - w, (n - s) * .25
    ps, pn = max(-90.0, s - pad_y), min(90.0, n + pad_y)
    if span >= 300:                       # effectively the whole world
        return (-180.0, s, 180.0, n), (-180.0, ps, 180.0, pn)
    visible = (_wrap(w), s, _wrap(e), n) if span < 360 else (-180.0, s, 180.0, n)
    pad_x = span * .25
    padded = (_wrap(w - pad_x), ps, _wrap(e + pad_x), pn) if span * 1.5 < 360 else (-180.0, ps, 180.0, pn)
    return visible, padded


def _cell(lat, lon):
    return (math.floor(lat / CELL_DEG), math.floor(lon / CELL_DEG))


class WorldStore:
    """Latest world snapshot plus a coarse grid index for viewport queries."""

    def __init__(self):
        self.snapshot = None
        self.grid = {}
        self.by_id = {}
        self.credits_remaining = None
        self.last_error = None

    def update(self, snap, credits_remaining=None):
        grid = defaultdict(list)
        for a in snap["aircraft"]:
            grid[_cell(a["lat"], a["lon"])].append(a)
        self.snapshot, self.grid = snap, dict(grid)
        self.by_id = {a["icao24"]: a for a in snap["aircraft"]}
        self.credits_remaining = credits_remaining
        self.last_error = None

    def query(self, west, south, east, north, limit=2000):
        """Aircraft inside a lat/lon box. Handles boxes crossing the antimeridian
        (west > east). When more than `limit` match, picks round-robin across grid
        cells so a zoomed-out view thins out evenly instead of keeping one region."""
        if not self.snapshot:
            return [], 0
        south, north = max(-90.0, south), min(90.0, north)
        ranges = [(west, east)] if west <= east else [(west, 180.0), (-180.0, east)]
        buckets = []
        for w, e in ranges:
            for cy in range(math.floor(south / CELL_DEG), math.floor(north / CELL_DEG) + 1):
                for cx in range(math.floor(w / CELL_DEG), math.floor(e / CELL_DEG) + 1):
                    hits = [a for a in self.grid.get((cy, cx), ())
                            if south <= a["lat"] <= north and w <= a["lon"] <= e]
                    if hits:
                        # Airborne first inside each cell: parked aircraft matter least zoomed out.
                        hits.sort(key=lambda a: a["on_ground"])
                        buckets.append(hits)
        total = sum(len(b) for b in buckets)
        if total <= limit:
            return [a for b in buckets for a in b], total
        picked, i = [], 0
        while len(picked) < limit:
            for b in buckets:
                if i < len(b):
                    picked.append(b[i])
                    if len(picked) == limit:
                        break
            i += 1
        return picked, total

    def stats(self):
        s = self.snapshot
        if not s:
            return {"available": False, "last_error": self.last_error}
        n = len(s["aircraft"])
        return {
            "available": True,
            "aircraft": n,
            "airborne": sum(1 for a in s["aircraft"] if not a["on_ground"]),
            "age_s": round(time.time() - s["fetched_at"]),
            "payload_kb": round(s["bytes"] / 1024),
            "grid_cells": len(self.grid),
            "credits_remaining": self.credits_remaining,
            "authenticated": opensky_auth.has_credentials(),
            "poll_seconds": poll_interval(),
            "last_error": self.last_error,
        }
