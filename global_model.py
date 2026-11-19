"""One landing-time model for ANY airport (the rough tier, for the worldwide feed).

    python global_model.py        (after importing history for the airports in airport_geo.CONFIG)

Flive's detailed models (train_eta.py / train_runway.py) are per airport and need a
position every 5-10 s plus the runway in use. Worldwide, Flive only has OpenSky's
90 s snapshots and no runway in use, so this model only uses what ONE position
report says, relative to whichever airport the plane seems to be heading for:

    distance, height above the field, speed, vertical rate, heading vs the airport,
    how well it's lined up with the best-matching runway, arrival-flow traffic

Training data: each imported history area (45 nm around Logan, JFK, Heathrow) also
contains the neighbouring airports (LaGuardia, Newark, Gatwick, London City, Luton...),
and the detector works at any airport with runway data, so their landings are labels
too: more airports to learn from, and real answers to "which airport did it go to".

Two separate questions, each scored leave-ONE-AREA-out (train on the Boston and New
York areas, predict the London area, and so on: airports it has never seen, which is
the whole point of a global model):
1. Which airport is it landing at? A classifier scores every nearby airport for the
   plane (distance, height vs a normal descent, heading, runway alignment, airport
   size); the simple rule guess_destination() is the baseline it has to beat. Whichever
   wins on unseen areas is what the server uses (first run: the rule won, because the
   classifier learned area habits like "the nearest big airport" that don't transfer).
2. When? Compared with the straight line and with each airport's own detailed model.

Writes data/models/GLOBAL_eta.joblib and GLOBAL_report.json. The server applies it to
worldwide aircraft (GlobalPredictor) every 90 s; the page labels it a rough estimate.
"""
import bisect
import json
import math
from collections import defaultdict
from pathlib import Path

import airport_geo as G
import dataset as D
import events as E

HERE = Path(__file__).resolve().parent
MODEL_PATH = D.MODELS / "GLOBAL_eta.joblib"
MAX_DIST_NM = 40
MAX_AGL_FT = 12000
FEATURES = ["dist_nm", "alt_agl_ft", "gs_kt", "vs_fpm", "off_airport_deg", "naive_eta_s", "traffic_15nm",
            "category", "al_along_nm", "al_cross_nm", "al_hdg_diff", "al_thr_dist_nm", "min_thr_dist_nm",
            "n_runway_ends"]
RANGE = (0.1, 0.9)
MAX_ETA_S = 35 * 60


# ---- geometry, relative to one airport ------------------------------------------------
def aligned_runway(ap, s):
    """The runway end the plane is best set up to land on: before (or just past) the
    threshold, within 45 deg of its heading, scored by cross-track + heading error.
    Returns (end, along, cross, hdg_diff) or None."""
    if s.track is None:
        return None
    best = None
    for r in ap.ends:
        hdg = G.angle_diff(s.track, r.heading)
        if hdg > 45:
            continue
        along, cross = r.offsets(s.lat, s.lon)
        if not -25 <= along <= 0.5:
            continue
        score = cross + hdg / 20
        if best is None or score < best[0]:
            best = (score, r, along, cross, hdg)
    return best[1:] if best else None


def lined_up(ap, s):
    """Runway ident if the plane is clearly on final for it (the global "runway" guess)."""
    hit = aligned_runway(ap, s)
    if hit and hit[2] <= 0.6 and hit[3] <= 20 and hit[1] >= -15:
        return hit[0].ident
    return None


def candidate(ap, s):
    """Could this plane be on its way down to `ap`? Same gate in training and live."""
    if s.on_ground or s.gs_kt is None or s.gs_kt < D.MIN_GS_KT or s.alt_ft is None:
        return False
    if ap.dist_nm(s.lat, s.lon) > MAX_DIST_NM:
        return False
    agl = s.alt_ft - ap.elev_ft
    if agl > MAX_AGL_FT or (s.vs_fpm is not None and s.vs_fpm > 300):
        return False
    return (s.vs_fpm is not None and s.vs_fpm < -200) or agl < 4000


