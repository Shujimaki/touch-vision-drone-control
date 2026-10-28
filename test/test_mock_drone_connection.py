"""Mock-only behavior. The contract suite covers what every drone connection must do."""

from fake_clock import FakeClock

from touch_vision_drone_control.drone_connection import FlightState, Position
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection


def test_mock_never_exceeds_its_speed_limit() -> None:
    clock = FakeClock()
    mock = MockDroneConnection(["cf1"], clock=clock, speed_limit_mps=0.3)
    mock.takeoff(["cf1"])
    target_sent = False

    previous = mock.reports()[0].position
    for step in [0.1] * 40 + [2.0, 0.5]:
        clock.advance(step)
        report = mock.reports()[0]
        assert previous.distance_to(report.position) <= 0.3 * step + 1e-9
        if report.state is FlightState.FLYING and not target_sent:
            target_sent = mock.send_target("cf1", Position(4.0, 3.0, 1.5)).ok
        previous = report.position

    assert target_sent


def test_a_mock_drone_takes_off_straight_up_from_its_start_position() -> None:
    clock = FakeClock()
    mock = MockDroneConnection(["cf1", "cf2"], clock=clock, start={"cf1": Position(2.35, 0.6, 0.0), "cf2": Position(2.65, 0.6, 0.0)})

    mock.takeoff(["cf2"])
    clock.advance(10.0)

    assert [(r.drone, r.state, r.position) for r in mock.reports()] == [
        ("cf1", FlightState.GROUNDED, Position(2.35, 0.6, 0.0)),
        ("cf2", FlightState.FLYING, Position(2.65, 0.6, 0.5)),
    ]
