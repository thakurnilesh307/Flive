"""Live landing-time predictions for Logan (roadmap step 5, live part).

The server feeds every Boston snapshot (5 s) into LivePredictor.update(). It:
1. keeps the last 40 minutes of every aircraft's track in memory,
2. runs the same landing detector as training (events.detect) every 30 s, so it
   knows which runway Logan has been landing on (an input to the model),
3. picks the aircraft that look like Logan arrivals, builds their inputs with
   dataset.feature_row (the exact function training used), and asks the model
   trained by train_eta.py for a best guess plus a "likely" 10th-90th percentile range,
4. adds absolute times to each aircraft dict: landing_at, landing_lo_at, landing_hi_at.

The model only ever saw planes that DID land at Logan, so predictions are only made
for aircraft that look like arrivals (see is_arrival); anything else gets None.
On startup it replays the newest log file so the runway-in-use is known right away.
"""
import glob
import json
import time
from collections import defaultdict, deque
from pathlib import Path

import dataset
import events as E
import traffic

HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "data" / "eta_model.joblib"
RUNWAY_MODEL_PATH = HERE / "data" / "runway_model.joblib"   # train_runway.py
TAXI_IN_S = 20 * 60          # a plane that landed this recently and is taxiing is taxiing IN
KEEP_S = 40 * 60
DETECT_EVERY_S = 30
MAX_ETA_S = 35 * 60


def is_arrival(s, status, recently_on_ground=False):
    """Does this aircraft look like it's coming in to land at Logan?
    - never if it was on the ground in the last few minutes or is climbing: that's a
      departure (right at the airport every direction "points at Logan", so a plane
      that just lifted off can pass the approach rule; found by checking live
      predictions against real touchdowns),
    - the existing Logan statuses "on approach" / "inbound", or
    - below 10,000 ft within 30 nm and descending (catches planes on a downwind or
      base leg that aren't pointed at Logan yet)."""
    if recently_on_ground or (s.vs_fpm is not None and s.vs_fpm > 300):
        return False
    if s.category == 8:   # helicopters use helipads, not the runways the model learned from
        return False
    if status in ("approach", "inbound"):
        return True
    if status == "departing" or s.alt_ft is None:
        return False
    d = dataset.dist_nm(s.lat, s.lon)
    return d < 30 and s.alt_ft < 10000 and s.vs_fpm is not None and s.vs_fpm < -300


def _sample(a):
    """Snapshot aircraft dict -> events.Sample (raw pressure altitude, like training)."""
    num = E._num
    lat, lon = num(a.get("lat")), num(a.get("lon"))
    t = num(a.get("time_position")) or num(a.get("last_contact"))
    if lat is None or lon is None or t is None:
        return None
    alt_m, gs, vs = num(a.get("baro_alt_m")), num(a.get("velocity_ms")), num(a.get("vert_rate_ms"))
    return E.Sample(
        t=t, lat=lat, lon=lon,
        alt_ft=None if alt_m is None else alt_m * E.M_TO_FT,
        on_ground=bool(a.get("on_ground")),
        gs_kt=None if gs is None else gs * E.MS_TO_KT,
        track=num(a.get("track_deg")),
        vs_fpm=None if vs is None else vs * E.MS_TO_FPM,
        callsign=(a.get("callsign") or "").strip(),
        actype=a.get("aircraft_type"),
        category=num(a.get("category")),
    )


