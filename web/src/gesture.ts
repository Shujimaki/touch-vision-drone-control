// sets up the gesture recognizer for the browser and reads one frame at a time

import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import type { GestureFrameResult } from "./gestureMessages";

export async function createGestureRecognizer(
  assetBaseUrl: string
): Promise<GestureRecognizer> {
  // runtime and model come from the web app's public/mediapipe folder, so it works offline
  const runtimeUrl = new URL("wasm", assetBaseUrl).href;
  const modelUrl = new URL("gesture_recognizer.task", assetBaseUrl).href;

  const vision = await FilesetResolver.forVisionTasks(runtimeUrl, true);

  return GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelUrl
    },
    runningMode: "VIDEO", // successive frames
    numHands: 1 // one operator hand
  });
}

export function readGestureFrame(
  recognizer: GestureRecognizer,
  frame: ImageBitmap,
  timestampMs: number
): GestureFrameResult {
  const result = recognizer.recognizeForVideo(frame, timestampMs);

  const hand = result.landmarks[0]; // only 1 hand to detect
  const gesture = result.gestures[0]?.[0]; // best gesture for that hand, if any

  return {
    handDetected: hand !== undefined,
    label: gesture?.categoryName ?? null,
    score: gesture?.score ?? null,
    wristX: hand?.[0]?.x ?? null, // needed in the frames sent to the bridge
    // landmark 0 of the 21 is the wrist; its y tracks vertical hand movement (0 top, 1 bottom)
    // https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/hands.py#L45-L66
    wristY: hand?.[0]?.y ?? null
  };
}
