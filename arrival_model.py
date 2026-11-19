"""Is this plane landing HERE? A per-airport classifier that decides which planes get
a landing-time prediction.

    python arrival_model.py [ICAO]      (default KBOS) -> data/models/ICAO_arrival.joblib

Why: scoring the live predictions (score_predictions.py) showed the landing-time
model is accurate for planes that really land, but 26-59% of predictions went to
planes that never landed here, mostly ones heading for a neighbour (Newark,
Teterboro, Gatwick, Bedford...) or light aircraft passing by. The hand-written rule
(eta.is_arrival + eta.landing_elsewhere) can only see one position. The landing-time
model can't fix it either: it was trained only on planes that did land.

Training rows: EVERY plane within 40 nm and below 18,000 ft above the field, one row
per minute (airborne, not climbing, not just off the ground, not a helicopter: the
same `candidate()` gate live), labelled 1 if it landed here within the next hour.
Features (`features()`, shared with live): the landing-time model's features, glide
path and runway alignment here, whether it's actually closing on the airport over
the last ~2 minutes, the same for the best-fitting neighbouring airport, and whether
the callsign looks like an airline flight. Tested leave-days-out (5 folds by day)
against the hand-written rule on the same rows; the threshold is set so the model
finds at least as many real arrivals as the rule did.
"""
import bisect
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime

import airport_geo as G
import dataset as D
import events as E
import global_model as GM
import traffic

MAX_AGL_FT = 18000
STEP_S = 60
LABEL_WITHIN_S = 60 * 60
PAST_S = 120                     # look back this far for the closing rate
NEIGHBOUR_NM = 30
AIRLINE = re.compile(r"^[A-Z]{3}\d")
RECENT_GROUND_S = 300


def model_path(ap):
    return D.MODELS / f"{ap.icao}_arrival.joblib"


def candidate(ap, s, recently_on_ground):
    """Planes the classifier is asked about (training and live)."""
    return (D.usable(ap, s) and not recently_on_ground and s.category != 8
            and not (s.vs_fpm is not None and s.vs_fpm > 300)
            and s.alt_ft - ap.elev_ft < MAX_AGL_FT)


def _past(samples, t):
    """The sample nearest PAST_S before t (60-240 s back), or None."""
    best = None
    for x in samples:
        dt = t - x.t
        if 60 <= dt <= 240 and (best is None or abs(dt - PAST_S) < abs(t - best.t - PAST_S)):
            best = x
    return best


def _closing(ap, s, past):
    """Knots of distance lost toward `ap` since `past` (negative = moving away)."""
    if past is None or s.t <= past.t:
        return None
    return (ap.dist_nm(past.lat, past.lon) - ap.dist_nm(s.lat, s.lon)) / (s.t - past.t) * 3600


def _fit(ap, s):
    """How well the plane fits a normal approach to `ap` (lower = better): the same
    score global_model.guess_destination uses."""
    d = ap.dist_nm(s.lat, s.lon)
    if GM.lined_up(ap, s):
        return -10 + d / 100
    brg = ap.bearing(s.lat, s.lon)
    off = G.angle_diff(s.track, (brg + 180) % 360) if s.track is not None else 90
    return off / 45 + abs((s.alt_ft - ap.elev_ft) - 320 * d) / 3000 + d / 40


_index = None


def neighbours(ap, s):
    global _index
    if _index is None:
        _index = GM.AirportIndex(G.world_airports())
    return [x for x in _index.near(s.lat, s.lon, NEIGHBOUR_NM) if x.icao != ap.icao]


def features(ap, s, past, t, traffic_15nm, runway_in_use, landings_30min):
    row = D.feature_row(ap, s, t, traffic_15nm, runway_in_use, landings_30min)
    row.pop("runway_in_use")
    g = GM.features(ap, s, traffic_15nm)
    d = row["dist_nm"]
    here_fit = _fit(ap, s)
    row.update({
        "alt_agl_ft": g["alt_agl_ft"],
        "glide_err_ft": round(g["alt_agl_ft"] - 320 * d),
        "lined_up": int(bool(GM.lined_up(ap, s))),
        "al_along_nm": g["al_along_nm"], "al_cross_nm": g["al_cross_nm"],
        "al_hdg_diff": g["al_hdg_diff"], "min_thr_dist_nm": g["min_thr_dist_nm"],
        "closing_kt": _round(_closing(ap, s, past)),
        "turn_deg": None if past is None or past.track is None or s.track is None
        else round(G.angle_diff(s.track, past.track), 1),
        "airline_callsign": int(bool(AIRLINE.match(s.callsign or ""))),
        "no_callsign": int(not s.callsign),
        "here_fit": round(here_fit, 3),
        "n_neighbours": 0,
        "nb_dist_nm": None, "nb_off_deg": None, "nb_glide_err_ft": None, "nb_lined_up": None,
        "nb_closing_kt": None, "nb_fit": None, "fit_margin": None,
    })
    nbs = neighbours(ap, s)
    row["n_neighbours"] = len(nbs)
    if nbs:
        fits = [(_fit(x, s), x) for x in nbs]
        f, x = min(fits, key=lambda p: p[0])
        xd = x.dist_nm(s.lat, s.lon)
        brg = x.bearing(s.lat, s.lon)
        row.update({
            "nb_dist_nm": round(xd, 3),
            "nb_off_deg": None if s.track is None else round(G.angle_diff(s.track, (brg + 180) % 360), 1),
            "nb_glide_err_ft": round((s.alt_ft - x.elev_ft) - 320 * xd),
            "nb_lined_up": int(bool(GM.lined_up(x, s))),
            "nb_closing_kt": _round(_closing(x, s, past)),
            "nb_fit": round(f, 3),
            "fit_margin": round(f - here_fit, 3),   # > 0: fits here better than any neighbour
        })
    return row


