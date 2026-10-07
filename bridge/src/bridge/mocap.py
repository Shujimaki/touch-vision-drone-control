"""Position sources: OptiTrack through libmotioncapture, and a mock for work away from the lab.

Each source keeps the latest pose of each tracked body, in the course frame, with the host time it arrived.
"""
from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Protocol, Sequence

from .config import Config

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Pose:
    x: float
    y: float
    z: float
    yaw: float  # degrees, counterclockwise from +x, -180 to 180
    t: float  # host monotonic time of arrival, s


class PoseSource(Protocol):
    def start(self) -> None: ...
    def stop(self) -> None: ...
    def latest(self) -> dict[str, Pose]: ...


def to_course(
    position: Sequence[float],
    wxyz: Sequence[float],
    up_axis: str,
    offset: Sequence[float],
    rotation: float = 0.0,
) -> tuple[float, float, float, float] | None:
    """Converts a Motive position and quaternion to course (x, y, z, yaw). Returns None for non-finite values.

    libmotioncapture passes NatNet values through unchanged. With a Y-up stream, the rotation of +90 degrees about x
    maps (x, y, z) to (x, -z, y). The quaternion vector part maps the same way. Then the floor axes turn by `rotation`
    degrees counterclockwise about z, and `offset` moves Motive's origin to its course position.
    """
    values = [*position, *wxyz]
    if len(values) != 7 or not all(math.isfinite(v) for v in values):
        return None
    x, y, z = position
    w, qx, qy, qz = wxyz
    if up_axis == "y":
        x, y, z = x, -z, y
        qx, qy, qz = qx, -qz, qy
    yaw = math.degrees(math.atan2(2 * (w * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)))
    if rotation:
        cr, sr = math.cos(math.radians(rotation)), math.sin(math.radians(rotation))
        x, y = cr * x - sr * y, sr * x + cr * y
        yaw = (yaw + rotation + 180) % 360 - 180
    return x + offset[0], y + offset[1], z + offset[2], yaw


class OptiTrackSource:
    """Reads Motive's NatNet stream in a background thread. waitForNextFrame blocks, so it cannot run in asyncio."""

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg.mocap
        self._ids = {body: pid for pid, body in cfg.mocap.bodies.items()}  # Motive name -> project id
        self._poses: dict[str, Pose] = {}
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        import motioncapture  # imported here so the mock and the tests run without a Motive connection

        log.info("connecting to Motive at %s", self._cfg.hostname)
        mc = motioncapture.connect("optitrack", {"hostname": self._cfg.hostname})
        self._running = True
        self._thread = threading.Thread(target=self._run, args=(mc,), name="optitrack", daemon=True)
        self._thread.start()

    def _run(self, mc) -> None:  # type: ignore[no-untyped-def]
        missing = set(self._ids)
        while self._running:
            mc.waitForNextFrame()
            now = time.monotonic()
            for name, body in mc.rigidBodies.items():
                pid = self._ids.get(name)
                if pid is None:
                    continue
                q = body.rotation
                pose = to_course(
                    list(body.position), [q.w, q.x, q.y, q.z], self._cfg.up_axis, self._cfg.offset, self._cfg.rotation
                )
                if pose is None:
                    continue
                with self._lock:
                    self._poses[pid] = Pose(*pose, t=now)
                if name in missing:
                    missing.discard(name)
                    log.info("tracking rigid body %s as %s", name, pid)

    def stop(self) -> None:
        self._running = False

    def latest(self) -> dict[str, Pose]:
        with self._lock:
            return dict(self._poses)


class MockSource:
    """Synthetic poses: the drones circle in step 0.5 m in front of their pads at 0.6 m, so they keep their spacing.
    Each obstacle and hoop stands at its configured place."""

    RADIUS = 0.12  # m
    PERIOD = 8.0  # s per circle

    def __init__(self, cfg: Config, clock=time.monotonic) -> None:  # type: ignore[no-untyped-def]
        self._cfg = cfg
        self._clock = clock
        self._t0 = clock()

    def start(self) -> None: ...

    def stop(self) -> None: ...

    def latest(self) -> dict[str, Pose]:
        now = self._clock()
        poses: dict[str, Pose] = {}
        a = 2 * math.pi * (now - self._t0) / self.PERIOD
        yaw = (math.degrees(a) + 90 + 180) % 360 - 180  # heading along the circle
        for pad in self._cfg.course.pads:
            poses[pad.id] = Pose(pad.x + self.RADIUS * math.cos(a), pad.y + 0.5 + self.RADIUS * math.sin(a), 0.6, yaw, now)
        for o in self._cfg.course.obstacles:
            x, y = o.centre
            poses[o.id] = Pose(x, y, o.height, 0.0, now)
        for h in self._cfg.course.hoops:
            poses[h.id] = Pose(h.x, h.y, h.z, h.yaw, now)
        return poses


def make_source(cfg: Config) -> PoseSource:
    return OptiTrackSource(cfg) if cfg.mocap.source == "optitrack" else MockSource(cfg)
