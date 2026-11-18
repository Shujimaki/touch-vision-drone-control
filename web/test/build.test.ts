import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { build } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const XML_NAMESPACES = ["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"];
const ASSET_REFERENCES: Record<string, RegExp[]> = {
  ".html": [/\b(?:src|href)\s*=\s*["']([^"']+)["']/g],
  ".css": [/url\(\s*["']?([^"')]+)["']?\s*\)/g, /@import\s+["']([^"']+)["']/g],
  ".js": [/\bimport\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /new URL\(\s*["']([^"']+)["']/g],
};

let builtFiles: { file: string; text: string }[] = [];

const hasScheme = (ref: string) => /^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith("//");
const staysInDocument = (ref: string) => ref.startsWith("#") || ref.startsWith("data:") || ref.startsWith("blob:");

const assetReferences = () => builtFiles.flatMap(({ file, text }) => (ASSET_REFERENCES[extname(file)] ?? [])
  .flatMap(pattern => [...text.matchAll(pattern)].map(m => ({ file, ref: m[1]!.trim() }))));

beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), "tablet-build-"));
  try {
    await build({ root: web, logLevel: "silent", build: { outDir, emptyOutDir: true } });
    builtFiles = readdirSync(outDir, { withFileTypes: true, recursive: true }).filter(e => e.isFile())
      .map(e => join(e.parentPath, e.name))
      .map(path => ({ file: relative(outDir, path), text: [".png", ".ico"].includes(extname(path)) ? "" : readFileSync(path, "utf8") }));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 60_000);

describe("built tablet web app loads everything from the bridge, with no internet", () => {
  it("builds the main page and the flight test page", () => {
    expect(builtFiles.map(({ file }) => file)).toEqual(expect.arrayContaining(["index.html", "flight-test.html"]));
  });
  it("references its own assets", () => {
    expect(assetReferences().length).toBeGreaterThan(0);
  });
  it("names no address on another origin", () => {
    const absolute = builtFiles.flatMap(({ file, text }) =>
      [...text.matchAll(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'`)<>]+/gi)].map(m => ({ file, url: m[0] })));
    const protocolRelative = assetReferences().filter(({ ref }) => ref.startsWith("//")).map(({ file, ref }) => ({ file, url: ref }));
    expect([...absolute, ...protocolRelative].filter(({ url }) => !XML_NAMESPACES.includes(url))).toEqual([]);
  });
  it("bundles every asset it references", () => {
    const names = new Set(builtFiles.map(({ file }) => file));
    const missing = assetReferences().filter(({ file, ref }) => {
      if (staysInDocument(ref) || hasScheme(ref)) return false;
      const path = ref.split(/[?#]/)[0]!;
      return !names.has(path.startsWith("/") ? path.slice(1) : join(dirname(file), path));
    });
    expect(missing).toEqual([]);
  });
});
