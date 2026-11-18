# Flive

Live air traffic around Boston Logan (KBOS) on a web map, with ATC-style data
tags. It grew out of an earlier Python ATC runway-scheduling simulator; the goal
is to compare a scheduler's predicted landing sequence against what actually
happens at Logan.

> Work in progress. See the roadmap below.

## How it works

```
data provider --(poll)--> server.py (FastAPI) --(WebSocket /ws)--> browser map
                             |
                             +-- keeps the latest snapshot in memory
                             +-- appends each snapshot to logan_*.jsonl
```

One server polls the data provider and broadcasts to every connected browser,
so the number of viewers never affects API usage. Browsers never call the
provider directly.

The server polls [adsb.fi open data](https://github.com/adsbfi/opendata) every
5 s for aircraft within 40 nm of Logan and logs a snapshot every 15 s. adsb.fi,
adsb.lol and similar aggregators share readsb's JSON format, so `adsb_feed.py`
works with any of them by changing `ADSB_URL` (and `ADSB_API_KEY` if needed).

Why adsb.fi: adsb.lol was the original plan, but without a key it allows 500
requests per day, and polling every 5 s needs about 17,000. adsb.fi's public
endpoint allows 1 request per second without a key.

## Run it locally

Requires Python 3.11.

```powershell
python -m pip install -r requirements.txt
copy .env.example .env      # optional: defaults work without any keys
python -m uvicorn server:app
```

Open http://127.0.0.1:8000.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | FastAPI app: 5 s poller with backoff, 15 s logging, WebSocket broadcast |
| `adsb_feed.py` | Fetches readsb-format JSON and converts it to Flive's snapshot format (SI units) |
| `static/index.html` | Live aircraft table sorted by distance (map coming in step 2) |
| `poll_logan.py` | Retired OpenSky poller; its OAuth2 code will be reused for nightly arrival checks |
| `.env.example` | Template for local secrets (`.env` is gitignored) |

## Roadmap

1. Repo hygiene
2. React + TypeScript frontend: aircraft list, detail panel
3. "Ask Flive": chat over the live state using a local LLM with tool calling
4. Arrival/departure detection per flight (runway, touchdown/liftoff time)
5. Scheduler: predicted landing sequence vs. actual, checked nightly against OpenSky arrivals
6. Always-on deployment

## Data

Live positions: [adsb.fi](https://adsb.fi) open data, a community network of
volunteer ADS-B receivers.
