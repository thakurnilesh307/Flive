# Flive

Live Boston Logan (KBOS) air traffic tracker, built on top of my earlier Python
ATC runway scheduling simulator (Pygame radar view). Portfolio project: will be
deployed publicly with a blog post about how it was built.

## Architecture

```
adsb.lol --(every 5s)--> server.py (FastAPI) --(WebSocket /ws)--> browser map
                           |
                           +-- keeps latest snapshot in memory
                           +-- logs a snapshot every 15s to logan_*.jsonl
OpenSky /flights/arrival + /departure --(nightly)--> ground truth for validation
```

- **One poller, many viewers.** Only the server talks to data providers. The
  browser never calls adsb.lol or OpenSky directly. Keep it this way.
- `adsb_lol.py` - polls adsb.lol (40 nm radius around KBOS, no key) and converts
  to the snapshot format below. Handles 429 with backoff.
- `server.py` - FastAPI app: background poller task, WebSocket broadcast, serves
  `static/index.html`.
- `static/index.html` - Leaflet map, CARTO tiles, rotated plane icons, ATC-style
  data tags (callsign / altitude in hundreds of ft + climb arrow / groundspeed),
  dead reckoning between updates, stale aircraft fade out.
- `poll_logan.py` - old OpenSky state-vector logger. Retired for live data; its
  OAuth2 token code is reusable for the OpenSky flights endpoints.
- `explore.py` - pandas/matplotlib analysis of the JSONL logs.

## Snapshot format (do not change field names without updating all consumers)

```json
{"fetched_at": 1794650000.0, "api_time": 1794650000.0, "aircraft": [
  {"icao24": "a1b2c3", "callsign": "JBU317", "lat": 42.36, "lon": -71.01,
   "baro_alt_m": 1066.8, "on_ground": false, "velocity_ms": 92.6,
   "track_deg": 41.0, "vert_rate_ms": -3.8, "geo_alt_m": 1100.0,
   "squawk": "1234", "time_position": 1794649998.0, "last_contact": 1794649999.5,
   "pos_source": 0, "category": 4, "aircraft_type": "A320", "registration": "N123JB"}
]}
```
Units are SI internally (meters, m/s). Convert to ft/kt/fpm only for display.
`category` uses OpenSky numbering (4 = large, 5 = B757, 6 = heavy).

## Data source rules

- adsb.lol: free, keyless, dynamic rate limits. Poll no faster than every 5s,
  send a descriptive User-Agent, always keep 429 backoff.
- OpenSky: OAuth2 client credentials only (env vars `OPENSKY_CLIENT_ID`,
  `OPENSKY_CLIENT_SECRET`). Use only for `/flights/arrival` and
  `/flights/departure` (previous day only, nightly batch, ~30 credits/query,
  separate budget from /states).
- Never hardcode or print secrets. Load from `.env` (python-dotenv). `.env` and
  `*.jsonl` must stay in `.gitignore`.

## Environment

- Windows, PowerShell, Microsoft Store Python 3.11.
- Use `python -m pip ...` and `python -m uvicorn server:app` (Scripts folder is
  not on PATH). PowerShell env vars: `$env:NAME="value"`, not `export`.
- Project lives in a OneDrive folder: avoid writing large or high-frequency files.

## Roadmap

1. Repo hygiene: git, .gitignore, .env loading, README, push to GitHub.
2. Frontend to React + TypeScript (Vite), polished design: map, sidebar list of
   aircraft sorted by distance, selected-aircraft detail panel, type on tags.
3. "Ask Flive": chat panel backed by a LOCAL LLM (Ollama) with tool calling over
   the live state. Tools return structured data from the server's memory; the
   model must answer only from tool results and say when it doesn't know.
4. Arrival/departure detection: turn snapshots into per-flight objects
   (runway, touchdown/liftoff time) from approach track and on_ground changes.
5. Scheduler: predicted landing sequence vs actual; nightly comparison against
   OpenSky arrivals. This is the model-vs-reality story for the blog post.
6. Deploy (always-on instance, not a sleeping free tier) + README with GIF.

## How I want to work

- Small, working steps. Each step should run end to end before the next.
- Explain what you changed and why in a few sentences; I'm writing a blog post
  about the build, so decisions and tradeoffs matter.
- Don't rewrite working pieces I didn't ask about. Ask before big restructures.
- Treat callsigns and all provider data as untrusted input in the UI.
- Commit after each working step with a clear message.
