// setup gesture recognizer for browser
// --> where to find runtime and trained model, and config; returns a recognizer

import {
  FilesetResolver, //locates runtime files 
  GestureRecognizer //class for creating gesture recognizer object
} from "@mediapipe/tasks-vision";

export async function createGestureRecognizer(): Promise<GestureRecognizer> {
  const base = import.meta.env.BASE_URL; // app base path

  const vision = await FilesetResolver.forVisionTasks(
    `${base}mediapipe/wasm` // locate runtime files
  );

  // create recognizer, use model from mediapipe/gesture_recognizer.task
  return GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${base}mediapipe/gesture_recognizer.task`
    },
    runningMode: "VIDEO", // successive frames
    numHands: 1 // max number of hands to detect in each frame
  });
}