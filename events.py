"""Arrival and departure detection at Logan (roadmap step 4).

Turns the 15-second snapshot logs (logan_*.jsonl) into events:

    JBU1883  A320  landing   2026-11-18 05:12:40  runway 04R

How it works:
1. Group every snapshot by aircraft (icao24) into a time-ordered track, split into
   separate visits wherever the aircraft was missing for over 20 minutes.
2. A landing is an airborne -> on-ground change; a takeoff is the reverse. ADS-B
   "on ground" flags glitch, so single-sample blips are smoothed out first and each
   change has to pass sanity checks (close to a runway, low, descending for
   landings / climbing for takeoffs, and the new state has to stick). Everything
   rejected is counted by reason, so the filter is visible rather than magic.
   Light aircraft that never send an on-ground flag get an inferred landing when
   their track ends low, descending and lined up with a runway (method
   "lost on final", with a wider time uncertainty).
3. The runway is the one whose centreline the aircraft is lined up on: heading
   within 25 degrees of the runway direction AND within 0.35 nm of the extended
   centreline. Position matters because 04L/04R (and 22L/22R) share a heading.
4. Touchdown time is estimated between the last airborne and first ground sample
   (logs are 15 s apart) from the last altitude and descent rate.

Run:  python events.py            -> prints a summary, writes data/events.csv
These events are the labels for the landing-time model (roadmap step 5).
"""
import csv
import glob
import gzip
import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
KBOS = (42.3656, -71.0096)
FIELD_ELEV_FT = 20
M_TO_FT = 3.28084
MS_TO_KT = 1.943844
MS_TO_FPM = 196.8504

# Logan's runways from OurAirports (public domain): (low end, lat, lon, high end, lat, lon).
# Landing on the low end ("04R") means flying from its threshold toward the high end.
RUNWAYS_RAW = [
    ("04L", 42.357997, -71.014344, "22R", 42.378322, -71.004511),
    ("04R", 42.351064, -71.011801, "22L", 42.376923, -70.999288),
    ("09", 42.35580063, -71.01290131, "27", 42.36019897, -70.98770142),
    ("14", 42.35660171508789, -71.02330017089844, "32", 42.34859848022461, -71.0082015991211),
    ("15L", 42.373600006103516, -71.00910186767578, "33R", 42.36859893798828, -71.00250244140625),
    ("15R", 42.374298095703125, -71.01789855957031, "33L", 42.35459899902344, -70.9916000366211),
]

SEGMENT_GAP_S = 20 * 60     # missing this long = a separate visit
MAX_SAMPLE_GAP_S = 90       # can't trust a transition across a bigger hole in the data
HEADING_TOL = 25            # degrees
CROSS_TRACK_NM = 0.35       # max distance from the extended centreline
CONFIRM_S = 60              # the new state must hold for this long


def _xy(lat, lon):
    """Flat local projection around Logan, in nautical miles (fine within ~20 nm)."""
    return ((lon - KBOS[1]) * 60 * math.cos(math.radians(KBOS[0])), (lat - KBOS[0]) * 60)


def _angle_diff(a, b):
    return abs((a - b + 180) % 360 - 180)


@dataclass
class RunwayEnd:
    ident: str
    x0: float          # threshold, nm
    y0: float
    ux: float          # unit vector along the landing direction
    uy: float
    heading: float     # true degrees
    length: float      # nm

    def offsets(self, lat, lon):
        """(along-track from threshold, cross-track) in nm for a point."""
        x, y = _xy(lat, lon)
        dx, dy = x - self.x0, y - self.y0
        return dx * self.ux + dy * self.uy, abs(-dx * self.uy + dy * self.ux)


def _runway_ends():
    ends = []
    for le, la1, lo1, he, la2, lo2 in RUNWAYS_RAW:
        for ident, a, b in ((le, (la1, lo1), (la2, lo2)), (he, (la2, lo2), (la1, lo1))):
            x0, y0 = _xy(*a)
            x1, y1 = _xy(*b)
            length = math.hypot(x1 - x0, y1 - y0)
            ux, uy = (x1 - x0) / length, (y1 - y0) / length
            heading = math.degrees(math.atan2(ux, uy)) % 360
            ends.append(RunwayEnd(ident, x0, y0, ux, uy, heading, length))
    return ends


RUNWAY_ENDS = _runway_ends()


