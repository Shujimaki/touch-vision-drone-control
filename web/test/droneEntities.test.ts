import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTelemetry } from "../src/droneEntities";
import { parseHostMessage, type DroneTelemetry, type Telemetry } from "../src/protocol";
import { sampleDrones } from "../src/sample";

const parsed = parseHostMessage(
  readFileSync(join(import.meta.dirname, "..", "..", "protocol", "examples", "telemetry-cf3-defensive-hover.json"), "utf8"));
if (parsed?.type !== "telemetry") throw new Error("the telemetry example does not parse as telemetry");
const TELEMETRY: Telemetry = parsed;
const STALE_MS = 250;
const withDrone = (id: string, fields: Partial<DroneTelemetry>): Telemetry =>
  ({ ...TELEMETRY, drones: TELEMETRY.drones.map(d => d.id === id ? { ...d, ...fields } : d) });

describe("applyTelemetry", () => {
  it("moves each drone entity to its measured position and its target marker to the bridge's target", () => {
    const drones = sampleDrones();
    drones[0]!.held = false;

    applyTelemetry(drones, TELEMETRY, STALE_MS);

    const cf1 = drones[0]!;
    expect([cf1.x, cf1.y, cf1.z, cf1.tx, cf1.ty, cf1.stale]).toEqual([1.184, 0.851, 0.742, 1.2, 0.85, false]);
  });

  it("leaves the target marker of a held drone where the finger put it", () => {
    const drones = sampleDrones();
    const cf1 = drones[0]!;
    cf1.held = true; cf1.tx = 4; cf1.ty = 3;

    applyTelemetry(drones, TELEMETRY, STALE_MS);

    expect([cf1.x, cf1.tx, cf1.ty]).toEqual([1.184, 4, 3]);
  });

  it("keeps the last position and marks the drone stale when the bridge has no position", () => {
    const drones = sampleDrones();
    applyTelemetry(drones, TELEMETRY, STALE_MS);

    applyTelemetry(drones, withDrone("cf2", { x: null, y: null, z: null, pos_age_ms: null }), STALE_MS);

    const cf2 = drones[1]!;
    expect([cf2.x, cf2.y, cf2.z, cf2.stale]).toEqual([1.593, 1.396, 0.915, true]);
  });

  it("ignores a partial position and marks the drone stale", () => {
    const drones = sampleDrones();
    applyTelemetry(drones, TELEMETRY, STALE_MS);

    applyTelemetry(drones, withDrone("cf2", { x: 3, y: null, z: null }), STALE_MS);

    expect([drones[1]!.x, drones[1]!.stale]).toEqual([1.593, true]);
  });

  it.each([[STALE_MS, false], [STALE_MS + 0.1, true]])("marks a drone whose position is %f ms old as stale: %s", (age, stale) => {
    const drones = sampleDrones();

    applyTelemetry(drones, withDrone("cf3", { pos_age_ms: age }), STALE_MS);

    expect(drones[2]!.stale).toBe(stale);
  });

  it("takes Multi-ranger readings from telemetry and leaves out directions with no reading", () => {
    const drones = sampleDrones();

    applyTelemetry(drones, TELEMETRY, STALE_MS);

    expect(drones[0]!.ranges).toEqual({ back: 1.18, left: 2.69, right: 0.84, up: 1.8 });
    expect(drones[0]!.below).toBeNull();
  });

  it("returns the drones the map does not know and applies the rest", () => {
    const drones = sampleDrones();
    const telemetry = { ...TELEMETRY, drones: [...TELEMETRY.drones, { ...TELEMETRY.drones[0]!, id: "cf9" }] };

    expect(applyTelemetry(drones, telemetry, STALE_MS)).toEqual(["cf9"]);
    expect(drones[0]!.x).toBe(1.184);
  });
});
