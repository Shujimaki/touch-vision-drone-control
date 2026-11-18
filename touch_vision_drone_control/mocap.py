from dataclasses import dataclass

from touch_vision_drone_control.drone_connection import Position


@dataclass(frozen=True)
class TrackedPose:
    """A drone position in the map frame and when the flight host measured it."""

    position: Position
    measured_at: float
    """Seconds on the flight host's monotonic clock."""


def motive_to_map(x: float, y: float, z: float) -> Position:
    """Convert a Motive point (y up) to the map frame (x, y on the floor, z up), in meters.

    The y-up rule was measured on the VRPN stream (issue #28). Confirm the ROS 2
    topic's up axis before using this on NatNet poses (ADR 0006).
    """
    return Position(x=x, y=-z, z=y)


def tracked_pose_from_motive(
    x: float, y: float, z: float, *, measured_at: float
) -> TrackedPose:
    """Convert one Motive reading into a tracked pose in the map frame."""
    return TrackedPose(position=motive_to_map(x, y, z), measured_at=measured_at)
