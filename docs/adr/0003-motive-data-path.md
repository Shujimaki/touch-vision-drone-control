---
status: proposed
---

# Read Motive positions over VRPN first, NatNet as the backup

We need live drone and obstacle positions from Motive on the flight host. Issue #28 lists three options: VRPN through ROS 2, NatNet through ROS 2, or a Windows relay that reads Motive and forwards the data over the LAN. We're proposing VRPN first, with NatNet as the fallback, because VRPN already worked in our test and it's the better-maintained ROS 2 path. This is not accepted yet. The team still needs to agree on #28.

## What we know

- VRPN worked before the restart. Telemetry reached the map in our test, at roughly 26 to 110 frames per second.
- NatNet also works. Our own lab test got NatNet data from Motive.
- `vrpn_mocap` is maintained for ROS 2 Jazzy and ships as binaries. [1]
- The ROS 2 port of the NatNet driver says it isn't maintained much. [2]
- `motion_capture_tracking` lists OptiTrack and VRPN among the systems it supports. [3]

## What we don't know

- We haven't confirmed that VRPN is fully supported in Motive 1.10.
- We haven't measured dropped frames or latency for either protocol in the lab. OptiTrack is down right now, so this has to wait.
- The Motive version and streaming settings still need to be written down.

## Not decided here

Whether we need a Windows relay machine. Ron's #28 comment says we'll need two computers either way. That's a separate decision, and it gets its own ADR.

## Consequences

- If the team agrees, the bridge reads Motive over VRPN. We keep NatNet working as a fallback.
- Before we trust either path, we need a lab test: dropped frames, latency, and an hour of stable running.
- Once the team agrees on #28, change the status to `accepted` and link the decision there.

## References

1. vrpn_mocap, ROS 2 Jazzy documentation. https://docs.ros.org/en/jazzy/p/vrpn_mocap/ (checked 2026-11-03)
2. natnet_ros_cpp, GitHub repository. https://github.com/L2S-lab/natnet_ros_cpp (checked 2026-11-03)
3. motion_capture_tracking, ROS index. https://index.ros.org/r/motion_capture_tracking/ (checked 2026-11-03)