def match_runway(lat, lon, track, before=3.0, after=0.5):
    """The runway end the aircraft is lined up with, or None.
    `before`: how far before the threshold still counts (nm); `after`: past the far end."""
    if track is None or lat is None or lon is None:
        return None
    best = None
    for r in RUNWAY_ENDS:
        if _angle_diff(track, r.heading) > HEADING_TOL:
            continue
        along, cross = r.offsets(lat, lon)
        if cross <= CROSS_TRACK_NM and -before <= along <= r.length + after:
            if best is None or cross < best[1]:
                best = (r.ident, cross)
    return best[0] if best else None


@dataclass
class Sample:
    t: float
    lat: float
    lon: float
    alt_ft: float | None   # pressure-corrected when the log has it
    on_ground: bool
    gs_kt: float | None
    track: float | None
    vs_fpm: float | None
    callsign: str
    actype: str | None
    category: int | None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def load_tracks(paths):
    """icao24 -> time-ordered samples from all log files."""
    tracks = defaultdict(dict)
    bad_lines = 0
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    snap = json.loads(line)
                except json.JSONDecodeError:
                    bad_lines += 1   # e.g. a line cut off when the server stopped
                    continue
                fetched = _num(snap.get("fetched_at"))
                for a in snap.get("aircraft", []):
                    lat, lon = _num(a.get("lat")), _num(a.get("lon"))
                    if lat is None or lon is None or not a.get("icao24"):
                        continue
                    t = _num(a.get("time_position")) or fetched
                    if t is None:
                        continue
                    # Raw pressure altitude everywhere, so old logs, new logs and adsb.lol
                    # history agree (only recent logs have the pressure-corrected value).
                    alt_m = _num(a.get("baro_alt_m"))
                    vs, gs = _num(a.get("vert_rate_ms")), _num(a.get("velocity_ms"))
                    tracks[a["icao24"]][round(t)] = Sample(
                        t=t, lat=lat, lon=lon,
                        alt_ft=None if alt_m is None else alt_m * M_TO_FT,
                        on_ground=bool(a.get("on_ground")),
                        gs_kt=None if gs is None else gs * MS_TO_KT,
                        track=_num(a.get("track_deg")),
                        vs_fpm=None if vs is None else vs * MS_TO_FPM,
                        callsign=(a.get("callsign") or "").strip(),
                        actype=a.get("aircraft_type"),
                        category=_num(a.get("category")),
                    )
    return {k: [v[t] for t in sorted(v)] for k, v in tracks.items()}, bad_lines


def load_history(paths, tracks=None):
    """Add adsb.lol history (scripts/import_history.py, data/history/*.jsonl.gz) to
    `tracks`. Points: [t, lat, lon, alt_ft, on_ground, gs_kt, track, vs_fpm, callsign
    (only when it changes)]. Altitudes here are raw pressure altitude (no historical
    QNH yet), which is fine for the detector's thresholds."""
    merged = defaultdict(dict)
    for k, v in (tracks or {}).items():
        merged[k].update({round(x.t): x for x in v})
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                icao, cs = rec.get("icao24"), ""
                if not icao:
                    continue
                for p in rec.get("points", []):
                    if len(p) < 9 or _num(p[0]) is None:
                        continue
                    cs = (p[8] or cs or "").strip()
                    merged[icao][round(p[0])] = Sample(
                        t=p[0], lat=p[1], lon=p[2], alt_ft=_num(p[3]), on_ground=bool(p[4]),
                        gs_kt=_num(p[5]), track=_num(p[6]), vs_fpm=_num(p[7]), callsign=cs,
                        actype=rec.get("aircraft_type"), category=_num(rec.get("category")),
                    )
    return {k: [v[t] for t in sorted(v)] for k, v in merged.items()}


