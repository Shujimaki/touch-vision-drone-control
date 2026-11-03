// page side: starts the worker, sends camera frames, and gets results back

import type {
  GestureFrameResult,
  GestureWorkerRequest,
  GestureWorkerResponse
} from "./gestureMessages";

// lets the page stop the worker when the camera is turned off
export interface GestureClient {
  stop(): void;
}

// what this needs from the page
export interface GestureClientOptions {
  video: HTMLVideoElement;
  onResult: (result: GestureFrameResult, tMs: number) => void;
  onError: (message: string) => void;
}

export function startGestureClient(o: GestureClientOptions): GestureClient {
  // start the worker that runs mediapipe
  const worker = new Worker(
    new URL("./gesture.worker.ts", import.meta.url),
    { type: "module" }
  );

  let ready = false;
  let busy = false;
  let stopped = false;
  let sentAt = 0;

  const send = (message: GestureWorkerRequest, transfer: Transferable[] = []) => {
    worker.postMessage(message, transfer);
  };

  // stop the worker if something goes wrong
  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    o.onError(message);
  };

  worker.addEventListener("error", event => {
    fail(event.message || "The gesture worker failed.");
  });

  worker.addEventListener("messageerror", () => {
    fail("The page could not read a message from the gesture worker.");
  });

  // get the worker's replies
  worker.addEventListener(
    "message",
    (event: MessageEvent<GestureWorkerResponse>) => {
      const message = event.data;

      if (message.type === "ready") {
        ready = true;
        return;
      }

      busy = false;

      if (message.type === "result") {
        o.onResult(message.result, sentAt);
      } else if (!ready) {
        fail(message.message);
      } else {
        o.onError(message.message);
      }
    }
  );

  // send a camera frame when the worker is ready
  async function tick(): Promise<void> {
    if (stopped) return;

    if (ready && !busy && o.video.readyState >= 2) {
      busy = true;
      sentAt = performance.now();

      let frame: ImageBitmap | null = null;

      try {
        frame = await createImageBitmap(o.video);

        if (stopped) {
          frame.close();
          return;
        }

        send({ type: "frame", frame, timestampMs: sentAt }, [frame]);
        frame = null;
      } catch (error) {
        frame?.close();
        busy = false;
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (!stopped) requestAnimationFrame(() => void tick());
  }

  // tell the worker where the local mediapipe files are
  try {
    send({
      type: "init",
      assetBaseUrl: new URL("mediapipe/", document.baseURI).href
    });
    void tick();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  // give main.ts a way to stop the worker
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      worker.terminate();
    }
  };
}