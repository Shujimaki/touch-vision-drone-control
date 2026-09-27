import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIPO, batteryLevel } from "../src/lib/battery";

describe("batteryLevel (firmware pm.batteryLevel)", () => {
  it("is 0 below the curve and 90 above it", () => {
    expect(batteryLevel(2.9)).toBe(0);
    expect(batteryLevel(4.2)).toBe(90);
  });
  it("counts the curve steps passed, in tens", () => {
    LIPO.forEach((v, i) => expect(batteryLevel(v)).toBe(i * 10));
    expect(batteryLevel(3.80)).toBe(20);
    expect(batteryLevel(3.94)).toBe(60);
  });
  it("matches battery_level in the shared telemetry example", () => {
    const t = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "protocol", "examples", "telemetry-cf3-defensive-hover.json"), "utf8")) as { drones: { battery_v: number; battery_level: number }[] };
    for (const d of t.drones) expect(batteryLevel(d.battery_v)).toBe(d.battery_level);
  });
});
