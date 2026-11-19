"""Import past traffic around Flive's airports from adsb.lol's open daily archives.

    python scripts/import_history.py 7               # the last 7 finished days, all airports
    python scripts/import_history.py 2026-11-10      # one specific day
    python scripts/import_history.py 7 KJFK EGLL     # only some airports

adsb.lol publishes every aircraft trace it recorded each day, worldwide, as a GitHub
release (github.com/adsblol/globe_history_YYYY, Open Database License). A day is
~3.5 GB because it covers the whole planet, so this script streams the archive
straight from GitHub and never stores it: it opens each aircraft's trace, keeps only
the points within 45 nm of each airport in airport_geo.CONFIG (one download serves
all of them), and writes a small file per airport per day:

    data/history/KBOS/YYYY-MM-DD.jsonl.gz   one line per aircraft that came near Logan

Traces have a position every few seconds (vs 15 s in Flive's own logs), so landing
times from history are more precise. events.py reads these files alongside the logs.
Airports already imported for a day are skipped, so it's safe to re-run.
"""
import gzip
import io
import json
import math
import sys
import tarfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from airport_geo import CONFIG  # noqa: E402

OUT = ROOT / "data" / "history"
UA = {"User-Agent": "Flive/0.1 (+https://github.com/thakurnilesh307/Flive)"}
RADIUS_NM = 45
# readsb emitter categories -> OpenSky numbering used everywhere else in Flive.
CATEGORY = {"A1": 2, "A2": 3, "A3": 4, "A4": 5, "A5": 6, "A6": 7, "A7": 8, "B1": 9, "B2": 10}


class Area:
    """45 nm around one airport, with a quick lat/lon box checked before the exact distance."""

    def __init__(self, icao):
        self.icao, (_, self.lat, self.lon, _, _) = icao, CONFIG[icao]
        dlat = RADIUS_NM / 60 * 1.05
        dlon = dlat / math.cos(math.radians(self.lat))
        self.box = (self.lat - dlat, self.lat + dlat, self.lon - dlon, self.lon + dlon)

    def contains(self, lat, lon):
        a, b, c, d = self.box
        if not (a <= lat <= b and c <= lon <= d):
            return False
        p1, p2 = math.radians(self.lat), math.radians(lat)
        h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon - self.lon) / 2) ** 2
        return 2 * 3440.065 * math.asin(math.sqrt(h)) <= RADIUS_NM


class ChainedDownload(io.RawIOBase):
    """One readable stream over several HTTP downloads (the archive is split
    into .tar.aa, .tar.ab, ...), so tarfile can read it as a single tar."""

    def __init__(self, urls):
        self.urls, self.resp, self.bytes = list(urls), None, 0

    def readable(self):
        return True

    def readinto(self, buf):
        while True:
            if self.resp is None:
                if not self.urls:
                    return 0
                self.resp = requests.get(self.urls.pop(0), headers=UA, stream=True, timeout=60)
                self.resp.raise_for_status()
            n = self.resp.raw.readinto(buf)
            if n:
                self.bytes += n
                return n
            self.resp.close()
            self.resp = None


