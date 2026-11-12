import asyncio
import json
import math
from dataclasses import replace

import pytest
from aiohttp import ClientWSTimeout, WSMsgType

from protocol_examples import example

from touch_vision_drone_control.drone_connection import (
    DefensiveHover,
    DroneReport,
    FlightState,
    LinkStatus,
    Position,
    Ranges,
)
from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection
from touch_vision_drone_control.ws_server import create_app

TEST_CONFIG = PLACEHOLDER_CONFIG.model_copy(update={"id": "test-config", "input_timeout_ms": 123.0, "drones": ["cf7"]})
INPUT = example("input-three-drones-climbing")


class FakeClock:
    def __init__(self) -> None:
        self.s = 1.23456

    def __call__(self) -> float:
        return self.s


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
async def connect(aiohttp_client, clock):
    drones = MockDroneConnection(TEST_CONFIG.drones, clock=clock, start={"cf7": Position(1.5, 2.0, 0.0)})
    client = await aiohttp_client(create_app(TEST_CONFIG, drones, session="s-test", clock=clock))

    async def open_socket():
        return await client.ws_connect("/ws", timeout=ClientWSTimeout(ws_receive=2))

    return open_socket


async def say_hello(ws, role: str = "operator") -> dict:
    await ws.send_json(example("hello", role=role))
    return await receive_reply(ws)


async def receive_reply(ws) -> dict:
    while (message := await ws.receive_json())["type"] == "telemetry":
        pass
    return message


async def receive_telemetry(ws) -> dict:
    while (message := await ws.receive_json())["type"] != "telemetry":
        pass
    return message


async def assert_closed(ws) -> None:
    while (msg := await ws.receive()).type is WSMsgType.TEXT and json.loads(msg.data)["type"] == "telemetry":
        pass
    assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED)


async def assert_still_open(ws, seq: int) -> None:
    await ws.send_json(example("hello", seq=seq))
    reply = await receive_reply(ws)
    assert (reply["ref"], reply["code"], reply["detail"]) == (seq, "invalid", "hello was already received")


async def test_hello_gets_a_welcome_with_the_bridge_configuration(connect) -> None:
    ws = await connect()

    welcome = await say_hello(ws)

    assert welcome.keys() == example("welcome").keys()
    assert (welcome["type"], welcome["v"], welcome["seq"], welcome["role"]) == ("welcome", 1, 1, "operator")
    assert (welcome["session"], welcome["host_ms"]) == ("s-test", 1234.6)
    assert welcome["config"] == TEST_CONFIG.model_dump(mode="json")


async def test_the_host_numbers_its_own_messages(connect) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_str("not json")
    await ws.send_str("not json")

    seqs, replies = [], 0
    while replies < 2:
        message = await ws.receive_json()
        seqs.append(message["seq"])
        replies += message["type"] == "reply"
    assert seqs == list(range(2, 2 + len(seqs)))


async def test_a_first_message_other_than_hello_gets_invalid_and_closes(connect) -> None:
    ws = await connect()

    await ws.send_json(example("command-takeoff", seq=1))
    reply = await receive_reply(ws)

    assert reply == {**reply, "type": "reply", "v": 1, "seq": 1, "ref": 1, "ok": False, "code": "invalid"}
    assert reply.keys() == example("reply-rejected").keys()
    await assert_closed(ws)


async def test_a_malformed_first_hello_gets_invalid_and_closes(connect) -> None:
    ws = await connect()

    await ws.send_json(example("hello", extra=1))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (1, "invalid")
    await assert_closed(ws)


@pytest.mark.parametrize("message", [example("hello", v=2), {"type": "input", "v": 2, "seq": 4, "junk": True}])
async def test_a_first_message_with_v_other_than_1_gets_version_and_closes(connect, message) -> None:
    ws = await connect()

    await ws.send_json(message)
    reply = await receive_reply(ws)

    assert (reply["ok"], reply["code"], reply["ref"]) == (False, "version", message["seq"])
    await assert_closed(ws)


@pytest.mark.parametrize("v", [2, True])
async def test_a_later_message_with_v_other_than_1_gets_version_and_closes(connect, v) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(INPUT | {"seq": 2, "v": v})
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (2, "version")
    await assert_closed(ws)


async def test_a_second_operator_gets_busy_and_the_first_stays_open(connect) -> None:
    first, second = await connect(), await connect()
    await say_hello(first)

    reply = await say_hello(second)

    assert (reply["ok"], reply["code"], reply["ref"]) == (False, "busy", 1)
    await assert_closed(second)
    await assert_still_open(first, 2)


async def test_an_experimenter_can_join_the_operator(connect) -> None:
    operator, experimenter = await connect(), await connect()
    await say_hello(operator)

    welcome = await say_hello(experimenter, role="experimenter")

    assert (welcome["type"], welcome["role"]) == ("welcome", "experimenter")


