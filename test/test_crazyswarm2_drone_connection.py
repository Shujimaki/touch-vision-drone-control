import math

from fake_clock import FakeClock
from fake_crazyswarm2_client import FakeCrazyswarm2Client

from touch_vision_drone_control.crazyswarm2_drone_connection import Crazyswarm2DroneConnection
from touch_vision_drone_control.drone_connection import FlightState, Position
from touch_vision_drone_control.host_config import TAKEOFF_CONFIG


def build() -> tuple[FakeClock, FakeCrazyswarm2Client, Crazyswarm2DroneConnection]:
    clock = FakeClock()
    client = FakeCrazyswarm2Client(clock, TAKEOFF_CONFIG.drones)
    return clock, client, Crazyswarm2DroneConnection(TAKEOFF_CONFIG, clock=clock, client=client)


def test_the_position_is_nan_until_the_first_pose_arrives() -> None:
    _, _, connection = build()

    [report] = connection.reports()

    assert all(math.isnan(v) for v in (report.position.x, report.position.y, report.position.z))


def test_a_pose_is_stamped_with_its_arrival_time_on_the_injected_clock() -> None:
    clock, client, connection = build()

    client.advance(0.5)
    [report] = connection.reports()

    assert report.position == Position(0.0, 0.0, 0.0)
    assert report.position_measured_at == clock()


def test_a_stop_before_takeoff_is_sent_keeps_the_drone_on_the_floor() -> None:
    _, client, connection = build()
    connection.takeoff(["cf1"])
    client.advance(0.5)

    assert connection.stop().ok
    client.advance(5.0)

    [report] = connection.reports()
    assert report.state is FlightState.GROUNDED
    assert report.position.z == 0.0
