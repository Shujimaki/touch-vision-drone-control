// worker: receives snapshots, runs recognition, sends results back to page

import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import { createGestureRecognizer, readGestureFrame } from "./gesture";
import type {
  GestureWorkerRequest,
  GestureWorkerResponse
} from "./gestureMessages"; // message types to and from worker

// remember the recognizer while it loads and after it is ready
let recognizerPromise: Promise<GestureRecognizer> | null = null;

// send a message back to the page
function reply(message: GestureWorkerResponse): void {
  self.postMessage(message);
}

// handle a message received from the page
async function handleMessage(message: GestureWorkerRequest): Promise<void> {
  try {
    switch (message.type) {
      case "init":
        recognizerPromise ??= createGestureRecognizer(message.assetBaseUrl);
        await recognizerPromise;
        reply({ type: "ready" });
        break;

      case "frame": {
        if (!recognizerPromise) {
          throw new Error("Initialize the recognizer before sending frames.");
        }

        const recognizer = await recognizerPromise;
        const result = readGestureFrame(recognizer, message.frame, message.timestampMs);
        reply({ type: "result", result });
        break;
      }
    }
  } catch (error) {
    if (message.type === "init") recognizerPromise = null;

    reply({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (message.type === "frame") message.frame.close();
  }
}

// listen for messages from the page
self.addEventListener("message", (event: MessageEvent<GestureWorkerRequest>) => {
  void handleMessage(event.data);
});
