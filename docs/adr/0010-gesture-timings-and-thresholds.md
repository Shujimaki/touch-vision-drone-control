---
status: accepted
---

# Gesture timings and thresholds

[REQ-03 to REQ-06](../CONTEXT.md#required-interactions-and-control-behavior) set how the altitude channel behaves, but the proposal gives no numbers for it. [OPEN-07](../CONTEXT.md#unknowns-contradictions-and-open-decisions) lists the gesture confirmation time, dead zone, maximum rate, and pose-loss duration as absent. The tablet uses the values below. They are placeholders for the pilot trials to tune against [TARGET-06 and TARGET-07](../CONTEXT.md#evaluation-method-and-numerical-targets). Decided 2026-11-18 by the software team, which owns the gesture channel ([ROADMAP.md](../../ROADMAP.md), software part 3).

| Setting | Value | Reason |
|---|---|---|
| Confirmation hold | 500 ms of open palm | REQ-03: a resting hand must not activate. A short steady hold proves intent without slowing activation much. |
| Stillness during the hold | wrist moves less than 0.04 of the frame height | A moving hand restarts the hold, so the neutral point is taken from a still wrist. |
| Dead band | 0.03 of the frame height around the neutral point | Small wrist drift requests no rate, which keeps unintended height changes down (TARGET-07). |
| Full rate | 0.18 of the frame height from the neutral point | The rate grows in proportion past the dead band and reaches the maximum here (REQ-04). |
| Maximum rate | `rate_max` from the host configuration, 0.2 m/s by default | The tablet also clamps to it, since the bridge rejects a larger rate. |
| Wrist smoothing | average of the last 5 frames | Cuts landmark jitter at about 15 FPS without much lag. |
| Classifier score | 0.5 or more to count a label | A lower score counts as an unclear pose. |
| Hand detection | 0.6 detection and presence, 0.5 tracking | Skips weak hand detections. |
| Hand loss | no hand for 300 ms or more | See below. |

- **A short gap pauses, a long one is hand loss.** The rate is 0 from the first frame with no hand, so altitude holds at once, as REQ-06 asks. Under 300 ms, the tablet treats the gap like an unclear pose: it reports `unrecognized` and keeps the neutral point, so an open palm resumes control. At 300 ms or more it reports `hand_loss`, drops the neutral point, and needs a fresh activation. At 15 FPS one missed frame lasts about 67 ms. Without the grace period, every tracking blip would force a full re-activation and count against gesture accuracy (TARGET-06).
- **This is an interpretation.** REQ-06 says reappearance alone does not resume altitude changes after hand loss. This ADR reads a gap under 300 ms as a tracking blip, not as hand loss. Each frame still goes to the host in `input.frames`, so the trial records can recount the gaps with another threshold ([OPEN-12](../CONTEXT.md#unknowns-contradictions-and-open-decisions)).

## Consequences

- The values live in `web/src/main.ts`, where the tablet creates the gesture controller. Changing one needs no protocol change.
- The pilot trials should log activations and gaps so these values can be tuned before data collection.
