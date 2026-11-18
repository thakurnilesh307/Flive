"""
Flive server: polls the ADS-B provider once, broadcasts to every connected browser.

  python -m pip install -r requirements.txt
  cd frontend; npm install; npm run build; cd ..
  python -m uvicorn server:app
  -> open http://127.0.0.1:8000

Live data comes from adsb_feed.py (adsb.fi by default, see .env.example).
The UI is the React app in frontend/, served from frontend/dist once built.
"""
import asyncio
import json
import os
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")  # before importing modules that read env vars

import ask  # noqa: E402
import world_feed  # noqa: E402
from adsb_feed import RateLimited, poll_once  # noqa: E402
import aircraft_db  # noqa: E402
import airports  # noqa: E402
import photos  # noqa: E402
import logos  # noqa: E402
import weather  # noqa: E402

POLL_SECONDS = 5        # provider allows 1 req/s; 5s is plenty for a live map
LOG_SECONDS = 15        # log less often than we poll: keeps log files small
MAX_BACKOFF = 300

DIST = HERE / "frontend" / "dist"

LOG = HERE / f"logan_{time.strftime('%Y%m%d_%H%M')}.jsonl"

latest = None                 # most recent snapshot, sent to new viewers
WORLD_VIEW_LIMIT = 2000       # max world aircraft per message (thinned evenly beyond this)