def history_coverage(paths):
    """Each imported day is one continuous window (adsb.lol records all day)."""
    out = []
    for path in paths:
        day = datetime.strptime(Path(path).name[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
        out.append((day, day + 86400))
    return out


def segments(samples):
    seg = [samples[0]]
    for s in samples[1:]:
        if s.t - seg[-1].t > SEGMENT_GAP_S:
            yield seg
            seg = []
        seg.append(s)
    yield seg


def _despike(seg):
    """Ground flags with single-sample blips removed: a sample that disagrees with
    both neighbours (all within 45 s) is a glitch. Real example: DAL257 rolling out
    on 33L sent one 'airborne at 3,650 ft' sample between two on-ground ones."""
    g = [x.on_ground for x in seg]
    # Two passes, "airborne" blips first: a plane on the ground briefly claiming to
    # fly (often with a garbage altitude) is the common glitch. Doing this pass first
    # matters for sequences like ground-air-ground right after touchdown.
    for blip in (False, True):
        for i in range(1, len(seg) - 1):
            if g[i] == blip and g[i - 1] == g[i + 1] == (not blip) and seg[i + 1].t - seg[i - 1].t <= 45:
                g[i] = not blip
    return g


def _holds(seg, g, i, seconds=CONFIRM_S):
    """Does the state at seg[i] stay the same for `seconds` (as far as we can see)?"""
    end = seg[i].t + seconds
    for j in range(i + 1, len(seg)):
        if seg[j].t > end:
            break
        if g[j] != g[i]:
            return False
    return True


def _track(seg, i, prefer):
    """Heading around seg[i]. The sample right at an air/ground change often has no
    track (adsb.lol traces), so fall back to the nearest neighbour that has one,
    looking first in the `prefer` direction (-1 = before, +1 = after)."""
    for j in (i, i + prefer, i - prefer, i + 2 * prefer, i - 2 * prefer):
        if 0 <= j < len(seg) and seg[j].track is not None:
            return seg[j].track
    return None


def _covered(t, windows):
    return any(s <= t <= e for s, e in windows)


def _lost_on_final(seg, windows):
    """Inferred landing for aircraft that never report 'on ground' (many light
    aircraft transponders, e.g. Cape Air's Cessnas): the track ends low,
    descending and lined up with a runway while our logs keep running."""
    last = seg[-1]
    if last.on_ground or last.alt_ft is None or last.alt_ft > 700:
        return None
    if last.vs_fpm is not None and last.vs_fpm > 0:
        return None
    if not (_covered(last.t + 60, windows) and _covered(last.t, windows)):
        return None   # our logging stopped, not the aircraft
    rwy = match_runway(last.lat, last.lon, last.track, before=2.5, after=0.5)
    if not rwy:
        return None
    sink = max(-(last.vs_fpm or -500), 500)
    dt = min(120.0, max(0.0, last.alt_ft - FIELD_ELEV_FT) / sink * 60)
    return rwy, last.t + dt, dt / 2 + 15


def _touchdown_time(a, b):
    """Between the last airborne (a) and first ground (b) sample: use the descent
    rate if we have it, otherwise the midpoint."""
    if a.alt_ft is not None and a.vs_fpm is not None and a.vs_fpm < -100:
        dt = max(0.0, a.alt_ft - FIELD_ELEV_FT) / -a.vs_fpm * 60
        return min(b.t, a.t + dt)
    return (a.t + b.t) / 2


def _event(icao, a, b, kind, t, rwy, uncertainty, method):
    return {
        "icao24": icao,
        "callsign": b.callsign or a.callsign,
        "aircraft_type": b.actype or a.actype or "",
        "kind": kind,
        "time": round(t, 1),
        "time_utc": datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        "runway": rwy,
        "uncertainty_s": round(uncertainty),
        "method": method,
    }


def detect(tracks, windows=()):
    """Returns (events, rejected Counter). `windows` = coverage(); needed for the
    inferred 'lost on final' landings (otherwise those are skipped)."""
    events, rejected = [], Counter()
    for icao, samples in tracks.items():
        for seg in segments(samples):
            last_event_t = -1e18
            g = _despike(seg)
            for i in range(1, len(seg)):
                a, b = seg[i - 1], seg[i]
                if g[i - 1] == g[i]:
                    continue
                kind = "landing" if g[i] else "takeoff"
                why = None
                if b.t - a.t > MAX_SAMPLE_GAP_S:
                    why = "gap in data"
                elif a.category == 8 or b.category == 8:
                    why = "helicopter"
                elif not _holds(seg, g, i):
                    why = "flag flickered"
                elif b.t - last_event_t < 10 * 60:
                    why = "duplicate"
                elif kind == "landing":
                    if a.alt_ft is not None and a.alt_ft > 2000:
                        why = "too high before touchdown"
                    elif a.vs_fpm is not None and a.vs_fpm > 500:
                        why = "climbing, not landing"
                    else:
                        trk = _track(seg, i - 1, -1)  # approach heading, from the last airborne samples
                        rwy = match_runway(b.lat, b.lon, trk, before=3.0, after=0.5) \
                            or match_runway(a.lat, a.lon, trk, before=3.0, after=0.5)
                        why = None if rwy else "not at a Logan runway (helipad or other airport)"
                else:
                    later = [s for s in seg[i:] if s.t <= b.t + 120 and s.alt_ft is not None]
                    climbing = (b.vs_fpm is not None and b.vs_fpm > 300) or (
                        len(later) >= 2 and later[-1].alt_ft - later[0].alt_ft > 300)
                    if not climbing:
                        why = "not climbing after liftoff"
                    else:
                        trk = _track(seg, i, +1)  # departure heading, from the first airborne samples
                        rwy = match_runway(a.lat, a.lon, trk, before=0.3, after=2.0) \
                            or match_runway(b.lat, b.lon, trk, before=0.3, after=2.0)
                        why = None if rwy else "not at a Logan runway (helipad or other airport)"
                if why:
                    rejected[f"{kind}: {why}"] += 1
                    continue
                t = _touchdown_time(a, b) if kind == "landing" else (a.t + b.t) / 2
                last_event_t = b.t
                events.append(_event(icao, a, b, kind, t, rwy, (b.t - a.t) / 2, "ground flag"))
            # No ground flag at all, but the track ends on short final: inferred landing.
            if windows and not any(g) and seg[-1].t - last_event_t > 10 * 60 and seg[-1].category != 8:
                hit = _lost_on_final(seg, windows)
                if hit:
                    rwy, t, unc = hit
                    events.append(_event(icao, seg[-1], seg[-1], "landing", t, rwy, unc, "lost on final"))
    events.sort(key=lambda e: e["time"])
    return events, rejected


def coverage(tracks_paths):
    """Time windows the logs actually cover (snapshots no more than 60 s apart)."""
    times = []
    for path in tracks_paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    times.append(json.loads(line)["fetched_at"])
                except (json.JSONDecodeError, KeyError):
                    pass
    times.sort()
    windows, start = [], None
    for prev, cur in zip([None] + times, times):
        if prev is None or cur - prev > 60:
            if start is not None:
                windows.append((start, prev))
            start = cur
    if start is not None:
        windows.append((start, times[-1]))
    return windows


def load_all():
    """Flive's own logs plus any imported adsb.lol history. Returns (tracks, windows, bad_lines)."""
    paths = sorted(glob.glob(str(HERE / "logan_*.jsonl")))
    hist = sorted(glob.glob(str(HERE / "data" / "history" / "*.jsonl.gz")))
    tracks, bad = load_tracks(paths)
    windows = coverage(paths) if paths else []
    if hist:
        tracks = load_history(hist, tracks)
        windows = sorted(windows + history_coverage(hist))
    merged = []  # overlapping windows (logs inside an imported day) -> one
    for w in windows:
        if merged and w[0] <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], w[1]))
        else:
            merged.append(w)
    return tracks, merged, bad, len(paths), len(hist)


