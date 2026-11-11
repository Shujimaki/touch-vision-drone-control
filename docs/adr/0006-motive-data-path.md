---
status: accepted
---

# Read Motive positions over NatNet through ROS 2

## Decision

Use NatNet to send Motive pose data from the Windows capture computer to
the ROS 2 computer over the LAN. The ROS 2 side receives and publishes the
poses for the bridge to use. 

This follows the decision recorded in issue #28 and keeps the flight system
on ROS 2.

## What still needs to be checked

- Confirm that ROS 2 receives the NatNet poses when the OptiTrack setup is
  available again.
- Record the Motive version, streaming settings, rigid body names, coordinate
  frame, and ROS topic.
- Measure whether the stream stays fresh and stable during a lab run.

We still need to confirm the exact setup when the OptiTrack system is available.

## Consequences

- The ROS 2 and Crazyswarm2 integration handles receiving the poses.
- The bridge sends the resulting drone positions to the tablet as telemetry.
- The tablet continues to use telemetry to update the map.

## References

- [Issue #28: Decide how the bridge gets Motive positions](https://github.com/Shujimaki/touch-vision-drone-control/issues/28)
- [ADR 0001: The Python command bridge lives inside the ROS 2 package](0001-bridge-inside-ros2-package.md)
- [ADR 0002: Drone connection commands and reports](0002-drone-connection-commands-and-reports.md)