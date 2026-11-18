"""Which runway will each flight use? (per-flight runway prediction at Logan)

    python train_runway.py

Two classifiers, trained on the runways events.py detected:
- arrivals:   for a plane in the air, which runway will it land on?
              (rows every 30 s over its last 30 minutes before touchdown)
- departures: for a plane taxiing, which runway will it take off from?
              (rows every 15 s over its last 15 minutes of taxiing)

Baseline to beat: "the runway Logan used most for that (landings or takeoffs) in the
last 30 minutes". Tested leave-one-day-out, like the landing-time model. Accuracy is
reported by how far ahead the prediction was made. The probability the model gives
is shown in the app ("22L, 92%"), so it's checked too: when the model says ~90%,
is it right ~90% of the time?

Writes data/runway_model.joblib and data/runway_report.json.
"""
import bisect
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

import dataset as D
import events as E

HERE = Path(__file__).resolve().parent
MIN_DAY_EVENTS = 50
ARR_STEP_S, DEP_STEP_S = 30, 15
DEP_HORIZON_S = 15 * 60
ARR_BUCKETS = [(0, 300, "0-5 min out"), (300, 600, "5-10 min"), (600, 1200, "10-20 min"), (1200, 1800, "20-30 min")]
DEP_BUCKETS = [(0, 180, "0-3 min before takeoff"), (180, 480, "3-8 min"), (480, 900, "8-15 min")]


def build_arrivals(tracks, evs, use, traffic):
    rows = []
    for ev in (e for e in evs if e["kind"] == "landing"):
        samples = tracks.get(ev["icao24"], [])
        i0 = bisect.bisect_left([x.t for x in samples], ev["time"] - D.HORIZON_S)
        next_t = -1e18
        for s in samples[i0:]:
            if s.t >= ev["time"] - 5:
                break
            if s.t < next_t or not D.usable(s):
                continue
            next_t = s.t + ARR_STEP_S
            row = {"day": datetime.fromtimestamp(ev["time"], D.BOSTON).strftime("%Y-%m-%d"),
                   "ahead_s": ev["time"] - s.t, "label": ev["runway"]}
            row.update(D.arrival_runway_features(s, s.t, traffic.count(s.t, ev["icao24"]), use))
            rows.append(row)
    return pd.DataFrame(rows)


def build_departures(tracks, evs, use):
    rows = []
    for ev in (e for e in evs if e["kind"] == "takeoff"):
        samples = tracks.get(ev["icao24"], [])
        i0 = bisect.bisect_left([x.t for x in samples], ev["time"] - DEP_HORIZON_S)
        next_t = -1e18
        for s in samples[i0:]:
            if s.t >= ev["time"]:
                break
            if s.t < next_t or not D.taxiing(s):
                continue
            next_t = s.t + DEP_STEP_S
            row = {"day": datetime.fromtimestamp(ev["time"], D.BOSTON).strftime("%Y-%m-%d"),
                   "ahead_s": ev["time"] - s.t, "label": ev["runway"]}
            row.update(D.departure_runway_features(s, s.t, use))
            rows.append(row)
    return pd.DataFrame(rows)


def make_model():
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=31,
                                          min_samples_leaf=30, random_state=0)


def baseline(df, kind):
    """Most-used runway (for this kind) in the last 30 min, from the count columns."""
    cols = [c for c in df.columns if c.startswith("land_" if kind == "landing" else "take_") and c != "take_total"]
    counts = df[cols].to_numpy()
    names = np.array([c.split("_", 1)[1] for c in cols])
    out = names[counts.argmax(axis=1)].astype(object)
    out[counts.sum(axis=1) == 0] = None
    return out


