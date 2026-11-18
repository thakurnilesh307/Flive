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

For Ask Flive, install [Ollama](https://ollama.com), then `ollama pull qwen3:8b`
(or set `OLLAMA_MODEL` in `.env` to another model with tool calling). Without
it, everything else works and the chat panel shows "offline".

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
- `/about.html` is the project's explainer: plain-language sections with
  collapsible "For developers" detail, for both general readers and engineers.

## Worldwide (in progress)

Boston stays on the fast 5 s adsb.fi feed. A second, slower feed pulls every
aircraft on Earth from OpenSky's `/states/all` (`world_feed.py`): about 5,000–
15,000 aircraft and ~0.7 MB per call. Each global call costs 4 OpenSky credits, so
the interval follows the daily budget: every ~90 s with a free OpenSky account,
every 15 minutes anonymously. World snapshots stay in memory, in a grid index
for fast map-view queries, and are never logged.

Each browser only gets the aircraft in its map view: the page sends its map
bounds over the WebSocket (`{"type":"view","bbox":[...]}`) and the server
replies with compact rows (arrays plus a field list, ~4x smaller than objects)
for that area, capped at 2,000 and thinned evenly when zoomed out. A whole-world
view is ~160 KB per update instead of the full ~700 KB, and a region is a few
KB. Pages that never send a view keep getting only the Boston feed.

For now the UI shows a "Worldwide in view" count. Next: move aircraft rendering
to MapLibre (GPU) so thousands of planes stay smooth. Debug endpoints:
`GET /api/world/stats`, `GET /api/world?bbox=west,south,east,north`.

## Ask Flive

A chat panel that answers questions about live traffic using a local LLM
(Ollama) with tool calling. The model can't answer from memory: it calls one of
four tools (`traffic_summary`, `list_aircraft`, `get_aircraft`,
`landing_sequence`) that read the server's in-memory snapshot, then writes its
reply from those results and says when Flive doesn't have the data.

- `ask.py`: tools, system prompt, tool-calling loop (max 4 rounds), Ollama backend
- `traffic.py`: status/distance/airline derivation (mirrors `frontend/src/status.ts`)
- `POST /api/ask` (max 300 chars; 5/min and 40/hour per IP; one model call at
  a time), `GET /api/ask/status`
- Answers render as plain text and list which tools were used.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | FastAPI app: 5 s poller with backoff, 15 s logging, WebSocket broadcast |
| `adsb_feed.py` | Fetches readsb-format JSON and converts it to Flive's snapshot format (SI units) |
| `frontend/` | React + TypeScript UI: live map (`index.html`) and About page (`about.html`) |
| `ask.py` | Ask Flive: LLM tool-calling loop and tools over the live snapshot |
| `traffic.py` | Derived facts per aircraft (distance, estimated status, airline) |
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
