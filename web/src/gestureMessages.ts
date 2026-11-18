// messages sent between the page and the gesture worker

// data returned by our frame-reading function; null when no hand is seen
export interface GestureFrameResult {
  handDetected: boolean;
  label: string | null;
  score: number | null;
  wristX: number | null;
  wristY: number | null;
  landmarks?: { x: number; y: number }[] | null; // all 21 hand points, for drawing the skeleton
}

// messages from the page to the worker; either initialization or frame-processing
export type GestureWorkerRequest =
  | { type: "init" 
      assetBaseUrl: string; // url of web app's public/mediapipe folder
  }   
  | {
      type: "frame"; // identifies this as a frame to be processed
      frame: ImageBitmap; // holds camera snapshot
      timestampMs: number; // give frame timestamp in ms
    };

// messages from the worker back to the page
export type GestureWorkerResponse =
  | { type: "ready" } // page can begin sending frames to worker
  | {
      type: "result"; // identifies this as a recognition result
      result: GestureFrameResult; // recognition data matching the function's return type
    }
  | {
      type: "error";
      message: string;
    };