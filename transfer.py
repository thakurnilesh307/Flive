"""The "transfer controller": one model that works at an airport it has never seen.

    python transfer.py            -> data/models/TRANSFER_report.json (+ cached datasets)

The analogy: a controller moved from Boston to JFK brings general skills and needs
only the layout and how the airport is running right now. So the generic models get
only features measured relative to the airport and its live state:

    distance, height above the FIELD, speed, descent, heading vs the airport,
    position relative to the runway in use (read from recent landings, observable
    anywhere), traffic and landings in the last 30 min, time of day, glide path,
    closing rate, and the same for the best-fitting neighbouring airport

and none of what ties a model to one airport: compass bearing and track, runway
names (cfg_* flags), altitude above sea level.

Two tasks: landing time (train_eta.py's data) and "is it landing here?"
(arrival_model.py's data). For each airport in turn as the NEW airport:
  test set     = its last TEST_DAYS days (the same for every model)
  local expert = the per-airport model (all features) trained on its first k days
  transfer     = generic features, trained on the OTHER airports (all days) plus
                 the new airport's first k days, k = 0 is the first day on the job
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import airport_geo as G
import arrival_model as AM
import dataset as D
import events as E
import train_eta as TE

AIRPORTS = ["KBOS", "KJFK", "EGLL"]
TEST_DAYS = 10
K_LOCAL = [1, 3, 7, 10]
K_TRANSFER = [0, 1, 3, 7]
AIRPORT_SPECIFIC = {"bearing_sin", "bearing_cos", "track_sin", "track_cos", "alt_ft"}
META = {"day", "icao24", "callsign", "t", "label_s", "lands_here", "rule", "runway_in_use", "airport"}


def arrival_dataset(ap):
    path = D.MODELS / f"{ap.icao}_arrival_dataset.csv.gz"
    if path.exists():
        return pd.read_csv(path)
    tracks, windows, *_ = E.load_all(ap)
    evs, _ = E.detect(tracks, windows, ap)
    df = pd.DataFrame(AM.build(ap, tracks, evs))
    del tracks
    df.to_csv(path, index=False)
    return df


def eta_dataset(ap):
    df = pd.read_csv(D.dataset_path(ap))
    df["alt_agl_ft"] = df["alt_ft"] - ap.elev_ft
    return df


def generic_features(df):
    return [c for c in df.columns if c not in META and c not in AIRPORT_SPECIFIC and not c.startswith("cfg_")]


def local_features(df):
    return [c for c in df.columns if c not in META and not (c.startswith("cfg_") and not df[c].any())]


def split(df):
    days = sorted(df.day.unique())
    train_days, test_days = days[:-TEST_DAYS], days[-TEST_DAYS:]
    return train_days, df[df.day.isin(test_days)]


def first_days(df, train_days, k):
    return df[df.day.isin(train_days[:k])]


def fit_eval(task, train, test, feats):
    X, Xt = train[feats].astype(float), test[feats].astype(float)
    if task == "eta":
        m = TE.make_model().fit(X, train.label_s)
        err = np.abs(m.predict(Xt) - test.label_s.to_numpy())
        return {"mae_min": round(float(err.mean()) / 60, 2), "train_rows": len(train)}
    m = AM.make_model().fit(X, train.lands_here)
    pred = m.predict_proba(Xt)[:, 1] >= 0.5
    return {**AM.scores(test.lands_here.to_numpy(), pred), "train_rows": len(train)}


def run(task, data):
    out = {}
    for target in AIRPORTS:
        df = data[target]
        train_days, test = split(df)
        others = pd.concat([data[a] for a in AIRPORTS if a != target], ignore_index=True)
        gfe = [c for c in generic_features(df) if c in others.columns]
        r = {"test_days": [test.day.min(), test.day.max()], "test_rows": len(test), "local": {}, "transfer": {}}
        if task == "arrival":
            r["old_rule"] = AM.scores(test.lands_here.to_numpy(), test.rule.to_numpy().astype(bool))
        else:
            err = np.abs(test.naive_eta_s - test.label_s)
            r["straight_line_mae_min"] = round(float(err.mean()) / 60, 2)
        for k in K_LOCAL:
            if k <= len(train_days):
                tr = first_days(df, train_days, k)
                r["local"][k] = fit_eval(task, tr, test, local_features(tr))
                print(f"{task} {target} local {k}d: {r['local'][k]}", flush=True)
        for k in K_TRANSFER:
            tr = pd.concat([others, first_days(df, train_days, k)], ignore_index=True) if k else others
            r["transfer"][k] = fit_eval(task, tr, test, gfe)
            print(f"{task} {target} transfer +{k}d: {r['transfer'][k]}", flush=True)
        r["generic_features"] = gfe
        out[target] = r
    return out


def main():
    tasks = sys.argv[1:] or ["eta", "arrival"]
    report_path = D.MODELS / "TRANSFER_report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    for task in tasks:
        loader = eta_dataset if task == "eta" else arrival_dataset
        data = {}
        for a in AIRPORTS:
            data[a] = loader(G.get(a))
            print(f"{task} {a}: {len(data[a]):,} rows, {data[a].day.nunique()} days", flush=True)
        report[task] = run(task, data)
        report_path.write_text(json.dumps(report, indent=1))
    print(f"Saved {report_path}")


if __name__ == "__main__":
    main()
