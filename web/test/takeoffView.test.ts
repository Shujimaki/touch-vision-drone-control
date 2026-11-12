import { describe, expect, it } from "vitest";
import { inBox, takeoffView, toScreen, toTakeoff } from "../src/takeoffView";

const BOX = { x_min: -0.5, x_max: 0.5, y_min: -0.5, y_max: 0.5 };

describe("takeoff view", () => {
  const view = takeoffView(400, 400, BOX);

  it("puts the takeoff spot at the center of the screen", () => {
    expect(toScreen(view, { x: 0, y: 0 })).toEqual({ px: 200, py: 200 });
    expect(toTakeoff(view, { px: 200, py: 200 })).toEqual({ x: 0, y: 0 });
  });

  it("points +x up the screen and +y left", () => {
    expect(toScreen(view, { x: 0.5, y: 0 })).toEqual({ px: 200, py: 0 });
    expect(toScreen(view, { x: 0, y: 0.5 })).toEqual({ px: 0, py: 200 });
    expect(toTakeoff(view, { px: 400, py: 400 })).toEqual({ x: -0.5, y: -0.5 });
  });

  it("maps a screen point back to the same takeoff-frame point", () => {
    const p = { x: 0.2, y: -0.3 };
    const back = toTakeoff(view, toScreen(view, p));
    expect(back.x).toBeCloseTo(0.2, 9);
    expect(back.y).toBeCloseTo(-0.3, 9);
  });

  it("keeps one scale for both axes, so a wide screen centers the box", () => {
    const wide = takeoffView(600, 400, BOX);
    expect(toScreen(wide, { x: 0.5, y: 0.5 })).toEqual({ px: 100, py: 0 });
    expect(toScreen(wide, { x: -0.5, y: -0.5 })).toEqual({ px: 500, py: 400 });
  });

  it("maps a point outside the box without clamping it, and inBox rejects it", () => {
    const outside = toTakeoff(view, { px: 200, py: -40 });
    expect(outside.x).toBeCloseTo(0.6, 9);
    expect(outside.y).toBeCloseTo(0, 9);
    expect(inBox(BOX, outside)).toBe(false);
    expect(inBox(BOX, { x: 0.5, y: -0.5 })).toBe(true);
  });
});
