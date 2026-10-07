"""Runs the bridge: uv run bridge [--config bridge.toml] [--mock] [--cert CERT --key KEY]."""
from __future__ import annotations

import argparse
import logging
import ssl

from aiohttp import web

from .config import load
from .mocap import make_source
from .server import make_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Stream motion-capture positions to the tablet over WebSocket.")
    parser.add_argument("--config", default="bridge.toml", help="host configuration file (default: bridge.toml)")
    parser.add_argument("--mock", action="store_true", help="use synthetic positions instead of OptiTrack")
    parser.add_argument("--cert", help="TLS certificate for wss://, for example from mkcert")
    parser.add_argument("--key", help="TLS private key that matches --cert")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    cfg = load(args.config)
    if args.mock:
        cfg = cfg.model_copy(update={"mocap": cfg.mocap.model_copy(update={"source": "mock"})})
    context = None
    if args.cert:
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(args.cert, args.key)
    web.run_app(make_app(cfg, make_source(cfg)), host=cfg.server.host, port=cfg.server.port, ssl_context=context)


if __name__ == "__main__":
    main()
