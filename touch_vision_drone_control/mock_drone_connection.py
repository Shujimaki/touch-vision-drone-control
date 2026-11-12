"""The mock drone connection: stands in for the swarm during development.

Each drone moves along the straight line to its target, no faster than the
speed limit. The mock reads time from an injected clock and catches up on every
call, so tests can drive time by hand.
"""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from touch_vision_drone_control.drone_connection import (
    DroneConnection,
    DroneReport,
    FlightState,
    LinkStatus,
    Position,
    Ranges,
    Reply,
)

NO_RANGES = Ranges(front=None, back=None, left=None, right=None, up=None)
"""The mock has no Multi-ranger readings."""

_ACCEPTED_IN = {
    "takeoff": (frozenset({FlightState.GROUNDED}), "not_grounded"),
    "land": (
        frozenset({FlightState.TAKING_OFF, FlightState.FLYING, FlightState.LANDING, FlightState.STOPPED}),
        "not_airborne",
    ),
    "send_target": (frozenset({FlightState.FLYING}), "not_flying"),
}
"""For each command: the flight states that accept it, and the reject reason otherwise."""

_ON_ARRIVAL = {FlightState.TAKING_OFF: FlightState.FLYING, FlightState.LANDING: FlightState.GROUNDED}
"""Flight state a drone moves to when it reaches its target."""


@dataclass
class _Drone:
    state: FlightState
    position: Position
    target: Position | None


class MockDroneConnection(DroneConnection):
    """A drone connection with simulated drones and no hardware.

    `speed_limit_mps` is a placeholder (about 0.5 m/s). Drones start grounded
    at their `start` positions, or 1 m apart along x when `start` is not given.
    """

    def __init__(
        self,
        drones: list[str],
        clock: Callable[[], float] = time.monotonic,
        speed_limit_mps: float = 0.5,
        takeoff_height_m: float = 0.5,
        start: Mapping[str, Position] | None = None,
    ) -> None:
        self._clock = clock
        self._speed_limit_mps = speed_limit_mps
        self._takeoff_height_m = takeoff_height_m
        self._now = clock()
        if start is None:
            start = {name: Position(float(i), 0.0, 0.0) for i, name in enumerate(drones)}
        self._drones = {name: _Drone(FlightState.GROUNDED, start[name], None) for name in drones}

    def takeoff(self, drones: list[str]) -> dict[str, Reply]:
        return self._move_vertically(drones, "takeoff", FlightState.TAKING_OFF, self._takeoff_height_m)

    def land(self, drones: list[str]) -> dict[str, Reply]:
        return self._move_vertically(drones, "land", FlightState.LANDING, 0.0)

    def stop(self) -> Reply:
        self._catch_up()
        for drone in self._drones.values():
            if drone.state is not FlightState.GROUNDED:
                drone.state = FlightState.STOPPED
                drone.target = None
        return Reply(ok=True)

    def send_target(self, drone: str, target: Position) -> Reply:
        self._catch_up()
        reply = _check(self._drones[drone], "send_target")
        if reply.ok:
            self._drones[drone].target = target
        return reply

    def reports(self) -> list[DroneReport]:
        self._catch_up()
        return [
            DroneReport(
                drone=name,
                state=d.state,
                link=LinkStatus.OK,
                position=d.position,
                position_measured_at=self._now,
                ranges=NO_RANGES,
                battery_v=None,
                defensive_hover=None,
                radio_measured_at=self._now,
            )
            for name, d in self._drones.items()
        ]

    def _move_vertically(
        self, drones: list[str], command: str, new_state: FlightState, height_m: float
    ) -> dict[str, Reply]:
        self._catch_up()
        replies = {}
        for name in drones:
            drone = self._drones[name]
            replies[name] = _check(drone, command)
            if replies[name].ok:
                drone.state = new_state
                drone.target = Position(drone.position.x, drone.position.y, height_m)
        return replies

    def _catch_up(self) -> None:
        """Move every drone for the time since the last call.

        A drone's target only changes between calls, so one straight-line step
        per call gives the same result as many small ones.
        """
        end = self._clock()
        for drone in self._drones.values():
            self._move(drone, end - self._now)
        self._now = end

    def _move(self, drone: _Drone, dt: float) -> None:
        if drone.target is None:
            return
        here, there = drone.position, drone.target
        gap = here.distance_to(there)
        step = min(gap, self._speed_limit_mps * dt)
        if gap > 0:
            k = step / gap
            drone.position = Position(
                here.x + (there.x - here.x) * k,
                here.y + (there.y - here.y) * k,
                here.z + (there.z - here.z) * k,
            )
        if step == gap and drone.state in _ON_ARRIVAL:
            drone.state = _ON_ARRIVAL[drone.state]
            if drone.state is FlightState.GROUNDED:
                drone.target = None


def _check(drone: _Drone, command: str) -> Reply:
    accepted_in, reason = _ACCEPTED_IN[command]
    return Reply(ok=True) if drone.state in accepted_in else Reply(ok=False, reason=reason)
