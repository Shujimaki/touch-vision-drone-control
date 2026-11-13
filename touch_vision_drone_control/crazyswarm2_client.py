"""The real Crazyswarm2 client: the one bridge module that imports `rclpy` (ADR 0001).

It drives a running Crazyswarm2 server through `crazyflie_py` 1.0.7, from the flight host's venv (ADR 0008).
"""

import threading
import time

import rclpy
from crazyflie_interfaces.msg import Status
from crazyflie_py.crazyflie import Crazyflie, CrazyflieServer
from geometry_msgs.msg import PoseStamped
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from rclpy.signals import SignalHandlerOptions
from std_srvs.srv import Empty

from touch_vision_drone_control.crazyswarm2_drone_connection import (
    RESET_PARAM,
    STREAM_HZ,
    Crazyswarm2Callbacks,
    Crazyswarm2StartupError,
)
from touch_vision_drone_control.drone_connection import Position

SERVER_TIMEOUT_S = 10.0
DRONE_TIMEOUT_S = 2.0
FIRST_POSE_TIMEOUT_S = 5.0
"""Not yet checked on cf1. The pose topic runs at 10 Hz in config/crazyflies.yaml."""
FLUSH_S = 1.0
"""Not yet checked on cf1. How long `close` keeps ROS 2 running, so the last land request leaves the flight host."""
QUEUE_DEPTH = 10


class RosCrazyswarm2Client:
    """Connects to the Crazyswarm2 server and checks that it serves every drone in `drones`.

    Raises `Crazyswarm2StartupError` instead of waiting forever, because `CrazyflieServer()` waits for its services
    without a timeout.
    """

    def __init__(self, drones: list[str]) -> None:
        rclpy.init(signal_handler_options=SignalHandlerOptions.NO)
        try:
            _wait_for_server(drones)
            self._server = CrazyflieServer()
            self._crazyflies = _crazyflies_of(self._server, drones)
        except BaseException:
            rclpy.shutdown()
            raise
        self._executor = SingleThreadedExecutor()
        self._thread = threading.Thread(target=self._executor.spin, name="crazyswarm2-client", daemon=True)

    def start(self, callbacks: Crazyswarm2Callbacks) -> None:
        try:
            self._start(callbacks)
        except BaseException:
            self.close()
            raise

    def _start(self, callbacks: Crazyswarm2Callbacks) -> None:
        first_pose = {name: threading.Event() for name in self._crazyflies}

        def on_pose(name: str, message: PoseStamped) -> None:
            point = message.pose.position
            callbacks.on_pose(name, Position(point.x, point.y, point.z))
            first_pose[name].set()

        def on_status(name: str, message: Status) -> None:
            callbacks.on_status(name, float(message.battery_voltage))

        for name in self._crazyflies:
            self._server.create_subscription(
                PoseStamped, f"/{name}/pose", lambda message, name=name: on_pose(name, message), QUEUE_DEPTH
            )
            self._server.create_subscription(
                Status, f"/{name}/status", lambda message, name=name: on_status(name, message), QUEUE_DEPTH
            )
        self._server.create_timer(1 / STREAM_HZ, callbacks.on_tick)
        self._executor.add_node(self._server)
        self._thread.start()
        deadline = time.monotonic() + FIRST_POSE_TIMEOUT_S
        silent = [name for name, seen in first_pose.items() if not seen.wait(max(0.0, deadline - time.monotonic()))]
        if silent:
            raise Crazyswarm2StartupError(
                f"--drones crazyswarm2: no pose from {', '.join(silent)} within {FIRST_POSE_TIMEOUT_S:g} s. "
                "Check that the drone is on, that its uri in crazyflies.yaml is the drone you mean to fly, "
                "and that the Crazyradio is plugged in"
            )

    def takeoff(self, drone: str, height_m: float, duration_s: float) -> None:
        self._crazyflies[drone].takeoff(height_m, duration_s)

    def land(self, drone: str, height_m: float, duration_s: float) -> None:
        self._crazyflies[drone].land(height_m, duration_s)

    def notify_setpoints_stop(self, drone: str) -> None:
        self._crazyflies[drone].notifySetpointsStop()

    def cmd_position(self, drone: str, target: Position) -> None:
        self._crazyflies[drone].cmdPosition([target.x, target.y, target.z])

    def set_param(self, drone: str, name: str, value: float) -> None:
        self._crazyflies[drone].setParam(name, value)

    def close(self) -> None:
        try:
            time.sleep(FLUSH_S)
            self._executor.shutdown(timeout_sec=FLUSH_S)
            if self._thread.is_alive():
                self._thread.join(timeout=FLUSH_S)
            self._server.destroy_node()
        finally:
            rclpy.shutdown()


def _wait_for_server(drones: list[str]) -> None:
    node = Node("touch_vision_drone_control_server_check")
    try:
        if not node.create_client(Empty, "/all/emergency").wait_for_service(timeout_sec=SERVER_TIMEOUT_S):
            raise Crazyswarm2StartupError(
                f"--drones crazyswarm2: no Crazyswarm2 server answered within {SERVER_TIMEOUT_S:g} s. "
                "Start it first with ros2 launch crazyflie launch.py"
            )
        missing = [
            name
            for name in drones
            if not node.create_client(Empty, f"/{name}/emergency").wait_for_service(timeout_sec=DRONE_TIMEOUT_S)
        ]
        if missing:
            raise Crazyswarm2StartupError(
                f"--drones crazyswarm2: the Crazyswarm2 server has no {', '.join(missing)}. "
                "Set enabled: true for it in the crazyflies.yaml the server was launched with"
            )
    finally:
        node.destroy_node()


def _crazyflies_of(server: CrazyflieServer, drones: list[str]) -> dict[str, Crazyflie]:
    crazyflies = {}
    for name in drones:
        crazyflie = server.crazyfliesByName.get(name)
        if crazyflie is None:
            raise Crazyswarm2StartupError(f"--drones crazyswarm2: crazyflie_py found no {name} on the Crazyswarm2 server")
        if RESET_PARAM not in crazyflie.paramTypeDict:
            raise Crazyswarm2StartupError(
                f"--drones crazyswarm2: the Crazyswarm2 server lists no {RESET_PARAM} parameter for {name}, "
                "so takeoff could not reset its position estimate"
            )
        server.get_logger().info(f"{name} flies at {crazyflie.uri}")
        crazyflies[name] = crazyflie
    return crazyflies
