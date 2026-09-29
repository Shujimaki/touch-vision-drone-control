import { describe, expect, it } from "vitest";
import { COURSE, sampleDrones, sampleLog, type TrialRecord } from "../src/sample";
import { PAL, threatColor } from "../src/theme";
import { U, batteryLevel, fmtMS, fmtT } from "../src/format";
import { courseLayer, droneEntity, fitView, toCourse } from "../src/components/map";
import { altitudeBars } from "../src/components/altitude";
import { dronesTable, logView, RANGE_COLS } from "../src/components/telemetry";
import { gestureStatus, heldAltitude } from "../src/components/panel";
import { flightState } from "../src/components/videoFeed";

const K = PAL.dark, R = { trig: 0.15, show: 0.60 };
const view = fitView(900, 800, COURSE.arena);

describe("sample data", () => {
  it("places every drone inside the room", () => {
    for (const d of sampleDrones()) {
      expect(d.x).toBeGreaterThanOrEqual(COURSE.arena.xMin); expect(d.x).toBeLessThanOrEqual(COURSE.arena.xMax);
      expect(d.y).toBeGreaterThanOrEqual(COURSE.arena.yMin); expect(d.y).toBeLessThanOrEqual(COURSE.arena.yMax);
    }
  });
});

describe("map", () => {
  it("fits the whole room and maps screen points back to the course", () => {
    const [x, y] = toCourse(view, view.OX + 2 * view.SC, view.OY - 1 * view.SC);
    expect(x).toBeCloseTo(2); expect(y).toBeCloseTo(1);
    expect(view.OX + COURSE.arena.xMax * view.SC).toBeLessThanOrEqual(view.VW);
  });
  it("draws the course: both obstacles, three hoops and the restricted zone", () => {
    const g = courseLayer(COURSE, view, K);
    for (const id of ["O1", "O2", "H1", "H2", "H3", "RESTRICTED"]) expect(g).toContain(id);
  });
  it("draws a held drone filled and a grounded drone dashed", () => {
    const [d1, , d3] = sampleDrones();
    expect(droneEntity(d1!, COURSE, view, K, R)).toContain(`fill="${K.own}"`);
    expect(droneEntity(d3!, COURSE, view, K, R)).toContain('stroke-dasharray="4 3"');
  });
  it("glows the proximity ring only when a side reading is close", () => {
    const [d1] = sampleDrones();
    expect(droneEntity(d1!, COURSE, view, K, R)).toContain("proxGlow");               // O1 is 0.19 m to its right
    expect(droneEntity({ ...d1!, ranges: {} }, COURSE, view, K, R)).not.toContain('filter="url(#proxGlow)"');
    expect(threatColor(K, 0)).toBe("rgb(95,208,104)");
  });
  it("draws a line to a drone's target only when it is heading somewhere", () => {
    const [d1, d2] = sampleDrones();
    expect(droneEntity(d2!, COURSE, view, K, R)).toContain("wisp-cf2");
    expect(droneEntity(d1!, COURSE, view, K, R)).not.toContain("wisp-cf1");
  });
});

describe("panels", () => {
  it("shows arrows only on the held, flying drone's altitude bar", () => {
    const s = altitudeBars(sampleDrones(), COURSE, 0.12, 80, 700, K);
    expect(s.match(/stroke="#25C6E8" stroke-width="2"\/>/g)?.length).toBe(2);   // two arrow heads, one bar
  });
  it("describes the altitude channel for the held drones", () => {
    const [d1] = sampleDrones();
    expect(gestureStatus("climb", [d1!], 0.12).main).toBe("▲ Climbing 0.12 m/s");
    expect(gestureStatus("climb", [], 0.12).main).toBe("Hold a drone to use altitude");
    expect(heldAltitude([])).toContain("No drone held");
  });
  it("shows the video header state", () => {
    const [d1, d2, d3] = sampleDrones();
    expect(flightState(d1!, 0.12)[0]).toBe("Moving");
    expect(flightState(d2!, 0.12)[0]).toBe("Moving");
    expect(flightState(d3!, 0.12)[0]).toBe("Grounded");
  });
});

describe("telemetry", () => {
  it("puts each Multi-ranger reading under its own heading", () => {
    const html = dronesTable(sampleDrones(), 0.15, 0.60), row = html.split("<tr>").find(r => r.includes("DRONE 1"))!;
    const heads = [...html.matchAll(/<th>(front|back|left|right|up)<\/th>/g)].map(m => m[1]);
    expect(heads).toEqual(RANGE_COLS);
    // columns: drone, state, hover, link, quality, pm.vbat, level, x, y, z, yaw, cmd x, y, z, then the five ranges
    const cells = [...row.matchAll(/<td[^>]*>([^<]*)/g)].map(m => m[1]!), ranges = cells.slice(14, 19);
    const d1 = sampleDrones()[0]!;
    RANGE_COLS.forEach((k, i) => expect(ranges[i], k).toBe(d1.ranges[k]!.toFixed(2)));
  });
  const trials: TrialRecord[] = [{ id: "S1-T1", session: "S1", t0: 821, t1: null, outcome: null, dh: 0, restrict: 0 }];
  it("filters the event log by session, then by trial", () => {
    const log = sampleLog();
    expect(logView(log, trials, ["S1"], { session: "all", trial: "all" }, 851, 300).events.length).toBe(log.length);
    const t = logView(log, trials, ["S1"], { session: "S1", trial: "S1-T1" }, 851, 300);
    expect(t.events.every(e => e.tr === "S1-T1")).toBe(true);
    expect(t.count).toBe(`${t.events.length} of ${log.length} events`);
    expect(t.summary).toContain("Running");
  });
});

describe("formats", () => {
  it("names drones and writes times", () => {
    expect(U("cf2")).toBe("DRONE 2"); expect(fmtT(851)).toBe("00:14:11"); expect(fmtMS(30)).toBe("00:30");
  });
  it("reads the Crazyflie battery curve", () => {
    expect(batteryLevel(4.02)).toBe(80); expect(batteryLevel(3.94)).toBe(60); expect(batteryLevel(2.9)).toBe(0);
  });
});
