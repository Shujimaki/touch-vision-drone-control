import { describe, expect, it } from "vitest";
import { GestureController } from "../src/gestureControl";
import type { GestureFrameResult } from "../src/gestureMessages";

// one frame of mediapipe output
const palm = (wristY: number): GestureFrameResult => ({ handDetected: true, label: "Open_Palm", score: 0.9, wristX: 0.5, wristY });
const fist: GestureFrameResult = { handDetected: true, label: "Closed_Fist", score: 0.9, wristX: 0.5, wristY: 0.5 };
const other: GestureFrameResult = { handDetected: true, label: "None", score: 0.9, wristX: 0.5, wristY: 0.5 };
const noHand: GestureFrameResult = { handDetected: false, label: null, score: null, wristX: null, wristY: null };

const make = () => new GestureController({ maxRateMps: 0.2, deadBand: 0.03, fullRateDisplacement: 0.18 });

// hold an open palm still long enough to confirm
function activate(c: GestureController, y = 0.5) {
  c.update(palm(y), 0);
  c.update(palm(y), 250);
  return c.update(palm(y), 500);
}

describe("gesture control", () => {
  it("needs a steady open palm for 500 ms before control starts", () => {
    const c = make();
    expect(c.update(palm(0.5), 0).mode).toBe("confirming");
    expect(c.update(palm(0.5), 400).mode).toBe("confirming");
    expect(c.update(palm(0.5), 500)).toMatchObject({ mode: "active", rateMps: 0, neutralY: 0.5 });
  });

  it("starts the hold over when the wrist moves while confirming", () => {
    const c = make();
    c.update(palm(0.5), 0);
    c.update(palm(0.6), 300); // moved more than 0.04
    expect(c.update(palm(0.6), 500).mode).toBe("confirming");
  });

  it("climbs when the wrist rises and descends when it drops", () => {
    const c = make();
    activate(c);
    for (let t = 600; t < 1000; t += 100) c.update(palm(0.3), t);
    expect(c.update(palm(0.3), 1000).rateMps).toBeCloseTo(0.2); // past full rate
    for (let t = 1100; t < 1500; t += 100) c.update(palm(0.6), t);
    expect(c.update(palm(0.6), 1500).rateMps).toBeLessThan(0);
  });

  it("ignores small wrist movements inside the dead band", () => {
    const c = make();
    activate(c);
    expect(c.update(palm(0.52), 600).rateMps).toBe(0);
  });

  it("locks on a fist and drops the neutral point", () => {
    const c = make();
    activate(c);
    expect(c.update(fist, 600)).toMatchObject({ mode: "locked", rateMps: 0, neutralY: null });
    expect(c.update(other, 700).mode).toBe("locked");
  });

  it("holds altitude on hand loss and needs a fresh open palm", () => {
    const c = make();
    activate(c);
    expect(c.update(noHand, 600)).toMatchObject({ mode: "hand_loss", rateMps: 0, neutralY: null });
    expect(c.update(palm(0.5), 700).mode).toBe("confirming");
  });

  it("pauses on an unclear pose and keeps the neutral point", () => {
    const c = make();
    activate(c);
    expect(c.update(other, 600)).toMatchObject({ mode: "unrecognized", rateMps: 0, neutralY: 0.5 });
    expect(c.update(palm(0.5), 700).mode).toBe("active");
  });

  it("does not start from a hand that only rests in view", () => {
    const c = make();
    expect(c.update(other, 0).mode).toBe("idle");
    expect(c.update(noHand, 100).mode).toBe("idle");
  });
});
