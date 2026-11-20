"""How much time does each arrival lose inside the last 40 nm?

    python time_lost.py [ICAO]      (default KBOS) -> data/time_lost/ICAO.csv + ICAO.json

The measure follows the idea behind EUROCONTROL's "additional ASMA time" (Arrival
Sequencing and Metering Area, a 40 nm ring): for every landing, time from crossing
40 nm to touchdown, minus an "unimpeded" time for comparable flights (same entry
direction, same landing runway, same size class) = the 20th percentile of their
transit times. What's left is time spent holding, being vectored or slowed for
sequencing. It's our version on public ADS-B data, not the official figure.

Why: this is step 1 of the scheduler story. Before optimizing landing sequences,
measure how much time real arrivals lose, when and where; if it's near zero there
is nothing to optimize.
"""
import bisect
import csv
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import airport_geo as G
import events as E

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "time_lost"
RING_NM = 40
MAX_CROSS_GAP_S = 120       # need samples on both sides of the ring this close together
MAX_TRANSIT_S = 90 * 60
SECTOR_DEG = 45
UNIMPEDED_PCT = 20
MIN_GROUP = 20              # smaller groups fall back to sector x runway, then runway
HEAVY = re.compile(r"^(A3[3-5]\d|A38\d|A3[34]N|B74\d|B76\d|B77\w|B78\w|MD11|IL96|A124|C17|C5M|DC10|KC\w*)$")
LIGHT_CATEGORIES = {1, 2}   # ADS-B emitter category: light / small


def size_class(actype, category):
    if actype and HEAVY.match(actype):
        return "heavy"
    if category in LIGHT_CATEGORIES:
        return "light"
    return "medium"


def _crossing(ap, samples, touchdown_t):
    """(time the flight last crossed into the 40 nm ring before touchdown, entry
    bearing, samples inside), or None when the crossing isn't covered by data."""
    inside = []
    prev = None
    for s in reversed(samples):
        if s.t > touchdown_t:
            continue
        if touchdown_t - s.t > MAX_TRANSIT_S:
            return None
        d = ap.dist_nm(s.lat, s.lon)
        if prev is not None and prev.t - s.t > MAX_CROSS_GAP_S:
            return None          # hole in the data before we found the crossing
        if d > RING_NM:
            if prev is None:
                return None
            d_in = ap.dist_nm(prev.lat, prev.lon)
            f = (d - RING_NM) / (d - d_in) if d != d_in else 0.0
            t = s.t + f * (prev.t - s.t)
            lat = s.lat + f * (prev.lat - s.lat)
            lon = s.lon + f * (prev.lon - s.lon)
            return t, ap.bearing(lat, lon), list(reversed(inside))
        inside.append(s)
        prev = s
    return None


def _path(ap, inside):
    """Distance flown inside the ring (nm) and total heading change (deg)."""
    dist, turn = 0.0, 0.0
    for a, b in zip(inside, inside[1:]):
        xa, ya = ap.xy(a.lat, a.lon)
        xb, yb = ap.xy(b.lat, b.lon)
        dist += math.hypot(xb - xa, yb - ya)
        if a.track is not None and b.track is not None:
            turn += abs(G.angle_diff(a.track, b.track))
    return dist, turn


def _pct(values, p):
    v = sorted(values)
    k = (len(v) - 1) * p / 100
    lo = math.floor(k)
    return v[lo] + (v[min(lo + 1, len(v) - 1)] - v[lo]) * (k - lo)


