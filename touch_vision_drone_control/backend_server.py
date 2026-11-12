import argparse
from datetime import datetime

from aiohttp import web

from touch_vision_drone_control.drone_connection import Position
from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection
from touch_vision_drone_control.ws_server import create_app

DEFAULT_PORT = 8765


def main() -> None:
    """Start the Python command bridge on plain HTTP. In development, Vite's HTTPS server forwards `/ws` here."""
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    pads = {pad.id: Position(pad.x, pad.y, 0.0) for pad in PLACEHOLDER_CONFIG.course.pads}
    drones = MockDroneConnection(PLACEHOLDER_CONFIG.drones, start=pads)
    app = create_app(PLACEHOLDER_CONFIG, drones, session=datetime.now().strftime("s%Y%m%d-%H%M%S"))
    web.run_app(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
