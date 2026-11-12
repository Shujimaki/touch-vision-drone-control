import asyncio
import json
import math
import time
from dataclasses import replace

import pytest
from aiohttp import ClientWSTimeout, WSMsgType

from protocol_examples import example

from touch_vision_drone_control.backend_server import build_bridge
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
INPUT = example(
    "input-three-drones-climbing", held=[], gesture={"state": "idle", "rate": 0.0, "neutral_y": None}, frames=[]
)


class FakeClock:
    def __init__(self) -> None:
        self.s = 1.23456

    def __call__(self) -> float:
        return self.s


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


async def socket_opener(aiohttp_client, clock, config, drones):
    client = await aiohttp_client(create_app(config, drones, session="s-test", clock=clock))

    async def open_socket():
        return await client.ws_connect("/ws", timeout=ClientWSTimeout(ws_receive=2))

    return open_socket


@pytest.fixture
async def connect(aiohttp_client, clock):
    drones = MockDroneConnection(TEST_CONFIG.drones, clock=clock, start={"cf7": Position(1.5, 2.0, 0.0)})
    return await socket_opener(aiohttp_client, clock, TEST_CONFIG, drones)


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


def command(name: str, seq: int, drones: list[str] | None = None) -> dict:
    args = {} if drones is None else {"drones": drones}
    return example("command-takeoff", seq=seq, name=name, args=args)


async def telemetry_until(ws, clock, state: str) -> dict:
    while True:
        telemetry = await receive_telemetry(ws)
        drone = telemetry["drones"][0]
        if telemetry["host_ms"] >= round(clock.s * 1000, 1) and drone["state"] == state:
            return drone


async def test_takeoff_gets_ok_and_the_drone_climbs_to_flying(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(command("takeoff", 2, ["cf7"]))
    reply = await receive_reply(ws)

    assert reply == {**reply, "type": "reply", "ref": 2, "ok": True, "code": None, "detail": None}
    assert (await telemetry_until(ws, clock, "taking_off"))["z"] == 0.0
    clock.s += 1.0
    flying = await telemetry_until(ws, clock, "flying")
    assert (flying["x"], flying["y"], flying["z"]) == (1.5, 2.0, 0.5)


async def test_a_drone_that_reaches_flying_is_held_where_it_arrived(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(command("takeoff", 2, ["cf7"]))
    await receive_reply(ws)

    clock.s += 1.0
    flying = await telemetry_until(ws, clock, "flying")
    clock.s += 5.0

    assert (await telemetry_until(ws, clock, "flying"))["z"] == 0.5
    assert flying["cmd"] == {"x": 1.5, "y": 2.0, "z": 0.5}


async def test_land_gets_ok_and_the_drone_descends_to_grounded(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(command("takeoff", 2, ["cf7"]))
    await receive_reply(ws)
    clock.s += 1.0
    await telemetry_until(ws, clock, "flying")

    await ws.send_json(command("land", 3, ["cf7"]))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["ok"], reply["code"]) == (3, True, None)
    assert (await telemetry_until(ws, clock, "landing"))["z"] == 0.5
    clock.s += 1.0
    grounded = await telemetry_until(ws, clock, "grounded")
    assert (grounded["z"], grounded["cmd"]) == (0.0, {"x": 1.5, "y": 2.0, "z": 0.0})


async def test_a_command_naming_a_drone_not_in_the_configuration_gets_unknown_drone(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(command("takeoff", 2, ["cf7", "cf9"]))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["ok"], reply["code"], reply["detail"]) == (2, False, "unknown_drone", "cf9")
    assert (await telemetry_until(ws, clock, "grounded"))["z"] == 0.0


async def test_land_while_grounded_gets_not_allowed_with_a_detail(connect) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(command("land", 2, ["cf7"]))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["ok"], reply["code"], reply["detail"]) == (2, False, "not_allowed", "cf7: not_airborne")


async def test_takeoff_while_flying_gets_not_allowed_and_the_drone_keeps_flying(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(command("takeoff", 2, ["cf7"]))
    await receive_reply(ws)
    clock.s += 1.0
    await telemetry_until(ws, clock, "flying")

    await ws.send_json(command("takeoff", 3, ["cf7"]))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"], reply["detail"]) == (3, "not_allowed", "cf7: not_grounded")
    assert (await telemetry_until(ws, clock, "flying"))["z"] == 0.5


async def test_a_command_that_some_drones_refuse_gets_not_allowed_and_the_rest_still_move(aiohttp_client, clock) -> None:
    config = TEST_CONFIG.model_copy(update={"drones": ["cf7", "cf8"]})
    drones = MockDroneConnection(config.drones, clock=clock)
    client = await aiohttp_client(create_app(config, drones, session="s-test", clock=clock))
    ws = await client.ws_connect("/ws", timeout=ClientWSTimeout(ws_receive=2))
    await say_hello(ws)
    await ws.send_json(command("takeoff", 2, ["cf8"]))
    await receive_reply(ws)

    await ws.send_json(command("takeoff", 3, ["cf7", "cf8"]))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["ok"], reply["code"], reply["detail"]) == (3, False, "not_allowed", "cf8: not_grounded")
    assert [d["state"] for d in (await receive_telemetry(ws))["drones"]] == ["taking_off", "taking_off"]


@pytest.mark.parametrize(
    "args",
    [{}, {"drones": "cf7"}, {"drones": []}, {"drones": ["cf7", "cf7"]}, {"drones": ["cf7"], "extra": 1}],
)
async def test_takeoff_with_malformed_args_gets_invalid_and_nothing_moves(connect, clock, args) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(command("takeoff", 2) | {"args": args})
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["ok"], reply["code"]) == (2, False, "invalid")
    assert (await telemetry_until(ws, clock, "grounded"))["z"] == 0.0


