import math
from collections.abc import Callable, Mapping

from touch_vision_drone_control.drone_connection import DroneConnection, FlightState, Position, Reply
from touch_vision_drone_control.messages import GestureState

SETPOINT_HZ = 30.0


class SetpointStream:
    def __init__(
        self,
        drones: DroneConnection,
        clock: Callable[[], float],
        input_timeout_s: float,
        on_target: Callable[[str, Position, Reply], None] | None = None,
    ) -> None:
        self._drones = drones
        self._on_target = on_target
        self._clock = clock
        self._input_timeout_s = input_timeout_s
        self._targets: dict[str, Position] = {}
        self._held: dict[str, tuple[float, float]] = {}
        self._lifted: set[str] = set()
        self._last_input_s: float | None = None
        self._locked = True

    def targets(self) -> Mapping[str, Position]:
        return self._targets

    def held(self) -> frozenset[str]:
        """Drones whose held entry the bridge applies: held in the latest valid input and flying."""
        self._expire()
        return frozenset(self._held.keys() & self._targets.keys())

    def apply_input(
        self, accepted: Mapping[str, tuple[float, float]], ignored: set[str], gesture_state: GestureState
    ) -> None:
        """Take the held list of one valid input.

        `accepted` maps each drone to its accepted horizontal target. An entry
        for a drone without a target (not flying, or no finite position yet) is
        dropped, so it cannot apply later. `ignored` names held drones whose
        entry failed a check, so they keep their previous target.
        """
        self._expire()
        self._last_input_s = self._clock()
        if self._locked:
            self._locked = not _fresh_start(accepted, ignored, gesture_state)
            return
        held = {drone: target for drone, target in accepted.items() if drone in self._targets}
        held.update({drone: self._held[drone] for drone in ignored if drone in self._held})
        self._lifted |= self._held.keys() - held.keys()
        self._held = held
        self.tick()

    def release_and_lock(self) -> None:
        self._held = {}
        self._locked = True

    def tick(self) -> None:
        """Bring targets up to date with the latest reports and send one target to every flying drone."""
        self._expire()
        for report in self._drones.reports():
            drone, position = report.drone, report.position
            if report.state is not FlightState.FLYING:
                self._targets.pop(drone, None)
                continue
            if not all(math.isfinite(v) for v in (position.x, position.y, position.z)):
                continue
            target = self._targets.setdefault(drone, position)
            if drone in self._held:
                x, y = self._held[drone]
                self._targets[drone] = Position(x, y, target.z)
            elif drone in self._lifted:
                self._targets[drone] = Position(position.x, position.y, target.z)
        self._lifted.clear()
        for drone, target in self._targets.items():
            reply = self._drones.send_target(drone, target)
            if self._on_target is not None:
                self._on_target(drone, target, reply)

    def _expire(self) -> None:
        if self._last_input_s is not None and self._clock() - self._last_input_s > self._input_timeout_s:
            self._held = {}
            self._locked = True
            self._last_input_s = None


def _fresh_start(accepted: Mapping[str, tuple[float, float]], ignored: set[str], gesture_state: GestureState) -> bool:
    return not accepted and not ignored and gesture_state != "active"
