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
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")  # before importing modules that read env vars

import ask  # noqa: E402
from adsb_feed import RateLimited, poll_once  # noqa: E402

POLL_SECONDS = 5        # provider allows 1 req/s; 5s is plenty for a live map
LOG_SECONDS = 15        # log less often than we poll: keeps log files small
MAX_BACKOFF = 300

DIST = HERE / "frontend" / "dist"

LOG = HERE / f"logan_{time.strftime('%Y%m%d_%H%M')}.jsonl"

latest = None                 # most recent snapshot, sent to new viewers
clients: set[WebSocket] = set()


async def broadcast(snap):
    msg = json.dumps(snap)
    for ws in list(clients):
        try:
            await ws.send_text(msg)
        except Exception:
            clients.discard(ws)   # browser went away mid-send


def backoff(failures):
    """10, 20, 40 ... capped at MAX_BACKOFF seconds."""
    return min(MAX_BACKOFF, POLL_SECONDS * 2 ** failures)


async def poller():
    global latest
    failures = 0
    last_logged = 0.0
    while True:
        delay = POLL_SECONDS
        try:
            # poll_once uses blocking requests, so run it off the event loop
            snap = await asyncio.to_thread(poll_once)
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


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(poller())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    if latest:                        # don't make new viewers wait for the next poll
        await ws.send_text(json.dumps(latest))
    try:
        while True:
            await ws.receive_text()   # just keeps the connection open
    except WebSocketDisconnect:
        clients.discard(ws)


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
        return await asyncio.to_thread(ask.answer, req.question, history, latest, backend)
    except ask.BackendUnavailable as e:
        print(f"Ask Flive unavailable: {e}")
        raise HTTPException(503, "Ask Flive's language model is offline right now.")
    finally:
        model_slot.release()


@app.get("/api/ask/status")
async def ask_status():
    ok = await asyncio.to_thread(backend.available)
    return {"available": ok, "model": backend.model}


# The built React app. Mounted last so /ws above takes precedence.
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
else:
    @app.get("/")
    async def not_built():
        return HTMLResponse(
            "<p>Frontend not built yet. Run <code>cd frontend; npm install; "
            "npm run build</code>, then restart the server.</p>", status_code=503)
