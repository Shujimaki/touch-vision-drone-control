import { describe, expect, it } from "vitest";
import { clamp, segCross, segHitsRect, segMinDist } from "../src/lib/geometry";

// restricted zone at the room centre, 1.18 m square (DEC-17), as in the app
const Z = { x: 2.655, y: 1.775, h: 0.59 };

describe("segHitsRect (restricted-zone drag check)", () => {
  it("detects a drag across the zone", () => { expect(segHitsRect(1.5, 1.775, 3.8, 1.775, Z.x, Z.y, Z.h, Z.h)).toBe(true); });
  it("detects a drag ending inside the zone", () => { expect(segHitsRect(1.5, 1.775, 2.655, 1.775, Z.x, Z.y, Z.h, Z.h)).toBe(true); });
  it("allows a drag beside the zone", () => { expect(segHitsRect(1.5, 0.9, 3.8, 0.9, Z.x, Z.y, Z.h, Z.h)).toBe(false); });
  it("counts a drag along an edge as entering", () => { expect(segHitsRect(1.5, Z.y + Z.h, 3.8, Z.y + Z.h, Z.x, Z.y, Z.h, Z.h)).toBe(true); });
  it("allows a drag that only crosses a corner point", () => { expect(segHitsRect(Z.x + Z.h - 1, Z.y + Z.h + 1, Z.x + Z.h + 1, Z.y + Z.h - 1, Z.x, Z.y, Z.h, Z.h)).toBe(false); });
});

describe("segMinDist (drone buffer)", () => {
  it("measures to the nearest point of the segment", () => {
    expect(segMinDist(0, 0, 2, 0, 1, 0.3)).toBeCloseTo(0.3);
    expect(segMinDist(0, 0, 2, 0, 3, 0)).toBeCloseTo(1);
  });
  it("handles a zero-length segment", () => { expect(segMinDist(1, 1, 1, 1, 1, 2)).toBeCloseTo(1); });
});

describe("segCross (hoop gate line)", () => {
  it("detects a pass through the gate", () => { expect(segCross(3.8, 2.7, 4.2, 2.7, 3.99, 2.5, 3.99, 2.9)).toBe(true); });
  it("rejects a pass beside the gate", () => { expect(segCross(3.8, 3.2, 4.2, 3.2, 3.99, 2.5, 3.99, 2.9)).toBe(false); });
});

describe("clamp", () => {
  it("keeps a value within limits", () => { expect(clamp(1.6, 0.5, 1.44)).toBe(1.44); expect(clamp(0.2, 0.5, 1.44)).toBe(0.5); });
});