def features(ap, s, traffic_15nm):
    d = ap.dist_nm(s.lat, s.lon)
    brg = ap.bearing(s.lat, s.lon)
    off = G.angle_diff(s.track, (brg + 180) % 360) if s.track is not None else None
    x, y = ap.xy(s.lat, s.lon)
    al = aligned_runway(ap, s)
    return {
        "dist_nm": round(d, 3),
        "alt_agl_ft": round(s.alt_ft - ap.elev_ft),
        "gs_kt": round(s.gs_kt, 1),
        "vs_fpm": None if s.vs_fpm is None else round(s.vs_fpm),
        "off_airport_deg": None if off is None else round(off, 1),
        "naive_eta_s": round(d / s.gs_kt * 3600, 1),
        "traffic_15nm": traffic_15nm,
        "category": s.category,
        "al_along_nm": None if not al else round(al[1], 2),
        "al_cross_nm": None if not al else round(al[2], 2),
        "al_hdg_diff": None if not al else round(al[3], 1),
        "al_thr_dist_nm": None if not al else round(math.hypot(x - al[0].x0, y - al[0].y0), 2),
        "min_thr_dist_nm": round(min((math.hypot(x - r.x0, y - r.y0) for r in ap.ends), default=d), 2),
        "n_runway_ends": len(ap.ends),
    }


# ---- which airport? -------------------------------------------------------------------
class AirportIndex:
    """Airports on a 1-degree grid, for "which airports are within 40 nm"."""

    def __init__(self, airports):
        self.cells = defaultdict(list)
        for ap in airports.values():
            if ap.ends:
                self.cells[(math.floor(ap.lat), math.floor(ap.lon))].append(ap)

    def near(self, lat, lon, nm=MAX_DIST_NM):
        out = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for ap in self.cells.get((math.floor(lat) + i, (math.floor(lon) + j + 180) % 360 - 180), ()):
                    if ap.dist_nm(lat, lon) <= nm:
                        out.append(ap)
        return out


def guess_destination(index, s):
    """Best guess of the airport this plane is landing at, or None. Lined up on final
    for a runway wins outright; otherwise the nearby airport it's pointed at AND whose
    height-for-distance looks like a normal ~3 degree descent (about 320 ft per nm)."""
    best = None
    for ap in index.near(s.lat, s.lon):
        if not candidate(ap, s):
            continue
        d = ap.dist_nm(s.lat, s.lon)
        if lined_up(ap, s):
            score = -10 + d / 100
        else:
            brg = ap.bearing(s.lat, s.lon)
            off = G.angle_diff(s.track, (brg + 180) % 360) if s.track is not None else 90
            agl = s.alt_ft - ap.elev_ft
            score = off / 45 + abs(agl - 320 * d) / 3000 + d / 40
        if best is None or score < best[0]:
            best = (score, ap)
    return best[1] if best else None


# ---- which airport, learned -----------------------------------------------------------
AREA_NM = 30   # neighbour airports whose approaches fit inside an imported 45 nm history area
DEST_FEATURES = ["dist_nm", "alt_agl_ft", "glide_err_ft", "off_airport_deg", "vs_fpm", "gs_kt",
                 "al_along_nm", "al_cross_nm", "al_hdg_diff", "is_lined_up", "n_runway_ends",
                 "longest_runway_nm", "n_candidates", "rank_by_dist"]
# Same without anything about airport size or how many airports are around: only the
# plane's geometry relative to each candidate (less to overfit to one area's layout).
DEST_GEOMETRY = ["dist_nm", "alt_agl_ft", "glide_err_ft", "off_airport_deg", "vs_fpm", "gs_kt",
                 "al_along_nm", "al_cross_nm", "al_hdg_diff", "is_lined_up"]


def candidates(index, s):
    return [ap for ap in index.near(s.lat, s.lon) if candidate(ap, s)]


