from dataclasses import dataclass

from .drone_connection import Position
from typing import Protocol


@dataclass(frozen=True)
class TrackedPose:
    position: Position
    measured_at: float

class PoseSource(Protocol):
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def latest(self) -> dict[str, TrackedPose]: ...