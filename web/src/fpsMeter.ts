// counts how many gesture results arrived in the last second
export class FpsMeter {
  private times: number[] = [];

  // call once per result; returns results in the last 1000 ms
  tick(nowMs: number): number {
    this.times.push(nowMs);

    // forget results older than one second
    while (this.times.length > 0 && nowMs - this.times[0] > 1000) {
      this.times.shift();
    }

    return this.times.length;
  }

  // start over when the camera is turned off
  reset(): void {
    this.times = [];
  }
}
