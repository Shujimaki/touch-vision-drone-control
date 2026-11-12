---
status: accepted
---

# Read Motive positions over NatNet through ROS 2

## Decision

Use NatNet to send Motive pose data from the motion capture machine to
the flight host over the local network. ROS 2 on the flight host receives
and publishes the poses for the Python command bridge to use.

This follows the decision recorded in issue #28 and keeps the flight host
on ROS 2. It builds on DEC-13, which puts Motive on a separate motion
capture machine. Decided 2026-11-11.

## What still needs to be checked

- Confirm that ROS 2 receives the NatNet poses when the OptiTrack setup is
  available again. Two lab tests disagree: issue #28 records that Motive
  1.10 sent no usable NatNet frames to the bridge, and a later test on
  2026-10-29 received NatNet data, with its setup not recorded. VRPN on
  port 3883 is the measured fallback.
- Confirm whether the ROS 2 topic is y-up or z-up before using
  `motive_to_map`. The y-up rule was measured on the VRPN stream (issue #28).
- Record the Motive version, streaming settings, rigid body names, and
  ROS topic.
- Measure whether the stream stays fresh and stable during a lab run.

## Consequences

- The ROS 2 and Crazyswarm2 integration handles receiving the poses.
- The Python command bridge sends the resulting drone positions to the
  tablet as telemetry.
- The tablet continues to use telemetry to update the map.

## References

- [Issue #28: Decide how the bridge gets Motive positions](https://github.com/Shujimaki/touch-vision-drone-control/issues/28)
- [ADR 0001: The Python command bridge lives inside the ROS 2 package](0001-bridge-inside-ros2-package.md)
- [ADR 0002: Drone connection commands and reports](0002-drone-connection-commands-and-reports.md)
- [DEC-13: Motive on a separate motion capture machine](../../CONTEXT.md#accepted-decisions-made-after-the-proposal)
