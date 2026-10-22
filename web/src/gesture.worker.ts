// worker: receives snapshots, runs recognition, sends results back to page

import { createGestureRecognizer, readGestureFrame } from "./gesture";
import type {
  GestureWorkerRequest,
  GestureWorkerResponse
} from "./gestureMessages"; // message types to and from worker

// remember the recognizer while it loads and after it is ready
let recognizerPromise: ReturnType<typeof createGestureRecognizer> | null = null;

// send a message back to the page
function reply(message: GestureWorkerResponse): void {
  self.postMessage(message);
}

// handle a message received from the page
async function handleMessage(message: GestureWorkerRequest): Promise<void> {
  try {
    if (message.type === "init") {
      recognizerPromise ??= createGestureRecognizer(message.assetBaseUrl);
      await recognizerPromise;
      reply({ type: "ready" });
    } else {
      if (!recognizerPromise) {
        throw new Error("Initialize the recognizer before sending frames.");
      }

      const recognizer = await recognizerPromise;
      const result = readGestureFrame(
        recognizer,
        message.frame,
        message.timestampMs
      );

      reply({ type: "result", result });
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