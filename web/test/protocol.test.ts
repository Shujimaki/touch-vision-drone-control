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
  it("mode and set_mode, removed from v1", () => {
    expect(checkMessage({ ...load("command-takeoff.json"), name: "set_mode" })).toContain('command.name has value "set_mode"');
  });
});