async def test_an_experimenter_can_take_off_a_drone(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws, role="experimenter")

    await ws.send_json(command("takeoff", 2, ["cf7"]))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["ok"], reply["code"]) == (2, True, None)
    assert (await telemetry_until(ws, clock, "taking_off"))["id"] == "cf7"


@pytest.mark.parametrize("name", ["stop", "stop_reset", "set_mode", "trial_start", "trial_end"])
async def test_other_commands_are_not_supported_yet(connect, name) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(command(name, 2))
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"], reply["detail"]) == (2, "not_allowed", f"{name} is not supported yet")


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


_BAD_FOR_S = 0.2
"""How long a fake drone connection stays bad. The setpoint stream also asks for reports, so one bad answer is not enough."""


class _Reports(MockDroneConnection):
    """Reports `first` for the first 0.2 s, then `then` forever."""

    def __init__(self, first: list[DroneReport], then: list[DroneReport] | None = None) -> None:
        super().__init__(["cf7"])
        self._first, self._then, self._start = first, then or first, time.monotonic()

    def reports(self) -> list[DroneReport]:
        return self._first if time.monotonic() - self._start < _BAD_FOR_S else self._then


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


async def test_telemetry_keeps_flowing_after_a_report_it_cannot_send(aiohttp_client, caplog) -> None:
    bad = replace(FULL_REPORT, position=Position(math.nan, 0.0, 0.0))
    ws = await open_with(aiohttp_client, _Reports([bad], [FULL_REPORT]))

    telemetry = await receive_telemetry(ws)

    assert telemetry["drones"][0]["y"] == 2.0
    assert "skipping telemetry ticks: a drone report does not fit message format v1" in caplog.text


async def test_a_refused_operator_gets_no_telemetry(connect) -> None:
    first, second = await connect(), await connect()
    await say_hello(first)

    await second.send_json(example("hello"))

    assert (await second.receive_json())["code"] == "busy"
    assert (await second.receive()).type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED)


class _FailsAtFirst(MockDroneConnection):
    def __init__(self) -> None:
        super().__init__(["cf7"])
        self._start = time.monotonic()

    def reports(self):
        if time.monotonic() - self._start < _BAD_FOR_S:
            raise RuntimeError("radio hiccup")
        return super().reports()


async def test_telemetry_keeps_flowing_after_the_drone_connection_fails(aiohttp_client, caplog) -> None:
    client = await aiohttp_client(create_app(TEST_CONFIG, _FailsAtFirst(), session="s-test"))
    ws = await client.ws_connect("/ws", timeout=ClientWSTimeout(ws_receive=2))
    await say_hello(ws)

    telemetry = await receive_telemetry(ws)

    assert [d["id"] for d in telemetry["drones"]] == ["cf7"]
    assert "skipping telemetry ticks: the drone connection failed to report" in caplog.text


def held_input(seq: int, x: float, y: float, drone: str = "cf7") -> dict:
    t_ms = INPUT["t_ms"] + seq
    return INPUT | {"seq": seq, "t_ms": t_ms, "held": [{"id": drone, "x": x, "y": y, "touch_ms": t_ms, "follow": True}]}


def empty_input(seq: int) -> dict:
    return INPUT | {"seq": seq, "t_ms": INPUT["t_ms"] + seq}


async def acked_drone(ws, clock, seq: int) -> dict:
    while True:
        telemetry = await receive_telemetry(ws)
        if telemetry["ack"]["seq"] == seq and telemetry["host_ms"] >= round(clock.s * 1000, 1):
            return telemetry["drones"][0]


async def take_off(ws, clock, drone: str = "cf7") -> None:
    await ws.send_json(command("takeoff", 2, [drone]))
    await receive_reply(ws)
    clock.s += 1.0
    await telemetry_until(ws, clock, "flying")


