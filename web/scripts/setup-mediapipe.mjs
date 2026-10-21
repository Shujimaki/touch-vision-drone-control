// ***script for setting up mediapipe files for browser***

// import tools from Node.js
import { mkdir, cp, readFile, writeFile} from "node:fs/promises";
import { createHash } from "node:crypto";

// locate source and destination
const runtimeSource = new URL(
  "../node_modules/@mediapipe/tasks-vision/wasm/",
  import.meta.url
); // where mediapipe runtime files are
const destination = new URL("../public/mediapipe/", import.meta.url); // where browser-accessible copies are
const modelPath = new URL("gesture_recognizer.task", destination); // where to save gesture model

// mediapipe model: float16, version 1
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/" +
  "gesture_recognizer/gesture_recognizer/float16/1/" +
  "gesture_recognizer.task";

const expectedHash = "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482"; // SHA256 hash of the model file [from readme]

// verify the model; check if these match
function validModel(bytes) {
return bytes.length === 8373440 &&
  createHash("sha256").update(bytes).digest("hex") === expectedHash;
}

// prepare runtime files; makes destination and copies into /wasm
await mkdir(destination, { recursive: true });
await cp(runtimeSource, new URL("wasm/", destination), {
  recursive: true
});
console.log("Copied MediaPipe runtime files.");


const existing = await readFile(modelPath).catch(() => null); // check for existing model

if (existing && validModel(existing)) {
  console.log("Gesture model already verified.");
} // use that if its right

else {
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Model download failed: ${response.status}`);
  } // download if none


  const bytes = Buffer.from(await response.arrayBuffer());
  if (!validModel(bytes)) {
    throw new Error("Model size or SHA-256 does not match.");
  } // verify downloaded bytes

  await writeFile(modelPath, bytes);
  console.log("Downloaded and verified gesture model.");
} // save verified model