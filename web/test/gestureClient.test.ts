import { describe, expect, it, vi } from "vitest";
import { startGestureClient, type WorkerLike } from "../src/gestureClient";
import type { GestureFrameResult, GestureWorkerRequest, GestureWorkerResponse } from "../src/gestureMessages";

const RESULT: GestureFrameResult = { handDetected: true, label: "Open_Palm", score: 0.9, wristX: 0.5, wristY: 0.5 };

// a fake worker, camera and animation-frame loop, so the client runs in node
function setup() {
  const sent: GestureWorkerRequest[] = [];
  const worker: WorkerLike = {
    postMessage: message => { sent.push(message); },
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null
  };
  const frames: { close: ReturnType<typeof vi.fn> }[] = [];
  let pending: (() => void) | null = null;
  const onResult = vi.fn();
  const onError = vi.fn();

  const client = startGestureClient({
    video: { readyState: 4 } as HTMLVideoElement,
    onResult,
    onError,
    createWorker: () => worker,
    grabFrame: async () => {
      const frame = { close: vi.fn() };
      frames.push(frame);
      return frame as unknown as ImageBitmap;
    },
    schedule: next => { pending = next; },
    now: () => 1000,
    assetBaseUrl: "http://tablet.test/mediapipe/"
  });

  const reply = (message: GestureWorkerResponse) => worker.onmessage!({ data: message } as MessageEvent<GestureWorkerResponse>);
  // run one animation frame and let the frame grab finish
  const tick = async () => { const next = pending; pending = null; next?.(); await Promise.resolve(); await Promise.resolve(); };
  const framesSent = () => sent.filter(m => m.type === "frame").length;

  return { client, worker, sent, frames, reply, tick, framesSent, onResult, onError };
}

describe("gesture client", () => {
  it("tells the worker where the mediapipe files are, and waits for ready", async () => {
    const t = setup();
    expect(t.sent[0]).toEqual({ type: "init", assetBaseUrl: "http://tablet.test/mediapipe/" });
    await t.tick();
    expect(t.framesSent()).toBe(0);
  });

  it("sends one frame at a time and drops frames while the worker is busy", async () => {
    const t = setup();
    t.reply({ type: "ready" });
    await t.tick();
    await t.tick();
    expect(t.framesSent()).toBe(1);

    t.reply({ type: "result", result: RESULT });
    expect(t.onResult).toHaveBeenCalledWith(RESULT, 1000);
    await t.tick();
    expect(t.framesSent()).toBe(2);
  });

  it("stops on an error before ready", () => {
    const t = setup();
    t.reply({ type: "error", message: "model not found" });
    expect(t.onError).toHaveBeenCalledWith("model not found");
    expect(t.worker.terminate).toHaveBeenCalled();
  });

  it("keeps going after a frame error once ready", async () => {
    const t = setup();
    t.reply({ type: "ready" });
    await t.tick();
    t.reply({ type: "error", message: "bad frame" });
    expect(t.onError).toHaveBeenCalledWith("bad frame");
    expect(t.worker.terminate).not.toHaveBeenCalled();
    await t.tick();
    expect(t.framesSent()).toBe(2);
  });

  it("closes a frame grabbed after stop", async () => {
    const t = setup();
    t.reply({ type: "ready" });
    const next = t.tick(); // grab starts, then the camera turns off
    t.client.stop();
    await next;
    expect(t.framesSent()).toBe(0);
    expect(t.frames[0]!.close).toHaveBeenCalled();
    expect(t.worker.terminate).toHaveBeenCalledTimes(1);
  });
});
