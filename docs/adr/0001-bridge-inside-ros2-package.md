---
status: accepted
---

# The Python command bridge lives inside the ROS 2 package

The Python command bridge is a Python package named `touch_vision_drone_control/` inside the repo-root ROS 2 package that Galvez set up (`package.xml`, `setup.py`). It isn't a separate `bridge/` uv project, which is what the 2026-09-30 bridge guide recommended. The bridge runs on the flight host next to ROS 2 and Crazyswarm2. One `ament_python` package gives the flight host one package to build. Only the Crazyswarm2 drone connection imports `rclpy`. The WebSocket server and the mock drone connection don't, so they still run and test on a laptop with plain pytest and no ROS install. Decided 2026-10-20.

## Amendment, 2026-11-13: the real Crazyswarm2 client owns rclpy

The Crazyswarm2 drone connection talks to Crazyswarm2 only through a Crazyswarm2 client. Only the real Crazyswarm2 client imports `rclpy`. The Crazyswarm2 drone connection itself and the fake Crazyswarm2 client import without it, so the contract suite runs against the Crazyswarm2 drone connection on a laptop.

## Consequences

- Keep the bridge code out of `scripts/`. It holds the repo check script (`scripts/check.py`). The empty `scripts/backend_server.py` entry point in `setup.py` moves to the bridge package when the bridge has code.
- Python dependencies that ROS 2 doesn't ship, such as aiohttp and Pydantic, need an install path on the flight host. Pick one when the first such dependency lands.
