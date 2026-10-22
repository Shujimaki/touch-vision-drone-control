import json

import pytest
from aiohttp import ClientWSTimeout, WSMsgType

from protocol_examples import example

from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG
from touch_vision_drone_control.ws_server import create_app

TEST_CONFIG = PLACEHOLDER_CONFIG.model_copy(update={"id": "test-config", "input_timeout_ms": 123.0, "drones": ["cf7"]})
INPUT = example("input-three-drones-climbing")


@pytest.fixture
async def connect(aiohttp_client):
    client = await aiohttp_client(create_app(TEST_CONFIG, session="s-test", clock=lambda: 1.23456))

    async def open_socket():
        return await client.ws_connect("/ws", timeout=ClientWSTimeout(ws_receive=2))

    return open_socket


async def say_hello(ws, role: str = "operator") -> dict:
    await ws.send_json(example("hello", role=role))
    return await ws.receive_json()


async def assert_closed(ws) -> None:
    msg = await ws.receive()
    assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED)


async def assert_still_open(ws, seq: int) -> None:
    await ws.send_json(INPUT | {"seq": seq, "extra": 1})
    reply = await ws.receive_json()
    assert (reply["ref"], reply["code"]) == (seq, "invalid")


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

    assert [(await ws.receive_json())["seq"] for _ in range(2)] == [2, 3]


async def test_a_first_message_other_than_hello_gets_invalid_and_closes(connect) -> None:
    ws = await connect()

    await ws.send_json(example("command-takeoff", seq=1))
    reply = await ws.receive_json()

    assert reply == {**reply, "type": "reply", "v": 1, "seq": 1, "ref": 1, "ok": False, "code": "invalid"}
    assert reply.keys() == example("reply-rejected").keys()
    await assert_closed(ws)


async def test_a_malformed_first_hello_gets_invalid_and_closes(connect) -> None:
    ws = await connect()

    await ws.send_json(example("hello", extra=1))
    reply = await ws.receive_json()

    assert (reply["ref"], reply["code"]) == (1, "invalid")
    await assert_closed(ws)


@pytest.mark.parametrize("message", [example("hello", v=2), {"type": "input", "v": 2, "seq": 4, "junk": True}])
async def test_a_first_message_with_v_other_than_1_gets_version_and_closes(connect, message) -> None:
    ws = await connect()

    await ws.send_json(message)
    reply = await ws.receive_json()

    assert (reply["ok"], reply["code"], reply["ref"]) == (False, "version", message["seq"])
    await assert_closed(ws)


@pytest.mark.parametrize("v", [2, True])
async def test_a_later_message_with_v_other_than_1_gets_version_and_closes(connect, v) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(INPUT | {"seq": 2, "v": v})
    reply = await ws.receive_json()

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
    reply = await ws.receive_json()

    assert (reply["ok"], reply["code"], reply["ref"]) == (False, "invalid", ref)
    await assert_still_open(ws, 3)


async def test_a_binary_frame_gets_invalid_and_the_connection_stays_open(connect) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_bytes(json.dumps(INPUT | {"seq": 2}).encode())
    reply = await ws.receive_json()

    assert (reply["ref"], reply["code"]) == (None, "invalid")
    await assert_still_open(ws, 2)


@pytest.mark.parametrize("seq", [1, 5])
async def test_a_message_whose_seq_does_not_increase_gets_invalid(connect, seq) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 5})

    await ws.send_json(INPUT | {"seq": seq})
    reply = await ws.receive_json()

    assert (reply["ref"], reply["code"]) == (seq, "invalid")


async def test_a_skipped_seq_is_accepted(connect) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 9})

    await ws.send_json(INPUT | {"seq": 9})
    reply = await ws.receive_json()

    assert "does not follow 9" in reply["detail"]


async def test_integer_numbers_are_accepted_where_the_format_allows_a_number(connect) -> None:
    ws = await connect()

    await ws.send_json(example("hello", t_ms=5321))
    welcome = await ws.receive_json()

    assert welcome["type"] == "welcome"


async def test_an_input_earlier_than_the_previous_input_gets_invalid(connect) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 2})

    await ws.send_json(INPUT | {"seq": 3, "t_ms": INPUT["t_ms"] - 1})
    reply = await ws.receive_json()

    assert (reply["ref"], reply["code"]) == (3, "invalid")


async def test_an_event_may_carry_an_earlier_t_ms_than_the_previous_input(connect) -> None:
    ws = await connect()
    await say_hello(ws)
    await ws.send_json(INPUT | {"seq": 2})

    await ws.send_json(example("event-release-cancelled", seq=3, t_ms=1.0))
    await ws.send_json(example("event-release-cancelled", seq=3))
    reply = await ws.receive_json()

    assert "does not follow 3" in reply["detail"]


@pytest.mark.parametrize("message", [INPUT, example("event-release-cancelled")])
async def test_input_and_events_from_an_experimenter_get_not_allowed(connect, message) -> None:
    ws = await connect()
    await say_hello(ws, role="experimenter")

    await ws.send_json(message | {"seq": 2})
    reply = await ws.receive_json()

    assert (reply["ref"], reply["code"]) == (2, "not_allowed")


async def test_commands_are_not_supported_yet(connect) -> None:
    ws = await connect()
    await say_hello(ws)

    await ws.send_json(example("command-takeoff", seq=2))
    reply = await ws.receive_json()

    assert (reply["ref"], reply["code"]) == (2, "not_allowed")
