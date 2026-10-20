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
