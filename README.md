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

Currently the server polls the OpenSky `/states/all` endpoint every 30 s
(via `poll_logan.py`). Switching live data to adsb.lol is planned.

## Run it locally

Requires Python 3.11.

```powershell
python -m pip install -r requirements.txt
copy .env.example .env      # then fill in your OpenSky API client, optional
python -m uvicorn server:app
```

Open http://127.0.0.1:8000.

Without OpenSky credentials the poller runs anonymously with much tighter rate
limits. Don't run `poll_logan.py` and the server at the same time; both poll
and log, which doubles credit usage.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | FastAPI app: background poller, WebSocket broadcast, serves the map |
| `poll_logan.py` | OpenSky poller (OAuth2 client credentials); also runs standalone as a logger |
| `static/index.html` | Leaflet map with rotated aircraft icons and data tags |
| `.env.example` | Template for local secrets (`.env` is gitignored) |

## Roadmap

1. Repo hygiene
2. React + TypeScript frontend: aircraft list, detail panel
3. "Ask Flive": chat over the live state using a local LLM with tool calling
4. Arrival/departure detection per flight (runway, touchdown/liftoff time)
5. Scheduler: predicted landing sequence vs. actual, checked nightly against OpenSky arrivals
6. Always-on deployment
