"""
Poll OpenSky for aircraft around Boston Logan and log every snapshot to JSONL.

Setup:
  python -m pip install requests python-dotenv
  copy .env.example to .env and fill in OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET
  python poll_logan.py

Runs anonymously if no credentials are set (much tighter rate limits).
"""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load .env next to this file (works regardless of the current directory).
# Real environment variables still win over .env values.
load_dotenv(Path(__file__).parent / ".env")

import opensky_auth  # noqa: E402  (token handling shared with the world feed)

# ~35 nm box around KBOS (42.3656, -71.0096)
BBOX = {"lamin": 41.80, "lamax": 42.95, "lomin": -71.80, "lomax": -70.20}
# Box is ~1.8 sq deg = 1 credit/call. Standard tier = 4,000 credits/day,
# so anything under ~22s runs dry before 24h. 30s = ~2,880 calls/day.
POLL_SECONDS = 30
OUTFILE = f"logan_{datetime.now():%Y%m%d_%H%M}.jsonl"

STATES_URL = "https://opensky-network.org/api/states/all"
FIELDS = ["icao24", "callsign", "origin_country", "time_position", "last_contact",
          "lon", "lat", "baro_alt_m", "on_ground", "velocity_ms", "track_deg",
          "vert_rate_ms", "sensors", "geo_alt_m", "squawk", "spi", "pos_source",
          "category"]  # category: 4=Large, 5=757, 6=Heavy, etc. (needs extended=1)

CLIENT_ID = os.getenv("OPENSKY_CLIENT_ID")
get_headers = opensky_auth.auth_headers


def poll_once():
    params = {**BBOX, "extended": 1}
    r = requests.get(STATES_URL, params=params, headers=get_headers(), timeout=15)
    if r.status_code == 401:
        opensky_auth.invalidate()
        r = requests.get(STATES_URL, params=params, headers=get_headers(), timeout=15)
    remaining = r.headers.get("X-Rate-Limit-Remaining")
    if remaining:
        print(f"  credits remaining: {remaining}")
    if r.status_code == 429:
        wait = int(r.headers.get("X-Rate-Limit-Retry-After-Seconds", 60))
        print(f"Rate limited, sleeping {wait}s")
        time.sleep(wait)
        return None
    r.raise_for_status()
    data = r.json()
    aircraft = [dict(zip(FIELDS, s)) for s in (data.get("states") or [])]
    return {"fetched_at": time.time(), "api_time": data.get("time"), "aircraft": aircraft}


def main():
    print(f"Logging to {OUTFILE} every {POLL_SECONDS}s "
          f"({'authenticated' if CLIENT_ID else 'anonymous'}). Ctrl+C to stop.")
    with open(OUTFILE, "a") as f:
        while True:
            try:
                snap = poll_once()
                if snap:
                    f.write(json.dumps(snap) + "\n")
                    f.flush()
                    airborne = sum(1 for a in snap["aircraft"] if not a["on_ground"])
                    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
                    print(f"{stamp}Z  {len(snap['aircraft'])} aircraft ({airborne} airborne)")
            except requests.RequestException as e:
                print(f"Request failed: {e}")
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