def measure(ap, tracks, landings):
    rows, skipped = [], defaultdict(int)
    for ev in landings:
        samples = tracks.get(ev["icao24"])
        if not samples:
            skipped["no track"] += 1
            continue
        t_td = float(ev["time"])
        c = _crossing(ap, samples, t_td)
        if c is None:
            skipped["40 nm crossing not in the data"] += 1
            continue
        t_in, brg, inside = c
        cat = next((s.category for s in reversed(inside) if s.category is not None), None)
        dist, turn = _path(ap, inside)
        rows.append({
            "icao24": ev["icao24"], "callsign": ev["callsign"], "aircraft_type": ev["aircraft_type"],
            "touchdown": t_td, "touchdown_local": datetime.fromtimestamp(t_td, ap.tz).strftime("%Y-%m-%d %H:%M"),
            "runway": ev["runway"], "entry_bearing": round(brg),
            "sector": int(brg // SECTOR_DEG) * SECTOR_DEG,
            "size": size_class(ev["aircraft_type"] or None, cat),
            "transit_min": round((t_td - t_in) / 60, 2),
            "path_nm": round(dist, 1), "turn_deg": round(turn),
        })
    return rows, skipped


def add_unimpeded(rows):
    """Unimpeded time per (sector, runway, size); fall back to coarser groups."""
    keys = [lambda r: (r["sector"], r["runway"], r["size"]),
            lambda r: (r["sector"], r["runway"]),
            lambda r: (r["runway"],)]
    groups = [defaultdict(list) for _ in keys]
    for r in rows:
        for g, k in zip(groups, keys):
            g[k(r)].append(r["transit_min"])
    for r in rows:
        for level, (g, k) in enumerate(zip(groups, keys)):
            vals = g[k(r)]
            if len(vals) >= MIN_GROUP or level == len(keys) - 1:
                r["unimpeded_min"] = round(_pct(vals, UNIMPEDED_PCT), 2)
                r["group_level"] = level
                break
        r["lost_min"] = round(max(0.0, r["transit_min"] - r["unimpeded_min"]), 2)
    # arrivals landing within +-30 min: how busy it was
    times = sorted(r["touchdown"] for r in rows)
    for r in rows:
        r["landings_hour"] = bisect.bisect_right(times, r["touchdown"] + 1800) - bisect.bisect_left(times, r["touchdown"] - 1800)


def summary(ap, rows, skipped, n_landings):
    def stats(rs):
        lost = [r["lost_min"] for r in rs]
        return {"flights": len(rs), "mean_min": round(sum(lost) / len(lost), 2),
                "median_min": round(_pct(lost, 50), 2), "p90_min": round(_pct(lost, 90), 2),
                "over_5_min_pct": round(100 * sum(x > 5 for x in lost) / len(lost), 1)}

    def by(key, min_n=30):
        g = defaultdict(list)
        for r in rows:
            g[key(r)].append(r)
        return {str(k): stats(v) for k, v in sorted(g.items()) if len(v) >= min_n}

    days = sorted({r["touchdown_local"][:10] for r in rows})
    return {
        "airport": ap.icao, "landings": n_landings, "measured": len(rows), "skipped": dict(skipped),
        "days": [days[0], days[-1]] if days else [],
        "total_hours_lost": round(sum(r["lost_min"] for r in rows) / 60, 1),
        "overall": stats(rows),
        "by_hour_local": by(lambda r: int(r["touchdown_local"][11:13]), 20),
        "by_runway": by(lambda r: r["runway"]),
        "by_entry_sector": by(lambda r: r["sector"]),
        "by_size": by(lambda r: r["size"], 10),
        "by_landings_per_hour": by(lambda r: min(r["landings_hour"] // 10 * 10, 60), 20),
        "by_day": by(lambda r: r["touchdown_local"][:10], 1),
        "holding_pct": round(100 * sum(r["turn_deg"] >= 540 for r in rows) / len(rows), 1),
    }


def main():
    ap = G.get(sys.argv[1] if len(sys.argv) > 1 else "KBOS")
    tracks, windows, *_ = E.load_all(ap)
    evs, _ = E.detect(tracks, windows, ap)
    landings = [e for e in evs if e["kind"] == "landing"]
    rows, skipped = measure(ap, tracks, landings)
    add_unimpeded(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / f"{ap.icao}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    s = summary(ap, rows, skipped, len(landings))
    (OUT / f"{ap.icao}.json").write_text(json.dumps(s, indent=1))
    o = s["overall"]
    print(f"{ap.icao}: {len(rows):,} of {len(landings):,} landings measured ({s['days'][0]} to {s['days'][-1]}); skipped {dict(skipped)}")
    print(f"  time lost inside 40 nm: mean {o['mean_min']} min, median {o['median_min']}, 90th pct {o['p90_min']}, "
          f"{o['over_5_min_pct']}% lose over 5 min; {s['total_hours_lost']} hours in total; holding-like turns {s['holding_pct']}%")
    for name in ("by_landings_per_hour", "by_size", "by_runway", "by_entry_sector"):
        print(f"  {name}: " + "; ".join(f"{k}: {v['mean_min']} ({v['flights']})" for k, v in s[name].items()))
    print("  by_hour_local: " + " ".join(f"{k}h {v['mean_min']}" for k, v in s["by_hour_local"].items()))


if __name__ == "__main__":
    main()
