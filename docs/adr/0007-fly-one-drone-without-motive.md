---
status: accepted
---

# Fly one drone from the flight test page without Motive

Motive is down until the camera LEDs are repaired. The test flight is due 2026-11-18. So the first real flights use one Crazyflie on its own Flow deck estimate, driven from the flight test page through the Python command bridge. Decided 2026-11-12 in a grilling session that followed the team meeting of the same day.

- **Position comes from the Flow deck.** Each drone carries a Flow deck, so it can estimate its own position. Positions use the takeoff frame. Its origin is a taped takeoff spot on the floor. Its +x axis points along a taped arrow, and the drone faces the arrow at takeoff.
- **The estimator resets before each takeoff.** The Crazyswarm2 drone connection resets the onboard estimate just before takeoff, so (0, 0) is the takeoff spot.
- **Crazyswarm2 drives the drone.** The Crazyswarm2 drone connection streams targets with `cmd_position`, as ADR 0001 and REC-01 expect. A quick cflib connection was rejected because it would bypass ADR 0001. Real flights run only on the Ubuntu flight host.
- **A separate host configuration describes the test area.** It gives the flight test page its bounds through `welcome.config`, so message format v1 does not change. It puts the pad at (0, 0) and the capture volume at a 1 m by 1 m box around it. It puts the restricted zone outside that box, because the bridge always runs the zone check.
- **The first flight stays low and slow.** Takeoff height is 0.4 m. `z_min` is 0.3 m and `z_max` is 1.0 m. The Crazyswarm2 drone connection moves the target it sends by at most 0.3 m/s, as the `send_target` docstring requires.
- **The bridge picks its drone connection and configuration at startup.** `--drones mock|crazyswarm2` defaults to `mock`. `--config course|takeoff` defaults to `course`. The bridge imports the Crazyswarm2 module only for `crazyswarm2`, so the mock still runs without ROS.
- **The flight test page is a second Vite page.** It reuses `input` with one held entry, plus the `takeoff`, `land`, and `stop` commands. It draws one drone circle that starts at the center, with +x pointing up the screen.
- **Stop works from the page.** The bridge accepts `stop` and calls `DroneConnection.stop()`, which follows ADR 0002. The command name is still a placeholder that both teams own.
- **No new loss behavior.** If the page closes or the tablet drops, the drone holds its last target (ADR 0004). If the bridge or the radio fails, setpoints stop. The firmware then cuts the motors after `COMMANDER_WDT_TIMEOUT_SHUTDOWN`, about 2 s by forum reports [[1]](https://www.bitcraze.io/documentation/repository/crazyflie-firmware/master/functional-areas/sensor-to-control/commanders_setpoints/) [[2]](https://forum.bitcraze.io/viewtopic.php?p=20625). A team member stands by with the `ros2 service call /cf1/land` command, and the takeoff spot gets a soft surface. OPEN-06 stays open.

## Work split

Metrillo builds the flight test page, the takeoff host configuration, the two bridge options, `stop`, and a bridge message log. Galvez and Romero own the Crazyswarm2 drone connection, as ROADMAP.md says. At the 2026-11-13 lab session, the hardware team first checks a Flow deck hover with hand-typed `ros2` commands. Then Metrillo pairs with them to write the Crazyswarm2 drone connection on the flight host.

## Done for the 2026-11-18 test flight

cf1 completes three runs in a row from the flight test page. In each run it takes off, follows one finger, holds where the finger lifts, and lands. No run uses a hand-typed command or the stop button. The bridge logs each received `input` and each sent target as one JSON line with host times. A phone video records each run. The log shows TARGET-01. TARGET-05 waits for the trial recorder.

## What still needs to be checked

- The hardware team confirms that the onboard estimate starts at (0, 0) after a reset and that +x points where the drone faces.
- The hardware team checks that the lab floor at the takeoff spot has enough texture and light for the Flow deck.
- The hardware team reports how often the onboard estimate reaches the flight host over the radio. The target is 10 Hz or more, because `stale_position_ms` is 250 ms.
- Check `COMMANDER_WDT_TIMEOUT_SHUTDOWN` in `commander.h` for the firmware version on the drones.

## Consequences

- The course, the map frame, and the motion capture checks don't apply on the flight test page. Results from it are test flights, not trials.
- ADR 0002 now allows a second position source. See its amendment of 2026-11-12.

## References

1. [Bitcraze, The Commander Framework (firmware docs)](https://www.bitcraze.io/documentation/repository/crazyflie-firmware/master/functional-areas/sensor-to-control/commanders_setpoints/), read 2026-11-12.
2. [Bitcraze Forums, motor shutoff issues during disconnect](https://forum.bitcraze.io/viewtopic.php?p=20625), read 2026-11-12.
3. [ADR 0001: The Python command bridge lives inside the ROS 2 package](0001-bridge-inside-ros2-package.md)
4. [ADR 0002: Drone connection command rules and measurement times](0002-drone-connection-commands-and-reports.md)
5. [ADR 0004: Held targets, release, and stale input](0004-held-targets-and-release.md)
6. [OPEN-06 in CONTEXT.md](../../CONTEXT.md#unknowns-contradictions-and-open-decisions)
