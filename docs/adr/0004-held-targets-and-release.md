---
status: accepted
---

# Held targets, release, and stale input

Issue #20 makes one finger drag one drone. [Message format v1](../../protocol/README.md#checks-and-responses) sets most of the rules for held entries. Two choices stay open there: which target a released drone holds ([OPEN-07](../../CONTEXT.md#unknowns-contradictions-and-open-decisions)), and the stale-input timeout ([OPEN-06](../../CONTEXT.md#unknowns-contradictions-and-open-decisions)). The bridge follows the rules below as placeholders until both teams settle those items.

- **One setpoint stream for the whole bridge.** The bridge sends one target to every flying drone 30 times a second, whether or not a tablet is connected. Telemetry reads the same targets for `cmd`. An accepted input also sends its targets at once.
- **A held entry moves only x and y.** It sets the drone's target to the accepted x and y and keeps the target's z, because the altitude channel is still a stub.
- **A lifted finger holds the position where it was released.** When a drone leaves the held list, its target becomes its measured x and y at that moment, with the same target z. A drone released while it still trails the finger then stops where it is. It does not fly on to the finger's last spot. User story 7 of issue #16 asks for this.
- **Stale input holds the target.** After `input_timeout_ms` with no valid input, the bridge drops every hold and keeps each drone's last target, as protocol/README.md says. Holds come back only after an input with an empty held list and a gesture state other than `active`.
- **A new operator starts locked.** When the operator disconnects, the bridge drops every hold. The next operator must send an input with an empty held list before a hold applies. Control then never resumes on its own after a reconnect.
- **The tablet checks the zone as a square.** The tablet's restricted-zone check (`web/src/zone.ts`) handles a square. If `config.course.restricted_zone` is not square, the tablet checks the smallest square that covers it, so it never sends a target the bridge would reject.

## Amendment, 2026-11-12: stop drops every hold

Issue #36 adds the `stop` command, as ADR 0007 decides. Stop drops every hold, as stale input and a new operator do.

- **Stop drops every hold and locks.** When the bridge receives a valid `stop`, it drops every hold before it calls `DroneConnection.stop()`. The next held entry applies only after an input with an empty held list. A finger still on the screen after stop, land, and takeoff then can't pull the drone again.
- **A refused stop still drops the holds.** If the drone connection refuses stop, the drones keep flying to their last targets, as with stale input. The operator must lift every finger before a hold applies again.
- **Both roles send stop.** The operator and the experimenter can both send it, as with takeoff and land (ADR 0003). protocol/README.md still calls the owner of stop open.

## Consequences

- A lifted finger and stale input end in different targets. The trial recorder needs to know which one happened, once it exists.
- The setpoint rate is a bridge constant, not a `welcome.config` field. Moving it to the configuration needs a protocol change and both teams.
