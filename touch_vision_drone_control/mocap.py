from dataclasses import dataclass
from typing import Protocol

from .drone_connection import Position


@dataclass(frozen=True)
class TrackedPose:
    position: Position
    measured_at: float # host monotonic time in seconds
# drone position contains location and when it was measured

class PoseSource(Protocol):
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def latest(self) -> dict[str, TrackedPose]: ...
# describes what a pose source (like mocap) should provide

def motive_to_map(
    x: float, y: float, z: float
) -> tuple[float, float, float]:
    # converts Motive coordinates to map position in meters
    map_x = x  # Motive x is already in meters
    height = y  # Motive's y is height
    map_y = -z  # Motive's z points the other way on the map

    return map_x, map_y, height  # map frame: x, y on the floor, z = height
