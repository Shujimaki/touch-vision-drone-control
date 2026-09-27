import { describe, expect, it } from "vitest";
import { U, fmtMS, fmtT, sg } from "../src/lib/format";

describe("formats", () => {
  it("names drones", () => { expect(U("cf2")).toBe("DRONE 2"); expect(U("h1")).toBe("H1"); });
  it("writes times", () => { expect(fmtT(3725)).toBe("01:02:05"); expect(fmtMS(125.9)).toBe("02:05"); expect(fmtMS(-3)).toBe("00:00"); });
  it("signs numbers", () => { expect(sg(0.2)).toBe("+0.20"); expect(sg(-1.5, 1)).toBe("−1.5"); });
});
