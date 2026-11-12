// The mockup is one HTML page plus a UI script. These checks keep the two in step and keep the page a mockup:
// every element the script uses exists, ids are unique, nothing but the UI script runs, and only the connection
// module talks to the host.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const html = readFileSync(join(web, "index.html"), "utf8");
const script = readFileSync(join(web, "src", "main.ts"), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]!);

describe("mockup page", () => {
  it("has every element the UI script looks up by a fixed id", () => {
    const used = [...script.matchAll(/byId(?:<[^>]+>)?\("([^"]+)"\)/g)].map(m => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(ids, `#${id}`).toContain(id);
  });
  it("uses each id once", () => {
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
  it("runs no script except the UI script", () => {
    expect([...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0])).toEqual(['<script type="module" src="/src/main.ts">']);
  });
  it("talks to the host only through the connection module, and simulates nothing", () => {
    const all = [script, ...["map", "altitude", "handCamera", "videoFeed", "telemetry", "panel"].map(f => readFileSync(join(web, "src", "components", f + ".ts"), "utf8"))].join("\n");
    for (const banned of ["WebSocket", "fetch(", "XMLHttpRequest", "serviceWorker", "setInterval"]) expect(all, banned).not.toContain(banned);
  });
});

describe("flight test page", () => {
  const page = readFileSync(join(web, "flight-test.html"), "utf8");
  const pageScript = readFileSync(join(web, "src", "flightTest.ts"), "utf8");
  const pageIds = [...page.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]!);

  it("has every element its script looks up by a fixed id", () => {
    const used = [...pageScript.matchAll(/byId(?:<[^>]+>)?\("([^"]+)"\)/g)].map(m => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(pageIds, `#${id}`).toContain(id);
  });
  it("uses each id once", () => {
    expect(pageIds.filter((id, i) => pageIds.indexOf(id) !== i)).toEqual([]);
  });
  it("runs no script except its own", () => {
    expect([...page.matchAll(/<script\b[^>]*>/g)].map(m => m[0])).toEqual(['<script type="module" src="/src/flightTest.ts">']);
  });
  it("uses no socket, request, or timer API directly", () => {
    for (const banned of ["WebSocket", "fetch(", "XMLHttpRequest", "serviceWorker", "setInterval"]) expect(pageScript, banned).not.toContain(banned);
  });
});
