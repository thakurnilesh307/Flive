"""
OpenSky OAuth2 (client credentials), shared by every OpenSky consumer:
the world feed now, the nightly arrivals/departures check later.

Credentials come from OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET (.env).
Without them, callers get no auth header and OpenSky treats them as anonymous
(400 credits/day instead of 4,000). Secrets are never printed.
"""
import os
import threading
import time

import requests

TOKEN_URL = ("https://auth.opensky-network.org/auth/realms/opensky-network"
             "/protocol/openid-connect/token")

_lock = threading.Lock()
_token, _token_expiry = None, 0.0


def has_credentials():
    return bool(os.getenv("OPENSKY_CLIENT_ID") and os.getenv("OPENSKY_CLIENT_SECRET"))


def auth_headers():
    """Authorization header with a fresh token, or {} when running anonymously."""
    global _token, _token_expiry
    if not has_credentials():
        return {}
    with _lock:
        if time.time() > _token_expiry - 60:
            r = requests.post(TOKEN_URL, data={
                "grant_type": "client_credentials",
                "client_id": os.getenv("OPENSKY_CLIENT_ID"),
                "client_secret": os.getenv("OPENSKY_CLIENT_SECRET"),
            }, timeout=10)
            r.raise_for_status()
            body = r.json()
            _token = body["access_token"]
            _token_expiry = time.time() + body.get("expires_in", 1800)
        return {"Authorization": f"Bearer {_token}"}


def invalidate():
    """Force a new token on the next call (e.g. after a 401)."""
    global _token_expiry
    with _lock:
        _token_expiry = 0.0
