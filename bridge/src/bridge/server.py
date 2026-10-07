"""WebSocket server at /ws: hello, welcome, then telemetry at config.telemetry_hz.

Implemented checks: JSON object, version, hello first, one operator, increasing seq. Input, event and command fields
are not checked yet. Commands get not_allowed, because this bridge has no flight link.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from datetime import datetime

from aiohttp import WSMsgType, web
from pydantic import ValidationError

from . import messages
from .config import Config
from .mocap import PoseSource

log = logging.getLogger(__name__)
CFG = web.AppKey("cfg", Config)
SOURCE = web.AppKey("source", PoseSource)
OPERATOR = web.AppKey("operator", dict)


class Link:
    """One tablet connection: its outgoing seq, the last received seq, and the latest input for telemetry.ack."""

    def __init__(self, ws: web.WebSocketResponse) -> None:
        self.ws = ws
        self.seq = 0
        self.rx_seq = 0
        self.ack: dict | None = None
        self.last_reply: dict[str, float] = {}

    def next_seq(self) -> int:
        self.seq += 1
        return self.seq

    async def send(self, msg: dict) -> None:
        await self.ws.send_str(json.dumps(msg, allow_nan=False, separators=(",", ":")))

    async def reply(self, ref: int | None, code: str, detail: str, limit: bool = False) -> None:
        now = time.monotonic()
        if limit and now - self.last_reply.get(code, -1e9) < 1.0:  # at most one reply each second per code
            return
        self.last_reply[code] = now
        await self.send(messages.reply(self.next_seq(), now * 1000, ref, code, detail))


def _seq(obj: object) -> int | None:
    s = obj.get("seq") if isinstance(obj, dict) else None
    return s if isinstance(s, int) and not isinstance(s, bool) else None


async def _telemetry_loop(app: web.Application, link: Link) -> None:
    cfg, source, period = app[CFG], app[SOURCE], 1 / app[CFG].telemetry_hz
    next_tick = time.monotonic()
    while not link.ws.closed:
        now = time.monotonic()
        await link.send(messages.telemetry(cfg, source.latest(), link.next_seq(), now, link.ack))
        next_tick += period
        await asyncio.sleep(max(0.0, next_tick - time.monotonic()))


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    app = request.app
    ws = web.WebSocketResponse(heartbeat=5.0)
    await ws.prepare(request)
    link = Link(ws)

    first = await ws.receive()
    try:
        obj = json.loads(first.data) if first.type == WSMsgType.TEXT else None
    except json.JSONDecodeError:
        obj = None
    if isinstance(obj, dict) and obj.get("v") != messages.VERSION and "v" in obj:
        await link.reply(_seq(obj), "version", f"this host speaks version {messages.VERSION}")
        await ws.close()
        return ws
    try:
        hello = messages.Hello.model_validate(obj)
    except ValidationError:
        await link.reply(_seq(obj), "invalid", "the first message must be a valid hello")
        await ws.close()
        return ws
    if hello.role == "operator" and app[OPERATOR].get("ws") is not None:
        await link.reply(hello.seq, "busy", "another operator is connected")
        await ws.close()
        return ws
    if hello.role == "operator":
        app[OPERATOR]["ws"] = ws
    link.rx_seq = hello.seq
    session = datetime.now().strftime("s%Y%m%d-%H%M%S")
    log.info("%s connected: %s", hello.role, hello.client)
    await link.send(messages.welcome(app[CFG], link.next_seq(), time.monotonic() * 1000, session, hello.role))
    ticker = asyncio.create_task(_telemetry_loop(app, link))
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            await _receive(link, msg.data, hello.role)
    finally:
        ticker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await ticker
        if app[OPERATOR].get("ws") is ws:
            app[OPERATOR]["ws"] = None
        log.info("%s disconnected", hello.role)
    return ws


async def _receive(link: Link, data: str, role: str) -> None:
    rx_ms = time.monotonic() * 1000
    try:
        obj = json.loads(data)
    except json.JSONDecodeError:
        obj = None
    if not isinstance(obj, dict):
        await link.reply(None, "invalid", "a message must be one JSON object", limit=True)
        return
    seq, kind = _seq(obj), obj.get("type")
    if obj.get("v") != messages.VERSION:
        await link.reply(seq, "version", f"this host speaks version {messages.VERSION}")
        await link.ws.close()
        return
    if seq is None or seq <= link.rx_seq:
        await link.reply(seq, "invalid", "seq must increase", limit=kind == "input")
        return
    if seq > link.rx_seq + 1:
        log.info("seq gap: %d to %d", link.rx_seq, seq)
    link.rx_seq = seq
    if kind == "input" and role == "operator":
        t_ms = obj.get("t_ms")
        if isinstance(t_ms, (int, float)) and not isinstance(t_ms, bool):
            link.ack = {"seq": seq, "t_ms": t_ms, "host_rx_ms": messages.ms(rx_ms)}
    elif kind == "event" and role == "operator":
        pass
    elif kind == "command":
        await link.reply(seq, "not_allowed", "this bridge streams positions only; it has no flight link")
    else:
        await link.reply(seq, "invalid", f"unexpected message type {kind!r} from {role}", limit=kind == "input")


def make_app(cfg: Config, source: PoseSource) -> web.Application:
    app = web.Application()
    app[CFG] = cfg
    app[SOURCE] = source
    app[OPERATOR] = {"ws": None}
    app.router.add_get("/ws", ws_handler)

    async def lifecycle(app: web.Application):  # type: ignore[no-untyped-def]
        source.start()
        yield
        source.stop()

    app.cleanup_ctx.append(lifecycle)
    return app
