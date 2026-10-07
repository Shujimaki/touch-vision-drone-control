import json
import math
from pathlib import Path

import pytest

from bridge import messages
from bridge.config import load
from bridge.mocap import MockSource, Pose, to_course
from bridge.server import make_app

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "protocol" / "examples"
CFG = load(ROOT / "bridge" / "bridge.toml")
MOCK = CFG.model_copy(update={"mocap": CFG.mocap.model_copy(update={"source": "mock"})})


def example(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


def shape(obj: object) -> object:
    """Keys and nesting of a message, without values. Lists take the shape of their first entry."""
    if isinstance(obj, dict):
        return {k: shape(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [shape(obj[0])] if obj and isinstance(obj[0], (dict, list)) else []
    return None


def hello(**changes: object) -> dict:
    return {**example("hello.json"), **changes}


# ---------- frames ----------

def yaw_quat(deg: float, up: str) -> list[float]:
    h = math.radians(deg) / 2
    return [math.cos(h), 0.0, math.sin(h), 0.0] if up == "y" else [math.cos(h), 0.0, 0.0, math.sin(h)]


def test_z_up_passes_through_with_offset():
    x, y, z, yaw = to_course([1.0, 2.0, 0.5], yaw_quat(30, "z"), "z", [0.1, 0.2, 0.0])
    assert (round(x, 6), round(y, 6), round(z, 6), round(yaw, 6)) == (1.1, 2.2, 0.5, 30.0)


def test_y_up_maps_height_to_z_and_keeps_yaw():
    # Motive Y-up: height is y. Course: (x, -z, y), so a body 0.5 m up at Motive z = -2 lies at course y = 2.
    x, y, z, yaw = to_course([1.0, 0.5, -2.0], yaw_quat(90, "y"), "y", [0.0, 0.0, 0.0])
    assert (round(x, 6), round(y, 6), round(z, 6), round(yaw, 6)) == (1.0, 2.0, 0.5, 90.0)


def test_rotation_turns_the_floor_axes_and_the_yaw():
    # Motive +x points along course +y (rotation 90): one metre along Motive x lands one metre along course y.
    x, y, z, yaw = to_course([1.0, 0.0, 0.4], yaw_quat(120, "z"), "z", [0.5, 0.5, 0.0], rotation=90)
    assert (round(x, 6), round(y, 6), round(z, 6), round(yaw, 6)) == (0.5, 1.5, 0.4, -150.0)


def test_lost_tracking_gives_no_pose():
    assert to_course([math.nan, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], "z", [0.0, 0.0, 0.0]) is None


# ---------- messages ----------

def test_welcome_matches_the_example_shape():
    built = messages.welcome(CFG, 1, 1000.0, "s1", "operator")
    assert shape(built) == shape(example("welcome.json"))


def test_telemetry_matches_the_example_shape():
    t = MockSource(MOCK, clock=lambda: 10.0)
    built = messages.telemetry(CFG, t.latest(), 5, 10.0, None)
    ex = example("telemetry-cf3-defensive-hover.json")
    assert built.pop("trial") is None and ex.pop("trial") is not None   # trial is an object or null
    assert shape(built) == shape(ex)
    json.dumps(built, allow_nan=False)


def test_telemetry_reports_measured_obstacles_and_nulls_before_a_pose():
    poses = {"O1": Pose(1.5, 1.6, 1.02, 12.0, t=9.99)}
    built = messages.telemetry(CFG, poses, 1, 10.0, None)
    o1, o2 = built["obstacles"]
    assert o1 == {"id": "O1", "x": 1.5, "y": 1.6, "z": 1.02, "yaw": 12.0, "pos_age_ms": 10.0}
    assert o2 == {"id": "O2", "x": None, "y": None, "z": None, "yaw": None, "pos_age_ms": None}
    cf1 = built["drones"][0]
    assert cf1["x"] is None and cf1["link"] == "lost" and cf1["cmd"] == {"x": 2.35, "y": 0.45, "z": 0.0}


def test_telemetry_reports_measured_hoops():
    built = messages.telemetry(CFG, {"H2": Pose(4.0, 2.6, 0.55, 80.0, t=9.98)}, 1, 10.0, None)
    assert [h["id"] for h in built["hoops"]] == ["H1", "H2", "H3"]
    assert built["hoops"][1] == {"id": "H2", "x": 4.0, "y": 2.6, "z": 0.55, "yaw": 80.0, "pos_age_ms": 20.0}
    assert built["hoops"][0]["x"] is None


def test_mock_drones_keep_their_spacing():
    poses = MockSource(MOCK, clock=lambda: 3.3).latest()
    a, b = poses["cf1"], poses["cf2"]
    assert math.hypot(a.x - b.x, a.y - b.y) == pytest.approx(0.3)


# ---------- WebSocket ----------

@pytest.fixture
async def client(aiohttp_client):
    return await aiohttp_client(make_app(MOCK, MockSource(MOCK)))


async def test_hello_gets_welcome_then_live_telemetry(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json(hello())
    welcome = await ws.receive_json()
    assert welcome["type"] == "welcome" and welcome["seq"] == 1 and welcome["config"]["drones"] == ["cf1", "cf2", "cf3"]
    await ws.send_json({"type": "input", "v": 1, "seq": 2, "t_ms": 6000.0})
    for _ in range(10):
        t = await ws.receive_json()
        if t["ack"]["seq"] == 2:
            break
    assert t["type"] == "telemetry" and t["seq"] > 1
    assert t["ack"]["t_ms"] == 6000.0
    assert all(d["x"] is not None for d in t["drones"]) and [o["id"] for o in t["obstacles"]] == ["O1", "O2"]
    assert [h["id"] for h in t["hoops"]] == ["H1", "H2", "H3"]
    await ws.close()


async def test_first_message_must_be_hello(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "input", "v": 1, "seq": 1, "t_ms": 1.0})
    r = await ws.receive_json()
    assert (r["type"], r["ok"], r["code"], r["ref"]) == ("reply", False, "invalid", 1)


async def test_other_version_is_refused(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json(hello(v=2))
    assert (await ws.receive_json())["code"] == "version"


async def test_second_operator_is_busy(client):
    first = await client.ws_connect("/ws")
    await first.send_json(hello())
    await first.receive_json()
    second = await client.ws_connect("/ws")
    await second.send_json(hello())
    assert (await second.receive_json())["code"] == "busy"
    await first.close()


async def test_commands_are_not_allowed_without_a_flight_link(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json(hello())
    await ws.receive_json()
    await ws.send_json(example("command-takeoff.json") | {"seq": 2})
    while (r := await ws.receive_json())["type"] != "reply":
        pass
    assert (r["ref"], r["code"]) == (2, "not_allowed")
    await ws.close()
