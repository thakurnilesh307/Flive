"""Import past Boston traffic from adsb.lol's open daily archives.

    python scripts/import_history.py 7          # the last 7 finished days
    python scripts/import_history.py 2026-11-10 # one specific day

adsb.lol publishes every aircraft trace it recorded each day, worldwide, as a GitHub
release (github.com/adsblol/globe_history_YYYY, Open Database License). A day is
~3.5 GB because it covers the whole planet, so this script streams the archive
straight from GitHub and never stores it: it opens each aircraft's trace, keeps only
the points within 45 nm of Logan, and writes a small file per day:

    data/history/YYYY-MM-DD.jsonl.gz   one line per aircraft that came near Logan

Traces have a position every few seconds (vs 15 s in Flive's own logs), so landing
times from history are more precise. events.py reads these files alongside the logs.
Days that are already imported are skipped, so it's safe to re-run.
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
OUT = ROOT / "data" / "history"
UA = {"User-Agent": "Flive/0.1 (+https://github.com/thakurnilesh307/Flive)"}
KBOS = (42.3656, -71.0096)
RADIUS_NM = 45
# Quick box before the exact distance check (a bit bigger than 45 nm).
LAT_MIN, LAT_MAX = KBOS[0] - 0.8, KBOS[0] + 0.8
LON_MIN, LON_MAX = KBOS[1] - 1.1, KBOS[1] + 1.1
# readsb emitter categories -> OpenSky numbering used everywhere else in Flive.
CATEGORY = {"A1": 2, "A2": 3, "A3": 4, "A4": 5, "A5": 6, "A6": 7, "A7": 8, "B1": 9, "B2": 10}


def dist_nm(lat, lon):
    p1, p2 = math.radians(KBOS[0]), math.radians(lat)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon - KBOS[1]) / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(h))


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


def parse_trace(raw):
    """One aircraft's day -> record with only the Boston-area points, or None."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    d = json.loads(raw)
    t0 = d.get("timestamp")
    trace = d.get("trace") or []
    if not isinstance(t0, (int, float)):
        return None
    points, callsign, category = [], None, None
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
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX) or dist_nm(lat, lon) > RADIUS_NM:
            continue
        alt = p[3]
        ground = alt == "ground"
        num = lambda v: v if isinstance(v, (int, float)) else None  # noqa: E731
        points.append([round(t0 + p[0], 1), round(lat, 5), round(lon, 5),
                       None if ground else num(alt), ground, num(p[4]), num(p[5]), num(p[7]), cs])
    if not points:
        return None
    # The first kept point should carry the callsign even if it was set earlier in the day.
    if points[0][8] is None:
        points[0][8] = callsign
    return {"icao24": str(d.get("icao", "")).lower()[:7], "registration": d.get("r"),
            "aircraft_type": d.get("t"), "category": category, "points": points}


def import_day(day):
    out = OUT / f"{day:%Y-%m-%d}.jsonl.gz"
    if out.exists():
        print(f"{day}: already imported, skipping")
        return
    urls = release_assets(day)
    if not urls:
        print(f"{day}: no adsb.lol release found")
        return
    stream = ChainedDownload(urls)
    started, traces, kept = time.time(), 0, 0
    tmp = out.with_suffix(".tmp")
    OUT.mkdir(parents=True, exist_ok=True)
    with gzip.open(tmp, "wt", encoding="utf-8") as f, \
            tarfile.open(fileobj=io.BufferedReader(stream, 1 << 20), mode="r|") as tar:
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
                rec = parse_trace(raw)
            except (ValueError, OSError):
                continue
            if rec:
                kept += 1
                f.write(json.dumps(rec, separators=(",", ":")) + "\n")
            if traces % 20000 == 0:
                mb = stream.bytes / 1e6
                print(f"  {day}: {traces:,} traces, {kept:,} near Logan, {mb:,.0f} MB, "
                      f"{mb / (time.time() - started):.1f} MB/s", flush=True)
    tmp.replace(out)
    print(f"{day}: {traces:,} aircraft worldwide, {kept:,} came near Logan -> {out.name} "
          f"({out.stat().st_size / 1e6:.1f} MB, {stream.bytes / 1e9:.1f} GB streamed, "
          f"{(time.time() - started) / 60:.0f} min)", flush=True)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "7"
    if arg.isdigit():
        today = datetime.now(timezone.utc).date()
        days = [today - timedelta(days=i) for i in range(int(arg), 0, -1)]
    else:
        days = [date.fromisoformat(arg)]
    for day in days:
        try:
            import_day(day)
        except Exception as e:  # keep going with the other days
            print(f"{day}: failed ({type(e).__name__}: {e}); re-run to retry", flush=True)


if __name__ == "__main__":
    main()
