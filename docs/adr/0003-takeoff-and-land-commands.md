---
status: accepted
---

# Takeoff and land commands in the Python command bridge

Issue #19 adds the `takeoff` and `land` commands of [message format v1](../../protocol/README.md#command-and-reply). The protocol lists both commands and their `drones` argument, but it leaves their rules open ([OPEN-10](../../CONTEXT.md#unknowns-contradictions-and-open-decisions)). The bridge follows the rules below until both teams settle the takeoff, landing, and stop items. protocol/README.md does not state these rules yet, because a change there needs both teams.

- **Both roles send takeoff and land.** The operator and the experimenter can both send them, as protocol/README.md says for `hello.role`. The other command names still get `not_allowed` with "not supported yet".
- **The bridge checks the whole command before any drone moves.** `args` must be exactly `{"drones": [...]}` with one or more distinct names. Anything else gets `invalid`. A name that is not in `config.drones` gets `unknown_drone`, and the drone connection receives nothing.
- **One reply covers all named drones.** The drone connection answers for each drone. If it accepts every drone, the reply is `ok`. Otherwise the reply is `not_allowed`, and `detail` lists each refused drone with the drone connection's reason, such as `cf7: not_grounded`. The drones it accepted still take off or land.
- **The bridge holds a target only for a flying drone.** When a drone reaches flying, its target becomes the position where it arrived. While a drone is grounded, taking off, landing, or stopped, the bridge holds no target, and telemetry `cmd` reports the drone's measured position. A later setpoint stream then can't pull a drone that just took off back to its pad.

## Consequences

- A command for several drones can partly succeed, although the reply says `ok: false`. The tablet sends one drone per command for now, so only another client can cause this. The tablet sees only `not_allowed` and the detail. Telemetry shows which drones changed flight state.
- Issue #20 moves the target of a held drone and streams it to the drone connection.
