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

// the parts of a Worker the client uses, so tests can pass a fake one
export interface WorkerLike {
  postMessage(message: GestureWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<GestureWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

// what this needs from the page; the optional parts default to the browser's and are swapped in tests
export interface GestureClientOptions {
  video: HTMLVideoElement;
  onResult: (result: GestureFrameResult, tMs: number) => void;
  onError: (message: string) => void;
  createWorker?: () => WorkerLike;
  grabFrame?: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  schedule?: (next: () => void) => void;
  now?: () => number;
  assetBaseUrl?: string;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function startGestureClient(o: GestureClientOptions): GestureClient {
  const {
    createWorker = () => new Worker(new URL("./gesture.worker.ts", import.meta.url), { type: "module" }),
    grabFrame = video => createImageBitmap(video),
    schedule = next => { requestAnimationFrame(next); },
    now = () => performance.now(),
    assetBaseUrl = new URL("mediapipe/", document.baseURI).href
  } = o;

  // start the worker that runs mediapipe
  const worker = createWorker();

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

  worker.onerror = event => fail(event.message || "The gesture worker failed.");
  worker.onmessageerror = () => fail("The page could not read a message from the gesture worker.");

  // get the worker's replies
  worker.onmessage = event => {
    const message = event.data;

    if (message.type === "ready") {
      ready = true;
      return;
    }

    busy = false;

    if (message.type === "result") {
      o.onResult(message.result, sentAt);
    } else if (!ready) {
      fail(message.message); // setup failed, so there's nothing to retry
    } else {
      o.onError(message.message); // one bad frame; keep going
    }
  };

  // send a camera frame when the worker is ready and not busy with the last one
  async function tick(): Promise<void> {
    if (stopped) return;

    if (ready && !busy && o.video.readyState >= 2) {
      busy = true;
      sentAt = now();

      let frame: ImageBitmap | null = null;

      try {
        frame = await grabFrame(o.video);

        if (stopped) {
          frame.close();
          return;
        }

        send({ type: "frame", frame, timestampMs: sentAt }, [frame]);
        frame = null;
      } catch (error) {
        frame?.close();
        busy = false;
        fail(errorText(error));
        return;
      }
    }

    if (!stopped) schedule(() => void tick());
  }

  // tell the worker where the local mediapipe files are
  send({ type: "init", assetBaseUrl });
  void tick();

  // give main.ts a way to stop the worker
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      worker.terminate();
    }
  };
}
