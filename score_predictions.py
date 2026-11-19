"""Score the landing predictions the live server logged against what really happened.

    python score_predictions.py [ICAO]        (default KBOS)

The server writes every prediction it makes into its logs (`landing_at`,
`landing_lo_at`, `landing_hi_at`, `landing_runway` on each arriving aircraft). This
script reads those logs, finds the real landings in the same logs with events.py's
detector (96-97% recall / 100% precision against OpenSky), and compares:

- landing time: error by how far out the prediction was, bias, how often the
  "likely" range held the real time, vs the straight-line guess from the same position
- landing runway: right or wrong, when a runway was predicted
- arrivals missed: real landings that never got a prediction 5+ minutes before
- false arrivals: planes predicted to land here that didn't (only counted once the
  logs run long enough past the predicted time to be sure)

These are predictions the live server made before the landing, using only what it
knew then, so unlike the training scores they include every live quirk (feed gaps,
the arrival gate, planes the model never saw). Writes data/scores/ICAO.json.
"""
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import airport_geo as G
import events as E

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "scores"
SAMPLE_S = 30            # one prediction per plane every 30 s, like the training rows
EPISODE_GAP_S = 30 * 60  # predictions this far apart = separate arrivals
MAX_AHEAD_S = 60 * 60    # a landing more than an hour after the prediction isn't "this" arrival
SURE_AFTER_S = 15 * 60   # logs must continue this long past the predicted time to call it false
BUCKETS = [(0, 5), (5, 10), (10, 20), (20, 30), (30, 60)]


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def load_predictions(paths):
    """[(icao24, t, landing_at, lo, hi, runway, straight_line_at)] from the logs, one per
    plane per SAMPLE_S, plus a sorted list of snapshot times (to know what the logs cover)."""
    preds, last, times = [], {}, []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    snap = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = _num(snap.get("fetched_at"))
                if t is None:
                    continue
                times.append(t)
                for a in snap.get("aircraft", []):
                    at, icao = _num(a.get("landing_at")), a.get("icao24")
                    if at is None or not icao or t - last.get(icao, -1e18) < SAMPLE_S:
                        continue
                    last[icao] = t
                    lat, lon, gs = _num(a.get("lat")), _num(a.get("lon")), _num(a.get("velocity_ms"))
                    preds.append({"icao24": icao, "t": t, "at": at,
                                  "lo": _num(a.get("landing_lo_at")), "hi": _num(a.get("landing_hi_at")),
                                  "runway": a.get("landing_runway"),
                                  "lat": lat, "lon": lon, "gs": gs})
    preds.sort(key=lambda p: p["t"])
    times.sort()
    return preds, times


def covered_until(times, t):
    """Logs run without a gap over 60 s from t until the returned time."""
    import bisect
    i = bisect.bisect_left(times, t)
    while i + 1 < len(times) and times[i + 1] - times[i] <= 60:
        i += 1
    return times[i] if i < len(times) else t


def episodes(preds):
    """Group each plane's predictions into arrivals (gaps over 30 min split them)."""
    by_plane = defaultdict(list)
    for p in preds:
        by_plane[p["icao24"]].append(p)
    out = []
    for ps in by_plane.values():
        cur = [ps[0]]
        for p in ps[1:]:
            if p["t"] - cur[-1]["t"] > EPISODE_GAP_S:
                out.append(cur)
                cur = []
            cur.append(p)
        out.append(cur)
    return out


def false_kind(ap, ep, track):
    """Why a predicted arrival never landed here (None = it probably did and the
    detector missed it: seen on the ground at the airport afterwards)."""
    first, last = ep[0], ep[-1]
    after = [s for s in track if last["t"] < s.t < last["t"] + MAX_AHEAD_S]
    if any(s.on_ground and ap.dist_nm(s.lat, s.lon) < 3 for s in after):
        return None
    if ap.dist_nm(first["lat"], first["lon"]) < 3 and after and ap.dist_nm(after[-1].lat, after[-1].lon) > 10:
        return "departure just after liftoff"
    if (last["gs"] or 0) * E.MS_TO_KT < 140:
        return "light/slow aircraft (<140 kt)"
    if after and ap.dist_nm(after[-1].lat, after[-1].lon) > 35:
        return "left the 40 nm coverage"
    return "other"