class Client:
    """One browser connection. Sends are serialized: the Boston poller, the world
    poller and view changes can all want to send at the same moment."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.view = None              # (visible, padded) boxes once the page asks for world data
        self.keep = ()                # icao24s to always include (the page's selected plane)
        self.lock = asyncio.Lock()

    async def send(self, text: str):
        async with self.lock:
            await self.ws.send_text(text)


clients: set[Client] = set()


async def broadcast(snap):
    """Boston snapshot to everyone (unchanged format: no "type" field)."""
    msg = json.dumps(snap)
    for c in list(clients):
        try:
            await c.send(msg)
        except Exception:
            clients.discard(c)   # browser went away mid-send


def world_message(view, keep=()):
    """Compact world aircraft for a client view, minus aircraft the Boston feed covers.
    `view` is (visible_box, padded_box): rows come from the padded box, the
    count shown to the user from the visible one. `keep` ids are always added
    (the selected plane must not vanish when a zoomed-out view is thinned)."""
    visible, padded = view
    local = {a["icao24"] for a in (latest or {}).get("aircraft", [])}
    rows, _ = world.query(*padded, limit=WORLD_VIEW_LIMIT + len(local))
    rows = [a for a in rows if a["icao24"] not in local][:WORLD_VIEW_LIMIT]
    have = {a["icao24"] for a in rows}
    rows += [world.by_id[k] for k in keep if k in world.by_id and k not in have and k not in local]
    visible_rows, _ = world.query(*visible, limit=10 ** 6)
    total_visible = sum(1 for a in visible_rows if a["icao24"] not in local)
    snap = world.snapshot
    return json.dumps({
        "type": "world",
        "api_time": snap["api_time"] if snap else None,
        "next_update_s": world_feed.poll_interval(),
        "total_in_view": total_visible,
        "fields": world_feed.COMPACT_FIELDS,
        "aircraft": [world_feed.compact_row(a) for a in rows],
    }, separators=(",", ":"))


async def send_world(c: Client):
    if c.view and world.snapshot:
        try:
            await c.send(world_message(c.view, c.keep))
        except Exception:
            clients.discard(c)


async def broadcast_world():
    for c in list(clients):
        await send_world(c)


def backoff(failures):
    """10, 20, 40 ... capped at MAX_BACKOFF seconds."""
    return min(MAX_BACKOFF, POLL_SECONDS * 2 ** failures)


qnh_field = weather.QnhField()   # altimeter settings from every METAR station


async def weather_poller():
    """All METARs every 10 minutes, for correcting low altitudes (see weather.py)."""
    while True:
        try:
            stations = await asyncio.to_thread(weather.fetch_stations)
            qnh_field.update(stations)
            print(f"METAR: {len(stations)} stations, KBOS area {qnh_field.inhg_at(42.37, -71.01)} inHg")
            await asyncio.sleep(600)
        except Exception as e:
            print(f"METAR fetch failed ({e}), retrying in 120s")
            await asyncio.sleep(120)


async def poller():
    global latest
    failures = 0
    last_logged = 0.0
    while True:
        delay = POLL_SECONDS
        try:
            # poll_once uses blocking requests, so run it off the event loop
            snap = await asyncio.to_thread(poll_once)
            aircraft_db.enrich(snap["aircraft"])  # operator, full type name, missing type/reg
            weather.apply(snap["aircraft"], qnh_field)  # adds alt_qnh_m; baro_alt_m stays raw
            failures = 0
            latest = snap
            if snap["fetched_at"] - last_logged >= LOG_SECONDS - 0.5:
                with LOG.open("a") as f:
                    f.write(json.dumps(snap) + "\n")
                last_logged = snap["fetched_at"]
            await broadcast(snap)
            print(f"{len(snap['aircraft'])} aircraft -> {len(clients)} viewer(s)")
        except RateLimited as e:
            # Failed requests count against the quota too, so never retry fast.
            failures += 1
            delay = max(e.retry_after or 0, backoff(failures))
            print(f"Rate limited, waiting {delay}s")
        except Exception as e:
            failures += 1
            delay = backoff(failures)
            print(f"Poll failed ({e}), retrying in {delay}s")
        await asyncio.sleep(delay)


world = world_feed.WorldStore()


async def world_poller():
    """Whole-world snapshot from OpenSky at a credit-safe interval. Not logged."""
    failures = 0
    while True:
        delay = world_feed.poll_interval()
        try:
            snap, credits = await asyncio.to_thread(world_feed.poll_once)
            await asyncio.to_thread(aircraft_db.enrich, snap["aircraft"])  # OpenSky has no type/reg
            await asyncio.to_thread(weather.apply, snap["aircraft"], qnh_field)  # pressure-corrected altitude
            world.update(snap, credits)
            failures = 0
            await broadcast_world()
            print(f"World: {len(snap['aircraft'])} aircraft, {snap['bytes'] // 1024} KB, "
                  f"credits left {credits if credits is not None else '?'}")
        except RateLimited as e:
            failures += 1
            delay = max(delay, e.retry_after or 0, min(3600, 300 * failures))
            world.last_error = f"rate limited; next try in {delay}s"
            print(f"World: rate limited, waiting {delay}s")
        except Exception as e:
            failures += 1
            delay = max(delay, min(MAX_BACKOFF, 30 * 2 ** failures))
            world.last_error = str(e)[:200]
            print(f"World: poll failed ({e}), retrying in {delay}s")
        await asyncio.sleep(delay)


@asynccontextmanager
async def lifespan(app):
    weather_task = asyncio.create_task(weather_poller())
    task = asyncio.create_task(poller())
    world_task = None
    if os.getenv("WORLD_FEED", "on").lower() != "off":
        world_task = asyncio.create_task(world_poller())
    # Load the LLM in the background so the first question isn't a cold start.
    asyncio.create_task(asyncio.to_thread(backend.warm_up))
    yield
    task.cancel()
    weather_task.cancel()
    if world_task:
        world_task.cancel()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    c = Client(ws)
    clients.add(c)
    if latest:                        # don't make new viewers wait for the next poll
        await c.send(json.dumps(latest))
    try:
        while True:
            text = await ws.receive_text()
            # Only message type so far: {"type": "view", "bbox": [w, s, e, n], "keep": [icao24]}.
            # Pages that never send one never get world data (old pages keep working).
            if len(text) > 300:
                continue
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            if isinstance(msg, dict) and msg.get("type") == "view":
                view = world_feed.parse_view(msg)
                if view:
                    c.view = view
                    c.keep = world_feed.parse_keep(msg)
                    await send_world(c)
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(c)


# --- Ask Flive --------------------------------------------------------------

backend = ask.OllamaBackend()
model_slot = asyncio.Semaphore(1)       # one model call at a time; others queue briefly
ASK_LIMITS = [(60, 5), (3600, 40)]       # per visitor: 5/minute, 40/hour
recent_asks: dict[str, deque] = defaultdict(deque)


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    history: list[Turn] = Field(default_factory=list, max_length=12)


def check_rate(ip: str):
    now = time.monotonic()
    q = recent_asks[ip]
    while q and now - q[0] > ASK_LIMITS[-1][0]:
        q.popleft()
    for window, limit in ASK_LIMITS:
        if sum(1 for t in q if now - t <= window) >= limit:
            raise HTTPException(429, f"Slow down a little: max {limit} questions per "
                                     f"{'minute' if window == 60 else 'hour'}.")
    q.append(now)


@app.post("/api/ask")
async def ask_endpoint(req: AskRequest, request: Request):
    # Behind a reverse proxy this needs the forwarded client IP (deploy step).
    check_rate(request.client.host if request.client else "unknown")
    try:
        await asyncio.wait_for(model_slot.acquire(), timeout=45)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Ask Flive is busy right now. Try again in a moment.")
    try:
        history = [t.model_dump() for t in req.history]
        return await asyncio.to_thread(ask.answer, req.question, history, latest, backend, world)
    except ask.BackendUnavailable as e:
        print(f"Ask Flive unavailable: {e}")
        raise HTTPException(503, "Ask Flive's language model is offline right now.")
    finally:
        model_slot.release()


@app.get("/api/ask/status")
async def ask_status():
    ok = await asyncio.to_thread(backend.available)
    return {"available": ok, "model": backend.model}


# --- World feed -------------------------------------------------------------

PHOTO_LIMITS = [(60, 30)]               # per visitor: 30 aircraft lookups/minute
recent_lookups: dict[str, deque] = defaultdict(deque)
_ICAO = re.compile(r"^[0-9a-f]{6}$")


@app.get("/api/aircraft/{icao24}")
async def aircraft_info(icao24: str, request: Request):
    """Extra details for the selected plane: full type name and a photo."""
    icao24 = icao24.lower()
    if not _ICAO.match(icao24):
        raise HTTPException(400, "Bad aircraft address.")
    now = time.monotonic()
    q = recent_lookups[request.client.host if request.client else "?"]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PHOTO_LIMITS[0][1]:
        raise HTTPException(429, "Too many lookups, try again in a minute.")
    q.append(now)
    info = aircraft_db.lookup(icao24)
    # No photo for unknown aircraft (avoids random matches) or privacy-listed ones.
    photo = None
    if info and info["_reg"] and not info["private"]:
        photo = await asyncio.to_thread(photos.photo_for, icao24)
    return {
        "type_desc": info["type_desc"] if info else None,
        "aircraft_type": info["aircraft_type"] if info else None,
        "registration": info["registration"] if info else None,
        "photo": photo,
    }


@app.get("/api/airports")
async def airport_list():
    """Compact [iata, icao, lat, lon, name, city] for the 3,265 airports, so the page
    can say "12 nm NE of JFK" and search airports. Static data: cached for a day."""
    rows, _ = airports._load()
    data = [[a["iata"] or "", a["icao"] or "", round(float(a["lat"]), 4), round(float(a["lon"]), 4),
             a["name"], a["city"]] for a in rows]
    return Response(content=json.dumps(data, separators=(",", ":")), media_type="application/json",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/logo/{code}")
async def airline_logo(code: str):
    """Airline logo by ICAO code, downloaded once and cached on disk (see logos.py)."""
    png = await asyncio.to_thread(logos.logo_png, code.upper()[:3]) if len(code) == 3 else None
    if png is None:
        raise HTTPException(404, "No logo.")
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/world/stats")
async def world_stats():
    return world.stats()


@app.get("/api/world")
async def world_view(bbox: str, limit: int = 2000):
    """Aircraft in a map view: bbox=west,south,east,north (degrees). Step 2 moves
    this onto the WebSocket; this endpoint is for testing and debugging."""
    try:
        west, south, east, north = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox must be west,south,east,north")
    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= north <= 90):
        raise HTTPException(422, "bbox out of range")
    aircraft, total = world.query(west, south, east, north, max(1, min(limit, 5000)))
    snap = world.snapshot
    return {"api_time": snap["api_time"] if snap else None, "total_in_view": total,
            "returned": len(aircraft), "aircraft": aircraft}


# The built React app. Mounted last so /ws above takes precedence.
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
else:
    @app.get("/")
    async def not_built():
        return HTMLResponse(
            "<p>Frontend not built yet. Run <code>cd frontend; npm install; "
            "npm run build</code>, then restart the server.</p>", status_code=503)
