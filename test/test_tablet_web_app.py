from pathlib import Path

import pytest

from protocol_examples import example
from test_ws_server import receive_reply

from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection
from touch_vision_drone_control.ws_server import create_app

INDEX = "<!DOCTYPE html><title>tablet</title>"


@pytest.fixture
def web_app_dir(tmp_path: Path) -> Path:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(INDEX)
    (tmp_path / "assets" / "index-abc.js").write_text("export {};")
    return tmp_path


def bridge(web_app_dir: Path | None = None):
    drones = MockDroneConnection(PLACEHOLDER_CONFIG.drones)
    return create_app(PLACEHOLDER_CONFIG, drones, session="s-test", web_app_dir=web_app_dir)


async def test_the_bridge_serves_the_tablet_web_app_at_the_root(aiohttp_client, web_app_dir) -> None:
    client = await aiohttp_client(bridge(web_app_dir))

    response = await client.get("/")

    assert response.status == 200
    assert response.content_type == "text/html"
    assert await response.text() == INDEX


async def test_the_bridge_serves_a_tablet_web_app_script_as_javascript(aiohttp_client, web_app_dir) -> None:
    client = await aiohttp_client(bridge(web_app_dir))

    response = await client.get("/assets/index-abc.js")

    assert response.status == 200
    assert response.content_type in ("text/javascript", "application/javascript")
    assert await response.text() == "export {};"


async def test_the_socket_still_answers_beside_the_tablet_web_app(aiohttp_client, web_app_dir) -> None:
    client = await aiohttp_client(bridge(web_app_dir))
    ws = await client.ws_connect("/ws")

    await ws.send_json(example("hello"))

    assert (await receive_reply(ws))["type"] == "welcome"


async def test_without_a_tablet_web_app_the_bridge_serves_only_the_socket(aiohttp_client) -> None:
    client = await aiohttp_client(bridge())

    assert (await client.get("/")).status == 404
