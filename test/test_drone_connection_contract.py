"""Contract suite: what every drone connection must do.

Each harness builds one drone connection and a `wait` function that lets time
pass. The mock drone connection moves a fake clock. The hardware team adds a
harness for the Crazyswarm2 drone connection to HARNESSES, where `wait` sleeps.
"""

from collections.abc import Callable
from dataclasses import dataclass

import pytest
from fake_clock import FakeClock

from touch_vision_drone_control.drone_connection import (
    DroneConnection,
    DroneReport,
    FlightState,
    Position,
)
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection

DRONES = ["cf1", "cf2", "cf3"]


@dataclass
class Harness:
    connection: DroneConnection
    wait: Callable[[float], None]
    timeout_s: float


def mock_harness() -> Harness:
    clock = FakeClock()
    return Harness(MockDroneConnection(DRONES, clock=clock), clock.advance, timeout_s=30.0)


HARNESSES = [pytest.param(mock_harness, id="mock")]


@pytest.fixture(params=HARNESSES)
def harness(request: pytest.FixtureRequest) -> Harness:
    harness: Harness = request.param()
    return harness


def report_of(harness: Harness, drone: str) -> DroneReport:
    return next(r for r in harness.connection.reports() if r.drone == drone)


def wait_until(harness: Harness, drone: str, check: Callable[[DroneReport], bool]) -> DroneReport:
    waited = 0.0
    while waited <= harness.timeout_s:
        report = report_of(harness, drone)
        if check(report):
            return report
        harness.wait(0.1)
        waited += 0.1
    pytest.fail(f"{drone} never met the condition. Last report: {report_of(harness, drone)}")


def test_takeoff_reaches_flying(harness: Harness) -> None:
    replies = harness.connection.takeoff(["cf1"])

    assert replies["cf1"].ok
    wait_until(harness, "cf1", lambda r: r.state is FlightState.FLYING)


def fly(harness: Harness, drone: str) -> DroneReport:
    harness.connection.takeoff([drone])
    return wait_until(harness, drone, lambda r: r.state is FlightState.FLYING)


def test_target_moves_the_drone(harness: Harness) -> None:
    start = fly(harness, "cf1").position
    target = Position(start.x + 0.5, start.y + 0.5, start.z + 0.25)

    assert harness.connection.send_target("cf1", target).ok
    wait_until(harness, "cf1", lambda r: r.position.distance_to(target) < 0.05)


def test_land_reaches_grounded(harness: Harness) -> None:
    fly(harness, "cf1")

    assert harness.connection.land(["cf1"])["cf1"].ok
    grounded = wait_until(harness, "cf1", lambda r: r.state is FlightState.GROUNDED)
    assert grounded.position.z == pytest.approx(0.0, abs=0.05)


def test_stop_halts_movement(harness: Harness) -> None:
    start = fly(harness, "cf1").position
    far = Position(start.x + 3.0, start.y, start.z)
    harness.connection.send_target("cf1", far)
    harness.wait(0.5)

    assert harness.connection.stop().ok
    halted = wait_until(harness, "cf1", lambda r: r.state is FlightState.STOPPED)
    harness.wait(1.0)

    assert report_of(harness, "cf1").position.distance_to(halted.position) < 0.05
    assert halted.position.distance_to(far) > 1.0


def test_stopped_drone_rejects_targets_but_lands(harness: Harness) -> None:
    start = fly(harness, "cf1").position
    harness.connection.stop()
    wait_until(harness, "cf1", lambda r: r.state is FlightState.STOPPED)

    assert not harness.connection.send_target("cf1", Position(start.x + 1.0, start.y, start.z)).ok
    assert harness.connection.land(["cf1"])["cf1"].ok
    wait_until(harness, "cf1", lambda r: r.state is FlightState.GROUNDED)


def test_target_is_rejected_unless_flying(harness: Harness) -> None:
    target = Position(1.0, 1.0, 1.0)
    assert not harness.connection.send_target("cf1", target).ok

    harness.connection.takeoff(["cf1"])
    assert report_of(harness, "cf1").state is FlightState.TAKING_OFF
    assert not harness.connection.send_target("cf1", target).ok


def test_takeoff_is_rejected_unless_grounded(harness: Harness) -> None:
    fly(harness, "cf1")

    assert not harness.connection.takeoff(["cf1"])["cf1"].ok


def test_land_is_rejected_when_grounded(harness: Harness) -> None:
    assert not harness.connection.land(["cf1"])["cf1"].ok


def test_every_reading_of_a_flying_drone_carries_a_measurement_time_that_advances(
    harness: Harness,
) -> None:
    before = fly(harness, "cf1")
    harness.wait(1.0)
    after = report_of(harness, "cf1")

    assert after.position_measured_at > before.position_measured_at
    assert after.radio_measured_at > before.radio_measured_at
