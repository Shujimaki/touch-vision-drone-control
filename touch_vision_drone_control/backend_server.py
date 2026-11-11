import argparse
import ssl
from datetime import datetime
from pathlib import Path

from aiohttp import web

from touch_vision_drone_control.drone_connection import Position
from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection
from touch_vision_drone_control.ws_server import create_app

DEFAULT_PORT = 8765


def main() -> None:
    """Start the Python command bridge. Without --web-app, Vite's dev server serves the page and forwards `/ws` here.
    With --web-app, --cert and --key, the bridge serves the built tablet web app and `/ws` from one HTTPS origin."""
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--web-app", type=Path, help="folder with the built tablet web app, such as web/dist")
    parser.add_argument("--cert", type=Path, help="certificate file; serves HTTPS together with --key")
    parser.add_argument("--key", type=Path, help="private key file for --cert")
    args = parser.parse_args()
    if (args.cert is None) != (args.key is None):
        parser.error("--cert and --key go together")
    if args.web_app is not None and not (args.web_app / "index.html").is_file():
        parser.error(f"{args.web_app} has no index.html; run npm run build in web/ first")
    tls = None
    if args.cert is not None:
        tls = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        tls.load_cert_chain(args.cert, args.key)
    pads = {pad.id: Position(pad.x, pad.y, 0.0) for pad in PLACEHOLDER_CONFIG.course.pads}
    drones = MockDroneConnection(PLACEHOLDER_CONFIG.drones, start=pads)
    session = datetime.now().strftime("s%Y%m%d-%H%M%S")
    app = create_app(PLACEHOLDER_CONFIG, drones, session=session, web_app_dir=args.web_app)
    web.run_app(app, host=args.host, port=args.port, ssl_context=tls)


if __name__ == "__main__":
    main()
