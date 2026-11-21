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


def _inside(outer: Rect, inner: Rect) -> bool:
    return outer.x_min <= inner.x_min and inner.x_max <= outer.x_max and outer.y_min <= inner.y_min and inner.y_max <= outer.y_max


def _overlap(a: Rect, b: Rect) -> bool:
    return a.x_min < b.x_max and b.x_min < a.x_max and a.y_min < b.y_max and b.y_min < a.y_max


def test_the_takeoff3_configuration_puts_cf1_cf2_cf3_on_pads_0_6_m_apart_across_the_arrow() -> None:
    options = option_parser().parse_args(["--config", "takeoff3"])

    config, drones = build_bridge(options.drones, options.config, FakeClock())

    assert config.drones == ["cf1", "cf2", "cf3"]
    assert {pad.id: (pad.x, pad.y) for pad in config.course.pads} == {"cf1": (0.0, 0.0), "cf2": (0.0, 0.6), "cf3": (0.0, -0.6)}
    assert {r.drone: (r.state, r.position) for r in drones.reports()} == {
        "cf1": (FlightState.GROUNDED, Position(0.0, 0.0, 0.0)),
        "cf2": (FlightState.GROUNDED, Position(0.0, 0.6, 0.0)),
        "cf3": (FlightState.GROUNDED, Position(0.0, -0.6, 0.0)),
    }


def test_the_takeoff3_pads_lie_in_the_capture_volume_and_the_restricted_zone_lies_outside_it() -> None:
    config, _ = build_bridge("mock", "takeoff3", FakeClock())
    course = config.course

    assert [pad.id for pad in course.pads] == config.drones
    assert _inside(course.room, course.capture_volume)
    for pad in course.pads:
        assert _inside(course.capture_volume, Rect(x_min=pad.x, x_max=pad.x, y_min=pad.y, y_max=pad.y)), pad.id
    assert _inside(course.room, course.restricted_zone)
    assert not _overlap(course.restricted_zone, course.capture_volume)


def test_the_takeoff3_configuration_keeps_the_takeoff_heights_and_timing() -> None:
    takeoff, _ = build_bridge("mock", "takeoff", FakeClock())
    config, _ = build_bridge("mock", "takeoff3", FakeClock())

    fields = ["z_min", "z_max", "input_hz", "telemetry_hz", "input_timeout_ms", "telemetry_timeout_ms",
              "stale_position_ms", "rate_max"]
    assert {k: getattr(config, k) for k in fields} == {k: getattr(takeoff, k) for k in fields}


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


def test_crazyswarm2_without_ros2_stops_the_bridge_and_points_at_the_flight_host_venv(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "rclpy", None)

    with pytest.raises(StartupError, match="cannot import rclpy. Source ROS 2"):
        build_bridge("crazyswarm2", "takeoff", FakeClock())
