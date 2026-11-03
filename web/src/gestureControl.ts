// turns MediaPipe results into a control mode and climb/descent rate.

import type { GestureFrameResult } from "./gestureMessages";

export interface GestureControlConfig {
  maxRateMps: number;
  deadBand: number;
  fullRateDisplacement: number;
}

export interface GestureControlState {
  mode: "waiting" | "active" | "locked";
  rateMps: number;
  neutralY: number | null;
}

export class GestureController {
  private mode: GestureControlState["mode"] = "waiting";
  private neutralY: number | null = null;

  constructor(private readonly config: GestureControlConfig) {
    // makes sure the rate and wrist movement settings are valid
    if (
      config.maxRateMps <= 0 ||
      config.deadBand < 0 ||
      config.fullRateDisplacement <= config.deadBand
    ) {
      throw new Error("Invalid gesture control settings.");
    }
  }

  update(result: GestureFrameResult): GestureControlState {
    // no hand means zero rate; wait for a fresh open palm
    if (!result.handDetected || result.wristY === null) {
      this.mode = "waiting";
      this.neutralY = null;
      return this.state(0);
    }

    // a fist pauses the rate and clears the saved wrist position
    if (result.label === "Closed_Fist") {
      this.mode = "locked";
      this.neutralY = null;
      return this.state(0);
    }

    // stay locked till an open palm comes back
    if (this.mode === "locked" && result.label !== "Open_Palm") {
      return this.state(0);
    }

    // other labels don't activate the control
    if (result.label !== "Open_Palm") {
      this.mode = "waiting";
      this.neutralY = null;
      return this.state(0);
    }

    if (this.neutralY === null) {
      // neutral point
      this.mode = "active";
      this.neutralY = result.wristY;
      return this.state(0);
    }

    // cam y gets smaller as the wrist moves up
    const displacement = this.neutralY - result.wristY;
    const distance = Math.abs(displacement);

    // ignore small movements so they don't change the rate.
    if (distance <= this.config.deadBand) {
      return this.state(0);
    }

    // scale the wrist movement to the configured maximum rate.
    const amount = Math.min(
      1,
      (distance - this.config.deadBand) /
        (this.config.fullRateDisplacement - this.config.deadBand)
    );

    const rateMps = Math.sign(displacement) * amount * this.config.maxRateMps;
    return this.state(rateMps);
  }

  // clear everything when the camera is turned off
  reset(): void {
    this.mode = "waiting";
    this.neutralY = null;
  }

  private state(rateMps: number): GestureControlState {
    return {
      mode: this.mode,
      rateMps,
      neutralY: this.neutralY
    };
  }
}