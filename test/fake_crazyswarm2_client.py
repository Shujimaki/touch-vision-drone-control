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
SETPOINT_TIMEOUT_S = 2.0
"""The firmware cuts the motors after this long without a setpoint (ADR 0009)."""
MODELED_PARAMS = frozenset({"kalman.resetEstimation"})


@dataclass(frozen=True)
class Call:
    at: float
    drone: str
    method: str
    args: tuple[object, ...]


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
    setpoints_in_control_since: float | None = None
    sends_telemetry: bool = True
    climb_limit_m: float = math.inf


class FakeCrazyswarm2Client:
    def __init__(self, clock: FakeClock, drones: list[str]) -> None:
        self._clock = clock
        self._drones = {name: _Drone(Position(0.0, 0.0, 0.0)) for name in drones}
        self._callbacks: Crazyswarm2Callbacks | None = None
        self._next_status_s = clock()
        self.calls: list[Call] = []

    def start(self, callbacks: Crazyswarm2Callbacks) -> None:
        self._callbacks = callbacks

    def takeoff(self, drone: str, height_m: float, duration_s: float) -> None:
        self._log(drone, "takeoff", height_m, duration_s)
        self._plan(drone, height_m, duration_s, motors_off_at_end=False)

    def land(self, drone: str, height_m: float, duration_s: float) -> None:
        self._log(drone, "land", height_m, duration_s)
        self._plan(drone, height_m, duration_s, motors_off_at_end=True)

    def notify_setpoints_stop(self, drone: str) -> None:
        self._log(drone, "notify_setpoints_stop")
        self._drones[drone].setpoints_in_control_since = None

    def cmd_position(self, drone: str, target: Position) -> None:
        self._log(drone, "cmd_position", target)
        state = self._drones[drone]
        state.plan = None
        state.setpoints_in_control_since = self._clock()
        state.position = target

    def set_param(self, drone: str, name: str, value: float) -> None:
        if name not in MODELED_PARAMS:
            raise ValueError(f"the fake Crazyswarm2 client does not model the parameter {name}")
        self._log(drone, "set_param", name, value)
        if value == 1:
            here = self._drones[drone].position
            self._drones[drone].position = Position(0.0, 0.0, here.z)

    def drop_telemetry(self, drone: str) -> None:
        self._drones[drone].sends_telemetry = False

    def stall_climb(self, drone: str, height_m: float) -> None:
        self._drones[drone].climb_limit_m = height_m

    def calls_to(self, drone: str, *methods: str) -> list[Call]:
        return [call for call in self.calls if call.drone == drone and call.method in methods]

    def advance(self, seconds: float) -> None:
        assert self._callbacks is not None, "the connection never started the client"
        steps = max(1, math.ceil(seconds * STREAM_HZ - 1e-9))
        for _ in range(steps):
            self._clock.advance(seconds / steps)
            now = self._clock()
            for name, drone in self._drones.items():
                self._fly(drone, now)
                if drone.sends_telemetry:
                    self._callbacks.on_pose(name, drone.position)
            if now >= self._next_status_s - 1e-9:
                self._next_status_s = now + STATUS_PERIOD_S
                for name, drone in self._drones.items():
                    if drone.sends_telemetry:
                        self._callbacks.on_status(name, FAKE_BATTERY_V)
            self._callbacks.on_tick()

    def _log(self, drone: str, method: str, *args: object) -> None:
        self.calls.append(Call(self._clock(), drone, method, args))

    def _plan(self, drone: str, end_z: float, duration_s: float, *, motors_off_at_end: bool) -> None:
        state = self._drones[drone]
        if state.setpoints_in_control_since is not None:
            return
        state.plan = _Plan(state.position, self._clock(), min(end_z, state.climb_limit_m), duration_s, motors_off_at_end)

    def _fly(self, drone: _Drone, now: float) -> None:
        if drone.setpoints_in_control_since is not None and now - drone.setpoints_in_control_since >= SETPOINT_TIMEOUT_S - 1e-9:
            drone.setpoints_in_control_since = None
            drone.position = Position(drone.position.x, drone.position.y, 0.0)
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
