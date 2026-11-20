"""Replay real arrivals through a simple runway scheduler and compare with reality.

    python scheduler.py [ICAO ...]     (after time_lost.py) -> data/scheduler/ICAO.json + ICAO_hours.csv

Step 2 and 3 of the scheduler story (first come, first served, then an optimizer
that may move each plane up to k places: see cps_sequence). Every arrival from time_lost.py has the moment it
crossed 40 nm and an *unimpeded* time to touchdown (what comparable flights take
with nobody in the way), so its earliest possible landing = crossing + unimpeded.

First come, first served (FCFS): on each runway it really used, planes land in the
order of their earliest possible landing, each as soon as it can, but no sooner than
the spacing behind the plane in front. Delay = scheduled landing - earliest possible.

Spacing is what each real runway DELIVERS under pressure, per (runway, leader size,
follower size): the median gap behind a landing when the follower was already queued
(real delay > QUEUED_MIN). It's measured, not assumed, and it already contains the
room left for departures on mixed runways and the controllers' normal margin. (A
first version used the tightest gaps ever flown plus real departures pinned at their
times; on Logan's mixed runway 04R that starved arrivals into a 100-minute queue,
and everywhere else it made FCFS look impossibly good.)

What the replay leaves out (it's a baseline, not a claim that FCFS is better):
runways are fixed to the ones really used; dependent runways (crossing or close
parallels) are treated as independent; any delay can be absorbed (holding, speed
control).

Reality's number is the same quantity: real touchdown - earliest possible, floored
at 0. Part of it is not sequencing at all (a longer route, a slower plane), so the
summary also gives real delay in quiet hours as a floor.
"""
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

import airport_geo as G
import events as E

HERE = Path(__file__).resolve().parent
IN = HERE / "data" / "time_lost"
OUT = HERE / "data" / "scheduler"
SEP_MAX_GAP_S = 240          # gaps longer than this aren't spacing-limited
QUEUED_MIN = 2.0             # follower this late = it was waiting, so the gap is the runway's pace
SEP_MIN_PAIRS = 20
SEP_DEFAULT = {("heavy", "heavy"): 105, ("heavy", "medium"): 150, ("heavy", "light"): 170,
               ("medium", "light"): 110, ("light", "light"): 90}
SEP_FALLBACK = 95
SIZES = ("heavy", "medium", "light")
QUIET_LANDINGS_HOUR = 10
SHIFTS = (1, 2, 3)           # max places a plane may move from first-come order


def spacing(arr):
    """Gap (s) a real runway delivers behind a landing when the next plane is queued:
    {(runway, leader size, follower size): s}, falling back to the airport-wide pair,
    then to SEP_DEFAULT."""
    per_rw, per_ap = defaultdict(list), defaultdict(list)
    for rw, g in arr.sort_values("touchdown").groupby("runway"):
        t, s, d = g.touchdown.to_numpy(), g["size"].to_numpy(), g.real_delay_min.to_numpy()
        for i in range(1, len(t)):
            if t[i] - t[i - 1] < SEP_MAX_GAP_S and d[i] > QUEUED_MIN:
                per_rw[(rw, s[i - 1], s[i])].append(t[i] - t[i - 1])
                per_ap[(s[i - 1], s[i])].append(t[i] - t[i - 1])
    ap_sep = {p: (float(np.median(per_ap[p])) if len(per_ap[p]) >= SEP_MIN_PAIRS
                  else SEP_DEFAULT.get(p, SEP_FALLBACK)) for p in ((a, b) for a in SIZES for b in SIZES)}
    sep = {}
    for rw in arr.runway.unique():
        for p in ap_sep:
            v = per_rw.get((rw, *p), [])
            sep[(rw, *p)] = float(np.median(v)) if len(v) >= SEP_MIN_PAIRS else ap_sep[p]
    return sep, ap_sep


def fcfs(arr, sep):
    """Scheduled landing time per arrival (aligned with arr.index)."""
    out = pd.Series(np.nan, index=arr.index)
    for rw, g in arr.groupby("runway"):
        prev_t, prev_size = -1e18, None
        for idx, r in g.sort_values("earliest").iterrows():
            t = r.earliest
            if prev_size is not None:
                t = max(t, prev_t + sep[(rw, prev_size, r["size"])])
            out[idx] = t
            prev_t, prev_size = t, r["size"]
    return out