async def test_a_new_operator_can_connect_after_the_first_one_leaves(connect) -> None:
    first = await connect()
    await say_hello(first)
    await first.close()

    welcome = await say_hello(await connect())

    assert welcome["type"] == "welcome"


@pytest.mark.parametrize(
    ("text", "ref"),
    [
        ("not json", None),
        ("[1, 2]", None),
        (json.dumps(INPUT | {"seq": 2, "extra": 1}), 2),
        (json.dumps({k: v for k, v in INPUT.items() if k != "frames"} | {"seq": 2}), 2),
        (json.dumps(INPUT | {"seq": 2, "t_ms": "812345.6"}), 2),
        (json.dumps(INPUT | {"seq": 2}).replace('"rtt_ms": 14.2', '"rtt_ms": NaN'), 2),
        (json.dumps(INPUT | {"seq": 2, "type": "dance"}), 2),
        (json.dumps(INPUT | {"seq": 2.0}), None),
    ],
    ids=["not-json", "not-object", "extra-field", "missing-field", "wrong-type", "nan", "unknown-type", "float-seq"],
)
async def test_a_malformed_message_gets_invalid_and_the_connection_stays_open(connect, text, ref) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_str(text)
    reply = await receive_reply(ws)

    assert (reply["ok"], reply["code"], reply["ref"]) == (False, "invalid", ref)
    await assert_still_open(ws, 3)


async def test_a_binary_frame_gets_invalid_and_the_connection_stays_open(connect) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_bytes(json.dumps(INPUT | {"seq": 2}).encode())
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (None, "invalid")
    await assert_still_open(ws, 2)


async def test_a_binary_first_frame_gets_invalid_and_closes(connect) -> None:
    ws = await connect()

    await ws.send_bytes(json.dumps(example("hello")).encode())
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (None, "invalid")
    await assert_closed(ws)


@pytest.mark.parametrize("seq", [1, 5])
async def test_a_message_whose_seq_does_not_increase_gets_invalid(connect, seq) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 5})

    await ws.send_json(INPUT | {"seq": seq})
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (seq, "invalid")


async def test_a_skipped_seq_is_accepted(connect) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 9})

    await ws.send_json(INPUT | {"seq": 9})
    reply = await receive_reply(ws)

    assert "does not follow 9" in reply["detail"]


async def test_integer_numbers_are_accepted_where_the_format_allows_a_number(connect) -> None:
    ws = await connect()

    await ws.send_json(example("hello", t_ms=5321))
    welcome = await receive_reply(ws)

    assert welcome["type"] == "welcome"


async def test_an_input_earlier_than_the_previous_input_gets_invalid(connect) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 2})

    await ws.send_json(INPUT | {"seq": 3, "t_ms": INPUT["t_ms"] - 1})
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (3, "invalid")


async def test_an_event_may_carry_an_earlier_t_ms_than_the_previous_input(connect) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 2})

    await ws.send_json(example("event-release-cancelled", seq=3, t_ms=1.0))
    await ws.send_json(example("event-release-cancelled", seq=3))
    reply = await receive_reply(ws)

    assert "does not follow 3" in reply["detail"]


@pytest.mark.parametrize("message", [INPUT, example("event-release-cancelled")])
async def test_input_and_events_from_an_experimenter_get_not_allowed(connect, message) -> None:
    ws = await connect()
    await say_hello(ws, role="experimenter")

    await ws.send_json(message | {"seq": 2})
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (2, "not_allowed")


async def test_commands_are_not_supported_yet(connect) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(example("command-takeoff", seq=2))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (2, "not_allowed")


async def test_input_replies_are_limited_to_one_each_second_for_each_code(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 2})

    for seq in (3, 4):
        await ws.send_json(INPUT | {"seq": seq, "t_ms": INPUT["t_ms"] - 1})
    await ws.send_json(INPUT | {"seq": 5, "extra": 1})
    assert (await receive_reply(ws))["ref"] == 3
    await assert_still_open(ws, 6)

    clock.s += 1.0
    await ws.send_json(INPUT | {"seq": 7, "t_ms": INPUT["t_ms"] - 1})
    assert (await receive_reply(ws))["ref"] == 7


async def test_telemetry_flows_after_welcome_without_any_input(connect) -> None:
    ws = await connect()
    await say_hello(ws)

    telemetry = await receive_telemetry(ws)

    assert telemetry.keys() == example("telemetry-cf3-defensive-hover").keys()
    assert (telemetry["mode"], telemetry["trial"]) == ("course", None)
    assert telemetry["ack"] == {"seq": None, "t_ms": None, "host_rx_ms": None}
    assert telemetry["altitude"] == {"rate": 0.0, "blocked_by": None, "reason": None}
    assert telemetry["drones"] == [
        {
            "id": "cf7", "held": False, "state": "grounded", "link": "ok",
            "x": 1.5, "y": 2.0, "z": 0.0, "yaw": None, "pos_age_ms": 0.0,
            "cmd": {"x": 1.5, "y": 2.0, "z": 0.0},
            "ranges": {"front": None, "back": None, "left": None, "right": None, "up": None},
            "defensive_hover": None,
            "battery_v": None,
        }
    ]


