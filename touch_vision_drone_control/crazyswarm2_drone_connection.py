"""The Crazyswarm2 drone connection: drives the real drones through Crazyswarm2.

Crazyswarm2 sends commands but tracks no flight state, so this drone connection
keeps the flight state itself and confirms it from the onboard estimate. It
talks only to a `Crazyswarm2Client`. Only the real client may import `rclpy`
(ADR 0001).

While a drone is flying or stopped, the stream publishes `cmd_position` on
every tick. docs/adr/0009-crazyswarm2-drone-connection-behavior.md records the
rules.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum, auto
from typing import Literal, Protocol

from touch_vision_drone_control.drone_connection import (
    DroneConnection,
    DroneReport,
    FlightState,
    LinkStatus,
    Position,
    Ranges,
    Reply,
)
from touch_vision_drone_control.messages import HostConfig

TAKEOFF_HEIGHT_M = 0.4
"""Takeoff height for the first flights (ADR 0007)."""
SPEED_LIMIT_MPS = 0.3
"""Fastest the sent target moves toward the requested target (ADR 0007)."""

STREAM_HZ = 30.0
TAKEOFF_S = 2.0
LAND_S = 2.5
LAND_HEIGHT_M = 0.03
RESET_SETTLE_S = 1.5
"""Not yet checked on cf1. ADR 0009 requires a settle wait but gives no value."""
TAKEOFF_MARGIN_S = 3.0
"""Not yet checked on cf1. A drone still climbing this long after the takeoff time lands (ADR 0009)."""
ARRIVE_TOLERANCE_M = 0.05
GROUND_Z_M = 0.08
LINK_TIMEOUT_S = 0.5
"""Not yet checked on cf1. A drone whose last pose is older than this has a lost link (ADR 0009)."""

NO_POSITION = Position(math.nan, math.nan, math.nan)
NO_RANGES = Ranges(front=None, back=None, left=None, right=None, up=None)
NEVER = -math.inf

type _Command = Literal["takeoff", "land", "send_target"]

_ACCEPTED_IN: dict[_Command, tuple[frozenset[FlightState], str]] = {
    "takeoff": (frozenset({FlightState.GROUNDED}), "not_grounded"),
    "land": (
        frozenset({FlightState.TAKING_OFF, FlightState.FLYING, FlightState.LANDING, FlightState.STOPPED}),
        "not_airborne",
    ),
    "send_target": (frozenset({FlightState.FLYING}), "not_flying"),
}
"""For each command: the flight states that accept it, and the reject reason otherwise."""

_STREAMING = frozenset({FlightState.FLYING, FlightState.STOPPED})


class Crazyswarm2StartupError(Exception):
    pass


@dataclass(frozen=True)
class Crazyswarm2Callbacks:
    """What a client delivers to the drone connection, from one thread, in arrival order."""

    on_pose: Callable[[str, Position], None]
    on_status: Callable[[str, float], None]
    """Battery voltage of one drone, about once a second."""
    on_tick: Callable[[], None]
    """Fires at about `STREAM_HZ`."""


class Crazyswarm2Client(Protocol):
    """The commands the drone connection sends to Crazyswarm2. Each one maps to one `crazyflie_py` call."""

    def start(self, callbacks: Crazyswarm2Callbacks) -> None: ...
    def takeoff(self, drone: str, height_m: float, duration_s: float) -> None: ...
    def land(self, drone: str, height_m: float, duration_s: float) -> None: ...
    def notify_setpoints_stop(self, drone: str) -> None: ...
    def cmd_position(self, drone: str, target: Position) -> None: ...
    def set_param(self, drone: str, name: str, value: float) -> None: ...


class _Step(Enum):
    SETTLING = auto()
    CLIMBING = auto()
    DESCENDING = auto()


@dataclass(frozen=True)
class _Phase:
    step: _Step
    deadline: float


@dataclass
class _Drone:
    state: FlightState = FlightState.GROUNDED
    position: Position = NO_POSITION
    position_at: float = NEVER
    battery_v: float | None = None
    status_at: float = NEVER
    phase: _Phase | None = None
    requested: Position | None = None
    sent: Position | None = None


class Crazyswarm2DroneConnection(DroneConnection):
    def __init__(
        self,
        config: HostConfig,
        *,
        clock: Callable[[], float],
        client: Crazyswarm2Client | None = None,
    ) -> None:
        if client is None:
            raise Crazyswarm2StartupError("--drones crazyswarm2: the real Crazyswarm2 client is not written yet")
        self._clock = clock
        self._client = client
        self._drones = {name: _Drone() for name in config.drones}
        self._last_tick_s = clock()
        client.start(Crazyswarm2Callbacks(on_pose=self._on_pose, on_status=self._on_status, on_tick=self._on_tick))

    def takeoff(self, drones: list[str]) -> dict[str, Reply]:
        replies = {}
        for name in drones:
            drone = self._drones[name]
            replies[name] = self._check(drone, "takeoff")
            if replies[name].ok:
                self._client.set_param(name, "kalman.resetEstimation", 1)
                self._client.set_param(name, "kalman.resetEstimation", 0)
                drone.state = FlightState.TAKING_OFF
                drone.phase = _Phase(_Step.SETTLING, self._clock() + RESET_SETTLE_S)
        return replies

    def land(self, drones: list[str]) -> dict[str, Reply]:
        replies = {}
        for name in drones:
            drone = self._drones[name]
            replies[name] = self._check(drone, "land")
            if replies[name].ok:
                self._start_landing(name, drone)
        return replies

    def stop(self) -> Reply:
        for drone in self._drones.values():
            if drone.state is FlightState.GROUNDED:
                continue
            if _is_settling(drone):
                _cancel_unsent_takeoff(drone)
                continue
            hold = drone.sent if drone.sent is not None else drone.position
            drone.state, drone.phase = FlightState.STOPPED, None
            drone.requested = drone.sent = hold if _is_finite(hold) else None
        return Reply(ok=True)

    def send_target(self, drone: str, target: Position) -> Reply:
        reply = self._check(self._drones[drone], "send_target")
        if reply.ok:
            self._drones[drone].requested = target
        return reply

    def close(self) -> dict[str, Reply]:
        """Land every airborne drone before the bridge exits.

        A drone with a lost link gets a `link_lost` reply. If it is climbing, the takeoff timeout still lands it.
        """
        for drone in self._drones.values():
            if _is_settling(drone):
                _cancel_unsent_takeoff(drone)
        return self.land([name for name, drone in self._drones.items() if drone.state is not FlightState.GROUNDED])

    def reports(self) -> list[DroneReport]:
        return [
            DroneReport(
                drone=name,
                state=drone.state,
                link=self._link(drone),
                position=drone.position,
                position_measured_at=drone.position_at,
                ranges=NO_RANGES,
                battery_v=drone.battery_v,
                defensive_hover=None,
                radio_measured_at=drone.status_at,
            )
            for name, drone in self._drones.items()
        ]

    def _link(self, drone: _Drone) -> LinkStatus:
        return LinkStatus.OK if self._clock() - drone.position_at <= LINK_TIMEOUT_S else LinkStatus.LOST

    def _check(self, drone: _Drone, command: _Command) -> Reply:
        if self._link(drone) is LinkStatus.LOST:
            return Reply(ok=False, reason="link_lost")
        accepted_in, reason = _ACCEPTED_IN[command]
        return Reply(ok=True) if drone.state in accepted_in else Reply(ok=False, reason=reason)

    def _on_pose(self, name: str, position: Position) -> None:
        drone = self._drones[name]
        drone.position, drone.position_at = position, self._clock()

    def _on_status(self, name: str, battery_v: float) -> None:
        drone = self._drones[name]
        drone.battery_v, drone.status_at = battery_v, self._clock()

    def _on_tick(self) -> None:
        now = self._clock()
        max_step = SPEED_LIMIT_MPS * (now - self._last_tick_s)
        self._last_tick_s = now
        for name, drone in self._drones.items():
            if drone.phase is not None:
                self._advance_phase(name, drone, drone.phase, now)
            if drone.state in _STREAMING and drone.sent is not None and drone.requested is not None:
                drone.sent = _step_toward(drone.sent, drone.requested, max_step)
                self._client.cmd_position(name, drone.sent)

    def _advance_phase(self, name: str, drone: _Drone, phase: _Phase, now: float) -> None:
        match phase.step:
            case _Step.SETTLING if now >= phase.deadline:
                drone.phase = _Phase(_Step.CLIMBING, now + TAKEOFF_S + TAKEOFF_MARGIN_S)
                self._client.takeoff(name, TAKEOFF_HEIGHT_M, TAKEOFF_S)
            case _Step.CLIMBING if abs(drone.position.z - TAKEOFF_HEIGHT_M) < ARRIVE_TOLERANCE_M:
                drone.state, drone.phase = FlightState.FLYING, None
                drone.requested = drone.sent = drone.position
            case _Step.CLIMBING if now >= phase.deadline:
                self._start_landing(name, drone)
            case _Step.DESCENDING if now >= phase.deadline and drone.position.z < GROUND_Z_M:
                drone.state, drone.phase = FlightState.GROUNDED, None

    def _start_landing(self, name: str, drone: _Drone) -> None:
        drone.state = FlightState.LANDING
        drone.phase = _Phase(_Step.DESCENDING, self._clock() + LAND_S)
        drone.requested = drone.sent = None
        self._client.notify_setpoints_stop(name)
        self._client.land(name, LAND_HEIGHT_M, LAND_S)


def _is_settling(drone: _Drone) -> bool:
    return drone.phase is not None and drone.phase.step is _Step.SETTLING


def _cancel_unsent_takeoff(drone: _Drone) -> None:
    drone.state, drone.phase = FlightState.GROUNDED, None


def _is_finite(position: Position) -> bool:
    return all(math.isfinite(v) for v in (position.x, position.y, position.z))


def _step_toward(here: Position, there: Position, max_step: float) -> Position:
    gap = here.distance_to(there)
    if gap <= max_step:
        return there
    share = max_step / gap
    return Position(
        here.x + (there.x - here.x) * share,
        here.y + (there.y - here.y) * share,
        here.z + (there.z - here.z) * share,
    )
