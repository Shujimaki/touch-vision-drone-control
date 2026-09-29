// The static mockup is one HTML file plus a small UI script. These checks keep the two in step and keep the mockup
// static: every element the script uses exists, ids are unique, both themes are drawn, and nothing else runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const html = readFileSync(join(web, "index.html"), "utf8");
const script = readFileSync(join(web, "src", "main.ts"), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]!);

describe("static mockup markup", () => {
  it("has every element the UI script looks up", () => {
    const used = [...script.matchAll(/byId\("([^"]+)"\)/g)].map(m => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) expect(ids, `#${id}`).toContain(id);
  });
  it("uses each id once", () => {
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dups).toEqual([]);
  });
  it("draws the map, altitude bars, hand camera and all three drone feeds in both themes", () => {
    for (const id of ["mapSvg", "tapeSvg", "camSvg", "fv-cf1", "fv-cf2", "fv-cf3"]) {
      const start = html.indexOf(`id="${id}"`);
      const svg = html.slice(start, html.indexOf("</svg>", html.indexOf('class="th-l"', start)));
      expect(svg, id).toContain('class="th-d"');
      expect(svg, id).toContain('class="th-l"');
    }
  });
  it("runs no script except the UI script", () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
    expect(scripts).toEqual(['<script type="module" src="/src/main.ts">']);
  });
  it("points each light-theme reference at a light-theme id", () => {
    for (const m of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids, m[1]).toContain(m[1]!);
  });
});
