// Puts the pinned Gesture Recognizer files in public/mediapipe, so the app serves them itself (no cloud inference).
// The WASM files come from the installed @mediapipe/tasks-vision package. The model is downloaded once from its
// versioned path and checked against the size and SHA-256 recorded in README.md "Versions".
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "mediapipe");
const MODEL = {
  url: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
  file: join(out, "models", "gesture_recognizer.task"),
  size: 8373440,
  sha256: "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482",
};

const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
if (!existsSync(wasmSrc)) {
  console.error("setup-mediapipe: run npm install first (node_modules/@mediapipe/tasks-vision/wasm is missing).");
  process.exit(1);
}
cpSync(wasmSrc, join(out, "wasm"), { recursive: true });

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const good = (buf) => buf.length === MODEL.size && sha(buf) === MODEL.sha256;

if (existsSync(MODEL.file) && good(readFileSync(MODEL.file))) {
  console.log("setup-mediapipe: WASM copied; model already present and verified.");
} else {
  console.log("setup-mediapipe: downloading the pinned gesture model…");
  const res = await fetch(MODEL.url);
  if (!res.ok) {
    console.error(`setup-mediapipe: download failed (${res.status} ${res.statusText}).`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!good(buf)) {
    console.error(`setup-mediapipe: the model does not match the pinned size and SHA-256 (got ${buf.length} bytes, ${sha(buf)}).`);
    process.exit(1);
  }
  mkdirSync(dirname(MODEL.file), { recursive: true });
  writeFileSync(MODEL.file, buf);
  console.log("setup-mediapipe: model downloaded and verified.");
}
