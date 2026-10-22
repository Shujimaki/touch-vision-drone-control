import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connect, socketUrl, type ConnectionState, type SocketLike } from "../src/connection";

const examples = join(import.meta.dirname, "..", "..", "protocol", "examples");
const example = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(examples, name + ".json"), "utf8"));

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  open(): void { this.onopen?.(new Event("open")); }
  receiveData(data: unknown): void { this.onmessage?.(new MessageEvent("message", { data })); }
  receive(message: unknown): void { this.receiveData(JSON.stringify(message)); }
  bridgeCloses(): void { this.onclose?.(new Event("close") as CloseEvent); }
}

function start() {
  const socket = new FakeSocket(), states: ConnectionState["status"][] = [], warnings: string[] = [];
  const connection = connect({
    openSocket: () => socket, tabletClockMs: () => 5321.7, client: "tablet-web 0.1.0", userAgent: "TestAgent/1.0",
    onState: s => states.push(s.status), warn: w => warnings.push(w),
  });
  return { socket, states, warnings, connection };
}

describe("connection", () => {
  it("sends hello as the first message once the socket opens", () => {
    const { socket, states } = start();
    expect(socket.sent).toEqual([]);

    socket.open();

    expect(socket.sent).toEqual([{ ...example("hello"), user_agent: "TestAgent/1.0" }]);
    expect(states).toEqual(["connecting"]);
  });

  it("is connected once welcome arrives, and keeps the host configuration", () => {
    const { socket, states, connection } = start();
    socket.open();

    socket.receive(example("welcome"));

    expect(states).toEqual(["connecting", "connected"]);
    const state = connection.state();
    expect(state.status === "connected" && state.welcome.config.telemetry_timeout_ms).toBe(500);
  });

  it.each([
    ["another version", JSON.stringify({ ...example("welcome"), v: 2 })],
    ["an unknown type", JSON.stringify({ ...example("welcome"), type: "dance" })],
    ["a welcome with no config", JSON.stringify({ ...example("welcome"), config: undefined })],
    ["a welcome with a broken config", JSON.stringify({ ...example("welcome"), config: { ...(example("welcome")["config"] as object), drones: "cf1" } })],
    ["a reply with an unknown code", JSON.stringify({ ...example("reply-rejected"), code: "nope" })],
    ["not JSON", "not json"],
    ["null", "null"],
    ["an array", "[]"],
    ["a binary frame", new ArrayBuffer(4)],
  ])("ignores, with a warning, %s", (_, data) => {
    const { socket, states, warnings, connection } = start();
    socket.open();

    socket.receiveData(data);

    expect(states).toEqual(["connecting"]);
    expect(connection.state()).toEqual({ status: "connecting" });
    expect(warnings).toHaveLength(1);
  });

  it("forgets the welcome once the bridge closes the socket", () => {
    const { socket, connection } = start();
    socket.open();
    socket.receive(example("welcome"));

    socket.bridgeCloses();

    expect(connection.state()).toEqual({ status: "disconnected" });
  });

  it("is disconnected when the bridge closes the socket, for example after busy", () => {
    const { socket, states, warnings } = start();
    socket.open();

    socket.receive({ ...example("reply-rejected"), ref: 1, code: "busy", detail: "another operator is connected" });
    socket.bridgeCloses();

    expect(states).toEqual(["connecting", "disconnected"]);
    expect(warnings.join()).toContain("busy");
  });
});

describe("socketUrl", () => {
  it("uses a secure socket on an HTTPS page, on the page's own host", () => {
    expect(socketUrl({ protocol: "https:", host: "10.0.0.5:5173" })).toBe("wss://10.0.0.5:5173/ws");
    expect(socketUrl({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws");
  });
});
