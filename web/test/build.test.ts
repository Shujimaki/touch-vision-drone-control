import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, sep } from "node:path";
import { build } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const XML_NAMESPACES = ["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"];
const ASSET_REFERENCES: Record<string, RegExp[]> = {
  ".html": [/\b(?:src|href)\s*=\s*["']([^"']+)["']/g],
  ".css": [/url\(\s*["']?([^"')]+)["']?\s*\)/g, /@import\s+["']([^"']+)["']/g],
  ".js": [/\bimport\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /new URL\(\s*["']([^"']+)["']/g],
};

// scripts/setup-mediapipe.mjs copies the pinned MediaPipe runtime and model into mediapipe/. The .wasm and .task files
// are binaries, so only their names are checked. The 1.0.1 loaders in mediapipe/wasm/ name these URLs in comments and
// error text, and never request them. A new MediaPipe version that names another address fails the test.
const BINARIES = [".png", ".ico", ".wasm", ".task"];
const MEDIAPIPE_LOADERS = "mediapipe/wasm/";
const MEDIAPIPE_LOADER_URLS = new Set([
  "http://en.wikipedia.org/wiki/UTF-8#Description",
  "http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html",
  "http://pubs.opengroup.org/onlinepubs/009695399/functions/tzset.html",
  "http://server.com:4324:12",
  "http://unicode.org/faq/utf_bom.html#utf16-3",
  "https://bugzil.la/1328882",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset",
  "https://github.com/emscripten-core/emscripten/issues/13295.",
  "https://github.com/emscripten-core/emscripten/issues/23697",
  "https://github.com/emscripten-core/emscripten/pull/8236",
  "https://github.com/github/fetch/pull/92#issuecomment-140665932",
  "https://github.com/google/closure-compiler/issues/3193,",
  "https://github.com/google/closure-compiler/pull/3913",
  "https://github.com/libsdl-org/SDL/pull/6304",
  "https://github.com/nodejs/help/issues/2136#issuecomment-523649904",
  "https://tools.ietf.org/html/rfc3629",
  "https://webkit.org/b/222758",
  "https://www.ietf.org/rfc/rfc2279.txt",
  "https://www.khronos.org/registry/webgl/specs/latest/2.0/#5.15",
  "wasm://wasm/test_return_address.wasm-0012cc2a:wasm-function[26]:0x9f3",
]);
// the loaders also name their own folder, and a fallback .wasm name that MediaPipe's locateFile replaces with the real one
const MEDIAPIPE_LOADER_REFS = new Set([".", "vision_wasm_module_raw_internal.wasm"]);
const inLoaders = (file: string) => file.split(sep).join("/").startsWith(MEDIAPIPE_LOADERS);
const knownLoaderUrl = (file: string, url: string) => inLoaders(file) && MEDIAPIPE_LOADER_URLS.has(url);

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
      .map(path => ({ file: relative(outDir, path), text: BINARIES.includes(extname(path)) ? "" : readFileSync(path, "utf8") }));
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
    expect([...absolute, ...protocolRelative]
      .filter(({ file, url }) => !XML_NAMESPACES.includes(url) && !knownLoaderUrl(file, url))).toEqual([]);
  });
  it.runIf(existsSync(join(web, "public", "mediapipe")))("carries the gesture model and its runtime", () => {
    const names = builtFiles.map(({ file }) => file.split(sep).join("/"));
    expect(names).toEqual(expect.arrayContaining(["mediapipe/gesture_recognizer.task", "mediapipe/wasm/vision_wasm_module_internal.js"]));
  });
  it("bundles every asset it references", () => {
    const names = new Set(builtFiles.map(({ file }) => file));
    const missing = assetReferences().filter(({ file, ref }) => {
      if (staysInDocument(ref) || hasScheme(ref) || (inLoaders(file) && MEDIAPIPE_LOADER_REFS.has(ref))) return false;
      const path = ref.split(/[?#]/)[0]!;
      return !names.has(path.startsWith("/") ? path.slice(1) : join(dirname(file), path));
    });
    expect(missing).toEqual([]);
  });
});