def main():
    tracks, windows, bad, n_logs, n_hist = load_all()
    if not tracks:
        sys.exit("No data: run the server for a while, or scripts/import_history.py.")
    events, rejected = detect(tracks, windows)
    hours = sum(e - s for s, e in windows) / 3600

    out = HERE / "data" / "events.csv"
    out.parent.mkdir(exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(events[0].keys()) if events else ["kind"])
        w.writeheader()
        w.writerows(events)

    kinds = Counter(e["kind"] for e in events)
    print(f"{n_logs} log files + {n_hist} imported days, {len(tracks)} aircraft, {hours:.1f} h of coverage"
          f"{f', {bad} unreadable lines' if bad else ''}")
    inferred = sum(1 for e in events if e["method"] == "lost on final")
    print(f"Detected {kinds['landing']} landings ({inferred} inferred: lost from view on short final) "
          f"and {kinds['takeoff']} takeoffs -> {out.relative_to(HERE)}")
    for kind in ("landing", "takeoff"):
        rw = Counter(e["runway"] for e in events if e["kind"] == kind)
        print(f"  {kind}s by runway: " + ", ".join(f"{r} {n}" for r, n in rw.most_common()))
    if rejected:
        print("Rejected transitions:")
        for why, n in rejected.most_common():
            print(f"  {n:4d}  {why}")


if __name__ == "__main__":
    main()
