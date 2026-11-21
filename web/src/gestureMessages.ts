// messages sent between the page and the gesture worker

// what the worker reads from one camera frame
export interface GestureFrameResult {
  handDetected: boolean;
  label: string | null; // gesture name, like Open_Palm
  score: number | null; // model's confidence in the label
  wristY: number | null; // 0 is the image top, 1 is the bottom
}

// messages from the page to the worker; either initialization or frame-processing
export type GestureWorkerRequest =
  | {
      type: "init";
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
      result: GestureFrameResult;
    }
  | {
      type: "error";
      message: string;
    };
