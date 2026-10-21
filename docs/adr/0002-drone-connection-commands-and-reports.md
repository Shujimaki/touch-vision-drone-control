---
status: accepted
---

# Drone connection command rules and measurement times

The drone connection (`touch_vision_drone_control/drone_connection.py`) follows these rules. They came out of the drone connection prototype on branch `prototype/drone-connection`, and the project agreed them on issue #22 on 2026-10-20.

- **Position targets go only to flying drones.** The Python command bridge sends a position target only to a drone that reports flying. The drone connection still rejects a target for any other drone. A bridge bug then can't move a drone that is grounded, taking off, landing, or stopped.
- **Land is the way out of stop.** Stop halts every airborne drone where it is. A stopped drone rejects position targets and accepts land. The drone connection keeps no stop latch. The bridge decides when takeoff is allowed again, through `stop_reset` in message format v1.
- **Defensive hover follows the straight line.** A drone heads along the straight line to its latest target. During defensive hover it holds only while that line points at the obstacle, so a new target that pulls it away moves it again.
- **Two measurement times per drone report, on the flight host clock.** Position comes from the motion capture machine and carries `position_measured_at`. Ranges, battery voltage, and the defensive-hover flag come over the radio and share `radio_measured_at`. The two can go stale separately.

## Consequences

- The stop rule settles, for the drone connection, part of what protocol/README.md still calls open ("Its effect and owner are open"). The protocol and the takeoff, landing, and stop items in CONTEXT.md need an update once both teams agree.
- The mock drone connection doesn't simulate defensive hover or link loss yet. The contract suite doesn't test either rule.
- The hardware team still has to confirm that ranges, battery voltage, and the defensive-hover flag arrive together in one radio packet.
