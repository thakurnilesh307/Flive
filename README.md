# Flive

Live air traffic around Boston Logan (KBOS) on a dark web map, with a live
arrivals/departures list and per-aircraft details. It grew out of an earlier Python ATC runway-scheduling simulator; the goal
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

Requires Python 3.11 and Node 20+.

```powershell
python -m pip install -r requirements.txt
copy .env.example .env      # optional: defaults work without any keys
cd frontend; npm install; npm run build; cd ..
python -m uvicorn server:app
```

Open http://127.0.0.1:8000. FastAPI serves the built React app from
`frontend/dist`.

For frontend work with hot reload, keep the server running and in a second
terminal run `cd frontend; npm run dev`, then open http://localhost:5173 (Vite
forwards `/ws` to the server).

## Frontend

React + TypeScript (Vite) with Leaflet for markers and a MapLibre vector
basemap from [OpenFreeMap](https://openfreemap.org) (free, no API key),
recolored to navy in `frontend/src/basemap.ts`.

- Aircraft icons rotate with track and glide between 5 s updates (dead
  reckoning from speed and track, capped at 20 s); stale aircraft fade.
- Selecting an aircraft shows a detail panel and a dashed trail of its
  recent positions (kept in the browser since page load).
- "Inbound", "On approach" and "Departing" are **estimates** from distance,
  track and vertical rate (`frontend/src/status.ts`). Real arrival/departure
  detection is roadmap step 4; predicted runway/ETA is step 5.
- All provider text is rendered as text (React escaping, `textContent` in
  Leaflet tooltips), and the server already strips callsigns to `[A-Z0-9-]`.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | FastAPI app: 5 s poller with backoff, 15 s logging, WebSocket broadcast |
| `adsb_feed.py` | Fetches readsb-format JSON and converts it to Flive's snapshot format (SI units) |
| `frontend/` | React + TypeScript UI (map, stats, search, detail panel, flight list) |
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
volunteer ADS-B receivers. Map: [OpenFreeMap](https://openfreemap.org),
© [OpenMapTiles](https://www.openmaptiles.org/),
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