async def acked_after(ws, clock, message: dict) -> dict:
    await ws.send_json(message)
    return await acked_drone(ws, clock, message["seq"])


async def fly_and_unlock(ws, clock, drone: str = "cf7") -> None:
    await take_off(ws, clock, drone)
    await ws.send_json(empty_input(3))
    await acked_drone(ws, clock, 3)


async def test_a_held_drone_moves_toward_its_target_at_the_speed_limit(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await fly_and_unlock(ws, clock)

    for seq in range(4, 14):
        drone = await acked_after(ws, clock, held_input(seq, 1.5, 3.0))
        assert (drone["held"], drone["cmd"]) == (True, {"x": 1.5, "y": 3.0, "z": 0.5})
        clock.s += 0.1
    drone = await acked_after(ws, clock, held_input(14, 1.5, 3.0))

    assert (drone["x"], drone["y"], drone["z"]) == (1.5, 2.5, 0.5)


async def test_a_held_entry_for_a_drone_that_is_not_flying_is_ignored(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await acked_after(ws, clock, empty_input(2))

    drone = await acked_after(ws, clock, held_input(3, 1.5, 3.0))
    clock.s += 1.0

    assert (drone["held"], drone["state"]) == (False, "grounded")
    assert (await acked_drone(ws, clock, 3))["y"] == 2.0


async def test_a_released_drone_holds_the_position_where_it_was_released(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await fly_and_unlock(ws, clock)
    for seq in range(4, 8):
        await acked_after(ws, clock, held_input(seq, 1.5, 3.0))
        clock.s += 0.1

    released = await acked_after(ws, clock, empty_input(8))
    clock.s += 0.1
    later = await acked_after(ws, clock, empty_input(9))

    assert (released["held"], released["cmd"]) == (False, {"x": 1.5, "y": 2.2, "z": 0.5})
    assert (later["x"], later["y"], later["z"]) == (1.5, 2.2, 0.5)


async def test_stale_input_drops_the_hold_until_an_input_with_no_held_drone(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await fly_and_unlock(ws, clock)
    await acked_after(ws, clock, held_input(4, 1.5, 3.0))

    clock.s += 0.124
    stale = await acked_drone(ws, clock, 4)
    ignored = [(await acked_after(ws, clock, held_input(seq, 1.5, 3.0)))["held"] for seq in (5, 6)]
    await acked_after(ws, clock, empty_input(7))
    resumed = await acked_after(ws, clock, held_input(8, 1.5, 3.0))

    assert (stale["held"], stale["cmd"]) == (False, {"x": 1.5, "y": 3.0, "z": 0.5})
    assert ignored == [False, False]
    assert resumed["held"] is True


async def test_a_new_operator_must_send_an_empty_held_list_before_holding(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await take_off(ws, clock)

    locked = [(await acked_after(ws, clock, held_input(seq, 1.5, 3.0)))["held"] for seq in (3, 4)]
    await acked_after(ws, clock, empty_input(5))
    resumed = await acked_after(ws, clock, held_input(6, 1.5, 3.0))

    assert (locked, resumed["held"]) == ([False, False], True)


class _CountsTargets(MockDroneConnection):
    def __init__(self, clock) -> None:
        super().__init__(["cf7"], clock=clock)
        self.sent = 0

    def send_target(self, drone, target):
        self.sent += 1
        return super().send_target(drone, target)


async def test_the_bridge_streams_setpoints_to_a_flying_drone_at_20_hz_or_more_without_input(aiohttp_client, clock) -> None:
    drones = _CountsTargets(clock)
    ws = await open_with(aiohttp_client, drones, clock)
    await take_off(ws, clock)

    before = drones.sent
    await asyncio.sleep(0.5)

    assert drones.sent - before >= 10


@pytest.mark.parametrize(
    ("held", "code"),
    [
        ([{"id": "cf9", "x": 1.5, "y": 3.0, "touch_ms": 1.0, "follow": True}], "unknown_drone"),
        ([{"id": "cf7", "x": 1.5, "y": 3.0, "touch_ms": 1.0, "follow": True}] * 2, "invalid"),
    ],
    ids=["unknown-drone", "repeated-drone"],
)
async def test_an_input_with_a_bad_held_name_is_rejected_and_not_acknowledged(connect, clock, held, code) -> None:
    ws = await connect()
    await say_hello(ws)
    await acked_after(ws, clock, empty_input(2))

    await ws.send_json(empty_input(3) | {"held": held})
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (3, code)
    assert (await receive_telemetry(ws))["ack"]["seq"] == 2


@pytest.mark.parametrize(
    "gesture",
    [{"state": "idle", "rate": 0.1, "neutral_y": None}, {"state": "active", "rate": 0.21, "neutral_y": 0.5}],
    ids=["rate-outside-active", "rate-above-rate-max"],
)
async def test_an_input_with_a_rate_the_gesture_state_does_not_allow_is_rejected(connect, gesture) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(empty_input(2) | {"gesture": gesture})
    reply = await receive_reply(ws)

    assert (reply["ref"], reply["code"]) == (2, "invalid")


@pytest.mark.parametrize(("x", "y"), [(2.5, 2.0), (0.2, 2.0)], ids=["restricted-zone", "outside-capture-volume"])
async def test_a_held_target_outside_the_allowed_area_keeps_the_previous_target(connect, clock, x, y) -> None:
    ws = await connect()
    await say_hello(ws)
    await fly_and_unlock(ws, clock)
    await acked_after(ws, clock, held_input(4, 1.5, 3.0))

    await ws.send_json(held_input(5, x, y))
    reply = await receive_reply(ws)
    drone = await acked_drone(ws, clock, 5)

    assert (reply["ref"], reply["code"]) == (5, "invalid")
    assert (drone["held"], drone["cmd"]) == (True, {"x": 1.5, "y": 3.0, "z": 0.5})


async def test_a_held_target_within_one_rounding_step_of_the_zone_edge_is_accepted(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await fly_and_unlock(ws, clock)

    drone = await acked_after(ws, clock, held_input(4, 2.0655, 2.0))

    assert (drone["held"], drone["cmd"]["x"]) == (True, 2.066)


async def test_an_experimenter_sees_the_operator_hold(connect, clock) -> None:
    operator, experimenter = await connect(), await connect()
    await say_hello(operator)
    await say_hello(experimenter, role="experimenter")
    await fly_and_unlock(operator, clock)

    await acked_after(operator, clock, held_input(4, 1.5, 3.0))

    while not (await receive_telemetry(experimenter))["drones"][0]["held"]:
        pass


async def test_an_empty_held_list_with_an_active_gesture_does_not_unlock_holds(connect, clock) -> None:
    ws = await connect()
    await say_hello(ws)
    await take_off(ws, clock)
    active = {"state": "active", "rate": 0.0, "neutral_y": 0.5}

    await acked_after(ws, clock, empty_input(3) | {"gesture": active})
    drone = await acked_after(ws, clock, held_input(4, 1.5, 3.0))

    assert drone["held"] is False


async def test_a_held_entry_sent_before_takeoff_does_not_move_the_drone_once_it_flies(aiohttp_client, clock) -> None:
    drones = MockDroneConnection(["cf7"], clock=clock, takeoff_height_m=0.01, start={"cf7": Position(1.5, 2.0, 0.0)})
    ws = await open_with(aiohttp_client, drones, clock)
    await acked_after(ws, clock, empty_input(2))
    await acked_after(ws, clock, held_input(3, 1.5, 3.0))
    await ws.send_json(command("takeoff", 4, ["cf7"]))
    await receive_reply(ws)

    clock.s += 0.05
    flying = await telemetry_until(ws, clock, "flying")

    assert (flying["held"], flying["cmd"]) == (False, {"x": 1.5, "y": 2.0, "z": 0.01})


async def test_the_next_operator_must_send_an_empty_held_list_after_the_first_disconnects(connect, clock) -> None:
    first = await connect()
    await say_hello(first)
    await fly_and_unlock(first, clock)
    await acked_after(first, clock, held_input(4, 1.5, 3.0))
    await first.close()

    second = await connect()
    await say_hello(second)
    held = await acked_after(second, clock, held_input(2, 1.5, 3.0))

    assert held["held"] is False


@pytest.fixture
async def connect_takeoff(aiohttp_client, clock):
    return await socket_opener(aiohttp_client, clock, *build_bridge("mock", "takeoff", clock))


async def test_the_takeoff_configuration_reaches_the_tablet_in_the_welcome(connect_takeoff) -> None:
    ws = await connect_takeoff()

    welcome = await say_hello(ws)

    assert welcome["config"]["id"] == "takeoff-draft-0.1"
    assert welcome["config"]["drones"] == ["cf1"]
    assert welcome["config"]["course"]["capture_volume"] == {"x_min": -0.5, "x_max": 0.5, "y_min": -0.5, "y_max": 0.5}


async def test_with_the_takeoff_configuration_a_held_target_outside_the_box_is_ignored(connect_takeoff, clock) -> None:
    ws = await connect_takeoff()
    await say_hello(ws)
    await fly_and_unlock(ws, clock, "cf1")
    await acked_after(ws, clock, held_input(4, 0.2, -0.3, "cf1"))

    await ws.send_json(held_input(5, 0.6, 0.0, "cf1"))
    reply = await receive_reply(ws)
    drone = await acked_drone(ws, clock, 5)

    assert (reply["ref"], reply["code"]) == (5, "invalid")
    assert (drone["held"], drone["cmd"]) == (True, {"x": 0.2, "y": -0.3, "z": 0.5})
