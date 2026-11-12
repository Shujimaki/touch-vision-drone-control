import math

import pytest

from protocol_examples import example, example_text

from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG

from touch_vision_drone_control.messages import TABLET_MESSAGE, Reply, Telemetry, Welcome, encode

TABLET_EXAMPLES = ["hello", "input-three-drones-climbing", "event-release-cancelled", "event-restriction-start",
                   "command-takeoff"]


@pytest.mark.parametrize("name", TABLET_EXAMPLES)
def test_every_tablet_example_parses(name: str) -> None:
    message = TABLET_MESSAGE.validate_json(example_text(name))

    assert message.type == name.split("-")[0]


@pytest.mark.parametrize(
    ("name", "model"),
    [("welcome", Welcome), ("reply-rejected", Reply), ("telemetry-cf3-defensive-hover", Telemetry)],
)
def test_every_host_example_parses(name: str, model: type[Welcome | Reply | Telemetry]) -> None:
    model.model_validate_json(example_text(name))


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_encoding_refuses_nan_and_infinity(value: float) -> None:
    reply = Reply.model_construct(seq=1, host_ms=value, ref=None, ok=True, code=None, detail=None)

    with pytest.raises(ValueError):
        encode(reply)


@pytest.mark.parametrize(("ok", "code"), [(True, "invalid"), (False, None)])
def test_a_reply_has_a_code_exactly_when_it_rejects(ok: bool, code: str | None) -> None:
    with pytest.raises(ValueError):
        Reply(seq=1, host_ms=0.0, ref=None, ok=ok, code=code, detail=None)


def test_the_placeholder_config_matches_the_welcome_example() -> None:
    assert PLACEHOLDER_CONFIG.model_dump(mode="json") == example("welcome")["config"]