def _land(prev_t, prev_size, e, size, sep_rw):
    return e if prev_size is None else max(e, prev_t + sep_rw[(prev_size, size)])


def cps_sequence(earliest, sizes, sep_rw, k):
    """Optimal landing times for one busy period under Constrained Position Shifting:
    planes are in first-come order (by earliest) and each may move at most k places
    from it. Minimises total delay. Exact dynamic programme over positions: state =
    (which planes within k of the current position are used, last plane), keeping
    every (total delay, last landing time) pair that isn't beaten on both."""
    n = len(earliest)
    if k == 0 or n == 1:
        out, pt, ps = [], None, None
        for e, sz in zip(earliest, sizes):
            pt = _land(pt, ps, e, sz, sep_rw)
            ps = sz
            out.append(pt)
        return out
    # state: (frozenset used indices >= m-k, last index) -> list of (delay, time, back-pointer)
    states = {(frozenset(), -1): [(0.0, None, None)]}
    history = []
    for m in range(n):
        nxt = {}
        lo, hi = max(0, m - k), min(n - 1, m + k)
        for (used, last), front in states.items():
            must = m - k if m - k >= 0 and (m - k) not in used else None
            choices = [must] if must is not None else [j for j in range(lo, hi + 1) if j not in used]
            for j in choices:
                nu = frozenset(x for x in used | {j} if x >= m + 1 - k)
                key = (nu, j)
                for fi, (d, t, _) in enumerate(front):
                    tj = _land(t, sizes[last] if last >= 0 else None, earliest[j], sizes[j], sep_rw)
                    cand = (d + tj - earliest[j], tj, ((used, last), fi, j))
                    lst = nxt.setdefault(key, [])
                    if any(c[0] <= cand[0] + 1e-9 and c[1] <= cand[1] + 1e-9 for c in lst):
                        continue
                    lst[:] = [c for c in lst if not (cand[0] <= c[0] + 1e-9 and cand[1] <= c[1] + 1e-9)]
                    lst.append(cand)
        history.append(nxt)
        states = nxt
    # best final state, then walk back
    key, fi = min(((k_, i) for k_, f in states.items() for i in range(len(f))),
                  key=lambda x: states[x[0]][x[1]][0])
    out = [None] * n
    for m in range(n - 1, -1, -1):
        d, t, (pkey, pfi, j) = history[m][key][fi]
        out[j] = t
        key, fi = pkey, pfi
    return out


def optimise(arr, sep, k):
    """CPS-k landing times per arrival. Each runway's stream is split where the
    first-come queue empties (the runway sits idle), and each busy period is solved
    exactly on its own."""
    out = pd.Series(np.nan, index=arr.index)
    for rw, g in arr.groupby("runway"):
        g = g.sort_values("earliest")
        sep_rw = {(a, b): sep[(rw, a, b)] for a in SIZES for b in SIZES}
        idx, e, sz, f = list(g.index), g.earliest.to_list(), g["size"].to_list(), g.fcfs_landing.to_list()
        start = 0
        for i in range(1, len(idx) + 1):
            if i == len(idx) or e[i] >= f[i - 1] + sep_rw[(sz[i - 1], sz[i])]:   # queue empty before i
                times = cps_sequence(e[start:i], sz[start:i], sep_rw, k)
                out[idx[start:i]] = times
                start = i
    return out


UNIMPEDED_PCT = 20
UNIMPEDED_MIN_GROUP = 20
IN_USE_WINDOW_S = 20 * 60    # a runway counts as "in use for arrivals" with real landings this close
IN_USE_MIN_LANDINGS = 2
SIZE_MIN_LANDINGS = 20       # a size class may only go to runways it really used this often
MAX_DEP_PER_ARR = 0.5        # ...and only to runways mainly landing at the time (departures <= half arrivals)


def takeoffs(ap):
    """Real takeoff times per runway (cached; detection over all history takes a minute)."""
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{ap.icao}_takeoffs.csv"
    if not path.exists():
        tracks, windows, *_ = E.load_all(ap)
        evs, _ = E.detect(tracks, windows, ap)
        pd.DataFrame([e for e in evs if e["kind"] == "takeoff"])[["icao24", "time", "runway"]].to_csv(path, index=False)
    dep = pd.read_csv(path)
    return {rw: np.sort(g.time.to_numpy()) for rw, g in dep.groupby("runway")}


