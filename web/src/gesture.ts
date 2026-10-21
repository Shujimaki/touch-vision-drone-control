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

// for processing camera frame; returns gesture name and height of wrist 
export function readGestureFrame(
  recognizer: GestureRecognizer, // recognizer object
  video: HTMLVideoElement, // video element
  timestampMs: number // timestamp in milliseconds
) {
    // process specific frame at that timestamp
    const result = recognizer.recognizeForVideo(video, timestampMs); 

    const hand = result.landmarks[0]; // only 1 hand to detect
    const gesture = result.gestures[0]?.[0]; // get 1st item of from list of gesture results for that hand , if none ? undefined

    return {
      handDetected: hand !== undefined, // if hand was detected
      label: gesture?.categoryName ?? null, // name of gesture
      score: gesture?.score?? null, // model's confidence score of gesture
      wristY: hand?.[0].y ?? null // get first landmark of hand (wrist) and its y coordinate, if no hand detected ? null
    };
}

/*
 * MediaPipe returns 21 landmarks for each detected hand.
 * Landmark 0 is the wrist. We read its y coordinate to track
 * vertical hand movement: 0 is the image top, 1 is the bottom.
 *
 * Landmark index reference:
 * https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/hands.py#L45-L66
 */