// The mockup is one HTML page plus a UI script. These checks keep the two in step and keep the page a mockup:
// every element the script uses exists, ids are unique, and nothing but the UI script runs.
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
  it("sends nothing and simulates nothing", () => {
    const all = [script, ...["map", "altitude", "handCamera", "videoFeed", "telemetry", "panel"].map(f => readFileSync(join(web, "src", "components", f + ".ts"), "utf8"))].join("\n");
    for (const banned of ["WebSocket", "fetch(", "XMLHttpRequest", "serviceWorker", "setInterval"]) expect(all, banned).not.toContain(banned);
  });
});
