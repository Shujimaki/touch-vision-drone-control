"""Host configuration, loaded from a TOML file and checked with Pydantic."""
from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)


class Rect(Model):
    x_min: float
    x_max: float
    y_min: float
    y_max: float

    @property
    def centre(self) -> tuple[float, float]:
        return (self.x_min + self.x_max) / 2, (self.y_min + self.y_max) / 2


class Obstacle(Rect):
    id: str
    height: float = Field(gt=0)


class Hoop(Model):
    id: str
    x: float
    y: float
    z: float
    diameter: float = Field(gt=0)
    plane: Literal["horizontal", "vertical"]
    yaw: float


class Pad(Model):
    id: str
    x: float
    y: float


class Course(Model):
    room: Rect
    capture_volume: Rect
    restricted_zone: Rect
    obstacles: list[Obstacle]
    hoops: list[Hoop]
    pads: list[Pad]


class Mocap(Model):
    source: Literal["optitrack", "mock"]
    hostname: str
    up_axis: Literal["y", "z"]
    offset: tuple[float, float, float]
    rotation: float = 0.0  # degrees counterclockwise from course +x to Motive +x, after the up-axis mapping
    bodies: dict[str, str]


class Server(Model):
    host: str
    port: int = Field(ge=1, le=65535)


class Config(Model):
    id: str
    drones: list[str] = Field(min_length=1, max_length=3)
    input_hz: float = Field(gt=0)
    telemetry_hz: float = Field(gt=0)
    input_timeout_ms: float = Field(gt=0)
    telemetry_timeout_ms: float = Field(gt=0)
    stale_position_ms: float = Field(gt=0)
    rate_max: float = Field(gt=0)
    zone_margin: float = Field(ge=0)
    z_min: float
    z_max: float
    course: Course
    mocap: Mocap
    server: Server

    @model_validator(mode="after")
    def _consistent(self) -> Config:
        ids = self.drones + [o.id for o in self.course.obstacles] + [h.id for h in self.course.hoops]
        if len(set(ids)) != len(ids):
            raise ValueError("drone, obstacle and hoop ids must be unique")
        if sorted(p.id for p in self.course.pads) != sorted(self.drones):
            raise ValueError("course.pads needs exactly one pad for each drone")
        unknown = set(self.mocap.bodies) - set(ids)
        if unknown:
            raise ValueError(f"mocap.bodies names ids that are not drones, obstacles or hoops: {sorted(unknown)}")
        if self.z_min >= self.z_max:
            raise ValueError("z_min must be below z_max")
        return self

    def welcome_config(self) -> dict:
        """The part of the configuration that the tablet receives in welcome.config."""
        return self.model_dump(exclude={"mocap", "server"})


def load(path: str | Path) -> Config:
    with open(path, "rb") as f:
        return Config.model_validate(tomllib.load(f))
