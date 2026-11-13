---
status: accepted
---

# How the Crazyswarm2 drone connection drives cf1

The Crazyswarm2 drone connection drives cf1 through `crazyflie_py` 1.0.7, as [ADR 0001](0001-bridge-inside-ros2-package.md) and [ADR 0007](0007-fly-one-drone-without-motive.md) require. Crazyswarm2 sends commands but tracks no flight state, so the drone connection keeps the flight state itself and confirms it from the onboard estimate. Decided 2026-11-13 in a grilling session, after checking the Crazyswarm2 1.0.7 source [[1]](#references) and the Crazyflie firmware [[2]](#references). The firmware was read at `master`. The version flashed on the drones still needs checking.

- **The drone connection streams by itself.** While a drone is flying or stopped, the drone connection's own timer publishes `cmd_position` at about 30 Hz. `send_target` only records the requested target. Each tick moves the sent target toward it by at most 0.3 m/s. The firmware cuts the motors after 2 s without setpoints [[2]](#references), and after a stop the Python command bridge sends no more targets. So the hold can't depend on the bridge's calls.
- **Stop holds by streaming.** A stop sets every airborne drone's requested target to the target it last sent, and the stream keeps it there. If the bridge or the radio fails, the drone levels out and then cuts its motors. That is the loss behavior ADR 0007 accepts.
- **Land leaves the stream first.** Streamed setpoints cancel the drone's own planner [[2]](#references). So land stops the stream, calls `notifySetpointsStop`, and then calls `land` right away, as the upstream examples do [[1]](#references). The first hover test checks for a short dip between the two calls.
- **Flight state comes from the onboard estimate.**
  - Takeoff resets the estimator, sets `kalman.resetEstimation` to 1 and then back to 0, and waits for the estimate to settle before it sends `takeoff`.
  - The drone is flying once its z is within tolerance of 0.4 m.
  - If it doesn't get there within the takeoff time plus about 3 s, the drone connection lands it.
  - The drone is grounded once the land time has passed and z is near the floor.
- **Link loss comes from pose age.** A drone whose last pose is older than about 0.5 s is lost. The drone connection rejects commands for it and keeps publishing in case the link returns. It doesn't try to land a drone it can't reach.
- **Shutdown lands.** When the bridge exits normally, the drone connection tries to land every airborne drone. If that fails, the firmware watchdog takes over.
- **Takeoff height and speed are module constants.** The 0.4 m takeoff height and the 0.3 m/s speed limit come from ADR 0007. They are not `HostConfig` fields, so message format v1 doesn't change.
- **The person at the flight host stops the bridge.** A hand-typed `ros2 service call /cf1/land` does nothing while the bridge streams, because the next `cmd_position` cancels it. To end a flight by hand, the person presses Ctrl-C in the bridge's terminal, and shutdown lands the drone. The emergency cut (`ros2 service call /cf1/emergency std_srvs/srv/Empty`) is the last resort.

## Amendment, 2026-11-13: the takeoff timeout lands a drone with a lost link

The takeoff timeout sends land even when the drone's link is lost. During the climb the drone flies on its own planner, and the stream doesn't run. So the 2 s motor cutoff never fires, and nothing else would end the flight. A land the drone can't hear costs nothing, and it reaches the drone if only the poses stopped. The rule that the drone connection doesn't land a drone it can't reach still holds for commands from the bridge and for `close()`.

## Amendment, 2026-11-13: `close()` also lands a climbing drone with a lost link

`close()` sends land to a drone that is climbing, even when its link is lost. `close()` then stops the Crazyswarm2 client, so the takeoff timeout can no longer run, and the reasoning of the first amendment applies. A drone that is flying or stopped with a lost link still gets no land from `close()`. The stream stops when the bridge exits, so the firmware cuts its motors after 2 s. After `close()`, the drone connection refuses every command with the reason `closed`. Decided while writing the real Crazyswarm2 client for issue #50, after a review found the gap.

## Considered options

- **Stop as an onboard hover (`notifySetpointsStop`, then a relative `goTo`)**: rejected for now. The drone would hold with no radio. But it would keep flying after the bridge died, and every stop would pass through the same planner gap as land.
- **Stop as `emergency()`**: rejected. It is the emergency cut. The drone falls and must be restarted.

## Consequences

- A `Reply(ok=True)` from this drone connection means "accepted and sent". See the [ADR 0002 amendment of 2026-11-13](0002-drone-connection-commands-and-reports.md).
- The contract suite gets an opt-in harness for cf1, with `Harness.max_move_m` and `Harness.tolerance_m`, so every test stays inside the 1 m box.
- Battery and the other status values arrive once a second, so `radio_measured_at` advances once a second.

## References

1. [Crazyswarm2 1.0.7 (commit fcf51e2)](https://github.com/IMRCLab/crazyswarm2/tree/fcf51e27fe675bbdb564a40f4ca1ee4336c062ea): `crazyflie_py/crazyflie_py/crazyflie.py`, `crazyflie_server_cpp/src/crazyflie_server.cpp`, `crazyflie_examples/crazyflie_examples/cmd_full_state.py`, read 2026-11-13.
2. [Crazyflie firmware master (commit b65d8c5)](https://github.com/bitcraze/crazyflie-firmware/tree/b65d8c5704743ca40c9eec78240b103f7d6c87f7): `src/modules/src/commander.c`, `crtp_commander.c`, `crtp_commander_high_level.c`, `supervisor.c`, read 2026-11-13.
