"""Contract suite: what every drone connection must do.

Each harness builds one drone connection and a `wait` function that lets time
pass. The mock drone connection moves a fake clock.
"""

from collections.abc import Callable
from dataclasses import dataclass

import pytest
from fake_clock import FakeClock
from fake_crazyswarm2_client import FakeCrazyswarm2Client

from touch_vision_drone_control.crazyswarm2_drone_connection import (
    SPEED_LIMIT_MPS,
    STREAM_HZ,
    Crazyswarm2DroneConnection,
)
from touch_vision_drone_control.drone_connection import (
    DroneConnection,
    DroneReport,
    FlightState,
    Position,
)
from touch_vision_drone_control.host_config import TAKEOFF_CONFIG
from touch_vision_drone_control.mock_drone_connection import MockDroneConnection

DRONES = ["cf1", "cf2", "cf3"]
MOCK_SPEED_LIMIT_MPS = 0.5
SIMULATED_MAX_MOVE_M = 0.5
SIMULATED_TOLERANCE_M = 0.05


@dataclass(kw_only=True)
class Harness:
    connection: DroneConnection
    wait: Callable[[float], None]
    timeout_s: float
    speed_limit_mps: float
    max_move_m: float
    tolerance_m: float


def mock_harness() -> Harness:
    clock = FakeClock()
    connection = MockDroneConnection(DRONES, clock=clock, speed_limit_mps=MOCK_SPEED_LIMIT_MPS)
    return Harness(
        connection=connection,
        wait=clock.advance,
        timeout_s=30.0,
        speed_limit_mps=MOCK_SPEED_LIMIT_MPS,
        max_move_m=SIMULATED_MAX_MOVE_M,
        tolerance_m=SIMULATED_TOLERANCE_M,
    )


def fake_crazyswarm2_harness() -> Harness:
    clock = FakeClock()
    client = FakeCrazyswarm2Client(clock, TAKEOFF_CONFIG.drones)
    connection = Crazyswarm2DroneConnection(TAKEOFF_CONFIG, clock=clock, client=client)
    client.advance(1 / STREAM_HZ)
    return Harness(
        connection=connection,
        wait=client.advance,
        timeout_s=30.0,
        speed_limit_mps=SPEED_LIMIT_MPS,
        max_move_m=SIMULATED_MAX_MOVE_M,
        tolerance_m=SIMULATED_TOLERANCE_M,
    )


HARNESSES = [
    pytest.param(mock_harness, id="mock"),
    pytest.param(fake_crazyswarm2_harness, id="fake-crazyswarm2"),
]


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
    move = harness.max_move_m
    target = Position(start.x + move, start.y + move, start.z + move / 2)

    assert harness.connection.send_target("cf1", target).ok
    wait_until(harness, "cf1", lambda r: r.position.distance_to(target) < harness.tolerance_m)


def test_target_moves_the_drone_no_faster_than_the_speed_limit(harness: Harness) -> None:
    start = fly(harness, "cf1")
    origin = start.position
    target = Position(origin.x + 0.8 * harness.max_move_m, origin.y, origin.z)
    samples: list[DroneReport] = []

    def arrived(report: DroneReport) -> bool:
        samples.append(report)
        return report.position.distance_to(target) < harness.tolerance_m

    assert harness.connection.send_target("cf1", target).ok
    wait_until(harness, "cf1", arrived)

    for sample in samples:
        elapsed = sample.position_measured_at - start.position_measured_at
        moved = start.position.distance_to(sample.position)
        allowed = harness.speed_limit_mps * elapsed + harness.tolerance_m
        assert moved <= allowed, f"moved {moved:.3f} m in {elapsed:.3f} s, allowed {allowed:.3f} m"


def test_land_reaches_grounded(harness: Harness) -> None:
    fly(harness, "cf1")

    assert harness.connection.land(["cf1"])["cf1"].ok
    grounded = wait_until(harness, "cf1", lambda r: r.state is FlightState.GROUNDED)
    assert grounded.position.z == pytest.approx(0.0, abs=harness.tolerance_m)


def test_stop_halts_movement(harness: Harness) -> None:
    start = fly(harness, "cf1").position
    far = Position(start.x + 6 * harness.max_move_m, start.y, start.z)
    harness.connection.send_target("cf1", far)
    harness.wait(0.5)

    assert harness.connection.stop().ok
    halted = wait_until(harness, "cf1", lambda r: r.state is FlightState.STOPPED)
    harness.wait(1.0)

    assert report_of(harness, "cf1").position.distance_to(halted.position) < harness.tolerance_m
    assert halted.position.distance_to(far) > 2 * harness.max_move_m


def test_stopped_drone_rejects_targets_then_lands_grounded(harness: Harness) -> None:
    start = fly(harness, "cf1").position

    assert harness.connection.stop().ok
    wait_until(harness, "cf1", lambda r: r.state is FlightState.STOPPED)

    target = Position(start.x + 0.8 * harness.max_move_m, start.y, start.z)
    assert not harness.connection.send_target("cf1", target).ok
    assert harness.connection.land(["cf1"])["cf1"].ok
    grounded = wait_until(harness, "cf1", lambda r: r.state is FlightState.GROUNDED)
    assert grounded.position.z == pytest.approx(0.0, abs=harness.tolerance_m)


def test_target_is_rejected_unless_flying(harness: Harness) -> None:
    move = harness.max_move_m
    target = Position(move, move, move)
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