def unimpeded_lookup(arr):
    """(sector, runway, size) -> unimpeded transit (min), with the same fallbacks as time_lost."""
    levels = [("sector", "runway", "size"), ("sector", "runway"), ("runway",)]
    tables = [arr.groupby(list(cols)).transit_min.agg(["size", lambda v: np.percentile(v, UNIMPEDED_PCT)])
              for cols in levels]

    def get(sector, runway, size):
        keys = [(sector, runway, size), (sector, runway), runway]
        for i, (t, key) in enumerate(zip(tables, keys)):
            if key in t.index and (t.loc[key, "size"] >= UNIMPEDED_MIN_GROUP or i == len(tables) - 1):
                return float(t.loc[key].iloc[1])
        return None
    return get


def with_runway_choice(arr, sep, deps):
    """Copy of arr where each plane may switch to another runway that was really in use
    mainly for arrivals at the time (`deps`: real takeoff times per runway) and that its
    size class really uses; the earliest landing
    changes with the runway (different approach path). Greedy: planes in order of their
    earliest possible landing, each to the runway where it can land first."""
    get = unimpeded_lookup(arr)
    landed = {rw: np.sort(g.touchdown.to_numpy()) for rw, g in arr.groupby("runway")}
    sizes_ok = arr.groupby(["runway", "size"]).size()
    cand_rows = []
    for idx, r in arr.iterrows():
        options = {r.runway: r.earliest}
        for rw, t in landed.items():
            if rw == r.runway or sizes_ok.get((rw, r["size"]), 0) < SIZE_MIN_LANDINGS:
                continue
            lo, hi = r.earliest - IN_USE_WINDOW_S, r.earliest + IN_USE_WINDOW_S
            n = np.searchsorted(t, hi) - np.searchsorted(t, lo)
            d = deps.get(rw, np.array([]))
            n_dep = np.searchsorted(d, hi) - np.searchsorted(d, lo)
            if n >= IN_USE_MIN_LANDINGS and n_dep <= MAX_DEP_PER_ARR * n:
                u = get(r.sector, rw, r["size"])
                if u is not None:
                    options[rw] = r.crossing + u * 60
        cand_rows.append((min(options.values()), idx, options))
    last = {}   # runway -> (time, size)
    new_rw, new_e = {}, {}
    for _, idx, options in sorted(cand_rows, key=lambda x: x[0]):
        size = arr.at[idx, "size"]
        best = None
        for rw, e in options.items():
            t = _land(*(last.get(rw, (None, None))), e, size, {(a, b): sep[(rw, a, b)] for a in SIZES for b in SIZES})
            if best is None or t < best[0] - 1e-9:
                best = (t, rw, e)
        last[best[1]] = (best[0], size)
        new_rw[idx], new_e[idx] = best[1], best[2]
    out = arr.copy()
    out["runway"] = pd.Series(new_rw)
    out["earliest"] = pd.Series(new_e)
    out["fcfs_landing"] = fcfs(out, sep)
    return out