def release_assets(day):
    tag = f"v{day:%Y.%m.%d}-planes-readsb-prod-0"
    r = requests.get(f"https://api.github.com/repos/adsblol/globe_history_{day.year}/releases/tags/{tag}",
                     headers=UA, timeout=30)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    assets = sorted(r.json()["assets"], key=lambda a: a["name"])
    return [a["browser_download_url"] for a in assets if ".tar" in a["name"]]


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def parse_trace(raw, areas):
    """One aircraft's day -> {icao: record with only the points near that airport}."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    d = json.loads(raw)
    t0 = d.get("timestamp")
    trace = d.get("trace") or []
    if not isinstance(t0, (int, float)):
        return {}
    points = {a.icao: [] for a in areas}
    callsign, category = None, None
    for p in trace:
        if not isinstance(p, list) or len(p) < 8:
            continue
        ac = p[8] if len(p) > 8 and isinstance(p[8], dict) else None
        cs = None
        if ac:
            flight = (ac.get("flight") or "").strip()
            if flight and flight != callsign:
                callsign = cs = flight[:8]
            category = CATEGORY.get(ac.get("category"), category)
        lat, lon = p[1], p[2]
        if not (isinstance(lat, (int, float)) and isinstance(lon, (int, float))):
            continue
        inside = [a for a in areas if a.contains(lat, lon)]
        if not inside:
            continue
        alt = p[3]
        ground = alt == "ground"
        for a in inside:
            pts = points[a.icao]
            # The first kept point carries the callsign even if it was set earlier in the day.
            pts.append([round(t0 + p[0], 1), round(lat, 5), round(lon, 5), None if ground else _num(alt),
                        ground, _num(p[4]), _num(p[5]), _num(p[7]), cs if pts else (cs or callsign)])
    base = {"icao24": str(d.get("icao", "")).lower()[:7], "registration": d.get("r"),
            "aircraft_type": d.get("t"), "category": category}
    return {k: {**base, "points": v} for k, v in points.items() if v}


def import_day(day, icaos):
    outs = {i: OUT / i / f"{day:%Y-%m-%d}.jsonl.gz" for i in icaos}
    todo = [i for i, p in outs.items() if not p.exists()]
    if not todo:
        print(f"{day}: already imported for {', '.join(icaos)}, skipping")
        return
    urls = release_assets(day)
    if not urls:
        print(f"{day}: no adsb.lol release found")
        return
    areas = [Area(i) for i in todo]
    stream = ChainedDownload(urls)
    started, traces = time.time(), 0
    kept = dict.fromkeys(todo, 0)
    files = {}
    for i in todo:
        outs[i].parent.mkdir(parents=True, exist_ok=True)
        files[i] = gzip.open(outs[i].with_suffix(".tmp"), "wt", encoding="utf-8")
    try:
        with tarfile.open(fileobj=io.BufferedReader(stream, 1 << 20), mode="r|") as tar:
            for m in tar:
                if not (m.isfile() and "/traces/" in m.name):
                    continue
                traces += 1
                try:
                    raw = tar.extractfile(m).read()
                    if traces == 1:  # show the format once, so a change upstream is obvious
                        d = json.loads(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
                        print(f"  first trace {m.name}: keys {sorted(d)}, first point {(d.get('trace') or [None])[0]}",
                              flush=True)
                    recs = parse_trace(raw, areas)
                except (ValueError, OSError):
                    continue
                for i, rec in recs.items():
                    kept[i] += 1
                    files[i].write(json.dumps(rec, separators=(",", ":")) + "\n")
                if traces % 20000 == 0:
                    mb = stream.bytes / 1e6
                    near = ", ".join(f"{n:,} near {i}" for i, n in kept.items())
                    print(f"  {day}: {traces:,} traces, {near}, {mb:,.0f} MB, "
                          f"{mb / (time.time() - started):.1f} MB/s", flush=True)
    finally:
        for f in files.values():
            f.close()
    for i in todo:
        outs[i].with_suffix(".tmp").replace(outs[i])
        print(f"{day}: {kept[i]:,} aircraft came near {i} -> {i}/{outs[i].name} "
              f"({outs[i].stat().st_size / 1e6:.1f} MB)", flush=True)
    print(f"{day}: {traces:,} aircraft worldwide, {stream.bytes / 1e9:.1f} GB streamed, "
          f"{(time.time() - started) / 60:.0f} min", flush=True)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "7"
    icaos = [a.upper() for a in sys.argv[2:]] or list(CONFIG)
    unknown = [a for a in icaos if a not in CONFIG]
    if unknown:
        sys.exit(f"Not configured in airport_geo.CONFIG: {', '.join(unknown)}")
    if arg.isdigit():
        today = datetime.now(timezone.utc).date()
        days = [today - timedelta(days=i) for i in range(int(arg), 0, -1)]
    else:
        days = [date.fromisoformat(arg)]
    for day in days:
        try:
            import_day(day, icaos)
        except Exception as e:  # keep going with the other days
            print(f"{day}: failed ({type(e).__name__}: {e}); re-run to retry", flush=True)


if __name__ == "__main__":
    main()