def pair_rows(cands, s):
    """One row per candidate airport for this plane: does it look like THIS one?"""
    by_dist = sorted(cands, key=lambda ap: ap.dist_nm(s.lat, s.lon))
    rows = []
    for ap in cands:
        d = ap.dist_nm(s.lat, s.lon)
        brg = ap.bearing(s.lat, s.lon)
        off = G.angle_diff(s.track, (brg + 180) % 360) if s.track is not None else None
        agl = s.alt_ft - ap.elev_ft
        al = aligned_runway(ap, s)
        rows.append({
            "dist_nm": round(d, 2), "alt_agl_ft": round(agl), "glide_err_ft": round(agl - 320 * d),
            "off_airport_deg": None if off is None else round(off, 1), "vs_fpm": s.vs_fpm, "gs_kt": s.gs_kt,
            "al_along_nm": None if not al else round(al[1], 2), "al_cross_nm": None if not al else round(al[2], 2),
            "al_hdg_diff": None if not al else round(al[3], 1), "is_lined_up": int(lined_up(ap, s) is not None),
            "n_runway_ends": len(ap.ends), "longest_runway_nm": round(max(r.length for r in ap.ends), 2),
            "n_candidates": len(cands), "rank_by_dist": by_dist.index(ap),
        })
    return rows


# ---- training -------------------------------------------------------------------------
def area_airports(center, world):
    """The history area's own airport plus scheduled-service neighbours close enough
    that their approaches are inside the imported 45 nm circle (LGA/EWR near JFK,
    Gatwick/City/Luton near Heathrow). The detector works for any of them."""
    return [center] + [ap for ap in world.values()
                       if ap.icao != center.icao and ap.ends and center.dist_nm(ap.lat, ap.lon) <= AREA_NM]


def build_area(center, world, index):
    tracks, windows, _, _, _ = E.load_all(center)
    eta_rows, dest_rows = [], []
    group = 0
    for ap in area_airports(center, world):
        evs, _ = E.detect(tracks, windows, ap)
        landings = [e for e in evs if e["kind"] == "landing" and e["method"] == "ground flag"]
        if not landings:
            continue
        traffic = D.TrafficIndex(ap, tracks)
        n0 = len(eta_rows)
        for ev in landings:
            samples = tracks.get(ev["icao24"], [])
            i0 = bisect.bisect_left([x.t for x in samples], ev["time"] - D.HORIZON_S)
            next_t = -1e18
            for s in samples[i0:]:
                if s.t >= ev["time"] - 5:
                    break
                if s.t < next_t or not candidate(ap, s):
                    continue
                next_t = s.t + D.STEP_S
                base = {"area": center.icao, "airport": ap.icao, "label_s": round(ev["time"] - s.t, 1)}
                heur = guess_destination(index, s)
                eta_rows.append({**base, "heuristic_ok": int(heur is not None and heur.icao == ap.icao),
                                 "lined_up": lined_up(ap, s) or "", "runway": ev["runway"],
                                 **features(ap, s, traffic.count(s.t, ev["icao24"]))})
                cands = candidates(index, s)
                for c, r in zip(cands, pair_rows(cands, s)):
                    dest_rows.append({**base, "group": f"{center.icao}-{group}", "is_dest": int(c.icao == ap.icao), **r})
                group += 1
        print(f"  {center.icao} area: {ap.icao} {ap.name[:30]}: {len(landings):,} landings, {len(eta_rows) - n0:,} rows")
    return eta_rows, dest_rows


def make_model(quantile=None):
    from sklearn.ensemble import HistGradientBoostingRegressor
    kw = dict(max_iter=400, learning_rate=0.06, max_leaf_nodes=31, min_samples_leaf=40, random_state=0)
    if quantile is None:
        return HistGradientBoostingRegressor(loss="absolute_error", **kw)
    return HistGradientBoostingRegressor(loss="quantile", quantile=quantile, **kw)


def make_dest_model():
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=31,
                                          min_samples_leaf=40, random_state=0)


def pick(dest_df, proba):
    """Per plane (group), the candidate with the highest probability -> was it right?"""
    d = dest_df.assign(p=proba)
    best = d.loc[d.groupby("group")["p"].idxmax()]
    return best.set_index("group")["is_dest"]


