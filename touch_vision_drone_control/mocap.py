from dataclasses import dataclass
from typing import Protocol

from .drone_connection import Position


@dataclass(frozen=True)
class TrackedPose:
    position: Position
    measured_at: float # host monotic time in seconds
# drone position contains location and when it was measured

class PoseSource(Protocol):
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def latest(self) -> dict[str, TrackedPose]: ...
# describes what a pose source (like mocap) should provide

def motive_to_map(x_mm, y_mm, z_mm):
    x = x_mm / 1000    # millimeters to meters
    height = y_mm / 1000   # Motive's y is height
    y = -z_mm / 1000 # Motive's z points the other way on the map

    return x, y, height  # map frame: x, y on the floor, z = height
