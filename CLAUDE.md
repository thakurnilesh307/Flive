# Flive

Live Boston Logan (KBOS) air traffic tracker. The end goal: compare real arrivals
with an optimized landing sequence (a runway scheduler; an idea, not built yet, so
no earlier simulator exists). Portfolio project: will be
deployed publicly with a blog post about how it was built.

## Architecture

```
adsb.fi --(every 5s, 40 nm)--> server.py (FastAPI) --(WebSocket /ws)--> browser
                                  |
                                  +-- keeps latest snapshot in memory
                                  +-- logs a snapshot every 15s to logan_*.jsonl
OpenSky /states/all --(world, 90s auth / 900s anon)--> WorldStore (memory only, never logged)
OpenSky /flights/arrival + /departure --(nightly)--> ground truth for validation
```

- **One poller, many viewers.** Only the server talks to data providers. The
  browser never calls adsb.fi or OpenSky directly. Keep it this way.
- `adsb_feed.py` - polls a readsb-format API (adsb.fi by default, 40 nm radius
  around KBOS, no key), sanitizes and converts to the snapshot format below.
  Raises `RateLimited` on 429. Provider is set by `ADSB_URL` / `ADSB_API_KEY`.
- `server.py` - FastAPI app: background poller task (5s poll, 15s log,
  exponential backoff on 429 and errors), WebSocket broadcast, serves the
  built frontend from `frontend/dist` (mounted last so `/ws` wins).