def main():
    import joblib
    import numpy as np
    import pandas as pd
    world = dict(G.world_airports())
    world.update(G.AIRPORTS)   # the detailed airports use their own config (time zone etc.)
    index = AirportIndex(world)
    eta_rows, dest_rows = [], []
    for center in G.AIRPORTS.values():
        e, d = build_area(center, world, index)
        eta_rows += e
        dest_rows += d
    df, dd = pd.DataFrame(eta_rows), pd.DataFrame(dest_rows)
    X, y = df[FEATURES].astype(float), df["label_s"].to_numpy()
    yd = dd["is_dest"].to_numpy()
    dest_sets = {"classifier (all features)": DEST_FEATURES, "classifier (geometry only)": DEST_GEOMETRY}
    dest_right = {name: [] for name in ["simple rule", *dest_sets]}
    print(f"{len(df):,} landing-time rows at {df.airport.nunique()} airports, {len(dd):,} destination rows")

    report = {"rows": int(len(df)), "airports_trained": int(df.airport.nunique()), "areas": {}}
    held = []
    for area in sorted(df.area.unique()):
        tr, te = (df.area != area).to_numpy(), (df.area == area).to_numpy()
        p = make_model().fit(X[tr], y[tr]).predict(X[te])
        lo = make_model(RANGE[0]).fit(X[tr], y[tr]).predict(X[te])
        hi = make_model(RANGE[1]).fit(X[tr], y[tr]).predict(X[te])
        held.append((y[te], p, lo, hi))
        sub = df[te].assign(err=np.abs(p - y[te]), straight=np.abs(X[te]["naive_eta_s"].to_numpy() - y[te]))
        main_ap = sub[sub.airport == area]
        own_path = D.MODELS / f"{area}_eta_report.json"
        own = json.loads(own_path.read_text())["summary"]["model"]["mae_min"] if own_path.exists() else None
        dtr, dte = (dd.area != area).to_numpy(), (dd.area == area).to_numpy()
        dest_scores = {"simple rule": float(sub.heuristic_ok.mean())}
        for name, cols in dest_sets.items():
            Xd = dd[cols].astype(float)
            dest_scores[name] = float(pick(dd[dte], make_dest_model().fit(Xd[dtr], yd[dtr])
                                           .predict_proba(Xd[dte])[:, 1]).mean())
        for name, v in dest_scores.items():
            dest_right[name].append(v)
        lined = sub[sub.lined_up != ""]
        r = report["areas"][area] = {
            "airports": sorted(sub.airport.unique().tolist()), "rows": int(te.sum()),
            "global_mae_min": round(float(sub.err.mean()) / 60, 2),
            "straight_mae_min": round(float(sub.straight.mean()) / 60, 2),
            "main_airport_global_mae_min": round(float(main_ap.err.mean()) / 60, 2),
            "main_airport_own_model_mae_min": own,
            "destination_right_pct": {k: round(v * 100, 1) for k, v in dest_scores.items()},
            "lined_up_runway_right_pct": round(float((lined.lined_up == lined.runway).mean()) * 100, 1) if len(lined) else None,
        }
        print(f"{area} area never seen in training: global {r['global_mae_min']} min vs straight line "
              f"{r['straight_mae_min']} | at {area} itself {r['main_airport_global_mae_min']} vs its own model {own} | "
              f"destination right {r['destination_right_pct']} | "
              f"lined-up runway right {r['lined_up_runway_right_pct']}%")

    yy, pp, ll, hh = (np.concatenate(x) for x in zip(*held))
    widen = 1.0
    while widen < 6 and np.mean((yy >= pp - widen * (pp - np.minimum(ll, pp)))
                                & (yy <= pp + widen * (np.maximum(hh, pp) - pp))) < RANGE[1] - RANGE[0]:
        widen += 0.05
    report["range_widen"] = round(widen, 2)
    report["global_mae_min"] = round(float(np.abs(pp - yy).mean()) / 60, 2)
    report["straight_mae_min"] = round(float(np.mean([np.abs(df[df.area == a]["naive_eta_s"] - df[df.area == a]["label_s"]).mean()
                                                      for a in df.area.unique()])) / 60, 2)
    print(f"Pooled over unseen areas: {report['global_mae_min']} min; range widened x{widen:.2f} to hold 80%")
    # Destination: keep whichever method was right most often on unseen areas (mean over areas).
    means = {k: float(np.mean(v)) for k, v in dest_right.items()}
    dest_mode = max(means, key=means.get)
    report["destination_mean_right_pct"] = {k: round(v * 100, 1) for k, v in means.items()}
    report["destination_method"] = dest_mode
    print(f"Destination on unseen areas: {report['destination_mean_right_pct']} -> using {dest_mode}")
    dest_cols = dest_sets.get(dest_mode)

    bundle = {"model": make_model().fit(X, y), "lo": make_model(RANGE[0]).fit(X, y),
              "hi": make_model(RANGE[1]).fit(X, y), "features": FEATURES,
              "dest": make_dest_model().fit(dd[dest_cols].astype(float), yd) if dest_cols else None,
              "dest_features": dest_cols,
              "range_widen": report["range_widen"], "report": report}
    D.MODELS.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, MODEL_PATH)
    (D.MODELS / "GLOBAL_report.json").write_text(json.dumps(report, indent=2))
    print(f"Saved {MODEL_PATH.relative_to(HERE)}")


