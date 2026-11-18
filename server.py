"""
Flive server: polls OpenSky once, broadcasts to every connected browser.

  python -m pip install -r requirements.txt
  (credentials come from .env, see .env.example)
  python -m uvicorn server:app
  -> open http://127.0.0.1:8000

Needs poll_logan.py in the same folder (reuses its poll_once).
Don't run poll_logan.py at the same time: this server logs too,
and running both doubles your credit usage.
"""
import asyncio
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")  # before importing modules that read env vars

from poll_logan import POLL_SECONDS, poll_once  # noqa: E402
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


async def poller():
    global latest
    while True:
        try:
            # poll_once uses blocking requests, so run it off the event loop
            snap = await asyncio.to_thread(poll_once)
            if snap:
                latest = snap
                with LOG.open("a") as f:
                    f.write(json.dumps(snap) + "\n")
                await broadcast(snap)
                print(f"{len(snap['aircraft'])} aircraft -> {len(clients)} viewer(s)")
        except Exception as e:
            print(f"Poll failed: {e}")
        await asyncio.sleep(POLL_SECONDS)


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(poller())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def index():
    return FileResponse(HERE / "static" / "index.html")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    if latest:                        # don't make new viewers wait 30s
        await ws.send_text(json.dumps(latest))
    try:
        while True:
            await ws.receive_text()   # just keeps the connection open
    except WebSocketDisconnect:
        clients.discard(ws)