def _round(v, n=1):
    return None if v is None else round(v, n)


def rule(ap, s, recently_on_ground):
    """The hand-written check this replaces (eta.is_arrival + not eta.landing_elsewhere)."""
    import eta
    d = ap.dist_nm(s.lat, s.lon)
    a = {"on_ground": s.on_ground, "track_deg": s.track, "lat": s.lat, "lon": s.lon}
    status = traffic.classify(a, d, s.alt_ft, s.gs_kt, s.vs_fpm, ref=(ap.lat, ap.lon))
    return eta.is_arrival(ap, s, status, recently_on_ground) and not eta.landing_elsewhere(ap, s)


def build(ap, tracks, events_list):
    landings = defaultdict(list)
    for e in events_list:
        if e["kind"] == "landing":
            landings[e["icao24"]].append(e["time"])
    for v in landings.values():
        v.sort()
    traffic_idx = D.TrafficIndex(ap, tracks)
    runways = D.RunwayHistory(sorted((e for e in events_list if e["kind"] == "landing"), key=lambda e: e["time"]))
    rows = []
    for icao, samples in tracks.items():
        lands = landings.get(icao, [])
        last_ground, next_t = -1e18, -1e18
        times = [x.t for x in samples]
        for i, s in enumerate(samples):
            if s.on_ground:
                last_ground = s.t
                continue
            if s.t < next_t:
                continue
            recent = s.t - last_ground < RECENT_GROUND_S
            if not candidate(ap, s, recent):
                continue
            next_t = s.t + STEP_S
            j = bisect.bisect_left(lands, s.t)
            ahead = lands[j] - s.t if j < len(lands) else None
            lo = bisect.bisect_left(times, s.t - 240)
            past = _past(samples[lo:i], s.t)
            cfg, n = runways.in_use(s.t)
            row = {"day": datetime.fromtimestamp(s.t, ap.tz).strftime("%Y-%m-%d"), "icao24": icao,
                   "t": round(s.t, 1), "lands_here": int(ahead is not None and ahead <= LABEL_WITHIN_S),
                   "rule": int(rule(ap, s, recent))}
            row.update(features(ap, s, past, s.t, traffic_idx.count(s.t, icao), cfg, n))
            rows.append(row)
    return rows


def make_model():
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=63,
                                          min_samples_leaf=50, random_state=0)


def scores(y, pred):
    tp = int((pred & (y == 1)).sum())
    fp = int((pred & (y == 0)).sum())
    fn = int((~pred & (y == 1)).sum())
    return {"precision_pct": round(100 * tp / max(tp + fp, 1), 1),
            "recall_pct": round(100 * tp / max(tp + fn, 1), 1),
            "false_per_true": round(fp / max(tp, 1), 2)}


def main():
    import joblib
    import numpy as np
    import pandas as pd
    from sklearn.model_selection import GroupKFold

    ap = G.get(sys.argv[1] if len(sys.argv) > 1 else "KBOS")
    tracks, windows, _, n_logs, n_hist = E.load_all(ap)
    evs, _ = E.detect(tracks, windows, ap)
    df = pd.DataFrame(build(ap, tracks, evs))
    del tracks
    days = sorted(df.day.unique())
    print(f"{ap.icao}: {len(df):,} rows from {len(days)} days, {df.lands_here.mean() * 100:.1f}% land here within an hour")
    drop = {"day", "icao24", "t", "lands_here", "rule"}
    feats = [c for c in df.columns if c not in drop and not (c.startswith("cfg_") and df[c].max() == 0)]
    X, y = df[feats].astype(float), df.lands_here.to_numpy()
    oof = np.zeros(len(df))
    for tr, te in GroupKFold(n_splits=min(5, len(days))).split(X, y, df.day):
        oof[te] = make_model().fit(X.iloc[tr], y[tr]).predict_proba(X.iloc[te])[:, 1]
    rule_pred = df.rule.to_numpy().astype(bool)
    rule_s = scores(y, rule_pred)
    # Threshold: the highest one that still finds at least as many real arrivals as the rule.
    thr = 0.5
    for cand in np.arange(0.95, 0.04, -0.01):
        if scores(y, oof >= cand)["recall_pct"] >= rule_s["recall_pct"]:
            thr = round(float(cand), 2)
            break
    model_s, half = scores(y, oof >= thr), scores(y, oof >= 0.5)
    # Planes inside 35 min of landing (where predictions are shown), the part that matters most.
    dfm = df.assign(p=oof)
    print(f"  hand-written rule:      {rule_s}")
    print(f"  model, threshold {thr}: {model_s}")
    print(f"  model, threshold 0.5:  {half}")
    report = {"rows": len(df), "days": days, "threshold": thr, "rule": rule_s, "model": model_s,
              "model_at_0.5": half, "by_dist": {}}
    for lo, hi in [(0, 10), (10, 20), (20, 30), (30, 41)]:
        m = (dfm.dist_nm >= lo) & (dfm.dist_nm < hi)
        r = {"rule": scores(y[m], rule_pred[m]), "model": scores(y[m], oof[m] >= thr)}
        report["by_dist"][f"{lo}-{hi} nm"] = r
        print(f"    {lo:>2}-{hi} nm: rule {r['rule']} | model {r['model']}")
    model = make_model().fit(X, y)
    D.MODELS.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": feats, "threshold": thr, "airport": ap.icao,
                 "report": report}, model_path(ap))
    (D.MODELS / f"{ap.icao}_arrival_report.json").write_text(json.dumps(report, indent=2))
    print(f"Saved {model_path(ap)}")


if __name__ == "__main__":
    main()
