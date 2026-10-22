import json
import logging
import time
import weakref
from collections.abc import Callable
from typing import Any, assert_never

from aiohttp import WSCloseCode, WSMsgType, web
from pydantic import ValidationError

from touch_vision_drone_control.messages import (
    TABLET_MESSAGE,
    Command,
    Event,
    Hello,
    HostConfig,
    Input,
    Reply,
    ReplyCode,
    Role,
    Welcome,
    encode,
)

_log = logging.getLogger(__name__)

_INPUT_REPLY_INTERVAL_S = 1.0


class _OperatorSlot:
    def __init__(self) -> None:
        self._holder: "_Connection | None" = None

    def claim(self, connection: "_Connection") -> bool:
        if self._holder is not None:
            return False
        self._holder = connection
        return True

    def release(self, connection: "_Connection") -> None:
        if self._holder is connection:
            self._holder = None

    def held_by(self, connection: "_Connection") -> bool:
        return self._holder is connection


CONFIG = web.AppKey("config", HostConfig)
CLOCK = web.AppKey("clock", Callable[[], float])
SESSION = web.AppKey("session", str)
OPERATOR = web.AppKey("operator", _OperatorSlot)
SOCKETS = web.AppKey("sockets", weakref.WeakSet)


def create_app(
    config: HostConfig,
    session: str,
    clock: Callable[[], float] = time.monotonic,
) -> web.Application:
    """Build the bridge's web application. `clock` is the host monotonic clock, in seconds."""
    app = web.Application()
    app[CONFIG] = config
    app[CLOCK] = clock
    app[SESSION] = session
    app[OPERATOR] = _OperatorSlot()
    app[SOCKETS] = weakref.WeakSet()
    app.router.add_get("/ws", _handle_socket)
    app.on_shutdown.append(_close_sockets)
    return app


async def _close_sockets(app: web.Application) -> None:
    for ws in set(app[SOCKETS]):
        await ws.close(code=WSCloseCode.GOING_AWAY, message=b"bridge shutting down")


async def _handle_socket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    request.app[SOCKETS].add(ws)
    connection = _Connection(request.app, ws)
    try:
        async for msg in ws:
            if msg.type is WSMsgType.TEXT:
                await connection.receive(msg.data)
            elif msg.type is WSMsgType.BINARY:
                await connection.receive_binary()
            else:
                _log.warning("closing a socket after %s: %s", msg.type.name, ws.exception())
                break
    finally:
        request.app[OPERATOR].release(connection)
    return ws


class _Connection:
    def __init__(self, app: web.Application, ws: web.WebSocketResponse) -> None:
        self._app = app
        self._ws = ws
        self._seq = 0
        self._role: Role | None = None
        self._last_seq: int | None = None
        self._last_input_t_ms: float | None = None
        self._last_input_reply_s: dict[ReplyCode, float] = {}

    async def receive(self, text: str) -> None:
        raw = _json_object(text)
        ref = _seq_of(raw)
        if raw is None:
            await self._reject_or_close(ref, "not a JSON object")
            return
        if "v" in raw and not (type(raw["v"]) is int and raw["v"] == 1):
            await self._close(ref, "version", "this bridge speaks message format v1")
            return
        if self._role is None and raw.get("type") != "hello":
            await self._close(ref, "invalid", "the first message must be hello")
            return
        try:
            message = TABLET_MESSAGE.validate_python(raw)
        except ValidationError as error:
            await self._reject_or_close(ref, _first_error(error), input_stream=raw.get("type") == "input")
            return
        if self._last_seq is not None and message.seq <= self._last_seq:
            detail = f"seq {message.seq} does not follow {self._last_seq}"
            await self._reject(ref, "invalid", detail, input_stream=isinstance(message, Input))
            return
        if self._last_seq is not None and message.seq > self._last_seq + 1:
            _log.info("seq gap: %d messages missing before seq %d", message.seq - self._last_seq - 1, message.seq)
        self._last_seq = message.seq
        await self._handle(message, message.seq)

    async def receive_binary(self) -> None:
        await self._reject_or_close(None, "messages must be text frames")

    async def _handle(self, message: Hello | Input | Event | Command, ref: int) -> None:
        match message:
            case Hello() if self._role is not None:
                await self._reject(ref, "invalid", "hello was already received")
            case Hello():
                await self._welcome(message, ref)
            case Command():
                await self._reject(ref, "not_allowed", f"{message.name} is not supported yet")
            case Input() | Event() if not self._app[OPERATOR].held_by(self):
                detail = f"only the operator sends {message.type}"
                await self._reject(ref, "not_allowed", detail, input_stream=isinstance(message, Input))
            case Input():
                if self._last_input_t_ms is not None and message.t_ms < self._last_input_t_ms:
                    detail = "input t_ms is earlier than the previous input"
                    await self._reject(ref, "invalid", detail, input_stream=True)
                else:
                    self._last_input_t_ms = message.t_ms
            case Event():
                pass
            case _:
                assert_never(message)

    async def _welcome(self, hello: Hello, ref: int) -> None:
        if hello.role == "operator" and not self._app[OPERATOR].claim(self):
            await self._close(ref, "busy", "another operator is connected")
            return
        self._role = hello.role
        await self._send(
            Welcome(
                seq=self._next_seq(),
                host_ms=self._host_ms(),
                session=self._app[SESSION],
                role=hello.role,
                config=self._app[CONFIG],
            )
        )

    async def _reject(self, ref: int | None, code: ReplyCode, detail: str, input_stream: bool = False) -> None:
        if input_stream and not self._input_reply_due(code):
            return
        await self._send(
            Reply(seq=self._next_seq(), host_ms=self._host_ms(), ref=ref, ok=False, code=code, detail=detail)
        )

    async def _close(self, ref: int | None, code: ReplyCode, detail: str) -> None:
        await self._reject(ref, code, detail)
        await self._ws.close()

    async def _reject_or_close(self, ref: int | None, detail: str, input_stream: bool = False) -> None:
        if self._role is None:
            await self._close(ref, "invalid", detail)
        else:
            await self._reject(ref, "invalid", detail, input_stream)

    def _input_reply_due(self, code: ReplyCode) -> bool:
        """The protocol allows one reply each second for each error code on the input stream."""
        now = self._app[CLOCK]()
        last = self._last_input_reply_s.get(code)
        if last is not None and now - last < _INPUT_REPLY_INTERVAL_S:
            return False
        self._last_input_reply_s[code] = now
        return True

    async def _send(self, message: Welcome | Reply) -> None:
        await self._ws.send_str(encode(message))

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def _host_ms(self) -> float:
        return round(self._app[CLOCK]() * 1000, 1)


def _json_object(text: str) -> dict[str, Any] | None:
    try:
        raw = json.loads(text)
    except ValueError:
        return None
    return raw if isinstance(raw, dict) else None


def _first_error(error: ValidationError) -> str:
    first = error.errors()[0]
    where = ".".join(str(part) for part in first["loc"])
    return f"{where}: {first['msg']}" if where else first["msg"]


def _seq_of(raw: dict[str, Any] | None) -> int | None:
    seq = raw.get("seq") if raw is not None else None
    return seq if type(seq) is int else None
