"""Training examples for the landing-time model (roadmap step 5).

For every landing events.py found, walk back through that aircraft's last 30
minutes. Each position (one every 30 s) becomes one row:

    what the plane looked like then (distance, altitude, speed, ...)  ->  seconds until it landed

Rules that keep the test honest:
- Only information available AT that moment goes in. The landing runway is NOT a
  feature (you don't know it in advance); the runway Logan was using for the
  landings in the previous 30 minutes is, because that's already happened.
- Rows from the same day stay together (train_eta.py tests on unseen days), since
  positions 30 s apart are nearly identical.
- Only "ground flag" landings (touchdown time known to seconds) are used as labels;
  inferred "lost on final" ones have up to a minute of uncertainty.

Run:  python dataset.py   -> data/eta_dataset.csv
"""
import bisect
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import events as E

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "eta_dataset.csv"
HORIZON_S = 30 * 60        # look back this far before each touchdown
STEP_S = 30                # one example per aircraft every 30 s
MAX_DIST_NM = 40
MIN_GS_KT = 60
CONFIG_WINDOW_S = 30 * 60  # "runway in use" = most common landing runway in the last 30 min
BOSTON = ZoneInfo("America/New_York")
LANDING_RUNWAYS = ["04L", "04R", "09", "15R", "22L", "27", "32", "33L"]
TAKEOFF_RUNWAYS = ["04L", "04R", "09", "14", "15R", "22L", "22R", "27", "32", "33L"]
TAXI_MIN_KT, TAXI_MAX_KT = 3, 40   # moving on the ground, but not yet on the takeoff roll


def bearing(lat, lon):
    """Degrees true from Logan to the point."""
    p1, p2 = math.radians(E.KBOS[0]), math.radians(lat)
    dl = math.radians(lon - E.KBOS[1])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def dist_nm(lat, lon):
    x, y = E._xy(lat, lon)
    return math.hypot(x, y)