- `frontend/` - React + TypeScript (Vite) + MapLibre GL only (Leaflet removed).
  OpenFreeMap styles (`dark` recolored navy in `src/basemap.ts`, `positron` for
  light mode; CARTO needs a key),
  globe projection when zoomed out. Aircraft are GPU symbol layers
  (`local-planes` = Boston, redrawn ~30 fps; `world-planes` = world, 4 fps,
  glide capped at 120 s; one requestAnimationFrame loop, and fresh reports
  blend in over 1.2 s / 2.5 s via `makeSmoother` instead of snapping). Selecting
  a plane flies in and follows it (jumpTo every frame on the drawn position,
  padded around the detail panel/table; dragstart stops it; a selected world
  plane is drawn in the local source so it moves at frame rate) using one SDF plane image recolored by
  feature props (sel/ground/dim/stale). MapLibre 6 needs `setWorkerUrl` with
  the worker imported via `?url`. `.app .map` selector beats MapLibre's own
  `position: relative`. `zoom` must be the top-level input of size
  expressions. MapLibre uses 512 px tiles (matters for bounds maths).
  Status (inbound/approach/departing) in `src/status.ts` is a heuristic
  placeholder until step 4; worldwide planes use `deriveWorld` (climbing/
  descending/cruising). The flight list follows the map view ("In view",
  nearest to centre, positions via `src/airports.ts` + `GET /api/airports?v=2`,
  bump v if the row format changes: it's cached a day); Logan tabs/stats only
  when the map is within 80 nm of KBOS at zoom >= 7. Search also finds
  airports and flies there; the top-bar pill is the airport under the map. Never put provider text into HTML strings (hover
  tips use Popup.setText; KBOS marker is static markup). Brand: hexagon logo in
  `src/components/icons.tsx` + `public/favicon.svg`. Themes: dark (default,
  OpenFreeMap `dark` recoloured navy) and light (`positron`), toggle in the top
  bar, `src/theme.ts` (system default, choice in localStorage), CSS overrides
  under `[data-theme="light"]`. Switching calls setStyle; MapView's
  `style.load` handler re-adds the plane image, sources and layers each time.
- `ask.py` - Ask Flive (step 3), OFF by default: server.ASK_ENABLED from env
  ASK_FLIVE=on; off -> button hidden (App reads /api/ask/status `enabled`),
  /api/ask 404. Kept as an experiment, not core. Ollama backend behind `chat(messages, tools)`,
  7 tools taking a `Ctx` (Boston snapshot + derived rows + WorldStore): Boston
  (traffic_summary, list_aircraft, landing_sequence), world (aircraft_near with
  airline filter, find_airport, world_summary), get_aircraft (Boston then
  world). Named-flight prefetch and no-tool nudge stay; max 4 tool rounds. `server.py` exposes `POST /api/ask` (5/min, 40/hour per IP, one model
  call at a time) and `GET /api/ask/status`. Answers render as plain text.
- `traffic.py` - server-side status/distance/airline; MUST stay in sync with
  `frontend/src/status.ts` (Logan rules) until step 4 replaces both. Operator
  names come from `aircraft_db.enrich` (`operator`, `operator_icao`); the
  `airlines.ts` table is only a fallback.
- `weather.py` - all METARs (aviationweather.gov bulk cache, every 10 min);
  `apply()` adds `alt_qnh_m` (nearest station within 100 nm, below 18,000 ft)
  to both feeds. `baro_alt_m` stays raw everywhere (logs, protocol).
- `frontend/about.html` + `src/about/` - public explainer page. Each section is
  plain English first, then a collapsible "For developers" block. Update it
  whenever behavior it describes changes (data source, statuses, AI, roadmap).
- `world_feed.py` - WORLDWIDE (done, steps 1-5). OpenSky global states every
  `poll_interval()` (4 credits/call: 90 s with an account, 900 s anonymous),
  converted to the same snapshot field names (no type/registration), held in
  `WorldStore` with a 5-degree grid index. `query(bbox, limit)` handles the
  antimeridian and thins evenly across cells when over the limit. Boston stays
  on the 5 s adsb.fi feed for statuses, Ask Flive, logs and predictions.
  Endpoints: `GET /api/world/stats`, `GET /api/world?bbox=w,s,e,n&limit=`.
  /ws protocol: Boston snapshots unchanged (no "type" field). A page may send
  `{"type":"view","bbox":[w,s,e,n]}` (unwrapped, east >= west); it then gets
  `{"type":"world", fields, aircraft:[[...]], total_in_view, next_update_s}`
  immediately and after every world refresh: compact rows from a 25%-padded
  box, capped at 2000, Boston-feed aircraft removed, count from the visible box.
  Pages that never send a view never get world data.
  Plan: (1) feed + store [done], (2) viewport subscription on /ws with compact
  format [done], (3) MapLibre-native aircraft layers replacing Leaflet [done;
  view messages may carry `keep: [icao24]` so the selected plane survives
  thinning], (4) Ask Flive region tools via OurAirports [done],
  (5) About/README "scaling to the world" section [done; keep its numbers
  current if feeds, caps or intervals change].
- `airports.py` + `data/airports.csv` - OurAirports (public domain) airports
  with scheduled service (3,265), built by `scripts/build_airports.py`:
  `find()` by code/name/city, `nearest()`, `describe_position()`.
- `aircraft_db.py` - icao24 -> type/registration/description from
  `data/aircraft.sqlite` (tar1090-db, built by `scripts/build_aircraft_db.py`,
  gitignored, not redistributed) and operator from callsign via
  `data/airlines.csv` (OpenFlights, committed). `enrich()` runs on BOTH feeds
  before broadcast and adds `operator` + `type_desc`. Never store/show the DB
  owner field (individuals' names). PIA/LADD aircraft: type only, no reg/photo.
- `photos.py` - Planespotters photo lookup (server only, 1 req/s, 1-day cache,
  User-Agent must carry the repo URL). `logos.py` - airline logos from
  Jxck-S/airline-logos cached in `data/logos/` (gitignored). Endpoints:
  `GET /api/aircraft/{icao24}` (type_desc + photo, 30/min per IP),
  `GET /api/logo/{ICAO}`. World compact rows also carry aircraft_type,
  registration, operator.
- `opensky_auth.py` - shared OpenSky OAuth2 token handling (thread-safe).
- `poll_logan.py` - old OpenSky state-vector logger. Retired for live data; its
  OAuth2 token code is reusable for the OpenSky flights endpoints.
- `airport_geo.py` - the PREDICTION AIRPORTS (`CONFIG`: KBOS "Logan", KJFK
  "JFK", EGLL "Heathrow"; name, ref point, time zone, live log prefix) with
  runway ends from `data/runways.csv` (OurAirports, committed, built by
  `scripts/build_runways.py`), field elevation, `xy`/`dist_nm`/`bearing`,
  `match_runway`. Every offline/ML script takes the ICAO as argv[1] (default
  KBOS); nothing else may hardcode Logan geometry. Adding an airport = CONFIG
  entry, build_runways, import history, dataset + train_eta + train_runway.
- Other prediction airports live: `server.airport_poller` polls adsb.fi around
  each (40 nm, every 10 s, staggered; `adsb_feed._throttle` keeps ALL adsb.fi
  requests >= 1.2 s apart), runs its own `eta.LivePredictor(icao)`, logs to
  `{prefix}_*.jsonl` (kjfk_, egll_) and only starts when that airport has a
  model. `PREDICT_AIRPORTS` env picks which. /ws: pages whose padded view
  overlaps an airport's area get `{"type":"airport", icao, name, lat, lon,
  ...snapshot}` (full aircraft dicts with predictions) immediately and every
  10 s; those aircraft are removed from that page's world rows. The frontend
  tags them `airport: icao`, derives statuses relative to that airport, and
  shows "<name> arrivals/departures" tabs when the map centre is within 80 nm
  (zoom >= 7). Non-Logan arrivals lists use model predictions only (the
  inbound heuristic catches LGA/EWR/Gatwick traffic).
- `eta.landing_elsewhere()` gates live arrivals at every detailed airport
  (lined up for / low near another airport, low and not lined up here): keeps
  LGW/LCY/LGA/EWR traffic out of Heathrow/JFK predictions.
- `global_model.py` - rough tier for the world feed: one landing-time model on
  airport-relative features from a single position (no runway in use), trained
  on every airport inside the history areas (neighbours detected too), scored
  leave-one-AREA-out; destination = simple rule `guess_destination` unless the
  classifier beats it on unseen areas (bundle `dest` None = rule). Server runs
  `GlobalPredictor` after each world poll; world compact rows carry
  landing_at/lo/hi, landing_airport, landing_runway (lined-up rule); page shows
  them as "rough estimate". Bundle `data/models/GLOBAL_eta.joblib`.
  `data/runways.csv` covers every airport in airports.csv (+ CONFIG).
- `scripts/overnight.sh START END` - unattended: import days, retrain all,
  validate, score; log in `data/overnight.log`.
- `score_predictions.py ICAO` - scores the predictions the live server logged
  (one per plane per 30 s) against landings `events.detect` finds in the same
  logs: error by minutes out, range coverage, runway, missed landings, false
  arrivals by kind -> `data/scores/ICAO.json` (gitignored). First run: timing
  0.8-1.1 min, but 26-59% of predictions were for planes that never landed here
  (neighbouring airports, GA, overflights): `is_arrival` is the weak point.
- `arrival_model.py ICAO` - "is it landing here?" classifier (every plane within 40
  nm / below 18k ft AGL, per minute, label = landed here within 1 h; `candidate()`
  and `features()` shared with live). -> data/models/ICAO_arrival.joblib, used by
  eta.py (falls back to is_arrival + landing_elsewhere without it). 20 days: 99%
  precision, 90/95/96% recall at KBOS/KJFK/EGLL vs rule 46-76% precision.
- `time_lost.py ICAO` - EUROCONTROL-style additional time in the 40 nm ring:
  transit minus 20th pct of (entry sector, runway, size class); runs events.detect
  over all history. -> data/time_lost/ICAO.csv/json (gitignored). 20 days: mean
  2.7 / 2.2 / 4.5 min KBOS/KJFK/EGLL; rises with landings per hour; EGLL 35%
  holding. Step 1 of the scheduler story (FCFS vs real vs optimized next).
- `transfer.py [eta] [arrival]` - "transfer controller": generic features (no
  bearing/track/cfg_*/alt_ft) trained on the other airports + first k days of the
  target vs local expert on first k days; test = target's last 10 days. Caches
  data/models/ICAO_arrival_dataset.csv.gz; -> TRANSFER_report.json. Result: ETA
  transfers (beats local experts at 1-7 days); arrival classification doesn't
  (JFK day 0: 65% precision; local 3 days: 98%). Next: settling-in hybrid.
- `events.py` - step 4 (done, offline): logs -> landing/takeoff events with
  runway (`data/events_ICAO.csv`, gitignored). Despike ground flags (airborne blips
  first), confirm 60 s, runway by heading <= 25 deg AND <= 0.35 nm from the
  extended centreline (RUNWAYS_RAW from OurAirports), "lost on final" inferred
  landings for aircraft with no ground flag. `scripts/validate_events.py` scores
  it against OpenSky /flights/arrival (one UTC day per request max: a query may
  touch at most 2 day partitions). Last check (Nov 1-18): KBOS 96% / KJFK 97% /
  EGLL 97% recall, 100% precision.
- `scripts/import_history.py` - past days from adsb.lol globe_history releases
  (ODbL, ~3.5 GB/day worldwide, split .tar.aa/.ab): streamed, never stored,
  keeps points within 45 nm of each prediction airport in one pass ->
  `data/history/ICAO/YYYY-MM-DD.jsonl.gz` (gitignored); per-airport skip if done. Trace point: [dt, lat, lon, alt_ft|"ground", gs, track, flags,
  vrate, ac{flight,category}, ...]. `events.load_all()` merges logs + history.
  History altitudes are raw pressure altitude (no historical QNH yet).
- `dataset.py` / `train_eta.py` / `eta.py` - step 5 landing-time model.
  `feature_row()` is THE feature function for training and live (never fork
  it). Raw pressure altitude everywhere for the model (history has no QNH).
  Model bundles per airport in `data/models/ICAO_eta.joblib` (gitignored): model + 10/90 quantile
  models + `range_widen` calibrated on held-out days. Live: arrivals only
  (`is_arrival`: not climbing, not on ground in last 5 min, not helicopters),
  adds `landing_at`, `landing_lo_at`, `landing_hi_at` (unix s) to Boston
  snapshot aircraft and `runway_in_use` to the snapshot; logged. `GET
  /api/eta/status`. Retrain after importing more history. Last (20 days,
  leave-one-day-out): KBOS 1.19 min vs 5.51 straight line, KJFK 0.98 vs 5.83,
  EGLL 1.22 vs 6.59. Global leave-one-area-out 1.31 pooled; destination = rule.
- `train_runway.py` - per-flight runway classifiers (arrival: landing runway;
  departure: takeoff runway while taxiing), features from
  `dataset.arrival_runway_features` / `departure_runway_features` (shared with
  live), `restrict_to_active` = only runways used in the last 30 min (training
  eval and live). Bundle `data/models/ICAO_runway.joblib`. Runway feature
  columns exist for every runway end at the airport; constant ones are dropped
  at training and live selects the bundle's feature list. Live fields:
  `landing_runway(_p)`, `takeoff_runway(_p)`; taxiing = `dataset.taxiing()` and
  not landed in the last 20 min. Last (KBOS, 20 days): 95.6% / 95.0% vs 92.7% / 92.4% baseline.
- `explore.py` - (planned) pandas/matplotlib analysis of the JSONL logs.

## Snapshot format (do not change field names without updating all consumers)

```json
{"fetched_at": 1794650000.0, "api_time": 1794650000.0, "aircraft": [
  {"icao24": "a1b2c3", "callsign": "JBU317", "lat": 42.36, "lon": -71.01,
   "baro_alt_m": 1066.8, "on_ground": false, "velocity_ms": 92.6,
   "track_deg": 41.0, "vert_rate_ms": -3.8, "geo_alt_m": 1100.0,
   "squawk": "1234", "time_position": 1794649998.0, "last_contact": 1794649999.5,
   "pos_source": 0, "category": 4, "aircraft_type": "A320", "registration": "N123JB",
   "type_desc": "Airbus A320-232", "operator": "JetBlue", "operator_icao": "JBU",
   "alt_qnh_m": 1205.0}
]}
```
`type_desc`, `operator`, `operator_icao` are added by `aircraft_db.enrich()` and
`alt_qnh_m` by `weather.apply()` (all may be null).
Units are SI internally (meters, m/s). Convert to ft/kt/fpm only for display.
`category` uses OpenSky numbering (4 = large, 5 = B757, 6 = heavy).

## Data source rules

- adsb.fi open data (live source): free, keyless, 1 req/s per IP; failed
  requests (4xx incl. 429) count toward the limit. Poll no faster than every
  5s, send a descriptive User-Agent, always keep backoff, credit adsb.fi on the
  page. Reportedly personal/non-commercial use only.
- adsb.lol: same JSON format, but only 500 req/day without a key (1,000 adhoc,
  7,200 feeder). Usable as a fallback via `ADSB_URL` + `ADSB_API_KEY` at a
  matching slower interval, not at 5s.
- OpenSky: OAuth2 client credentials only (env vars `OPENSKY_CLIENT_ID`,
  `OPENSKY_CLIENT_SECRET`). Used for the worldwide `/states/all` feed (states
  bucket: 4,000 credits/day standard, 4 per global call, never poll faster
  than `world_feed.poll_interval()`) and `/flights/arrival` + `/departure`
  (previous day only, nightly batch, separate flights bucket). Non-commercial
  use only; commercial use needs an OpenSky licence.
- Never hardcode or print secrets. Load from `.env` (python-dotenv). `.env` and
  `*.jsonl` must stay in `.gitignore`.

## Environment

- Windows, PowerShell, Microsoft Store Python 3.11.
- Use `python -m pip ...` and `python -m uvicorn server:app` (Scripts folder is
  not on PATH). PowerShell env vars: `$env:NAME="value"`, not `export`.
- Project lives in `C:\dev\Flive` (moved out of OneDrive so node_modules and
  logs don't sync). Node 24 / npm for the frontend: `cd frontend; npm run build`
  (or `npm run dev` on :5173 alongside the server on :8000).

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
   [model + live predictions done; nightly scoring of logged predictions next]
6. Deploy (always-on instance, not a sleeping free tier) + README with GIF.

## How I want to work

- Small, working steps. Each step should run end to end before the next.
- Explain what you changed and why in a few sentences; I'm writing a blog post
  about the build, so decisions and tradeoffs matter.
- Don't rewrite working pieces I didn't ask about. Ask before big restructures.
- Treat callsigns and all provider data as untrusted input in the UI.
- Commit after each working step with a clear message.
