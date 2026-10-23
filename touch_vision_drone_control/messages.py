import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False, frozen=True)


Role = Literal["operator", "experimenter"]
Seq = Annotated[int, Field(ge=1)]
Fraction = Annotated[float, Field(ge=0, le=1)]


class Hello(_Strict):
    type: Literal["hello"]
    v: Literal[1]
    seq: Seq
    t_ms: Annotated[float, Field(ge=0)]
    role: Role
    client: str
    user_agent: str


class Held(_Strict):
    id: str
    x: float
    y: float
    touch_ms: float
    follow: bool


class Gesture(_Strict):
    state: Literal["idle", "confirming", "active", "locked", "hand_loss", "unrecognized"]
    rate: float
    neutral_y: Fraction | None


class Frame(_Strict):
    t_ms: float
    label: str | None
    score: Fraction | None
    wrist_x: float | None
    wrist_y: float | None


class Input(_Strict):
    type: Literal["input"]
    v: Literal[1]
    seq: Seq
    t_ms: float
    rtt_ms: float | None
    held: Annotated[list[Held], Field(max_length=3)]
    gesture: Gesture
    frames: Annotated[list[Frame], Field(max_length=10)]


class Event(_Strict):
    type: Literal["event"]
    v: Literal[1]
    seq: Seq
    t_ms: float
    name: Literal[
        "release",
        "restriction_start",
        "restriction_end",
        "capture_limit_start",
        "capture_limit_end",
        "touch_ignored",
        "video_switch",
        "visibility",
    ]
    drone: str | None
    data: dict[str, Any]


class Command(_Strict):
    type: Literal["command"]
    v: Literal[1]
    seq: Seq
    t_ms: float
    name: Literal["takeoff", "land", "stop", "stop_reset", "set_mode", "trial_start", "trial_end"]
    args: dict[str, Any]


TabletMessage = Annotated[Hello | Input | Event | Command, Field(discriminator="type")]
TABLET_MESSAGE: TypeAdapter[TabletMessage] = TypeAdapter(TabletMessage)
"""Parses one tablet message from JSON text. Raises `pydantic.ValidationError` when it does not match the format."""


class Rect(_Strict):
    x_min: float
    x_max: float
    y_min: float
    y_max: float


class Obstacle(Rect):
    id: str
    height: float


class Hoop(_Strict):
    id: str
    x: float
    y: float
    z: float
    diameter: float
    plane: Literal["horizontal", "vertical"]
    yaw: float


class Pad(_Strict):
    id: str
    x: float
    y: float


class Course(_Strict):
    room: Rect
    capture_volume: Rect
    restricted_zone: Rect
    obstacles: list[Obstacle]
    hoops: list[Hoop]
    pads: list[Pad]


class HostConfig(_Strict):
    id: str
    drones: list[str]
    input_hz: float
    telemetry_hz: float
    input_timeout_ms: float
    telemetry_timeout_ms: float
    stale_position_ms: float
    rate_max: float
    zone_margin: float
    z_min: float
    z_max: float
    course: Course


class Welcome(_Strict):
    type: Literal["welcome"] = "welcome"
    v: Literal[1] = 1
    seq: Seq
    host_ms: float
    session: str
    role: Role
    config: HostConfig


ReplyCode = Literal["invalid", "version", "busy", "unknown_drone", "not_allowed"]


class Reply(_Strict):
    type: Literal["reply"] = "reply"
    v: Literal[1] = 1
    seq: Seq
    host_ms: float
    ref: int | None
    ok: bool
    code: ReplyCode | None
    detail: str | None

    @model_validator(mode="after")
    def _code_only_when_rejected(self) -> "Reply":
        if self.ok == (self.code is not None):
            raise ValueError("code must be null when ok is true and set when ok is false")
        return self


def encode(message: Welcome | Reply) -> str:
    """Serialize a host message as JSON text. Raises `ValueError` rather than write NaN or Infinity."""
    return json.dumps(message.model_dump(mode="json"), allow_nan=False)
