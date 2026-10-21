"""The drone connection: the boundary between the Python command bridge and whatever moves the drones.

The Python command bridge talks to the swarm only through `DroneConnection`.
The mock drone connection stands in for the swarm during development. The
Crazyswarm2 drone connection drives the real swarm, and it is the only module
allowed to import `rclpy` (ADR 0001).

Commands go one way: the bridge sends position targets at its fixed setpoint
rate, plus takeoff, land, and stop. Reports come back: one `DroneReport` per
drone each time the bridge asks. Flight states and link values match message
format v1 telemetry in protocol/README.md. Field names and reject reasons are
the drone connection's own. The bridge maps them to message fields and reply
codes.

All times are seconds on the flight host's monotonic clock. The drone
connection stamps each reading with the flight host time at which it was
measured, so the bridge can tell how old each reading is.

docs/adr/0002-drone-connection-commands-and-reports.md records the command
rules and the two measurement times.
"""

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum


class FlightState(str, Enum):
    """Flight state of one drone, as in message format v1 telemetry."""

    GROUNDED = "grounded"
    """On the ground with motors off. Accepts takeoff."""
    TAKING_OFF = "taking_off"
    """Climbing to takeoff height. Accepts land. Rejects position targets."""
    FLYING = "flying"
    """Airborne and following position targets."""
    LANDING = "landing"
    """Descending to the ground. Rejects position targets."""
    STOPPED = "stopped"
    """Held in place after a stop. Accepts only land."""


class LinkStatus(str, Enum):
    """State of the radio link to one drone."""

    OK = "ok"
    LOST = "lost"


@dataclass(frozen=True)
class Position:
    """A point in the motion capture frame, in meters."""

    x: float
    y: float
    z: float

    def distance_to(self, other: "Position") -> float:
        """Straight-line distance to `other`, in meters."""
        return math.dist((self.x, self.y, self.z), (other.x, other.y, other.z))


@dataclass(frozen=True)
class Ranges:
    """Multi-ranger readings in meters, relative to the drone body. `None` when no valid reading exists."""

    front: float | None
    back: float | None
    left: float | None
    right: float | None
    up: float | None


@dataclass(frozen=True)
class DefensiveHover:
    """An active defensive hover: the onboard override that stops movement toward an obstacle.

    `direction` is the range direction that triggered it, such as "front".
    `range_m` is that reading in meters.
    """

    direction: str
    range_m: float


@dataclass(frozen=True)
class Reply:
    """The drone connection's answer to one command for one drone.

    `reason` names why a command was rejected, such as "not_flying". It is
    `None` when `ok` is true.
    """

    ok: bool
    reason: str | None = None


@dataclass(frozen=True)
class DroneReport:
    """What the drone connection knows about one drone.

    Readings arrive by two routes and go stale separately:
    - `position` comes from the motion capture machine. `position_measured_at`
      is when it was measured.
    - `ranges`, `battery_v`, and `defensive_hover` come from the drone over the
      radio. `radio_measured_at` is when they were measured.
    """

    drone: str
    state: FlightState
    link: LinkStatus
    position: Position
    position_measured_at: float
    ranges: Ranges
    battery_v: float | None
    defensive_hover: DefensiveHover | None
    radio_measured_at: float


class DroneConnection(ABC):
    """Commands to the swarm and reports from it. Drones are named by their configured names, such as "cf1"."""

    @abstractmethod
    def takeoff(self, drones: list[str]) -> dict[str, Reply]:
        """Start takeoff for each named drone.

        A grounded drone moves to taking off, then to flying once it reaches
        takeoff height. Rejected for a drone that is not grounded or whose link
        is lost. Returns one reply per drone.
        """

    @abstractmethod
    def land(self, drones: list[str]) -> dict[str, Reply]:
        """Start landing for each named drone.

        A drone that is taking off, flying, or stopped moves to landing, then
        to grounded once it reaches the ground. Land is the only command a
        stopped drone accepts. Rejected for a grounded drone or one whose link
        is lost. Returns one reply per drone.
        """

    @abstractmethod
    def stop(self) -> Reply:
        """Stop the whole swarm.

        Every airborne drone halts where it is and moves to stopped. A stopped
        drone rejects position targets and accepts land. Grounded drones are
        unaffected. The bridge decides when takeoff is allowed again, through
        `stop_reset` in message format v1.
        """

    @abstractmethod
    def send_target(self, drone: str, target: Position) -> Reply:
        """Set the position target of one flying drone.

        The bridge calls this at its fixed setpoint rate for every flying
        drone. The drone moves along the straight line to its latest target,
        within its speed limit. During defensive hover it holds while that line
        points at the obstacle. Rejected for a drone that is not flying or
        whose link is lost.
        """

    @abstractmethod
    def reports(self) -> list[DroneReport]:
        """Return the latest report for every drone, in configured order."""
