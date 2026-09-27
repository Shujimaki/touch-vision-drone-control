// Every shared example in protocol/examples must follow the v1 wire rules (README.md "Versions": both test suites
// load the shared examples to catch differences between the tablet and the bridge).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMessage } from "../src/protocol/messages";

const dir = join(import.meta.dirname, "..", "..", "protocol", "examples");
const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const load = (f: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, f), "utf8"));

describe("protocol examples", () => {
  it("finds the shared examples", () => { expect(files.length).toBeGreaterThanOrEqual(11); });
  for (const f of files) it(`${f} follows the v1 wire rules`, () => { expect(checkMessage(load(f))).toEqual([]); });
});

describe("checkMessage rejects", () => {
  const hello = () => load("hello.json");
  it("a missing field", () => { const m = hello(); delete m["client"]; expect(checkMessage(m)).toContain("hello.client is missing"); });
  it("an extra field", () => { const m = { ...hello(), extra: 1 }; expect(checkMessage(m)).toContain("hello.extra is not a field"); });
  it("another version", () => { expect(checkMessage({ ...hello(), v: 2 })).toContain("v must be 1"); });
  it("a seq that is not a positive integer", () => { expect(checkMessage({ ...hello(), seq: 0 })).toContain("seq must be a positive integer"); });
  it("an unknown type", () => { expect(checkMessage({ ...hello(), type: "ping" })).toEqual(['unknown type "ping"']); });
  it("a value outside its enumeration", () => { expect(checkMessage({ ...hello(), role: "pilot" })).toContain('hello.role has value "pilot"'); });
  it("a nested extra field", () => {
    const t = load("telemetry-cf3-defensive-hover.json") as { drones: Record<string, unknown>[] };
    t.drones[0]!["mode"] = "course";
    expect(checkMessage(t)).toContain("telemetry.drones[0].mode is not a field");
  });
  it("an inherited property name as the type, without throwing", () => {
    expect(checkMessage({ ...hello(), type: "toString" })).toEqual(['unknown type "toString"']);
    expect(checkMessage({ ...hello(), type: "__proto__" })).toEqual(['unknown type "__proto__"']);
  });
  it("null for a nested object that the protocol requires", () => {
    const m = { ...load("input-three-drones-climbing.json"), gesture: null };
    expect(checkMessage(m)).toContain("input.gesture must be an object");
  });
  const telem = () => load("telemetry-cf3-defensive-hover.json") as { trial: unknown; drones: Record<string, unknown>[] };
  it("an extra field in a health result", () => {
    const t = telem(); (t.drones[0]!["health"] as Record<string, unknown>)["extra"] = 1;
    expect(checkMessage(t)).toContain("telemetry.drones[0].health.extra is not a field");
  });
  it("a defensive hover with an unknown direction", () => {
    const t = telem(); t.drones[0]!["defensive_hover"] = { dir: "down", range: 0.1 };
    expect(checkMessage(t)).toContain('telemetry.drones[].defensive_hover.dir has value "down"');
  });
  it("set_mode, removed from v1 with mode", () => {
    expect(checkMessage({ ...load("command-takeoff.json"), name: "set_mode" })).toContain('command.name has value "set_mode"');
  });
  it("trial.hoops, removed in review", () => {
    const t = telem(); (t.trial as Record<string, unknown>)["hoops"] = {};
    expect(checkMessage(t)).toContain("telemetry.trial.hoops is not a field");
  });
});

describe("checkMessage accepts", () => {
  it("null where the protocol allows it (trial, defensive_hover, health)", () => {
    const t = load("telemetry-cf3-defensive-hover.json") as { trial: unknown; drones: Record<string, unknown>[] };
    t.trial = null; t.drones[0]!["health"] = null; t.drones[0]!["defensive_hover"] = null;
    expect(checkMessage(t)).toEqual([]);
  });
});
