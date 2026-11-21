// sets up the mediapipe files for the browser

import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// where the runtime files are, and where the browser can reach the copies
const runtimeSource = new URL("../node_modules/@mediapipe/tasks-vision/wasm/", import.meta.url);
const destination = new URL("../public/mediapipe/", import.meta.url);
const modelPath = new URL("gesture_recognizer.task", destination);

// mediapipe model: float16, version 1
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/" +
  "gesture_recognizer/gesture_recognizer/float16/1/" +
  "gesture_recognizer.task";

// size and sha-256 of the model, from the root readme
const expectedSize = 8373440;
const expectedHash = "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482";

function validModel(bytes) {
  return bytes.length === expectedSize &&
    createHash("sha256").update(bytes).digest("hex") === expectedHash;
}

// copy the runtime files into public/mediapipe/wasm
await mkdir(destination, { recursive: true });
await cp(runtimeSource, new URL("wasm/", destination), { recursive: true });
console.log("Copied MediaPipe runtime files.");

// only a missing file means no model yet; other read errors should stop the script
const existing = await readFile(modelPath).catch(error => {
  if (error.code !== "ENOENT") throw error;
  return null;
});

if (existing && validModel(existing)) {
  // keep the model that's already there
  console.log("Gesture model already verified.");
} else {
  // download it and check it before saving
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Model download failed: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!validModel(bytes)) {
    throw new Error("Model size or SHA-256 does not match.");
  }

  await writeFile(modelPath, bytes);
  console.log("Downloaded and verified gesture model.");
}
