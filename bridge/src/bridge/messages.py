"""Builders for the host messages of protocol/README.md version 1, and the check of the tablet hello.

This bridge has no flight link yet. Telemetry carries measured poses; every flight field holds its no-link value.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from .config import Config
from .mocap import Pose

VERSION = 1


class Hello(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    type: Literal["hello"]
    v: int
    seq: int
    t_ms: float
    role: Literal["operator", "experimenter"]
    client: str
    user_agent: str


def m(v: float) -> float:
    """Rounds a length to 0.001 m."""
    return round(v, 3)


def ms(v: float) -> float:
    """Rounds a time to 0.1 ms."""
    return round(v, 1)


def welcome(cfg: Config, seq: int, host_ms: float, session: str, role: str) -> dict:
    return {"type": "welcome", "v": VERSION, "seq": seq, "host_ms": ms(host_ms), "session": session, "role": role,
            "config": cfg.welcome_config()}


def reply(seq: int, host_ms: float, ref: int | None, code: str | None, detail: str | None) -> dict:
    return {"type": "reply", "v": VERSION, "seq": seq, "host_ms": ms(host_ms), "ref": ref, "ok": code is None,
            "code": code, "detail": detail}


def _pose(p: Pose | None, now_s: float) -> dict:
    if p is None:
        return {"x": None, "y": None, "z": None, "yaw": None, "pos_age_ms": None}
    return {"x": m(p.x), "y": m(p.y), "z": m(p.z), "yaw": round(p.yaw, 1), "pos_age_ms": ms((now_s - p.t) * 1000)}


def telemetry(cfg: Config, poses: dict[str, Pose], seq: int, now_s: float, ack: dict | None) -> dict:
    pads = {p.id: p for p in cfg.course.pads}
    drones = []
    for did in cfg.drones:
        p = poses.get(did)
        # With no flight link, the host commands nothing: the target is where the drone is, or its pad.
        cmd = {"x": m(p.x), "y": m(p.y), "z": m(p.z)} if p else {"x": m(pads[did].x), "y": m(pads[did].y), "z": 0.0}
        drones.append({"id": did, "held": False, "state": "grounded", "link": "lost", **_pose(p, now_s), "cmd": cmd,
                       "ranges": {k: None for k in ("front", "back", "left", "right", "up")},
                       "defensive_hover": None, "battery_v": None})
    obstacles = [{"id": o.id, **_pose(poses.get(o.id), now_s)} for o in cfg.course.obstacles]
    hoops = [{"id": h.id, **_pose(poses.get(h.id), now_s)} for h in cfg.course.hoops]
    return {"type": "telemetry", "v": VERSION, "seq": seq, "host_ms": ms(now_s * 1000),
            "ack": ack or {"seq": None, "t_ms": None, "host_rx_ms": None},
            "mode": "course", "trial": None, "altitude": {"rate": 0.0, "blocked_by": None, "reason": None},
            "drones": drones, "obstacles": obstacles, "hoops": hoops}
