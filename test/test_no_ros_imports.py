"""The bridge runs and tests without ROS 2. Only the real Crazyswarm2 client may import rclpy (ADR 0001)."""

import subprocess
import sys
import textwrap

ALLOWED_TO_IMPORT_RCLPY = {"touch_vision_drone_control.crazyswarm2_client"}
CRAZYSWARM2_MODULES = ALLOWED_TO_IMPORT_RCLPY | {"touch_vision_drone_control.crazyswarm2_drone_connection"}

IMPORT_ALL_WITH_RCLPY_BLOCKED = textwrap.dedent(
    f"""
    import importlib, pkgutil, sys
    sys.modules["rclpy"] = None  # any import of rclpy now raises ImportError
    import touch_vision_drone_control as package
    for module in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        if module.name not in {ALLOWED_TO_IMPORT_RCLPY!r}:
            importlib.import_module(module.name)
    """
)


def test_bridge_modules_import_without_rclpy() -> None:
    result = subprocess.run(
        [sys.executable, "-c", IMPORT_ALL_WITH_RCLPY_BLOCKED],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


START_THE_MOCK_WITH_RCLPY_BLOCKED = textwrap.dedent(
    f"""
    import sys
    import time
    sys.modules["rclpy"] = None
    from touch_vision_drone_control.backend_server import build_bridge, option_parser
    for config in ("course", "takeoff"):
        options = option_parser().parse_args(["--config", config])
        build_bridge(options.drones, options.config, time.monotonic)
    imported = {CRAZYSWARM2_MODULES!r} & sys.modules.keys()
    assert not imported, imported
    """
)


def test_the_default_drone_connection_never_imports_the_crazyswarm2_module() -> None:
    result = subprocess.run(
        [sys.executable, "-c", START_THE_MOCK_WITH_RCLPY_BLOCKED],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