def evaluate(df, kind, buckets):
    feats = [c for c in df.columns if c not in ("day", "ahead_s", "label", "runway_in_use")]
    per_day = df.groupby("day").size()
    days = [d for d in sorted(per_day.index) if per_day[d] >= MIN_DAY_EVENTS * 10]
    prefix = "land_" if kind == "landing" else "take_"
    use_cols = [c for c in df.columns if c.startswith(prefix) and c != "take_total"]
    preds, probs, base, truth, ahead = [], [], [], [], []
    for d in days:
        tr, te = df[df.day != d], df[df.day == d]
        m = make_model().fit(tr[feats].astype(float), tr["label"])
        p = m.predict_proba(te[feats].astype(float))
        # Only choose among runways used (for this kind) in the last 30 minutes.
        active = te[use_cols].to_numpy() > 0
        names = [c.split("_", 1)[1] for c in use_cols]
        p = np.vstack([D.restrict_to_active(m.classes_, p[i], {n for n, a in zip(names, active[i]) if a})
                       for i in range(len(te))])
        preds.append(m.classes_[p.argmax(axis=1)])
        probs.append(p.max(axis=1))
        base.append(baseline(te, kind))
        truth.append(te["label"].to_numpy())
        ahead.append(te["ahead_s"].to_numpy())
    preds, probs, base, truth, ahead = map(np.concatenate, (preds, probs, base, truth, ahead))
    out = {"days_tested": len(days), "rows": int(len(truth)),
           "model_accuracy": round(float((preds == truth).mean()) * 100, 1),
           "baseline_accuracy": round(float((base == truth).mean()) * 100, 1), "by_horizon": {}, "calibration": {}}
    for lo, hi, name in buckets:
        m = (ahead >= lo) & (ahead < hi)
        if m.any():
            out["by_horizon"][name] = {"model": round(float((preds[m] == truth[m]).mean()) * 100, 1),
                                       "baseline": round(float((base[m] == truth[m]).mean()) * 100, 1)}
    for lo, hi in ((0.5, 0.7), (0.7, 0.9), (0.9, 1.01)):
        m = (probs >= lo) & (probs < hi)
        if m.any():
            out["calibration"][f"said {int(lo * 100)}-{min(int(hi * 100), 100)}%"] = {
                "right": round(float((preds[m] == truth[m]).mean()) * 100, 1), "share_of_rows": round(float(m.mean()) * 100, 1)}
    final = make_model().fit(df[feats].astype(float), df["label"])
    return out, final, feats


def show(name, r):
    print(f"\n{name}: model {r['model_accuracy']}% vs baseline {r['baseline_accuracy']}% "
          f"({r['rows']:,} rows, {r['days_tested']} unseen days)")
    for h, v in r["by_horizon"].items():
        print(f"  {h:24s} model {v['model']:5.1f}%   baseline {v['baseline']:5.1f}%")
    for k, v in r["calibration"].items():
        print(f"  when it {k:12s} it was right {v['right']:5.1f}% ({v['share_of_rows']}% of predictions)")


def main():
    tracks, windows, _, _, _ = E.load_all()
    evs, _ = E.detect(tracks, windows)
    use = D.RunwayUse(evs)
    traffic = D.TrafficIndex(tracks)
    arr = build_arrivals(tracks, evs, use, traffic)
    dep = build_departures(tracks, evs, use)
    print(f"{len(arr):,} arrival rows ({arr.label.nunique()} runways), {len(dep):,} departure rows "
          f"({dep.label.nunique()} runways)")
    print("arrival runways:", dict(Counter(arr.label).most_common()))
    print("departure runways:", dict(Counter(dep.label).most_common()))
    arr_r, arr_m, arr_f = evaluate(arr, "landing", ARR_BUCKETS)
    dep_r, dep_m, dep_f = evaluate(dep, "takeoff", DEP_BUCKETS)
    show("Arrivals (landing runway)", arr_r)
    show("Departures (takeoff runway, while taxiing)", dep_r)
    joblib.dump({"arrival": arr_m, "arrival_features": arr_f, "departure": dep_m, "departure_features": dep_f,
                 "report": {"arrivals": arr_r, "departures": dep_r}}, HERE / "data" / "runway_model.joblib")
    (HERE / "data" / "runway_report.json").write_text(json.dumps({"arrivals": arr_r, "departures": dep_r}, indent=2))
    print("\nSaved data/runway_model.joblib and data/runway_report.json")


if __name__ == "__main__":
    main()
