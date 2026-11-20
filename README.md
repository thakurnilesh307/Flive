# Flive

Live air traffic around Boston Logan (KBOS) on a dark web map, with a live
arrivals/departures list and per-aircraft details. The goal is to compare what
actually happens at Logan with an optimized landing sequence: how much time
arrivals lose, and how much of it a scheduler could win back.

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
python scripts/build_aircraft_db.py   # optional: aircraft types/registrations (~25 MB, re-run weekly)
python -m uvicorn server:app
```

Open http://127.0.0.1:8000. FastAPI serves the built React app from
`frontend/dist`.

Ask Flive (the chat) is an experiment and is **off by default**. To try it, set
`ASK_FLIVE=on` in `.env`, install [Ollama](https://ollama.com), then
`ollama pull qwen3:8b` (or set `OLLAMA_MODEL` to another model with tool calling).
Switched on without Ollama, the chat panel shows "offline".

For frontend work with hot reload, keep the server running and in a second
terminal run `cd frontend; npm run dev`, then open http://localhost:5173 (Vite
forwards `/ws` to the server).

## Frontend

React + TypeScript (Vite) with [MapLibre GL](https://maplibre.org): a vector
basemap from [OpenFreeMap](https://openfreemap.org) (free, no API key),
recolored to navy in `frontend/src/basemap.ts`, shown as a globe when zoomed
out. Aircraft are GPU symbol layers (one recolorable plane icon rotated by
track), so thousands of worldwide planes stay smooth.

- Aircraft icons rotate with track and glide between updates (dead
  reckoning from speed and track: Boston every 0.5 s capped at 20 s, world
  every 1 s capped at 120 s); stale aircraft fade.
- The flight list follows the map: "In view" lists every plane on screen
  (Boston feed + worldwide), nearest to the map centre first, with positions
  like "12 nm NE of JFK" from the nearest airport. The "Logan arrivals/
  departures" tabs and Logan stats only appear when the map is over Boston.
- Search finds flights, airlines, types and airports (IATA/ICAO code, name or
  city); Enter on an exact airport code flies the map there. The top-bar pill
  shows the airport at the middle of the map.
- Selecting an aircraft shows a detail panel and a dashed trail of its
  recent positions (kept in the browser since page load).
- "Inbound", "On approach" and "Departing" are **estimates** from distance,
  track and vertical rate relative to Logan (`frontend/src/status.ts`); planes
  elsewhere get motion-only labels (Climbing, Descending, Cruising). Real
  arrival/departure detection is roadmap step 4; predicted runway/ETA is step 5.
- Altitudes are corrected for local air pressure (see "Altitudes" below).
- All provider text is rendered as text (React escaping, `textContent` in
  Leaflet tooltips), and the server already strips callsigns to `[A-Z0-9-]`.
- `/about.html` is the project's explainer: plain-language sections with
  collapsible "For developers" detail, for both general readers and engineers.

## Scaling to the whole world

Flive started as a 40 nm circle around Logan with about 15 aircraft. It now shows
every aircraft OpenSky tracks worldwide, typically 5,000–6,000 at the quietest hour
in this coverage (measured at ~06:30 UTC) and more at peak, without giving up the
detailed Boston view. Five decisions made that work on free data and a single small
server:

**1. Two feeds at two speeds.** Boston keeps adsb.fi every 5 s (its keyless limit is
1 request/s). The rest of the world comes from OpenSky's `/states/all`, the only free
source with a whole-planet snapshot in one request. Each global call costs 4 credits
of a 4,000/day budget, so `world_feed.poll_interval()` waits 90 s between calls with an
account (15 min anonymously). Everything Logan-specific (statuses, landing order, logs,
predictions) stays on the fast feed.

| | Boston | World |
|---|---|---|
| Source | adsb.fi (readsb JSON) | OpenSky `/states/all` |
| Refresh | 5 s | 90 s (900 s anonymous) |
| Size per fetch | ~5 KB, ~15 aircraft | ~675 KB, ~5,200 aircraft |
| Logged | every 15 s (~30 MB/day) | never (would be ~4 GB/day at 15 s) |
| Type / registration | yes | no (OpenSky doesn't send them) |

**2. One poller, any number of viewers.** Only the server talks to data providers, so
a thousand visitors cost adsb.fi and OpenSky exactly as much as one.

**3. Each viewer gets only their map view.** The world snapshot goes into a 5° grid
index (built in ~16 ms for 5,000 aircraft; area queries take well under a
millisecond). The page sends its visible bounds over the WebSocket and gets back:
- rows from a box 25% larger than the screen, so short pans don't run off the data
- compact arrays plus a field list: 4.6× smaller than JSON objects, about 70 bytes per
  aircraft
- a cap of 2,000 rows when zoomed out, thinned round-robin across grid cells so every
  region keeps planes, airborne first
- the selected plane always included (`keep`), so it never vanishes when thinned

A whole-world view is ~140 KB per update instead of ~630 KB of objects, and a regional
view is ~10 KB. Pages that never send a view still get only the Boston feed.

**4. Draw on the GPU.** Leaflet makes one HTML element per plane, which falls over at
thousands. MapLibre draws aircraft as symbol layers: one plane shape stored as a
signed distance field (SDF), recolored and rotated per plane by the GPU. Boston planes
glide every 0.5 s (dead reckoning, capped at 20 s), world planes every 1 s (capped at
120 s, since their data is ~90 s apart). Zoomed out, the map becomes a globe.

**5. Make the AI world-aware without making it guess.** Ask Flive gets worldwide tools
(`aircraft_near` any airport or city, `world_summary` by region, worldwide
`get_aircraft`) backed by 3,265 OurAirports airports. Tool results describe positions
relative to the nearest airport, and the prompt requires a caveat on worldwide counts.

**Known limits.** OpenSky relies on volunteer receivers: Europe and North America are
well covered, oceans and much of Africa, Asia and South America much less, so real
global totals are higher than Flive shows (commercial trackers add satellite and radar
data). World positions can be up to ~90 s old before gliding takes over. Faster or
denser worldwide data would mean running a receiver (feeder accounts get more credits)
or a paid API such as FlyItalyADSB; `world_feed.py` is one module, so swapping it is
contained.

Debug endpoints: `GET /api/world/stats`, `GET /api/world?bbox=west,south,east,north`.

## Ask Flive

**Off by default** (`ASK_FLIVE=on` in `.env` turns it on). It isn't part of the core
project: the map and the detail panel already answer what people would ask, a small
local model still gets things wrong now and then, and a public deployment would need
a GPU or a paid model. The code stays as a working experiment.

A chat panel that answers questions about live traffic using a local LLM
(Ollama) with tool calling. The model can't answer from memory: it calls tools
that read the server's in-memory data, then writes its reply from those results
and says when Flive doesn't have the data.

- Boston: `traffic_summary`, `list_aircraft`, `landing_sequence`
- Worldwide: `aircraft_near` (any airport or city, optional airline filter),
  `find_airport`, `world_summary` (totals by region, with a coverage caveat)
- Anywhere: `get_aircraft` (Boston feed first, then worldwide; positions are
  described relative to the nearest airport)

Airports come from OurAirports (public domain): `data/airports.csv` holds the
3,265 airports with scheduled service, rebuilt by `scripts/build_airports.py`.

- `ask.py`: tools, system prompt, tool-calling loop (max 4 rounds), Ollama backend
- `traffic.py`: status/distance/airline derivation (mirrors `frontend/src/status.ts`)
- `POST /api/ask` (max 300 chars; 5/min and 40/hour per IP; one model call at
  a time), `GET /api/ask/status`
- Answers render as plain text and list which tools were used.

## Altitudes

ADS-B altitude is barometric pressure altitude, computed for a "standard" day
(29.92 inHg). On a high-pressure morning everything below ~18,000 ft reads too
low (a plane on Logan's runway showed "-400 ft"). `weather.py` downloads every
METAR station's altimeter setting from
[aviationweather.gov](https://aviationweather.gov/data/cache/) every 10 minutes
(~250 KB, ~4,800 stations) and adds `alt_qnh_m` = pressure altitude corrected
with the nearest station within 100 nm (1 inHg = 1,000 ft, the pilots' rule).
`baro_alt_m` stays raw, so the logs keep the original value; planes far from
any station (mid-ocean) keep the raw value.

## Aircraft details: type, operator, photo, logo

OpenSky's worldwide feed has positions only, so on its own every plane outside
Boston would be "Unknown type, unknown operator". The server fills that in:

- **Type and registration:** `aircraft_db.py` looks each icao24 up in
  `data/aircraft.sqlite`, built by `scripts/build_aircraft_db.py` from
  [tar1090-db](https://github.com/wiedehopf/tar1090-db) (Mictronics database +
  FAA records, ~600k aircraft). SQLite instead of a Python dict keeps memory near
  zero; ~6,000 lookups per world refresh take milliseconds. The file isn't
  committed (no explicit licence), only lookup results are shown.
- **Operator:** from the callsign prefix (`DLH415` -> Lufthansa) using the
  OpenFlights airline list (`data/airlines.csv`, 5,775 ICAO codes, ODbL), and
  "Private / general aviation" when the callsign is just the tail number. A
  hand-checked `data/airlines_extra.csv` adds airlines newer than OpenFlights.
  The database's owner name is never stored or shown (for private aircraft it is
  often a person); the build only keeps an airline code when the owner IS an
  airline ("JETBLUE AIRWAYS CORP" -> JBU), so an airliner flying under its tail
  number (positioning or test flights) still shows its airline and logo.
- **Privacy:** aircraft in the FAA privacy programs (PIA/LADD) get their type only,
  no registration and no photo.
- **Photo:** `GET /api/aircraft/{icao24}` asks
  [Planespotters.net](https://www.planespotters.net/photo/api) (cached a day, max
  1 request/s, 30 lookups/min per visitor). The page shows the thumbnail from
  Planespotters' image host with the photographer credit and a link back, as
  their terms ask.
- **Logo:** `GET /api/logo/{ICAO}` serves square airline logos from
  [Jxck-S/airline-logos](https://github.com/Jxck-S/airline-logos), downloaded once
  and cached in `data/logos/`. No logo -> the coloured code badge.

Coverage on a live check: 99% of worldwide aircraft got a type, 86% an operator.

## Files

| File | Purpose |
| --- | --- |
| `server.py` | FastAPI app: 5 s poller with backoff, 15 s logging, WebSocket broadcast |
| `adsb_feed.py` | Fetches readsb-format JSON and converts it to Flive's snapshot format (SI units) |
| `frontend/` | React + TypeScript UI: live map (`index.html`) and About page (`about.html`) |
| `ask.py` | Ask Flive: LLM tool-calling loop and tools over the live snapshot |
| `traffic.py` | Derived facts per aircraft (distance, estimated status, airline) |
| `aircraft_db.py` | Type/registration lookup (SQLite) and operator from callsign; enriches both feeds |
| `photos.py`, `logos.py` | Cached Planespotters photo lookup and airline logo cache |
| `weather.py` | Worldwide METAR altimeter settings; pressure-corrected altitudes |
| `events.py` | Landing/takeoff detection with runway assignment from the logs (step 4) |
| `airport_geo.py` | The prediction airports (Logan, JFK, Heathrow): runways, elevation, time zone, nm maths |
| `scripts/build_runways.py` | Builds `data/runways.csv` from OurAirports for those airports |
| `scripts/validate_events.py` | Scores `events.py` against OpenSky's arrival records for an airport |
| `scripts/import_history.py` | Streams adsb.lol daily archives, keeps traces around each prediction airport |
| `dataset.py`, `train_eta.py` | Training rows from detected landings; model training and leave-one-day-out scoring |
| `eta.py` | Live landing-time and runway predictions in the server, one predictor per airport |
| `global_model.py` | Rough landing-time model for any airport (worldwide feed), tested on unseen areas |
| `scripts/overnight.sh` | Unattended run: import more history, retrain every model, re-validate, score |
| `score_predictions.py` | Scores the predictions the live server logged against the landings that followed |
| `arrival_model.py` | "Is it landing here?" classifier per airport, used live to decide who gets a prediction |
| `time_lost.py` | Time each arrival loses inside 40 nm vs. comparable unimpeded flights |
| `train_runway.py` | Landing/takeoff runway classifiers, scored against "most-used runway" |
| `scripts/build_aircraft_db.py` | Downloads the aircraft DB and the OpenFlights airline list into `data/` |
| `poll_logan.py` | Retired OpenSky poller; its OAuth2 code will be reused for nightly arrival checks |
| `.env.example` | Template for local secrets (`.env` is gitignored) |

## Landing and takeoff detection (step 4)

`python events.py` turns the 15 s logs into events (`data/events.csv`): who
landed or took off, when, and on which runway. These are the labels for the
landing-time model (step 5).

- A landing is an airborne -> on-ground change; a takeoff the reverse.
  Single-sample flag blips are smoothed out first (a plane rolling out once
  reported "airborne at 3,650 ft"), and every change must stick for 60 s, be
  low/descending (landing) or climbing (takeoff), and be on a Logan runway.
- Runway = lined up within 25 degrees of its heading AND within 0.35 nm of its
  extended centreline (from OurAirports threshold coordinates), so parallel
  runways like 04L/04R are told apart by position.
- Light aircraft that never send an on-ground flag (many Cape Air Cessnas) get an
  inferred landing when the track ends low, descending and lined up with a runway
  while the logs keep running (`method = lost on final`, wider uncertainty).
- Rejections are counted by reason; most are helicopters at downtown helipads and
  business jets at Hanscom, which the runway check correctly ignores.

**History:** `python scripts/import_history.py 7` imports past days from
[adsb.lol's open archives](https://github.com/adsblol/globe_history_2026) (ODbL).
Each day is ~3.5 GB worldwide; the script streams it from GitHub without saving
it and keeps only aircraft within 45 nm of each prediction airport
(`data/history/ICAO/YYYY-MM-DD.jsonl.gz`, gitignored; one download serves all of them). Positions every few seconds instead of every 15. `events.py` reads
these alongside the live logs, so weeks of labelled landings don't need weeks of
waiting.

**Validation** (`python scripts/validate_events.py`) against OpenSky's
`/flights/arrival` records for KBOS, inside the 9.1 h of logs it could check:
**97% recall** (142 of 147 OpenSky arrivals found) and **100% precision** (all 142
detected landings confirmed). The 5 misses: two touchdowns inside gaps in the old
logs, a helicopter, a low pass and an arrival outside our data. Our touchdown time
is a median 10 s after OpenSky's "last seen". Re-run on 18 days of history (Nov 1-18):
96% recall / 100% precision at Logan (9,666 OpenSky arrivals), 97% / 100% at JFK
(9,710) and 97% / 100% at Heathrow (11,146).

## Landing-time model (step 5)

"This plane will land in about 6 minutes (likely 5 to 8)", for every arrival.

```powershell
python -m pip install -r requirements-ml.txt
python scripts/import_history.py 7    # past week from adsb.lol, all airports in one pass
python events.py KBOS                  # landings and takeoffs with runway
python dataset.py KBOS                 # -> data/models/KBOS_eta_dataset.csv
python train_eta.py KBOS               # -> data/models/KBOS_eta.joblib (the server loads it)
python train_runway.py KBOS            # -> data/models/KBOS_runway.joblib
```

- **Training rows:** every detected landing, walked back 30 minutes, one row
  every 30 s: distance and direction from Logan, altitude, speed, vertical rate,
  heading vs the runway in use, traffic in the arrival flow, time of day ->
  seconds until touchdown. Only information available at that moment: the
  runway it actually landed on is not a feature; the runway Logan was using in
  the previous 30 minutes is. `dataset.feature_row()` is shared with the live
  server so training and serving can't drift.
- **Model:** scikit-learn `HistGradientBoostingRegressor` (absolute-error loss),
  plus 10th/90th percentile models for the "likely" range, widened by a factor
  calibrated on held-out days so it really holds ~80% of landings.
- **Test:** leave-one-day-out (positions 30 s apart are near-duplicates, so a
  random split would flatter it).

Results on 20 days of Logan traffic (296,708 rows, Oct 31 - Nov 19, each day
predicted by a model that never saw it):

| | overall | 5 min out | 10 min out | 20 min out | within 1 min |
| --- | --- | --- | --- | --- | --- |
| Straight line (distance / speed) | 5.51 min | 1.26 | 5.68 | 13.74 | 28% |
| Straight line x fitted factor | 3.62 min | | | | |
| **Model** | **1.19 min** | **0.34** | **1.15** | **2.70** | **65%** |

The first run, on one week, scored 1.01 min overall. Tripling the data made the
headline *worse* but the model better: at 5 and 20 minutes out it improved, and the
straight-line baseline got worse by more (4.85 -> 5.51), so the 20-day test set is
simply harder. One held-out day scores 2.4 min on its own. A small test set flatters
you; the 20-day number is the one to trust.

What it learned matters most: altitude (a plane 15 nm out at 10,000 ft is far
from landing; at 2,000 ft it's nearly down), then where it is relative to the
runway in use. Lesson from the first run: with one day of northeast-wind
landings (runway 4L/4R) held out, error doubled; the model only knows the
weather it has seen, so more history = better.

**Live:** `eta.py` keeps 40 minutes of the Boston feed, detects the runway in
use with the same detector, and predicts for aircraft that look like Logan
arrivals (not climbing, not just off the ground, not helicopters). Predictions
go out as `landing_at` / `landing_lo_at` / `landing_hi_at` on each aircraft,
show in the detail panel and the Logan arrivals tab, drive Ask Flive's landing
order, and are written to the logs for scoring. First live check: 5 arrivals
predicted 2 to 15 minutes ahead landed 0.2 to 2.6 minutes from the prediction,
4 of 5 inside the likely range. That check also caught departures getting
"predictions" right after liftoff, now excluded.

## Runway prediction

`python train_runway.py` trains two classifiers on the runways `events.py`
detected: which runway an arrival will land on (rows every 30 s over its last 30
minutes) and which runway a taxiing plane will take off from (rows every 15 s over
its last 15 minutes of taxiing). Baseline to beat: "the runway Logan used most in
the last 30 minutes". Leave-one-day-out, 20 days:

| | model | baseline |
| --- | --- | --- |
| Landing runway | **95.6%** | 92.7% |
| Takeoff runway (taxiing) | **95.0%** | 92.4% |

(First run on 9 days: 94.6% / 91.4% vs 88.9% / 88.4%. Accuracy is highest close to
landing or takeoff and lowest furthest out.)

The first version only matched the baseline (88%) and was worse far out, picking
runways nobody was using. Three changes fixed that: only runways used in the last
30 minutes can win (`dataset.restrict_to_active`, same rule live), runway use as
shares instead of counts, and the plane's position relative to every runway, so
it can learn which of two active runways it's lined up for. The probability shown
in the app is honest: when the model says over 90% (most of the time) it's right
95-96% of the time. Live, `eta.py` adds `landing_runway`/`landing_runway_p` to
arrivals and `takeoff_runway`/`takeoff_runway_p` to planes taxiing out (not ones
that just landed), shown in the detail panel, both Logan tabs and Ask Flive.

## More airports: JFK, Heathrow, and a rough model for everywhere

Everything above was built for Logan, with Logan's runways hardcoded. Now the
airport is a parameter (`airport_geo.py`: runways from OurAirports, field elevation,
time zone), so the same detector, features and models run for any airport in
`CONFIG`: currently Logan, JFK and Heathrow. One history download feeds all of them.

**Detailed tier (Logan, JFK, Heathrow).** Each has its own landing-time and runway
models, plus its own adsb.fi feed: Logan every 5 s, the others every 10 s. Requests
from all feeds stay at least 1.2 s apart to respect adsb.fi's 1 request/s limit. The
page only receives an airport's feed while the map is looking at it.

| | Detection vs OpenSky | Landing time (held-out) | Straight line | Landing runway | Takeoff runway |
| --- | --- | --- | --- | --- | --- |
| Logan | 96% recall / 100% precision | 1.19 min | 5.51 | 95.6% (baseline 92.7%) | 95.0% (92.4%) |
| JFK | 97% / 100% | 0.98 min | 5.83 | 91.8% (89.0%) | 98.2% (95.7%) |
| Heathrow | 97% / 100% | 1.22 min | 6.59 | 95.3% (93.9%) | 98.8% (98.1%) |

19-20 held-out days each (Oct 31 - Nov 19); detection checked on Nov 1-18 against
about 10,000 OpenSky arrivals per airport. At Heathrow the takeoff-runway baseline is already ~98%: each mostly uses
one departure runway per direction, so there's nothing left for a model to add.

**Rough tier (everywhere else): `global_model.py`.** Worldwide, Flive only has
OpenSky's 90 s snapshots and doesn't know the runway in use. This model uses only
what one position report says, relative to the airport the plane seems to be
heading for: distance, height above the field, speed, descent, heading, runway
alignment and nearby traffic. The detector works at any airport with runway data,
so the history areas also yield landings at the neighbours: Teterboro,
Westchester, Gatwick, Luton, London City and others, 11 airports in all.

It's tested leave-one-*area*-out: for example, train on Boston and New York, then
predict London.

| Area never seen in training | Global model | Straight line | Main airport, global vs its own model |
| --- | --- | --- | --- |
| Boston | 1.39 min | 4.54 | 1.38 vs 1.19 |
| New York | 1.22 min | 3.37 | 1.31 vs 0.98 |
| London | 1.40 min | 4.27 | 1.67 vs 1.22 |

Trained on 1.43 million rows. So a single model with no local knowledge gets within
about 10-30 seconds of the dedicated ones.

The weak part is *which airport* a plane is going to. A simple rule (lined up with a
runway, otherwise pointed at the airport and on a normal ~3° descent) picks the right
airport 68-83% of the time overall (75% on average) and 99% in the last five minutes.
A classifier trained for this did *worse* on unseen areas (67% average), because it
learned local habits like "the nearest big airport"; a geometry-only version came
close (73%) and won in New York, but not overall. `global_model.py` picks whichever
wins on each retrain. So the server uses the rule, and the page labels these
predictions as rough estimates.

**A bug only live data showed.** On the first live Heathrow tab, an easyJet at 500 ft
over Gatwick was "landing at Heathrow in 10 minutes". The training scores couldn't
catch this: the models only ever saw real arrivals. The problem was the live check
that decides who is arriving. `eta.landing_elsewhere()` now rejects planes lined up
for, or low near, another airport. Checked on real arrivals, it drops 0% at Heathrow,
0.2% at Logan and 1.5% at JFK, where a curved approach and LaGuardia's parallel
runway headings make it harder.

## Scoring the live predictions

The training scores test the model on past days. `python score_predictions.py ICAO`
tests what the live server actually said, before each landing. It reads the
predictions out of the logs, finds the real landings in the same logs with
`events.py` (96-97% recall, 100% precision against OpenSky), and compares the two.
`scripts/overnight.sh` runs it for every airport at the end. Report:
`data/scores/ICAO.json`.

First results (Logan Nov 18-19, about 31 hours; JFK and Heathrow 8 hours each on Nov 19;
one prediction per plane every 30 s):

| | Landing time | Straight line | 5 / 10 / 20 min out | Likely range held | Landing runway | Real landings missed |
| --- | --- | --- | --- | --- | --- | --- |
| Logan | **0.83 min** | 4.59 | 0.23 / 0.70 / 1.34 | 75% | 99.1% | 2.3% |
| JFK | **0.80 min** | 3.29 | 0.26 / 0.77 / 1.46 | 62% | 92.9% | 0% |
| Heathrow | **1.06 min** | 4.19 | 0.15 / 0.70 / 2.26 | 83% | 97.0% | 0% |

"Missed" = landed without a prediction at least 5 minutes before. For planes that
really were arriving, live accuracy is as good as the held-out test or better. JFK's
range is too narrow live (62%, aim 80%); a few hours of data isn't enough to recalibrate it yet.

**The real weakness: deciding who is arriving.** Many planes got a prediction and
never landed: 342 at Logan, 808 at JFK, 507 at Heathrow, against 275 / 191 / 302 that
did. That's 26%, 59% and 37% of all predictions. Most get their first prediction
20-40 nm out and were really going to a neighbour: Bedford, Providence and Manchester
near Boston; Newark, Islip, Teterboro and LaGuardia near JFK; Gatwick, London City
and Luton near Heathrow. Others were light aircraft (under 140 kt) or just passing
through. The arrival gate only catches them near the end, when they line up for the
other airport. The training data never showed this problem, because it only contains
planes that did land. Next step: an "is it landing here?" model trained on history,
with every plane that came within 40 nm, landed or not.

**The fix: `arrival_model.py`.** A per-airport classifier trained on every plane
within 40 nm and below 18,000 ft above the field, one row per minute, labelled by
whether it landed here within the hour. Features: the landing-time features, glide
path and runway alignment here, whether it's closing on the airport over the last
two minutes, the same for the best-fitting neighbouring airport, and whether the
callsign looks like an airline flight. Tested leave-days-out against the old rule on
the same rows; the threshold is set so it finds at least as many arrivals as the rule.

| | Old rule: right / found | Model: right / found | Wrong predictions per real arrival |
| --- | --- | --- | --- |
| Logan | 76% / 70% | **99% / 90%** | 0.32 -> 0.01 |
| JFK | 46% / 65% | **99% / 95%** | 1.17 -> 0.01 |
| Heathrow | 67% / 76% | **99% / 96%** | 0.50 -> 0.01 |

The live server uses it at all three airports (and falls back to the rule without a
model file). Live re-scoring follows once there are enough new logs.

## Time lost on arrival

The goal is to compare real arrivals with an optimized landing sequence. Before
building a scheduler, `python time_lost.py ICAO` measures how much time real arrivals
lose, using the idea behind EUROCONTROL's "additional ASMA time": for every landing,
the time from crossing 40 nm to touchdown, minus an *unimpeded* time for comparable
flights (same entry direction in 45-degree sectors, same landing runway, same size
class) = the 20th percentile of their transit times. What's left is holding,
vectoring and slowing down for sequencing. Report: `data/time_lost/ICAO.json`, one
row per landing in `ICAO.csv` (both gitignored). It's our version on public data,
not the official figure.

20 days of history (Oct 31 - Nov 19), 9-11 thousand landings per airport:

| | Mean lost | Median | 90th pct | Lose over 5 min | Holding-like turns | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Logan | 2.7 min | 1.4 | 7.1 | 17% | 4% | 407 h |
| JFK | 2.2 min | 1.5 | 5.4 | 12% | 1% | 344 h |
| Heathrow | 4.5 min | 3.0 | 11.2 | 36% | 35% | 805 h |

Time lost grows with how busy the hour is (landings within 30 minutes either side):

| Landings that hour | 0-9 | 10-19 | 20-29 | 30-39 | 40+ |
| --- | --- | --- | --- | --- | --- |
| Logan | 0.9 | 0.8 | 2.0 | 3.5 | 3.8 |
| JFK | 1.0 | 1.2 | 2.1 | 2.6 | 3.2 |
| Heathrow | 1.4 | 0.5 | 2.5 | 3.7 | 7.5 |

Heathrow is the outlier, by design: about a third of its arrivals fly a holding
pattern, because it keeps a queue in the stacks so the runway never sits idle. Logan
and JFK mostly absorb delay with vectors and speed. Heathrow's number is also an
underestimate: when nearly every arrival queues, the 20th percentile "unimpeded"
time already includes some queueing. Holding-like = at least 540 degrees of turning
inside the ring.

## Roadmap

1. Repo hygiene
2. React + TypeScript frontend: aircraft list, detail panel
3. "Ask Flive": chat over the live state using a local LLM with tool calling
4. Arrival/departure detection per flight (runway, touchdown/liftoff time) - done (offline, `events.py`)
5. Landing-time model: predicted landing times and order vs. actual - model, live predictions, scoring of live predictions and the "is it landing here?" classifier done
6. Time lost on arrival (`time_lost.py`, done), then a runway scheduler to compare against: first come first served vs. what really happened vs. optimized
7. A generic "transfer controller" model: one model for any airport from its layout and live state, tested on airports it never saw
8. Always-on deployment

## Data

Live positions: [adsb.fi](https://adsb.fi) open data, a community network of
volunteer ADS-B receivers. Map: [OpenFreeMap](https://openfreemap.org),
© [OpenMapTiles](https://www.openmaptiles.org/),
© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
Aircraft types: [tar1090-db](https://github.com/wiedehopf/tar1090-db) (Mictronics).
Airlines: [OpenFlights](https://openflights.org/data) (ODbL). Historical traces:
[adsb.lol](https://adsb.lol) globe_history (ODbL). Photos:
[Planespotters.net](https://www.planespotters.net) (credited per photo). Logos:
[Jxck-S/airline-logos](https://github.com/Jxck-S/airline-logos); trademarks belong
to their airlines.
