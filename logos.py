"""Airline logos by ICAO code (DLH, UPS, ...), for the detail badge and flight list.

Source: github.com/Jxck-S/airline-logos (square logos scraped from FlightAware and
RadarBox; no licence, offered for identifying airlines in flight trackers). The
server fetches each logo once, keeps it in data/logos/ (gitignored) and serves it
from there, so visitors never call GitHub and each logo is downloaded only once.
"""
import re
import threading
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
CACHE = HERE / "data" / "logos"
SOURCES = [
    "https://raw.githubusercontent.com/Jxck-S/airline-logos/main/flightaware_logos/{}.png",
    "https://raw.githubusercontent.com/Jxck-S/airline-logos/main/radarbox_logos/{}.png",
]
UA = {"User-Agent": "Flive/0.1 (+https://github.com/thakurnilesh307/Flive)"}
MAX_BYTES = 200_000
MISS_RETRY_S = 7 * 24 * 3600   # re-check airlines with no logo once a week
_CODE = re.compile(r"^[A-Z]{3}$")
_lock = threading.Lock()


def logo_png(code):
    """PNG bytes for an airline's logo, or None if there isn't one."""
    if not _CODE.match(code):
        return None
    path, miss = CACHE / f"{code}.png", CACHE / f"{code}.none"
    if path.exists():
        return path.read_bytes()
    if miss.exists() and time.time() - miss.stat().st_mtime < MISS_RETRY_S:
        return None
    with _lock:  # one upstream download at a time
        if path.exists():
            return path.read_bytes()
        CACHE.mkdir(parents=True, exist_ok=True)
        for url in SOURCES:
            try:
                r = requests.get(url.format(code), headers=UA, timeout=8)
            except requests.RequestException as e:
                print(f"Logo fetch failed for {code}: {e}")
                return None  # network trouble: don't record a miss
            data = r.content
            if r.status_code == 200 and data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) <= MAX_BYTES:
                path.write_bytes(data)
                miss.unlink(missing_ok=True)
                return data
        miss.touch()
        return None