# ---- live -----------------------------------------------------------------------------
MIN_DEST_P = 0.3   # don't name an airport the model itself thinks is unlikely


class GlobalPredictor:
    """Rough landing predictions for worldwide (OpenSky, 90 s) aircraft."""

    def __init__(self):
        self.bundle, self.error = None, None
        try:
            import joblib
            self.bundle = joblib.load(MODEL_PATH) if MODEL_PATH.exists() else None
        except Exception as e:
            self.error = f"{type(e).__name__}: {e}"
        self.index = AirportIndex(G.world_airports()) if self.bundle else None

    @property
    def available(self):
        return self.bundle is not None

    def update(self, aircraft, skip=frozenset()):
        """Adds landing_at / landing_lo_at / landing_hi_at / landing_airport /
        landing_runway / prediction="global" in place. `skip`: icao24s covered by a
        detailed airport feed (they get the better prediction there)."""
        import eta
        import pandas as pd
        for a in aircraft:
            for k in ("landing_at", "landing_lo_at", "landing_hi_at", "landing_airport", "landing_runway", "prediction"):
                a[k] = None
        if not self.available:
            return
        planes, pairs = [], []
        for a in aircraft:
            if a["icao24"] in skip or a.get("on_ground"):
                continue
            s = eta._sample(a)
            if s is None or s.alt_ft is None:
                continue
            cands = candidates(self.index, s)
            if cands:
                planes.append((a, s, cands))
                if self.bundle.get("dest") is not None:
                    pairs += pair_rows(cands, s)
        if not planes:
            return
        chosen = []
        if self.bundle.get("dest") is None:   # the simple rule won on unseen areas
            for a, s, _ in planes:
                ap = guess_destination(self.index, s)
                if ap:
                    chosen.append((a, s, ap))
        else:
            proba = self.bundle["dest"].predict_proba(pd.DataFrame(pairs)[self.bundle["dest_features"]].astype(float))[:, 1]
            i = 0
            for a, s, cands in planes:
                p = proba[i:i + len(cands)]
                i += len(cands)
                j = int(p.argmax())
                if p[j] >= MIN_DEST_P:
                    chosen.append((a, s, cands[j]))
        if not chosen:
            return
        flow = defaultdict(int)   # arrival-flow traffic per chosen airport (same definition as training)
        for _, s, _ in planes:
            for ap in {c[2] for c in chosen if c[2].dist_nm(s.lat, s.lon) < 20}:
                if D.in_flow(ap, s):
                    flow[ap.icao] += 1
        rows = [features(ap, s, max(0, flow[ap.icao] - int(D.in_flow(ap, s)))) for _, s, ap in chosen]
        X = pd.DataFrame(rows)[self.bundle["features"]].astype(float)
        best = self.bundle["model"].predict(X)
        lo, hi = self.bundle["lo"].predict(X), self.bundle["hi"].predict(X)
        k = self.bundle["range_widen"]
        for (a, s, ap), b, l, h in zip(chosen, best, lo, hi):
            if not 0 < b <= MAX_ETA_S:
                continue
            l, h = b - k * (b - min(l, b)), b + k * (max(h, b) - b)
            a["landing_at"] = round(s.t + b, 1)
            a["landing_lo_at"] = round(s.t + max(l, 0), 1)
            a["landing_hi_at"] = round(s.t + h, 1)
            a["landing_airport"] = ap.icao
            a["landing_runway"] = lined_up(ap, s)
            a["prediction"] = "global"


if __name__ == "__main__":
    main()
