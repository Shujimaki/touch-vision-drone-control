import argparse
import importlib
import ssl
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Literal, Protocol, get_args

from aiohttp import web

from touch_vision_drone_control.drone_connection import DroneConnection, Position
from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG, TAKEOFF_CONFIG
from touch_vision_drone_control.messages import HostConfig
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection
from touch_vision_drone_control.ws_server import create_app

DEFAULT_PORT = 8765

DroneOption = Literal["mock", "crazyswarm2"]
ConfigOption = Literal["course", "takeoff"]

CRAZYSWARM2_MODULE = "touch_vision_drone_control.crazyswarm2_drone_connection"

_CONFIGS: dict[ConfigOption, HostConfig] = {"course": PLACEHOLDER_CONFIG, "takeoff": TAKEOFF_CONFIG}


class StartupError(Exception):
    pass


class Crazyswarm2Constructor(Protocol):
    def __call__(self, config: HostConfig, *, clock: Callable[[], float]) -> DroneConnection: ...


def build_bridge(
    drone_option: DroneOption, config_option: ConfigOption, clock: Callable[[], float]
) -> tuple[HostConfig, DroneConnection]:
    config = _CONFIGS[config_option]
    match drone_option:
        case "mock":
            pads = {pad.id: Position(pad.x, pad.y, 0.0) for pad in config.course.pads}
            return config, MockDroneConnection(config.drones, clock=clock, start=pads)
        case "crazyswarm2":
            return config, _crazyswarm2(config, clock)


def _crazyswarm2(config: HostConfig, clock: Callable[[], float]) -> DroneConnection:
    """Import the Crazyswarm2 drone connection only here, so the mock runs without ROS 2 (ADR 0001)."""
    try:
        module = importlib.import_module(CRAZYSWARM2_MODULE)
    except ModuleNotFoundError as error:
        if error.name != CRAZYSWARM2_MODULE:
            raise
        raise StartupError(
            f"--drones crazyswarm2: the Crazyswarm2 drone connection is not available ({CRAZYSWARM2_MODULE} is missing)"
        ) from error
    construct: Crazyswarm2Constructor = module.Crazyswarm2DroneConnection
    return construct(config, clock=clock)


def option_parser() -> argparse.ArgumentParser:
    """The bridge's command-line options. Without --web-app, Vite's dev server serves the page and forwards `/ws` here.
    With --web-app, --cert and --key, the bridge serves the built tablet web app and `/ws` from one HTTPS origin."""
    parser = argparse.ArgumentParser(description=option_parser.__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--web-app", type=Path, help="folder with the built tablet web app, such as web/dist")
    parser.add_argument("--cert", type=Path, help="certificate file; serves HTTPS together with --key")
    parser.add_argument("--key", type=Path, help="private key file for --cert")
    parser.add_argument("--drones", choices=get_args(DroneOption), default="mock", help="drone connection")
    parser.add_argument("--config", choices=get_args(ConfigOption), default="course", help="host configuration")
    return parser


def main() -> None:
    parser = option_parser()
    args = parser.parse_args()
    if (args.cert is None) != (args.key is None):
        parser.error("--cert and --key go together")
    if args.web_app is not None and not (args.web_app / "index.html").is_file():
        parser.error(f"{args.web_app} has no index.html; run npm run build in web/ first")
    tls = None
    if args.cert is not None:
        tls = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        tls.load_cert_chain(args.cert, args.key)
    clock = time.monotonic
    try:
        config, drones = build_bridge(args.drones, args.config, clock)
    except StartupError as error:
        parser.error(str(error))
    session = datetime.now().strftime("s%Y%m%d-%H%M%S")
    app = create_app(config, drones, session=session, clock=clock, web_app_dir=args.web_app)
    web.run_app(app, host=args.host, port=args.port, ssl_context=tls)


if __name__ == "__main__":
    main()
