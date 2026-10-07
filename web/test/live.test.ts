// Live positions: the page address that turns them on, and how telemetry poses move drones and obstacles.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTelemetry, liveUrl, mapYaw, type Pose, type Telemetry } from "../src/live";
import { COURSE, sampleDrones } from "../src/sample";

const example = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "protocol", "examples", "telemetry-cf3-defensive-hover.json"), "utf8")) as Telemetry;
const pose = (id: string, x: number | null, y = 1, age = 5): Pose => ({ id, x, y: x === null ? null : y, z: x === null ? null : 0.8, yaw: x === null ? null : 0, pos_age_ms: x === null ? null : age });
const course = () => ({ boxes: COURSE.boxes.map(b => ({ ...b })), hoops: COURSE.hoops.map(h => ({ ...h })) });

describe("live positions", () => {
  it("connect only with ?live, to this host or to the given address", () => {
    expect(liveUrl("", { protocol: "https:", host: "tab:5173" })).toBeNull();
    expect(liveUrl("?live", { protocol: "https:", host: "tab:5173" })).toBe("wss://tab:5173/ws");
    expect(liveUrl("?live", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws");
    expect(liveUrl("?live=ws://10.0.0.2:8765/ws", { protocol: "https:", host: "x" })).toBe("ws://10.0.0.2:8765/ws");
  });
  it("turn protocol yaw (counterclockwise from +x) into map heading (clockwise from +y)", () => {
    expect([0, 90, -90, 180].map(mapYaw)).toEqual([90, 0, 180, 270]);
  });
  it("move each drone to its measured pose and drop its sample readings", () => {
    const drones = sampleDrones();
    applyTelemetry(example, drones, course(), COURSE, 250);
    const d3 = drones[2]!;
    expect([d3.x, d3.y, d3.z, d3.stale]).toEqual([3.372, 0.752, 0.603, false]);
    expect(d3.ranges).toEqual({});
    expect(d3.tx).toBe(3.372);                        // released: the target follows the measurement
    expect(drones[0]!.tx).toBe(sampleDrones()[0]!.tx);  // held: the operator's target stays
  });
  it("mark a drone stale when its pose is missing or too old, and leave it where it was", () => {
    const drones = sampleDrones(), before = drones[1]!.x;
    applyTelemetry({ ...example, drones: [pose("cf1", 2, 1, 400), pose("cf2", null)], obstacles: [] }, drones, course(), COURSE, 250);
    expect([drones[0]!.stale, drones[1]!.stale, drones[1]!.x]).toEqual([true, true, before]);
  });
  it("move an obstacle to its measured centre, and back to its configured place when tracking stops", () => {
    const c = course(), b = c.boxes;
    expect(applyTelemetry({ ...example, drones: [], obstacles: [pose("O1", 1.4, 1.7)], hoops: [] }, [], c, COURSE, 250)).toBe(true);
    expect([b[0]!.x, b[0]!.y, b[0]!.stale]).toEqual([1.4, 1.7, false]);
    expect(applyTelemetry({ ...example, drones: [], obstacles: [pose("O1", null)], hoops: [] }, [], c, COURSE, 250)).toBe(true);
    expect([b[0]!.x, b[0]!.y, b[0]!.stale]).toEqual([COURSE.boxes[0]!.x, COURSE.boxes[0]!.y, true]);
  });
  it("move a hoop to its measured centre, height and yaw, and back to its configured place when tracking stops", () => {
    const c = course(), h2 = c.hoops[1]!, home = COURSE.hoops[1]!;
    const measured = { ...pose("H2", 4.1, 2.5), z: 0.62, yaw: 75 };
    expect(applyTelemetry({ ...example, drones: [], obstacles: [], hoops: [measured] }, [], c, COURSE, 250)).toBe(true);
    expect([h2.x, h2.y, h2.z, h2.ang, h2.stale]).toEqual([4.1, 2.5, 0.62, 75, false]);
    expect(applyTelemetry({ ...example, drones: [], obstacles: [], hoops: [pose("H2", null)] }, [], c, COURSE, 250)).toBe(true);
    expect([h2.x, h2.y, h2.z, h2.ang, h2.stale]).toEqual([home.x, home.y, home.z, home.ang, true]);
  });
});
