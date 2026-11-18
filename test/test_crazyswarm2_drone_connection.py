import math

from fake_clock import FakeClock
from fake_crazyswarm2_client import FakeCrazyswarm2Client

from touch_vision_drone_control.crazyswarm2_drone_connection import RESET_SETTLE_S, Crazyswarm2DroneConnection
from touch_vision_drone_control.drone_connection import FlightState, LinkStatus, Position, Reply
from touch_vision_drone_control.host_config import TAKEOFF_CONFIG


def build() -> tuple[FakeClock, FakeCrazyswarm2Client, Crazyswarm2DroneConnection]:
    clock = FakeClock()
    client = FakeCrazyswarm2Client(clock, TAKEOFF_CONFIG.drones)
    return clock, client, Crazyswarm2DroneConnection(TAKEOFF_CONFIG, clock=clock, client=client)


def fly() -> tuple[FakeClock, FakeCrazyswarm2Client, Crazyswarm2DroneConnection]:
    clock, client, connection = build()
    client.advance(0.1)
    connection.takeoff(["cf1"])
    client.advance(5.0)
    assert state_of(connection) is FlightState.FLYING
    return clock, client, connection


def state_of(connection: Crazyswarm2DroneConnection) -> FlightState:
    [report] = connection.reports()
    return report.state


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
    client.advance(0.1)
    connection.takeoff(["cf1"])
    client.advance(0.5)

    assert connection.stop().ok
    client.advance(5.0)

    [report] = connection.reports()
    assert report.state is FlightState.GROUNDED
    assert report.position.z == 0.0


def test_a_drone_without_a_recent_pose_has_a_lost_link_and_rejects_commands_but_still_gets_setpoints() -> None:
    _, client, connection = fly()

    client.drop_telemetry("cf1")
    client.advance(1.0)
    sent_before = len(client.calls_to("cf1", "cmd_position"))
    client.advance(1.0)

    [report] = connection.reports()
    assert report.link is LinkStatus.LOST
    assert connection.send_target("cf1", Position(0.1, 0.0, 0.4)) == Reply(ok=False, reason="link_lost")
    assert connection.land(["cf1"]) == {"cf1": Reply(ok=False, reason="link_lost")}
    assert len(client.calls_to("cf1", "cmd_position")) > sent_before


def test_land_before_the_first_pose_is_rejected_as_a_lost_link() -> None:
    _, client, connection = build()

    assert connection.land(["cf1"]) == {"cf1": Reply(ok=False, reason="link_lost")}
    assert client.calls == []


def test_a_takeoff_that_never_reaches_takeoff_height_lands_by_itself() -> None:
    _, client, connection = build()
    client.stall_climb("cf1", 0.2)
    client.advance(0.1)
    connection.takeoff(["cf1"])

    client.advance(6.0)
    assert state_of(connection) is FlightState.TAKING_OFF
    client.advance(1.0)
    [takeoff] = client.calls_to("cf1", "takeoff")
    [land] = client.calls_to("cf1", "land")

    assert land.at - takeoff.at >= 5.0
    assert state_of(connection) is FlightState.LANDING
    client.advance(3.0)
    assert state_of(connection) is FlightState.GROUNDED


def test_close_lands_every_airborne_drone_and_cancels_an_unsent_takeoff() -> None:
    clock = FakeClock()
    config = TAKEOFF_CONFIG.model_copy(update={"drones": ["cf1", "cf2", "cf3"]})
    client = FakeCrazyswarm2Client(clock, config.drones)
    connection = Crazyswarm2DroneConnection(config, clock=clock, client=client)
    client.advance(0.1)
    connection.takeoff(["cf1", "cf2"])
    client.advance(5.0)
    connection.takeoff(["cf3"])
    client.advance(0.5)

    replies = connection.close()
    client.advance(3.0)

    assert replies == {"cf1": Reply(ok=True), "cf2": Reply(ok=True)}
    for drone in ("cf1", "cf2"):
        assert [call.method for call in client.calls_to(drone, "notify_setpoints_stop", "land")] == [
            "notify_setpoints_stop",
            "land",
        ]
    assert client.calls_to("cf3", "takeoff", "land") == []
    assert {report.state for report in connection.reports()} == {FlightState.GROUNDED}


def test_every_takeoff_resets_the_estimator_and_waits_for_it_to_settle() -> None:
    _, client, connection = fly()
    connection.land(["cf1"])
    client.advance(3.0)
    connection.takeoff(["cf1"])
    client.advance(5.0)

    calls = client.calls_to("cf1", "set_param", "takeoff")

    assert [(call.method, call.args) for call in calls] == [
        ("set_param", ("kalman.resetEstimation", 1)),
        ("set_param", ("kalman.resetEstimation", 0)),
        ("takeoff", (0.4, 2.0)),
    ] * 2
    for reset, takeoff in ((calls[1], calls[2]), (calls[4], calls[5])):
        assert takeoff.at - reset.at >= RESET_SETTLE_S


def test_after_stop_the_stream_holds_the_drone_with_no_send_target_calls() -> None:
    _, client, connection = fly()
    connection.send_target("cf1", Position(0.3, 0.0, 0.4))
    client.advance(0.5)

    connection.stop()
    stopped_at = len(client.calls)
    client.advance(5.0)

    [hold] = {call.args for call in client.calls[stopped_at:] if call.method == "cmd_position"}
    [report] = connection.reports()
    assert 0.1 < hold[0].x < 0.2
    assert report.position == hold[0]


def test_land_sends_notify_setpoints_stop_then_land_and_no_setpoint_follows() -> None:
    _, client, connection = fly()

    connection.land(["cf1"])
    client.advance(3.0)

    methods = [call.method for call in client.calls_to("cf1", "notify_setpoints_stop", "land", "cmd_position")]
    assert methods[-2:] == ["notify_setpoints_stop", "land"]
    assert state_of(connection) is FlightState.GROUNDED


def test_the_takeoff_timeout_lands_a_drone_even_with_a_lost_link() -> None:
    _, client, connection = build()
    client.stall_climb("cf1", 0.2)
    client.advance(0.1)
    connection.takeoff(["cf1"])
    client.advance(2.0)

    client.drop_telemetry("cf1")
    client.advance(10.0)

    assert [call.method for call in client.calls_to("cf1", "notify_setpoints_stop", "land")] == [
        "notify_setpoints_stop",
        "land",
    ]