def summarize(rows):
    """rows: dicts with err_s (predicted - actual), line_err_s, ahead_s, in_range."""
    if not rows:
        return None
    mae = lambda xs: round(sum(abs(x) for x in xs) / len(xs) / 60, 2) if xs else None
    s = {"n": len(rows),
         "mae_min": mae([r["err_s"] for r in rows]),
         "bias_min": round(sum(r["err_s"] for r in rows) / len(rows) / 60, 2),
         "within_1min_pct": round(100 * sum(abs(r["err_s"]) <= 60 for r in rows) / len(rows), 1),
         "straight_line_mae_min": mae([r["line_err_s"] for r in rows if r["line_err_s"] is not None])}
    ranged = [r for r in rows if r["in_range"] is not None]
    s["range_held_pct"] = round(100 * sum(r["in_range"] for r in ranged) / len(ranged), 1) if ranged else None
    s["by_minutes_out"] = {}
    for lo, hi in BUCKETS:
        b = [r for r in rows if lo * 60 <= r["ahead_s"] < hi * 60]
        if b:
            s["by_minutes_out"][f"{lo}-{hi}"] = {"n": len(b), "mae_min": mae([r["err_s"] for r in b]),
                                                 "straight_line_mae_min": mae([r["line_err_s"] for r in b if r["line_err_s"] is not None])}
    return s


def score(ap):
    paths = E.log_paths(ap)
    preds, times = load_predictions(paths)
    if not preds:
        print(f"{ap.icao}: no logged predictions yet")
        return None
    tracks, _ = E.load_tracks(paths)
    landings, _ = E.detect(tracks, E.coverage(paths), ap)
    landings = [e for e in landings if e["kind"] == "landing"]
    by_plane = defaultdict(list)
    for e in landings:
        by_plane[e["icao24"]].append(e)

    rows, rwy = [], []
    flights = {"predicted": 0, "landed": 0, "false": 0, "unsure": 0}
    false_kinds, false_rows, false_examples = defaultdict(int), 0, []
    for ep in episodes(preds):
        flights["predicted"] += 1
        first, last = ep[0], ep[-1]
        land = next((e for e in by_plane.get(first["icao24"], [])
                     if first["t"] - 30 <= e["time"] <= last["t"] + MAX_AHEAD_S), None)
        if land is None:
            # Never seen landing here: false arrival if the logs kept running well past
            # the predicted time (else the plane may have landed after the logs stopped).
            kind = false_kind(ap, ep, tracks.get(first["icao24"], []))
            if kind is None or covered_until(times, last["t"]) < last["at"] + SURE_AFTER_S:
                flights["unsure"] += 1
            else:
                flights["false"] += 1
                false_kinds[kind] += 1
                false_rows += len(ep)
                false_examples.append(first["icao24"])
            continue
        flights["landed"] += 1
        for p in ep:
            ahead = land["time"] - p["t"]
            if ahead < 0:
                continue
            line = None
            if p["gs"] and p["gs"] > 20 and p["lat"] is not None:
                line = p["t"] + ap.dist_nm(p["lat"], p["lon"]) / (p["gs"] * E.MS_TO_KT) * 3600 - land["time"]
            in_range = (p["lo"] <= land["time"] <= p["hi"]) if p["lo"] is not None and p["hi"] is not None else None
            day = datetime.fromtimestamp(land["time"], ap.tz).strftime("%Y-%m-%d")
            rows.append({"err_s": p["at"] - land["time"], "line_err_s": line, "ahead_s": ahead,
                         "in_range": in_range, "day": day})
            if p["runway"] and land["runway"]:
                rwy.append({"ok": p["runway"] == land["runway"], "ahead_s": ahead, "day": day})

    # Real landings inside the predicting period that never got a prediction 5+ min before.
    # (Only landings an hour after predictions began, so each had the chance.)
    start = preds[0]["t"]
    real = [e for e in landings if e["time"] >= start + 3600]
    missed = 0
    for e in real:
        got = any(e["icao24"] == p["icao24"] and e["time"] - MAX_AHEAD_S <= p["t"] <= e["time"] - 300
                  for p in preds_for(preds, e["icao24"]))
        missed += not got

    report = {"airport": ap.icao, "name": ap.name,
              "from": datetime.fromtimestamp(start, ap.tz).isoformat(timespec="minutes"),
              "to": datetime.fromtimestamp(preds[-1]["t"], ap.tz).isoformat(timespec="minutes"),
              "landing_time": summarize(rows),
              "runway_right_pct": round(100 * sum(r["ok"] for r in rwy) / len(rwy), 1) if rwy else None,
              "runway_n": len(rwy),
              "flights": flights,
              "false_arrivals_by_kind": dict(false_kinds),
              "predictions_for_false_arrivals_pct": round(100 * false_rows / (false_rows + len(rows)), 1) if rows else None,
              "real_landings": len(real),
              "real_landings_missed_pct": round(100 * missed / len(real), 1) if real else None,
              "false_arrival_examples": false_examples[:20],
              "by_day": {}}
    for day in sorted({r["day"] for r in rows}):
        d = summarize([r for r in rows if r["day"] == day])
        rd = [r for r in rwy if r["day"] == day]
        d["runway_right_pct"] = round(100 * sum(r["ok"] for r in rd) / len(rd), 1) if rd else None
        report["by_day"][day] = d
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{ap.icao}.json").write_text(json.dumps(report, indent=2))
    return report


