// page side of the gesture worker:
// sends it camera frames and gives the results back to the page

import type {
  GestureFrameResult,
  GestureWorkerRequest,
  GestureWorkerResponse
} from "./gestureMessages";

// what the page gets back so it can stop the worker later
export interface GestureClient {
  stop(): void;
}

// what the page needs to provide to start this
export interface GestureClientOptions {
  video: HTMLVideoElement; // the video element showing the hand camera
  onResult: (result: GestureFrameResult, tMs: number) => void; // what to do with each result
  onError: (message: string) => void; // what to do if something goes wrong
}

export function startGestureClient(o: GestureClientOptions): GestureClient {
  // start the worker that loads MediaPipe and recognizes the hand
  const worker = new Worker(
    new URL("./gesture.worker.ts", import.meta.url),
    { type: "module" }
  );

  // keep track of whether the worker is ready, processing a frame, or stopped
  let ready = false;
  let busy = false;
  let stopped = false;
  let sentAt = 0; // timestamp for the frame currently being processed

  // send a message from the page to the worker
  const send = (message: GestureWorkerRequest, transfer: Transferable[] = []) => {
    worker.postMessage(message, transfer);
  };

  // stop the worker and show the error in the page
  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    o.onError(message);
  };

  // catch errors from the worker itself, like if its script fails
  worker.addEventListener("error", event => {
    fail(event.message || "The gesture worker failed.");
  });

  // catch a reply that the page cannot read
  worker.addEventListener("messageerror", () => {
    fail("The page could not read a message from the gesture worker.");
  });

  // listen for replies from the worker
  worker.addEventListener(
    "message",
    (event: MessageEvent<GestureWorkerResponse>) => {
      const message = event.data;

      // MediaPipe has loaded, so the page can start sending frames
      if (message.type === "ready") {
        ready = true;
        return;
      }

      // the worker has finished with the current frame
      busy = false;

      // send the recognition result back to the page
      if (message.type === "result") {
        o.onResult(message.result, sentAt);
      } else if (!ready) {
        // if it failed before becoming ready, MediaPipe did not initialize
        fail(message.message);
      } else {
        // report a frame-processing error, but keep the client running
        o.onError(message.message);
      }
    }
  );

  // check for a camera frame and send it to the worker
  async function tick(): Promise<void> {
    // stop checking if the page has stopped this client
    if (stopped) return;

    // only send a frame when MediaPipe is ready, the worker is free,
    // and the video has a frame available
    if (ready && !busy && o.video.readyState >= 2) {
      busy = true;
      sentAt = performance.now();

      // this will hold a snapshot of the current video frame
      let frame: ImageBitmap | null = null;

      try {
        // take a snapshot of what the camera video is showing
        frame = await createImageBitmap(o.video);

        // the client might have been stopped while the snapshot was being made
        if (stopped) {
          frame.close();
          return;
        }

        // send the snapshot and its timestamp to the worker
        // transfer the frame so the browser does not need to copy it
        send(
          { type: "frame", frame, timestampMs: sentAt },
          [frame]
        );

        // the worker now owns the transferred frame
        frame = null;
      } catch (error) {
        // if sending failed before transfer, close the frame to free its memory
        frame?.close();
        busy = false;
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    // check again on the next browser frame
    // busy prevents camera frames from piling up while MediaPipe is working
    if (!stopped) requestAnimationFrame(() => void tick());
  }

  try {
    // tell the worker where the app's local MediaPipe files are
    send({
      type: "init",
      assetBaseUrl: new URL("mediapipe/", document.baseURI).href
    });

    // start checking for video frames; it waits until the worker says it is ready
    void tick();
  } catch (error) {
    // report if the initialization message itself could not be sent
    fail(error instanceof Error ? error.message : String(error));
  }

  // give the page a way to stop recognition and shut down the worker
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      worker.terminate();
    }
  };
}