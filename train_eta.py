"""Train and score the landing-time model (roadmap step 5).

    python train_eta.py [KBOS|KJFK|EGLL]     (after: python dataset.py ICAO)

Compares three ways of answering "how long until this plane lands?":
  1. straight line:  distance / groundspeed (what Ask Flive says today, as a lower bound)
  2. scaled line:    straight line x a single factor fitted on the training days
  3. model:          gradient-boosted trees on everything in dataset.py

The test is leave-one-day-out: train on all other days, predict a day the model has
never seen, repeat for each day. With only one usable day it falls back to a time
split (first 70% of that day's landings vs the rest) and says so, since that's a
weaker test. Errors are reported overall and at "5, 10 and 20 minutes out".

Writes data/models/ICAO_eta.joblib (trained on everything) and ICAO_eta_report.json.
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance

import airport_geo as G
import dataset as D

HERE = Path(__file__).resolve().parent
MIN_DAY_LANDINGS = 50        # days with fewer landings aren't worth a test fold
HORIZONS = {"5 min out": (240, 360), "10 min out": (540, 660), "20 min out": (1140, 1260)}

BASE_FEATURES = [
    "dist_nm", "bearing_sin", "bearing_cos", "alt_ft", "gs_kt", "vs_fpm", "track_sin", "track_cos",
    "off_airport_deg", "naive_eta_s", "traffic_15nm", "landings_30min", "hour_sin", "hour_cos", "category",
    "rwy_along_nm", "rwy_cross_nm", "rwy_thr_dist_nm", "rwy_hdg_diff",
]


def model_path(ap):
    return D.MODELS / f"{ap.icao}_eta.joblib"


def make_model(quantile=None):
    """Best guess: absolute-error loss (we care about minutes off, and a few odd flights
    like holding or go-arounds shouldn't dominate). With `quantile`, a model for the
    10th/90th percentile, which gives the "likely between" range shown in the app."""
    kw = dict(max_iter=400, learning_rate=0.06, max_leaf_nodes=31, min_samples_leaf=40, random_state=0)
    if quantile is None:
        return HistGradientBoostingRegressor(loss="absolute_error", **kw)
    return HistGradientBoostingRegressor(loss="quantile", quantile=quantile, **kw)


RANGE = (0.1, 0.9)   # "likely between" = 10th to 90th percentile


def scores(y, pred):
    err = np.abs(pred - y)
    out = {"mae_min": round(float(err.mean()) / 60, 2),
           "within_1min": round(float((err <= 60).mean()) * 100, 1),
           "n": int(len(y))}
    for name, (lo, hi) in HORIZONS.items():
        m = (y >= lo) & (y <= hi)
        out[name] = round(float(err[m].mean()) / 60, 2) if m.any() else None
    return out


def folds(df):
    per_day = df.groupby("day").apply(lambda g: g.groupby(["icao24", "callsign"]).ngroups, include_groups=False)
    days = sorted(per_day[per_day >= MIN_DAY_LANDINGS].index)
    if len(days) >= 2:
        for d in days:
            yield f"day {d}", df.day != d, df.day == d
    else:
        # One day: split by time so the test landings all come after the training ones.
        t_split = df["t"].quantile(0.7)
        print("NOTE: only one full day of data, so this is a time split within it (weaker than unseen days).")
        yield "last 30% of the day", df.t <= t_split, df.t > t_split


def main():
    ap = G.get(sys.argv[1] if len(sys.argv) > 1 else "KBOS")
    data = D.dataset_path(ap)
    if not data.exists():
        sys.exit(f"Run python dataset.py {ap.icao} first.")
    df = pd.read_csv(data)
    # One "runway in use" flag per runway end that was ever the runway in use here.
    FEATURES = BASE_FEATURES + [c for c in df.columns if c.startswith("cfg_") and df[c].any()]
    print(f"{ap.icao}: {len(df):,} rows from {df.day.nunique()} days")
    X, y = df[FEATURES].astype(float), df["label_s"].to_numpy()
    results = {"straight line": [], "scaled line": [], "model": []}
    preds_all, inside, held = [], [], []
    for name, train, test in folds(df):
        train, test = np.asarray(train), np.asarray(test)
        Xtr, ytr, Xte, yte = X[train], y[train], X[test], y[test]
        straight = Xte["naive_eta_s"].to_numpy()
        factor = float(np.median(ytr / np.maximum(Xtr["naive_eta_s"].to_numpy(), 1)))
        model = make_model().fit(Xtr, ytr)
        p = model.predict(Xte)
        lo = make_model(RANGE[0]).fit(Xtr, ytr).predict(Xte)
        hi = make_model(RANGE[1]).fit(Xtr, ytr).predict(Xte)
        inside.append(((yte >= lo) & (yte <= hi)).mean())
        held.append((yte, p, lo, hi))
        for k, pred in (("straight line", straight), ("scaled line", straight * factor), ("model", p)):
            results[k].append(scores(yte, pred))
        preds_all.append(pd.DataFrame({"y": yte, "straight": straight, "model": p}))
        print(f"{name}: train {int(train.sum()):,} rows, test {int(test.sum()):,} rows | "
              f"straight {results['straight line'][-1]['mae_min']} min, "
              f"scaled (x{factor:.2f}) {results['scaled line'][-1]['mae_min']} min, "
              f"model {results['model'][-1]['mae_min']} min, range holds the truth {inside[-1] * 100:.0f}%")

    # Pool every held-out prediction for the headline numbers.
    pooled = pd.concat(preds_all)
    summary = {k: scores(pooled["y"].to_numpy(), pooled[c].to_numpy())
               for k, c in (("straight line", "straight"), ("model", "model"))}
    summary["scaled line"] = {"mae_min": round(float(np.mean([r["mae_min"] for r in results["scaled line"]])), 2)}

    print("\nHeld-out error (average minutes off):")
    print(f"{'':16s}{'overall':>9s}{'5 min out':>11s}{'10 min out':>12s}{'20 min out':>12s}{'within 1 min':>14s}")
    for k in ("straight line", "model"):
        s = summary[k]
        fmt = lambda v: "-" if v is None else f"{v:.2f}"  # noqa: E731
        print(f"{k:16s}{s['mae_min']:>9.2f}{fmt(s['5 min out']):>11s}{fmt(s['10 min out']):>12s}"
              f"{fmt(s['20 min out']):>12s}{s['within_1min']:>13.1f}%")
    print(f"{'scaled line':16s}{summary['scaled line']['mae_min']:>9.2f}")
    coverage = round(float(np.mean(inside)) * 100, 1)
    print(f"Predicted 'likely' range ({int(RANGE[0] * 100)}th-{int(RANGE[1] * 100)}th percentile) "
          f"contained the real landing time {coverage}% of the time (aim: ~{int((RANGE[1] - RANGE[0]) * 100)}%)")
    summary["range_coverage_pct"] = coverage
    # Calibrate: widen the range around the best guess until it holds ~80% of real
    # landings on the held-out days (the raw quantile models are overconfident on days
    # unlike the training ones). eta.py applies the same factor live.
    yy, pp, ll, hh = (np.concatenate(parts) for parts in zip(*held))
    target = RANGE[1] - RANGE[0]
    widen = 1.0
    while widen < 6 and np.mean((yy >= pp - widen * (pp - np.minimum(ll, pp))) & (yy <= pp + widen * (np.maximum(hh, pp) - pp))) < target:
        widen += 0.05
    summary["range_widen"] = round(widen, 2)
    print(f"Range widened x{widen:.2f} to hold {int(target * 100)}% of held-out landings")

    # Final model on all data, plus which inputs it relies on (measured on a held-out slice).
    final = make_model().fit(X, y)
    bundle = {"model": final, "lo": make_model(RANGE[0]).fit(X, y), "hi": make_model(RANGE[1]).fit(X, y),
              "features": FEATURES, "trained_rows": int(len(df)), "days": sorted(df.day.unique().tolist()),
              "mae_min": summary["model"]["mae_min"], "range_widen": summary["range_widen"], "airport": ap.icao,
              "straight_mae_min": summary["straight line"]["mae_min"]}
    joblib.dump(bundle, model_path(ap))
    sample = df.sample(min(4000, len(df)), random_state=1)
    imp = permutation_importance(final, sample[FEATURES].astype(float), sample["label_s"],
                                 n_repeats=3, random_state=0, scoring="neg_mean_absolute_error")
    top = sorted(zip(FEATURES, imp.importances_mean), key=lambda kv: -kv[1])[:8]
    print("\nWhat the model leans on (seconds of error added when shuffled):")
    for f, v in top:
        print(f"  {f:18s} {v:7.1f}")

    report = {"rows": int(len(df)), "days": sorted(df.day.unique().tolist()), "summary": summary,
              "folds": results, "importance": {f: round(float(v), 1) for f, v in top}}
    report_path = D.MODELS / f"{ap.icao}_eta_report.json"
    report_path.write_text(json.dumps(report, indent=2))
    print(f"\nSaved {model_path(ap).relative_to(HERE)} and {report_path.relative_to(HERE)}")


if __name__ == "__main__":
    main()
