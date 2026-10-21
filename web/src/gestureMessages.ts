// messages sent between the page and the gesture worker

import type { readGestureFrame } from "./gesture";

// data returned by our frame-reading function
export type GestureFrameResult = ReturnType<typeof readGestureFrame>;

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