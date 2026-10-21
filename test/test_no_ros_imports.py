"""The bridge runs and tests without ROS 2. Only the Crazyswarm2 drone connection may import rclpy (ADR 0001)."""

import subprocess
import sys
import textwrap

ALLOWED_TO_IMPORT_RCLPY = {"touch_vision_drone_control.crazyswarm2_drone_connection"}

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
