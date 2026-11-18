"""Aircraft photos from Planespotters.net's public photo API, looked up by icao24.

Only the server calls the API (cached for a day, at most one upstream request per
second). The browser then shows the thumbnail straight from Planespotters' image
host, with the photographer credit and a link back to the photo page, as their
terms ask (https://www.planespotters.net/photo/api). Images are never stored here.
"""
import re
import threading
import time

import requests

API = "https://api.planespotters.net/pub/photos/hex/{}"
# Planespotters requires a contact URL in the User-Agent.
UA = "Flive/0.1 (Boston Logan live tracker; +https://github.com/thakurnilesh307/Flive)"
TTL_S = 24 * 3600
MIN_GAP_S = 1.0
_HEX = re.compile(r"^[0-9a-f]{6}$")
_NAME = re.compile(r"[^\w .,'&()/-]")

_session = requests.Session()
_session.headers["User-Agent"] = UA
_lock = threading.Lock()
_last_call = 0.0
_cache: dict[str, tuple[float, dict | None]] = {}


def _clean(p):
    """Keep only what the page needs, and only from Planespotters' own hosts."""
    thumb = p.get("thumbnail_large") or p.get("thumbnail") or {}
    src, link = thumb.get("src"), p.get("link")
    size = thumb.get("size") or {}
    if not (isinstance(src, str) and src.startswith("https://t.plnspttrs.net/")):
        return None
    if not (isinstance(link, str) and link.startswith("https://www.planespotters.net/")):
        return None
    return {
        "src": src,
        "width": size.get("width") if isinstance(size.get("width"), int) else None,
        "height": size.get("height") if isinstance(size.get("height"), int) else None,
        "link": link,
        "photographer": _NAME.sub("", str(p.get("photographer") or ""))[:60] or "Unknown",
    }


def photo_for(icao):
    """Photo info dict, or None if there's no photo (or the lookup failed)."""
    global _last_call
    if not _HEX.match(icao):
        return None
    hit = _cache.get(icao)
    if hit and time.time() - hit[0] < TTL_S:
        return hit[1]
    with _lock:  # serialise upstream calls and keep them >= 1 s apart
        hit = _cache.get(icao)
        if hit and time.time() - hit[0] < TTL_S:
            return hit[1]
        wait = MIN_GAP_S - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        try:
            r = _session.get(API.format(icao), timeout=8)
            r.raise_for_status()
            photos = r.json().get("photos") or []
            result = _clean(photos[0]) if photos and isinstance(photos[0], dict) else None
        except Exception as e:
            print(f"Photo lookup failed for {icao}: {e}")
            return None  # don't cache failures
        if len(_cache) > 5000:
            _cache.clear()
        _cache[icao] = (time.time(), result)
        return result
