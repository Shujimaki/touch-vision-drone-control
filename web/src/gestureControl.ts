// turns MediaPipe results into a control mode and climb/descent rate.

import type { GestureFrameResult } from "./gestureMessages";

export interface GestureControlConfig {
  maxRateMps: number;
  deadBand: number;
  fullRateDisplacement: number;
  minConfidence?: number;
  confirmMs?: number;
  stillThreshold?: number;
}

export interface GestureControlState {
  mode: "waiting" | "confirming" | "active" | "unrecognized" | "locked";
  rateMps: number;
  neutralY: number | null;
}

const FILTER_SAMPLES = 5;

export class GestureController {
  private mode: GestureControlState["mode"] = "waiting";
  private neutralY: number | null = null;
  private confirmStartMs: number | null = null;
  private confirmY: number | null = null;
  private wristSamples: number[] = [];
  private readonly config: Required<GestureControlConfig>;

  constructor(config: GestureControlConfig) {
    this.config = {
      ...config,
      minConfidence: config.minConfidence ?? 0.5,
      confirmMs: config.confirmMs ?? 500,
      stillThreshold: config.stillThreshold ?? 0.04
    };

    // makes sure the rate and wrist movement settings are valid
    if (
      this.config.maxRateMps <= 0 ||
      this.config.deadBand < 0 ||
      this.config.fullRateDisplacement <= this.config.deadBand ||
      this.config.minConfidence < 0 ||
      this.config.minConfidence > 1 ||
      this.config.confirmMs < 0 ||
      this.config.stillThreshold < 0
    ) {
      throw new Error("Invalid gesture control settings.");
    }
  }

  update(result: GestureFrameResult, tMs = performance.now()): GestureControlState {
    const wristY = result.wristY;

    // no hand means zero rate; wait for a fresh open palm
    if (!result.handDetected || wristY === null) {
      this.clearConfirmation();
      this.wristSamples = [];

      if (this.mode !== "locked") {
        this.mode = "waiting";
        this.neutralY = null;
      }

      return this.state(0);
    }

    const confident = result.score !== null &&
      result.score >= this.config.minConfidence;
    const label = confident ? result.label : null;

    // a fist pauses the rate and clears the saved wrist position
    if (label === "Closed_Fist") {
      this.mode = "locked";
      this.neutralY = null;
      this.clearConfirmation();
      this.wristSamples = [];
      return this.state(0);
    }

    // stay locked till an open palm comes back
    if (this.mode === "locked" && label !== "Open_Palm") {
      return this.state(0);
    }

    // other labels pause movement; keep the neutral point if control was active
    if (label !== "Open_Palm") {
      this.clearConfirmation();
      this.wristSamples = [];

      if (this.mode === "active" || this.mode === "unrecognized") {
        this.mode = "unrecognized";
      } else if (this.mode !== "locked") {
        this.mode = "waiting";
      }

      return this.state(0);
    }

    if (this.mode === "active") {
      return this.state(this.rateFrom(this.filteredWrist(wristY)));
    }

    if (this.mode === "unrecognized") {
      // resume without a sudden rate jump
      this.mode = "active";
      this.wristSamples = [wristY];
      return this.state(0);
    }

    // hold the palm steady before saving the neutral point
    if (
      this.mode !== "confirming" ||
      this.confirmStartMs === null ||
      this.confirmY === null
    ) {
      this.startConfirmation(wristY, tMs);
      return this.state(0);
    }

    if (Math.abs(wristY - this.confirmY) > this.config.stillThreshold) {
      this.startConfirmation(wristY, tMs);
      return this.state(0);
    }

    this.addWristSample(wristY);

    if (tMs - this.confirmStartMs >= this.config.confirmMs) {
      this.neutralY = this.averageWrist();
      this.mode = "active";
      this.clearConfirmation();
      return this.state(0);
    }

    return this.state(0);
  }

  // clear everything when the camera is turned off
  reset(): void {
    this.mode = "waiting";
    this.neutralY = null;
    this.clearConfirmation();
    this.wristSamples = [];
  }

  private startConfirmation(wristY: number, tMs: number): void {
    this.mode = "confirming";
    this.confirmStartMs = tMs;
    this.confirmY = wristY;
    this.wristSamples = [wristY];
  }

  private clearConfirmation(): void {
    this.confirmStartMs = null;
    this.confirmY = null;
  }

  // average a few frames to reduce wrist tracking jitter
  private addWristSample(wristY: number): void {
    this.wristSamples.push(wristY);
    if (this.wristSamples.length > FILTER_SAMPLES) {
      this.wristSamples.shift();
    }
  }

  private averageWrist(): number {
    return this.wristSamples.reduce((sum, y) => sum + y, 0) /
      this.wristSamples.length;
  }

  private filteredWrist(wristY: number): number {
    this.addWristSample(wristY);
    return this.averageWrist();
  }

  private rateFrom(wristY: number): number {
    if (this.neutralY === null) return 0;

    // camera y gets smaller as the wrist moves up
    const displacement = this.neutralY - wristY;
    const distance = Math.abs(displacement);

    // ignore small movements so they don't change the rate.
    if (distance <= this.config.deadBand) {
      return 0;
    }

    // scale the wrist movement to the configured maximum rate.
    const amount = Math.min(
      1,
      (distance - this.config.deadBand) /
        (this.config.fullRateDisplacement - this.config.deadBand)
    );

    return Math.sign(displacement) * amount * this.config.maxRateMps;
  }

  private state(rateMps: number): GestureControlState {
    return {
      mode: this.mode,
      rateMps,
      neutralY: this.neutralY
    };
  }
}