import math
from dataclasses import dataclass

from fake_clock import FakeClock

from touch_vision_drone_control.crazyswarm2_drone_connection import (
    STREAM_HZ,
    Crazyswarm2Callbacks,
)
from touch_vision_drone_control.drone_connection import Position

STATUS_PERIOD_S = 1.0
FAKE_BATTERY_V = 4.0


@dataclass
class _Plan:
    start: Position
    start_s: float
    end_z: float
    duration_s: float
    motors_off_at_end: bool


@dataclass
class _Drone:
    position: Position
    plan: _Plan | None = None


class FakeCrazyswarm2Client:
    def __init__(self, clock: FakeClock, drones: list[str]) -> None:
        self._clock = clock
        self._drones = {name: _Drone(Position(0.0, 0.0, 0.0)) for name in drones}
        self._callbacks: Crazyswarm2Callbacks | None = None
        self._next_status_s = clock()

    def start(self, callbacks: Crazyswarm2Callbacks) -> None:
        self._callbacks = callbacks

    def takeoff(self, drone: str, height_m: float, duration_s: float) -> None:
        self._plan(drone, height_m, duration_s, motors_off_at_end=False)

    def land(self, drone: str, height_m: float, duration_s: float) -> None:
        self._plan(drone, height_m, duration_s, motors_off_at_end=True)

    def notify_setpoints_stop(self, drone: str) -> None:
        pass

    def cmd_position(self, drone: str, target: Position) -> None:
        self._drones[drone].plan = None
        self._drones[drone].position = target

    def set_param(self, drone: str, name: str, value: float) -> None:
        if name == "kalman.resetEstimation" and value == 1:
            here = self._drones[drone].position
            self._drones[drone].position = Position(0.0, 0.0, here.z)

    def advance(self, seconds: float) -> None:
        assert self._callbacks is not None, "the connection never started the client"
        steps = max(1, math.ceil(seconds * STREAM_HZ - 1e-9))
        for _ in range(steps):
            self._clock.advance(seconds / steps)
            now = self._clock()
            for name, drone in self._drones.items():
                self._fly(drone, now)
                self._callbacks.on_pose(name, drone.position)
            if now >= self._next_status_s - 1e-9:
                self._next_status_s = now + STATUS_PERIOD_S
                for name in self._drones:
                    self._callbacks.on_status(name, FAKE_BATTERY_V)
            self._callbacks.on_tick()

    def _plan(self, drone: str, end_z: float, duration_s: float, *, motors_off_at_end: bool) -> None:
        here = self._drones[drone].position
        self._drones[drone].plan = _Plan(here, self._clock(), end_z, duration_s, motors_off_at_end)

    def _fly(self, drone: _Drone, now: float) -> None:
        plan = drone.plan
        if plan is None:
            return
        progress = min(1.0, (now - plan.start_s) / plan.duration_s)
        start = plan.start
        z = start.z + (plan.end_z - start.z) * progress
        if progress == 1.0:
            drone.plan = None
            if plan.motors_off_at_end:
                z = 0.0
        drone.position = Position(start.x, start.y, z)
