"""Check events.py's detected landings against OpenSky's arrival records for KBOS.

    python scripts/validate_events.py

OpenSky builds per-flight records overnight (/flights/arrival, previous days only,
separate credit bucket from the live states). We only compare inside the time
windows our logs actually cover, with a margin so the whole approach was visible:

- recall:    of OpenSky's KBOS arrivals in covered windows, how many did we detect?
- precision: of our detected landings in those windows, how many does OpenSky have?

A match is the same icao24 within 20 minutes. OpenSky's records are estimates too
(its "lastSeen" depends on receiver coverage near the ground, and it sometimes
assigns a nearby airport), so disagreements are listed for a human to look at.
"""
import glob
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

import events  # noqa: E402
import opensky_auth  # noqa: E402

URL = "https://opensky-network.org/api/flights/arrival"
MATCH_S = 20 * 60
EDGE_S = 15 * 60          # ignore arrivals right at the edges of a covered window
MAX_QUERY_S = 86400       # OpenSky: a query may touch at most 2 UTC days


def fetch_arrivals(begin, end):
    out = []
    t = begin
    while t < end:
        stop = min(end, t + MAX_QUERY_S)
        r = requests.get(URL, params={"airport": "KBOS", "begin": int(t), "end": int(stop)},
                         headers=opensky_auth.auth_headers(), timeout=60)
        if r.status_code == 404:      # OpenSky: no flights in this interval
            pass
        else:
            r.raise_for_status()
            out.extend(r.json())
        t = stop
        time.sleep(1)
    return out


def main():
    paths = sorted(glob.glob(str(ROOT / "logan_*.jsonl")))
    tracks, _ = events.load_tracks(paths)
    covered = events.coverage(paths)
    detected, _ = events.detect(tracks, covered)
    landings = [e for e in detected if e["kind"] == "landing"]
    windows = [(s + EDGE_S, e - 120) for s, e in covered if e - s > EDGE_S + 600]

    # OpenSky only has finished days: stop at the start of today (UTC).
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    windows = [(s, min(e, today)) for s, e in windows if s < today]
    if not windows:
        sys.exit("No covered time before today (UTC) yet: OpenSky publishes arrivals the next day.")

    def inside(t):
        return any(s <= t <= e for s, e in windows)

    print(f"Covered windows before today: {len(windows)}, "
          f"{sum(e - s for s, e in windows) / 3600:.1f} h")
    arrivals = fetch_arrivals(windows[0][0] - 3600, windows[-1][1] + 3600)
    sky = [a for a in arrivals if a.get("lastSeen") and inside(a["lastSeen"])]
    ours = [e for e in landings if inside(e["time"])]

    def match(t, icao, pool, key):
        return any(p_icao == icao and abs(p_t - t) <= MATCH_S for p_icao, p_t in pool)

    sky_pool = [(a["icao24"], a["lastSeen"]) for a in sky]
    our_pool = [(e["icao24"], e["time"]) for e in ours]
    found = [a for a in sky if match(a["lastSeen"], a["icao24"], our_pool, None)]
    confirmed = [e for e in ours if match(e["time"], e["icao24"], sky_pool, None)]

    print(f"OpenSky KBOS arrivals in those windows: {len(sky)}")
    print(f"Our detected landings in those windows:  {len(ours)}")
    if sky:
        print(f"Recall:    {len(found)}/{len(sky)} = {100 * len(found) / len(sky):.0f}% of OpenSky's arrivals detected")
    if ours:
        print(f"Precision: {len(confirmed)}/{len(ours)} = {100 * len(confirmed) / len(ours):.0f}% of our landings confirmed by OpenSky")
    for method in ("ground flag", "lost on final"):
        m = [e for e in ours if e["method"] == method]
        if m:
            c = sum(1 for e in m if e in confirmed)
            print(f"  {method:14s} {c}/{len(m)} confirmed")
    if found:
        # How far apart are the two time estimates? (OpenSky's lastSeen is often a bit after touchdown.)
        diffs = sorted(
            min((a["lastSeen"] - e["time"] for e in ours if e["icao24"] == a["icao24"]), key=abs)
            for a in found)
        print(f"lastSeen minus our touchdown time: median {diffs[len(diffs) // 2]:.0f} s")

    fmt = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime("%m-%d %H:%M")  # noqa: E731
    missed = [a for a in sky if a not in found]
    extra = [e for e in ours if e not in confirmed]
    if missed:
        print("\nOpenSky arrivals we missed (first 15):")
        for a in missed[:15]:
            print(f"  {fmt(a['lastSeen'])}  {(a.get('callsign') or '').strip():8s} {a['icao24']}  from {a.get('estDepartureAirport')}")
    if extra:
        print("\nOur landings OpenSky doesn't list (first 15):")
        for e in extra[:15]:
            print(f"  {fmt(e['time'])}  {e['callsign']:8s} {e['icao24']}  runway {e['runway']}  ({e['method']})")


if __name__ == "__main__":
    main()