_pred_index = {}


def preds_for(preds, icao):
    if not _pred_index:
        for p in preds:
            _pred_index.setdefault(p["icao24"], []).append(p)
    return _pred_index.get(icao, [])


def show(r):
    lt = r["landing_time"]
    print(f"{r['airport']} ({r['name']}): logged predictions {r['from']} .. {r['to']}")
    if lt:
        print(f"  landing time: {lt['mae_min']} min off on average (straight line {lt['straight_line_mae_min']}), "
              f"bias {lt['bias_min']:+} min, {lt['within_1min_pct']}% within 1 min, "
              f"likely range held {lt['range_held_pct']}% (n={lt['n']})")
        for k, v in lt["by_minutes_out"].items():
            print(f"    {k:>6} min out: {v['mae_min']} min (straight line {v['straight_line_mae_min']}, n={v['n']})")
    print(f"  landing runway right: {r['runway_right_pct']}% (n={r['runway_n']})")
    f = r["flights"]
    print(f"  arrivals predicted: {f['predicted']} -> landed {f['landed']}, false {f['false']}, "
          f"unsure (logs stopped) {f['unsure']}")
    print(f"  false arrivals by kind: {r['false_arrivals_by_kind']}; "
          f"{r['predictions_for_false_arrivals_pct']}% of all predictions were for them")
    print(f"  real landings: {r['real_landings']}, missed (no prediction 5+ min before): {r['real_landings_missed_pct']}%")
    if r["false_arrival_examples"]:
        print(f"  false arrival icao24s: {', '.join(r['false_arrival_examples'][:10])}")
    for day, d in r["by_day"].items():
        print(f"  {day}: {d['mae_min']} min (straight line {d['straight_line_mae_min']}), runway {d['runway_right_pct']}%, n={d['n']}")


if __name__ == "__main__":
    ap = G.get(sys.argv[1] if len(sys.argv) > 1 else "KBOS")
    r = score(ap)
    if r:
        show(r)