class LivePredictor:
    def __init__(self, path=MODEL_PATH):
        self.bundle = None
        self.error = None
        try:
            import joblib
            self.bundle = joblib.load(path) if path.exists() else None
            if self.bundle is None:
                self.error = "no model yet: run dataset.py and train_eta.py"
        except Exception as e:  # missing scikit-learn, or a model from another version
            self.error = f"model not loaded ({type(e).__name__}: {e})"
        self.runways = None
        try:
            import joblib
            self.runways = joblib.load(RUNWAY_MODEL_PATH) if RUNWAY_MODEL_PATH.exists() else None
        except Exception as e:
            print(f"Runway model not loaded ({type(e).__name__}: {e})")
        self.tracks = defaultdict(deque)
        self.events = []             # recent detected landings AND takeoffs (dicts from events.detect)
        self.last_detect = 0.0
        self.started = time.time()

    @property
    def available(self):
        return self.bundle is not None

    def status(self):
        b = self.bundle or {}
        cfg, n = self.runway_in_use(time.time())
        rr = (self.runways or {}).get("report", {})
        return {"available": self.available, "error": self.error, "trained_rows": b.get("trained_rows"),
                "trained_days": len(b.get("days", [])), "held_out_mae_min": b.get("mae_min"),
                "runway_in_use": cfg, "landings_last_30min": n,
                "runway_model": self.runways is not None,
                "runway_accuracy": {k: v.get("model_accuracy") for k, v in rr.items()}}

    # ---- live state -----------------------------------------------------------------
    def _add(self, icao, s):
        q = self.tracks[icao]
        if q and s.t <= q[-1].t:
            return
        q.append(s)
        while q and q[0].t < s.t - KEEP_S:
            q.popleft()

    def seed_from_logs(self):
        """Replay the newest log so the runway in use is known right after a restart."""
        cutoff = time.time() - KEEP_S
        # Every log written to in the last 40 min (each server run starts a new file,
        # so "just the newest" would be the empty one this run just created).
        paths = [p for p in sorted(glob.glob(str(HERE / "logan_*.jsonl"))) if Path(p).stat().st_mtime >= cutoff]
        for path in paths:
            self._replay(path, cutoff)
        self._detect(time.time(), force=True)

    def _replay(self, path, cutoff):
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    snap = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if (snap.get("fetched_at") or 0) < cutoff:
                    continue
                for a in snap.get("aircraft", []):
                    s = _sample(a)
                    if s and a.get("icao24"):
                        self._add(a["icao24"], s)

    def _detect(self, now, force=False):
        if not force and now - self.last_detect < DETECT_EVERY_S:
            return
        self.last_detect = now
        tracks = {k: list(v) for k, v in self.tracks.items() if v}
        if not tracks:
            return
        start = min(v[0].t for v in tracks.values())
        found, _ = E.detect(tracks, [(start, now)])
        seen = {(e["icao24"], e["kind"], round(e["time"] / 60)) for e in self.events}
        for e in found:
            if (e["icao24"], e["kind"], round(e["time"] / 60)) not in seen:
                self.events.append(e)
        self.events = [e for e in self.events if e["time"] > now - max(dataset.CONFIG_WINDOW_S, TAXI_IN_S)]

    def runway_in_use(self, t):
        recent = [e["runway"] for e in self.events
                  if e["kind"] == "landing" and t - dataset.CONFIG_WINDOW_S <= e["time"] <= t]
        if not recent:
            return None, 0
        return max(set(recent), key=recent.count), len(recent)

    # ---- per snapshot ---------------------------------------------------------------
    def update(self, snapshot):
        """Add predictions to the snapshot's aircraft in place."""
        now = snapshot.get("api_time") or time.time()
        samples = {}
        for a in snapshot["aircraft"]:
            s = _sample(a)
            if s and a.get("icao24"):
                samples[a["icao24"]] = s
                self._add(a["icao24"], s)
        self._detect(now)
        for a in snapshot["aircraft"]:
            a["landing_at"] = a["landing_lo_at"] = a["landing_hi_at"] = None
            a["landing_runway"] = a["landing_runway_p"] = a["takeoff_runway"] = a["takeoff_runway_p"] = None
        self._predict_runways(snapshot, samples, now)
        if not self.available:
            return snapshot
        cfg, n_landings = self.runway_in_use(now)
        snapshot["runway_in_use"] = cfg
        # Arrival-flow traffic right now (same definition as dataset.TrafficIndex).
        flow = {i for i, s in samples.items() if not s.on_ground and s.alt_ft is not None
                and s.alt_ft < 8000 and dataset.dist_nm(s.lat, s.lon) < 15}
        rows, targets = [], []
        for a in snapshot["aircraft"]:
            s = samples.get(a.get("icao24"))
            if not s or not dataset.usable(s):
                continue
            d = dataset.dist_nm(s.lat, s.lon)
            status = traffic.classify(a, d, s.alt_ft, s.gs_kt, s.vs_fpm)
            recent = self.tracks.get(a["icao24"], ())
            on_ground_lately = any(x.on_ground for x in recent if x.t >= s.t - 300)
            if not is_arrival(s, status, on_ground_lately):
                continue
            rows.append(dataset.feature_row(s, now, len(flow - {a["icao24"]}), cfg, n_landings))
            targets.append((a, s))
        if not rows:
            return snapshot
        import pandas as pd
        X = pd.DataFrame(rows)[self.bundle["features"]].astype(float)
        best = self.bundle["model"].predict(X)
        lo, hi = self.bundle["lo"].predict(X), self.bundle["hi"].predict(X)
        for (a, s), b, l, h in zip(targets, best, lo, hi):
            if not 0 < b <= MAX_ETA_S:
                continue
            # Widen the raw range by the factor calibrated on held-out days (train_eta.py).
            k = self.bundle.get("range_widen", 1.0)
            l, h = b - k * (b - min(l, b)), b + k * (max(h, b) - b)
            # Predictions are relative to the sample's own time; send absolute times so
            # the page can count down smoothly between updates.
            a["landing_at"] = round(s.t + b, 1)
            a["landing_lo_at"] = round(s.t + max(l, 0), 1)
            a["landing_hi_at"] = round(s.t + h, 1)
        return snapshot

    # ---- runways ----------------------------------------------------------------------
    def _predict_runways(self, snapshot, samples, now):
        """Landing runway for arrivals, takeoff runway for planes taxiing out, each with
        the model's probability (only runways used in the last 30 min can win, the same
        rule train_runway.py was scored with)."""
        if not self.runways:
            return
        import pandas as pd
        use = dataset.RunwayUse(self.events)
        land_active = set(use.counts("landing", now))
        take_active = set(use.counts("takeoff", now))
        flow = {i for i, s in samples.items() if not s.on_ground and s.alt_ft is not None
                and s.alt_ft < 8000 and dataset.dist_nm(s.lat, s.lon) < 15}
        just_landed = {e["icao24"] for e in self.events if e["kind"] == "landing" and e["time"] > now - TAXI_IN_S}
        arr, dep = [], []
        for a in snapshot["aircraft"]:
            s = samples.get(a.get("icao24"))
            if not s:
                continue
            if dataset.usable(s):
                d = dataset.dist_nm(s.lat, s.lon)
                status = traffic.classify(a, d, s.alt_ft, s.gs_kt, s.vs_fpm)
                recent = self.tracks.get(a["icao24"], ())
                if is_arrival(s, status, any(x.on_ground for x in recent if x.t >= s.t - 300)):
                    arr.append((a, dataset.arrival_runway_features(s, now, len(flow - {a["icao24"]}), use)))
            elif dataset.taxiing(s) and a["icao24"] not in just_landed:
                dep.append((a, dataset.departure_runway_features(s, now, use)))
        for items, model_key, active, field in ((arr, "arrival", land_active, "landing_runway"),
                                                (dep, "departure", take_active, "takeoff_runway")):
            if not items:
                continue
            model = self.runways[model_key]
            X = pd.DataFrame([f for _, f in items])[self.runways[f"{model_key}_features"]].astype(float)
            proba = dataset.restrict_to_active(model.classes_, model.predict_proba(X), active)
            for (a, _), p in zip(items, proba):
                i = int(p.argmax())
                a[field], a[f"{field}_p"] = str(model.classes_[i]), round(float(p[i]), 2)
