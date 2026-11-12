import sys

import pytest

from fake_clock import FakeClock

from touch_vision_drone_control.backend_server import (
    CRAZYSWARM2_MODULE,
    StartupError,
    build_bridge,
    open_message_log,
    option_parser,
)
from touch_vision_drone_control.drone_connection import FlightState, Position
from touch_vision_drone_control.host_config import PLACEHOLDER_CONFIG
from touch_vision_drone_control.messages import Rect
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection


def test_with_no_options_the_bridge_uses_the_mock_and_the_course_configuration() -> None:
    options = option_parser().parse_args([])

    config, drones = build_bridge(options.drones, options.config, FakeClock())

    assert config == PLACEHOLDER_CONFIG
    assert isinstance(drones, MockDroneConnection)
    assert {r.drone: r.position for r in drones.reports()} == {
        "cf1": Position(2.35, 0.6, 0.0),
        "cf2": Position(2.65, 0.6, 0.0),
        "cf3": Position(2.95, 0.6, 0.0),
    }


def test_the_takeoff_configuration_flies_cf1_alone_in_a_1_m_box_from_the_origin() -> None:
    options = option_parser().parse_args(["--config", "takeoff"])

    config, drones = build_bridge(options.drones, options.config, FakeClock())

    assert config.id == "takeoff-draft-0.1"
    assert config.drones == ["cf1"]
    assert config.course.capture_volume == Rect(x_min=-0.5, x_max=0.5, y_min=-0.5, y_max=0.5)
    assert (config.course.obstacles, config.course.hoops) == ([], [])
    assert (config.z_min, config.z_max) == (0.3, 1.0)
    [report] = drones.reports()
    assert (report.drone, report.state, report.position) == ("cf1", FlightState.GROUNDED, Position(0.0, 0.0, 0.0))


def test_the_takeoff_configuration_keeps_the_course_timeouts_and_rates() -> None:
    config, _ = build_bridge("mock", "takeoff", FakeClock())

    timing = ["input_hz", "telemetry_hz", "input_timeout_ms", "telemetry_timeout_ms", "stale_position_ms", "rate_max"]
    assert {k: getattr(config, k) for k in timing} == {k: getattr(PLACEHOLDER_CONFIG, k) for k in timing}


def test_crazyswarm2_without_its_module_stops_the_bridge_with_a_clear_error(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, CRAZYSWARM2_MODULE, None)

    with pytest.raises(StartupError, match="the Crazyswarm2 drone connection is not available"):
        build_bridge("crazyswarm2", "takeoff", FakeClock())


def test_without_the_log_option_the_bridge_has_no_message_log() -> None:
    with open_message_log(option_parser().parse_args([]).log) as log:
        assert log is None


def test_the_log_option_appends_to_an_existing_message_log(tmp_path) -> None:
    path = tmp_path / "flight.jsonl"
    path.write_text('{"earlier": true}\n')

    with open_message_log(option_parser().parse_args(["--log", str(path)]).log) as log:
        log.write('{"later": true}\n')

    assert path.read_text() == '{"earlier": true}\n{"later": true}\n'