def run(icao):
    ap = G.get(icao)
    arr = pd.read_csv(IN / f"{icao}.csv")
    arr["crossing"] = arr.touchdown - arr.transit_min * 60
    arr["earliest"] = arr.crossing + arr.unimpeded_min * 60
    arr["real_delay_min"] = ((arr.touchdown - arr.earliest) / 60).clip(lower=0)
    sep, ap_sep = spacing(arr)
    arr["fcfs_landing"] = fcfs(arr, sep)
    arr["fcfs_delay_min"] = (arr.fcfs_landing - arr.earliest) / 60
    for k in SHIFTS:
        arr[f"cps{k}_delay_min"] = (optimise(arr, sep, k) - arr.earliest) / 60
    # Runway choice: delay still measured against the earliest landing on the REAL
    # runway, so a longer approach to another runway counts against it.
    alt = with_runway_choice(arr, sep, takeoffs(ap))
    arr["rwy_fcfs_delay_min"] = (alt.fcfs_landing - arr.earliest) / 60
    arr["rwy_cps3_delay_min"] = (optimise(alt, sep, 3) - arr.earliest) / 60
    switched = float((alt.runway != arr.runway).mean() * 100)
    arr["hour"] = [datetime.fromtimestamp(t, ap.tz).strftime("%Y-%m-%d %H:00") for t in arr.earliest]

    hours = arr.groupby("hour").agg(landings=("icao24", "size"), real_min=("real_delay_min", "mean"),
                                    fcfs_min=("fcfs_delay_min", "mean"),
                                    **{f"cps{k}_min": (f"cps{k}_delay_min", "mean") for k in SHIFTS}).reset_index()
    OUT.mkdir(parents=True, exist_ok=True)
    hours.round(2).to_csv(OUT / f"{icao}_hours.csv", index=False)

    def stats(d):
        return {"flights": int(len(d)), "real_mean_min": round(float(d.real_delay_min.mean()), 2),
                "fcfs_mean_min": round(float(d.fcfs_delay_min.mean()), 2),
                "real_over_5_pct": round(float((d.real_delay_min > 5).mean() * 100), 1),
                "fcfs_over_5_pct": round(float((d.fcfs_delay_min > 5).mean() * 100), 1),
                **{f"cps{k}_mean_min": round(float(d[f"cps{k}_delay_min"].mean()), 2) for k in SHIFTS},
                "runway_choice_fcfs_mean_min": round(float(d.rwy_fcfs_delay_min.mean()), 2),
                "runway_choice_cps3_mean_min": round(float(d.rwy_cps3_delay_min.mean()), 2)}

    busy = hours.landings.clip(upper=49) // 10 * 10
    by_busy = {}
    for b in sorted(busy.unique()):
        hs = set(hours.hour[busy == b])
        d = arr[arr.hour.isin(hs)]
        if len(d) >= 20:
            by_busy[f"{int(b)}-{int(b) + 9}" if b < 40 else "40+"] = {**stats(d), "hours": len(hs)}
    quiet = arr[arr.hour.isin(set(hours.hour[hours.landings < QUIET_LANDINGS_HOUR]))]
    busy_h = hours[hours.landings >= 30]
    report = {
        "airport": icao, "flights": int(len(arr)), "days": [arr.hour.min()[:10], arr.hour.max()[:10]],
        "spacing_s": {f"{a}->{b}": round(v) for (a, b), v in ap_sep.items()},
        "overall": stats(arr),
        "real_quiet_hours_floor_min": round(float(quiet.real_delay_min.mean()), 2) if len(quiet) else None,
        "by_landings_per_hour": by_busy,
        "busy_hours": int(len(busy_h)),
        "busy_hours_real_beats_fcfs_pct": round(float((busy_h.real_min < busy_h.fcfs_min).mean() * 100), 1)
        if len(busy_h) else None,
        "fcfs_max_delay_min": round(float(arr.fcfs_delay_min.max()), 1),
        "runway_choice_switched_pct": round(switched, 1),
    }
    (OUT / f"{icao}.json").write_text(json.dumps(report, indent=1))
    o = report["overall"]
    print(f"{icao}: {len(arr):,} arrivals; spacing under pressure {report['spacing_s']}")
    print(f"  mean delay: real {o['real_mean_min']} min (quiet-hour floor {report['real_quiet_hours_floor_min']}) "
          f"vs FCFS {o['fcfs_mean_min']}; over 5 min: real {o['real_over_5_pct']}% vs FCFS {o['fcfs_over_5_pct']}%; "
          f"FCFS worst {report['fcfs_max_delay_min']} min")
    for k, v in by_busy.items():
        print(f"  {k} landings/h ({v['hours']} h): real {v['real_mean_min']} vs FCFS {v['fcfs_mean_min']} vs "
              + " ".join(f"CPS{s} {v[f'cps{s}_mean_min']}" for s in SHIFTS)
              + f" | runway choice: FCFS {v['runway_choice_fcfs_mean_min']} CPS3 {v['runway_choice_cps3_mean_min']}")
    print(f"  runway choice moved {report['runway_choice_switched_pct']}% of arrivals to another runway")
    print(f"  busy hours (30+ landings): real beats FCFS in {report['busy_hours_real_beats_fcfs_pct']}% of {len(busy_h)}")


if __name__ == "__main__":
    for icao in sys.argv[1:] or ["KBOS", "KJFK", "EGLL"]:
        run(icao)