class TrafficIndex:
    """How busy the sky around Logan was at any moment (30 s buckets):
    aircraft airborne within 15 nm and below 8,000 ft, i.e. in the arrival flow."""

    def __init__(self, tracks):
        self.buckets = defaultdict(set)
        for icao, samples in tracks.items():
            for s in samples:
                if not s.on_ground and s.alt_ft is not None and s.alt_ft < 8000 and dist_nm(s.lat, s.lon) < 15:
                    self.buckets[int(s.t // 30)].add(icao)

    def count(self, t, exclude):
        b = int(t // 30)
        return len((self.buckets.get(b, set()) | self.buckets.get(b - 1, set())) - {exclude})


class RunwayHistory:
    """Which runway was Logan landing on recently (known at prediction time)."""

    def __init__(self, landings):
        self.times = [e["time"] for e in landings]
        self.rwys = [e["runway"] for e in landings]

    def in_use(self, t):
        lo = bisect.bisect_left(self.times, t - CONFIG_WINDOW_S)
        hi = bisect.bisect_left(self.times, t)
        recent = Counter(self.rwys[lo:hi])
        return recent.most_common(1)[0][0] if recent else None, hi - lo


_ENDS = {r.ident: r for r in E.RUNWAY_ENDS}


def feature_row(s, t, traffic_15nm, runway_in_use, landings_30min):
    """The model's inputs for one aircraft sample at time t. Used by BOTH training
    (dataset.build) and live predictions (eta.py), so the two can't drift apart.
    `s` is an events.Sample (raw pressure altitude, knots, fpm)."""
    d = dist_nm(s.lat, s.lon)
    brg = bearing(s.lat, s.lon)
    off = E._angle_diff(s.track, (brg + 180) % 360) if s.track is not None else None
    hour = datetime.fromtimestamp(t, BOSTON).hour
    row = {
        "dist_nm": round(d, 3),
        "bearing_sin": round(math.sin(math.radians(brg)), 4),
        "bearing_cos": round(math.cos(math.radians(brg)), 4),
        "alt_ft": round(s.alt_ft),
        "gs_kt": round(s.gs_kt, 1),
        "vs_fpm": None if s.vs_fpm is None else round(s.vs_fpm),
        "track_sin": None if s.track is None else round(math.sin(math.radians(s.track)), 4),
        "track_cos": None if s.track is None else round(math.cos(math.radians(s.track)), 4),
        "off_kbos_deg": None if off is None else round(off, 1),
        "naive_eta_s": round(d / s.gs_kt * 3600, 1),   # the straight-line guess (baseline)
        "traffic_15nm": traffic_15nm,
        "landings_30min": landings_30min,
        "hour_sin": round(math.sin(2 * math.pi * hour / 24), 4),
        "hour_cos": round(math.cos(2 * math.pi * hour / 24), 4),
        "category": s.category,
        "runway_in_use": runway_in_use or "",
        "rwy_along_nm": None, "rwy_cross_nm": None, "rwy_thr_dist_nm": None, "rwy_hdg_diff": None,
    }
    # Geometry relative to the runway in use (not the one it actually lands on: that would leak).
    r = _ENDS.get(runway_in_use)
    if r:
        along, cross = r.offsets(s.lat, s.lon)
        x, y = E._xy(s.lat, s.lon)
        row["rwy_along_nm"] = round(along, 3)   # negative = before the threshold, on the approach side
        row["rwy_cross_nm"] = round(cross, 3)
        row["rwy_thr_dist_nm"] = round(math.hypot(x - r.x0, y - r.y0), 3)
        row["rwy_hdg_diff"] = None if s.track is None else round(E._angle_diff(s.track, r.heading), 1)
    for rw in LANDING_RUNWAYS:
        row[f"cfg_{rw}"] = int(runway_in_use == rw)
    return row


class RunwayUse:
    """How many landings and takeoffs each runway had in the 30 minutes before t.
    Logan often uses two runways at once for each, so counts say more than
    'the most used one'. Built from events.detect output (training) or the live
    predictor's recent events (serving): same class either way."""

    def __init__(self, events_list):
        self.by_kind = {}
        for kind in ("landing", "takeoff"):
            evs = sorted((e for e in events_list if e["kind"] == kind), key=lambda e: e["time"])
            self.by_kind[kind] = ([e["time"] for e in evs], [e["runway"] for e in evs])

    def counts(self, kind, t):
        times, rwys = self.by_kind[kind]
        lo = bisect.bisect_left(times, t - CONFIG_WINDOW_S)
        hi = bisect.bisect_left(times, t)
        return Counter(rwys[lo:hi])


def _use_features(use, t):
    """Share of the last 30 min's landings/takeoffs on each runway (0-1): "70% on 27,
    30% on 33L" says more than raw counts, which depend on how busy it was."""
    row = {}
    land, take = use.counts("landing", t), use.counts("takeoff", t)
    nl, nt = max(sum(land.values()), 1), max(sum(take.values()), 1)
    for rw in LANDING_RUNWAYS:
        row[f"land_{rw}"] = round(land.get(rw, 0) / nl, 3)
    for rw in TAKEOFF_RUNWAYS:
        row[f"take_{rw}"] = round(take.get(rw, 0) / nt, 3)
    return row, land, take


def arrival_runway_features(s, t, traffic_15nm, use):
    """Inputs for "which runway will this arrival land on": the landing-time inputs
    plus position in nm and per-runway use in the last 30 min."""
    row, land, _ = _use_features(use, t)
    cfg = land.most_common(1)[0][0] if land else None
    row.update(feature_row(s, t, traffic_15nm, cfg, sum(land.values())))
    x, y = E._xy(s.lat, s.lon)
    row["x_nm"], row["y_nm"] = round(x, 3), round(y, 3)
    # Where the plane is relative to EVERY landing runway's approach, so the model can
    # learn "lined up with 33L, not 27" when two runways are in use.
    for rw in LANDING_RUNWAYS:
        along, cross = _ENDS[rw].offsets(s.lat, s.lon)
        row[f"along_{rw}"], row[f"cross_{rw}"] = round(along, 2), round(cross, 2)
        row[f"hdg_{rw}"] = None if s.track is None else round(E._angle_diff(s.track, _ENDS[rw].heading), 1)
    return row


def restrict_to_active(classes, proba, active):
    """Zero out runways nobody has used in the last 30 min (when some have been used)
    and renormalise. Used in training evaluation AND live, so both see the same rule."""
    import numpy as np
    if not active:
        return proba
    mask = np.array([c in active for c in classes], dtype=float)
    if not mask.any():
        return proba
    p = proba * mask
    total = p.sum(axis=-1, keepdims=True)
    return np.where(total > 0, p / np.where(total > 0, total, 1), proba)


def departure_runway_features(s, t, use):
    """Inputs for "which runway will this taxiing plane take off from": where it is on
    the airport and which way it's moving, how far each runway end is, its size, and
    recent runway use."""
    row, _, take = _use_features(use, t)
    x, y = E._xy(s.lat, s.lon)
    hour = datetime.fromtimestamp(t, BOSTON).hour
    row.update({
        "x_nm": round(x, 4), "y_nm": round(y, 4),
        "gs_kt": None if s.gs_kt is None else round(s.gs_kt, 1),
        "track_sin": None if s.track is None else round(math.sin(math.radians(s.track)), 4),
        "track_cos": None if s.track is None else round(math.cos(math.radians(s.track)), 4),
        "category": s.category,
        "hour_sin": round(math.sin(2 * math.pi * hour / 24), 4),
        "hour_cos": round(math.cos(2 * math.pi * hour / 24), 4),
        "take_total": sum(take.values()),
    })
    for rw in TAKEOFF_RUNWAYS:
        r = _ENDS[rw]
        row[f"thr_{rw}_nm"] = round(math.hypot(x - r.x0, y - r.y0), 3)
    top = take.most_common(1)[0][0] if take else None
    for rw in TAKEOFF_RUNWAYS:
        row[f"topdep_{rw}"] = int(top == rw)
    return row


def taxiing(s):
    """On the ground at Logan and moving, but not yet on the takeoff roll."""
    return (s.on_ground and s.gs_kt is not None and TAXI_MIN_KT <= s.gs_kt <= TAXI_MAX_KT
            and dist_nm(s.lat, s.lon) < 3 and (s.category is None or s.category < 14))


def usable(s):
    """Samples the model can say something about (airborne, moving, within range)."""
    return (not s.on_ground and s.gs_kt is not None and s.gs_kt >= MIN_GS_KT and s.alt_ft is not None
            and dist_nm(s.lat, s.lon) <= MAX_DIST_NM)


def build(tracks, events_list):
    landings = sorted((e for e in events_list if e["kind"] == "landing"), key=lambda e: e["time"])
    labelled = [e for e in landings if e["method"] == "ground flag"]
    traffic = TrafficIndex(tracks)
    runways = RunwayHistory(landings)
    rows = []
    for ev in labelled:
        td = ev["time"]
        samples = tracks.get(ev["icao24"], [])
        i0 = bisect.bisect_left([x.t for x in samples], td - HORIZON_S)
        next_t = -1e18
        for s in samples[i0:]:
            if s.t >= td - 5:
                break
            if s.t < next_t or not usable(s):
                continue
            next_t = s.t + STEP_S
            cfg, n_landings = runways.in_use(s.t)
            row = {
                "day": datetime.fromtimestamp(td, BOSTON).strftime("%Y-%m-%d"),
                "icao24": ev["icao24"], "callsign": ev["callsign"], "t": round(s.t, 1),
                "label_s": round(td - s.t, 1),
            }
            row.update(feature_row(s, s.t, traffic.count(s.t, ev["icao24"]), cfg, n_landings))
            rows.append(row)
    return rows


def main():
    import pandas as pd
    tracks, windows, _, n_logs, n_hist = E.load_all()
    evs, _ = E.detect(tracks, windows)
    rows = build(tracks, evs)
    df = pd.DataFrame(rows)
    OUT.parent.mkdir(exist_ok=True)
    df.to_csv(OUT, index=False)
    days = df["day"].value_counts().sort_index() if len(df) else {}
    print(f"{len(df):,} examples from {df['icao24'].nunique() if len(df) else 0:,} aircraft "
          f"({n_logs} log files + {n_hist} imported days) -> {OUT.relative_to(HERE)}")
    for day, n in days.items():
        print(f"  {day}: {n:,} examples, {df[df.day == day].groupby(['icao24', 'callsign']).ngroups} landings")


if __name__ == "__main__":
    main()