async def test_telemetry_arrives_at_the_welcome_rate(connect) -> None:
    ws = await connect()
    welcome = await say_hello(ws)
    count, loop = 0, asyncio.get_running_loop()

    end = loop.time() + 0.5
    while loop.time() < end:
        await receive_telemetry(ws)
        count += 1

    assert welcome["config"]["telemetry_hz"] == 30
    assert 10 <= count <= 20


async def test_telemetry_acknowledges_the_latest_valid_input(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    clock.s = 2.5

    await ws.send_json(INPUT | {"seq": 2})
    await ws.send_json(INPUT | {"seq": 3, "t_ms": INPUT["t_ms"] - 1})
    await receive_reply(ws)
    telemetry = await receive_telemetry(ws)

    assert telemetry["ack"] == {"seq": 2, "t_ms": INPUT["t_ms"], "host_rx_ms": 2500.0}


async def test_an_experimenter_gets_telemetry_too(connect) -> None:
    ws = await connect()
    await say_hello(ws, role="experimenter")

    telemetry = await receive_telemetry(ws)

    assert [d["id"] for d in telemetry["drones"]] == ["cf7"]


FULL_REPORT = DroneReport(
    drone="cf7",
    state=FlightState.FLYING,
    link=LinkStatus.OK,
    position=Position(1.23456, 2.0004, 0.7),
    position_measured_at=1.2,
    ranges=Ranges(front=0.23, back=None, left=2.8, right=0.75, up=1.95),
    battery_v=3.88,
    defensive_hover=DefensiveHover(direction="front", range_m=0.2304),
    radio_measured_at=1.2,
)


class _Reports(MockDroneConnection):
    """Reports each listed batch once, then the last one forever."""

    def __init__(self, *batches: list[DroneReport]) -> None:
        super().__init__(["cf7"])
        self._batches = list(batches)

    def reports(self) -> list[DroneReport]:
        return self._batches.pop(0) if len(self._batches) > 1 else self._batches[0]


async def open_with(aiohttp_client, drones, clock=lambda: 1.23456):
    client = await aiohttp_client(create_app(TEST_CONFIG, drones, session="s-test", clock=clock))
    ws = await client.ws_connect("/ws", timeout=ClientWSTimeout(ws_receive=2))
    await say_hello(ws)
    return ws


async def test_telemetry_carries_every_reading_of_a_drone_report(aiohttp_client) -> None:
    ws = await open_with(aiohttp_client, _Reports([FULL_REPORT]))

    drone = (await receive_telemetry(ws))["drones"][0]

    assert drone == {
        "id": "cf7", "held": False, "state": "flying", "link": "ok",
        "x": 1.235, "y": 2.0, "z": 0.7, "yaw": None, "pos_age_ms": 34.6,
        "cmd": {"x": 1.235, "y": 2.0, "z": 0.7},
        "ranges": {"front": 0.23, "back": None, "left": 2.8, "right": 0.75, "up": 1.95},
        "defensive_hover": {"dir": "front", "range": 0.23},
        "battery_v": 3.88,
    }


async def test_telemetry_keeps_flowing_after_a_report_it_cannot_send(aiohttp_client) -> None:
    bad = replace(FULL_REPORT, position=Position(math.nan, 0.0, 0.0))
    ws = await open_with(aiohttp_client, _Reports([bad], [FULL_REPORT]))

    telemetry = await receive_telemetry(ws)

    assert telemetry["drones"][0]["y"] == 2.0


async def test_a_refused_operator_gets_no_telemetry(connect) -> None:
    first, second = await connect(), await connect()
    await say_hello(first)

    await second.send_json(example("hello"))

    assert (await second.receive_json())["code"] == "busy"
    assert (await second.receive()).type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED)


class _FailsOnce(MockDroneConnection):
    def __init__(self) -> None:
        super().__init__(["cf7"])
        self.failed = False

    def reports(self):
        if not self.failed:
            self.failed = True
            raise RuntimeError("radio hiccup")
        return super().reports()


async def test_telemetry_keeps_flowing_after_the_drone_connection_fails_once(aiohttp_client) -> None:
    drones = _FailsOnce()
    client = await aiohttp_client(create_app(TEST_CONFIG, drones, session="s-test"))
    ws = await client.ws_connect("/ws", timeout=ClientWSTimeout(ws_receive=2))
    await say_hello(ws)

    telemetry = await receive_telemetry(ws)

    assert drones.failed
    assert [d["id"] for d in telemetry["drones"]] == ["cf7"]
