import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, linkLabel, socketUrl, type Connection, type ConnectionOptions, type ConnectionState, type SocketLike } from "../src/connection";
import { parseHostMessage, type FlightCommand, type Held, type Welcome } from "../src/protocol";

const examples = join(import.meta.dirname, "..", "..", "protocol", "examples");
const example = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(examples, name + ".json"), "utf8"));

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(): void { this.closed = true; }
  open(): void { this.onopen?.(new Event("open")); }
  receiveData(data: unknown): void { this.onmessage?.(new MessageEvent("message", { data })); }
  receive(message: unknown): void { this.receiveData(JSON.stringify(message)); }
  bridgeCloses(): void { this.onclose?.(new Event("close") as CloseEvent); }
}

function start(clock: () => number = () => 5321.7, gesture?: ConnectionOptions["gesture"]) {
  const sockets: FakeSocket[] = [], states: ConnectionState["status"][] = [], warnings: string[] = [];
  const telemetry: unknown[] = [], hostLost: string[] = [];
  const connection = connect({
    openSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    tabletClockMs: clock, client: "tablet-web 0.1.0", userAgent: "TestAgent/1.0", gesture,
    onState: s => states.push(s.status), warn: w => warnings.push(w),
    onTelemetry: t => telemetry.push(t), onHostLost: reason => hostLost.push(reason),
  });
  const socket = sockets[0]!;
  const latest = () => sockets[sockets.length - 1]!;
  return { socket, sockets, latest, states, warnings, telemetry, hostLost, connection };
}

const TELEMETRY = example("telemetry-cf3-defensive-hover");
const WELCOME = example("welcome");
const TELEMETRY_TIMEOUT_MS = (WELCOME["config"] as { telemetry_timeout_ms: number }).telemetry_timeout_ms;

function command(connection: Connection, name: FlightCommand): void {
  const state = connection.state();
  if (state.status !== "connected") throw new Error(`expected a connected state, got ${state.status}`);
  state.command(name, ["cf1"]);
}

function connected(clock?: () => number, gesture?: ConnectionOptions["gesture"]) {
  const c = start(clock, gesture);
  c.socket.open();
  c.socket.receive(WELCOME);
  return c;
}

describe("connection", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends hello as the first message once the socket opens", () => {
    const { socket, states } = start();
    expect(socket.sent).toEqual([]);

    socket.open();

    expect(socket.sent).toEqual([{ ...example("hello"), user_agent: "TestAgent/1.0" }]);
    expect(states).toEqual(["connecting"]);
  });

  it("rounds the tablet clock to 0.1 ms, as message format v1 requires", () => {
    const socket = new FakeSocket();
    connect({
      openSocket: () => socket, tabletClockMs: () => 5321.74, client: "c", userAgent: "u",
      onState: () => {}, onTelemetry: () => {}, onHostLost: () => {},
    });

    socket.open();

    expect(socket.sent[0]?.["t_ms"]).toBe(5321.7);
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
    ["a welcome with seq 0", JSON.stringify({ ...example("welcome"), seq: 0 })],
    ["a welcome with seq -1", JSON.stringify({ ...example("welcome"), seq: -1 })],
    ["a welcome with seq 1.5", JSON.stringify({ ...example("welcome"), seq: 1.5 })],
    ["an accepted reply with seq 0", JSON.stringify({ ...example("reply-rejected"), ok: true, code: null, seq: 0 })],
    ["an accepted reply with ref 0", JSON.stringify({ ...example("reply-rejected"), ok: true, code: null, ref: 0 })],
    ["an accepted reply with ref 2.5", JSON.stringify({ ...example("reply-rejected"), ok: true, code: null, ref: 2.5 })],
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

  it("passes each telemetry on once connected", () => {
    const { socket, telemetry } = connected();

    socket.receive(TELEMETRY);

    expect(telemetry).toEqual([TELEMETRY]);
  });

  it("loses the bridge when telemetry stops, releases every contact, and reconnects with seq 1", () => {
    const { sockets, connection, hostLost } = connected();
    vi.advanceTimersByTime(TELEMETRY_TIMEOUT_MS - 1);
    sockets[0]!.receive(TELEMETRY);
    vi.advanceTimersByTime(TELEMETRY_TIMEOUT_MS - 1);
    expect(connection.state().status).toBe("connected");

    vi.advanceTimersByTime(1);

    expect(connection.state()).toEqual({ status: "failed", cause: "bridge_lost" });
    expect(hostLost).toEqual(["host_lost"]);
    expect(sockets[0]!.closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent).toEqual([{ ...example("hello"), user_agent: "TestAgent/1.0" }]);
  });

  it("loses the bridge when the socket closes after welcome", () => {
    const { socket, connection, hostLost } = connected();

    socket.bridgeCloses();

    expect(connection.state()).toEqual({ status: "failed", cause: "bridge_lost" });
    expect(hostLost).toEqual(["host_lost"]);
  });

  it("finds no bridge when welcome does not arrive within 2 s, and keeps retrying each second", () => {
    const { sockets, connection, hostLost } = start();
    sockets[0]!.open();

    vi.advanceTimersByTime(2000);

    expect(connection.state()).toEqual({ status: "failed", cause: "no_bridge" });
    expect(hostLost).toEqual([]);
    vi.advanceTimersByTime(1000);
    sockets[1]!.bridgeCloses();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(3);
    expect(connection.state()).toEqual({ status: "failed", cause: "no_bridge" });
  });

  it("is connected again once a retry gets welcome", () => {
    const { latest, connection } = connected();
    latest().bridgeCloses();
    vi.advanceTimersByTime(1000);

    latest().open();
    latest().receive(WELCOME);

    expect(connection.state().status).toBe("connected");
  });

  it.each([
    ["busy", "operator_busy", true],
    ["version", "version_mismatch", false],
    ["invalid", "rejected", false],
  ])("after a %s reply to hello, fails with %s", (code, cause, retries) => {
    const c = start();
    c.socket.open();

    c.socket.receive({ ...example("reply-rejected"), ref: 1, code, detail: "no" });
    c.socket.bridgeCloses();

    expect(c.connection.state()).toEqual({ status: "failed", cause });
    vi.advanceTimersByTime(1000);
    expect(c.sockets.length > 1).toBe(retries);
  });

  it("ignores a late close from a socket it already gave up on", () => {
    const { sockets, connection } = connected();
    vi.advanceTimersByTime(TELEMETRY_TIMEOUT_MS);
    vi.advanceTimersByTime(1000);
    sockets[1]!.open();
    sockets[1]!.receive(WELCOME);

    sockets[0]!.bridgeCloses();

    expect(connection.state().status).toBe("connected");
  });

  it("keeps the connection after an invalid reply once connected", () => {
    const { socket, connection } = connected();

    socket.receive({ ...example("reply-rejected"), ref: 2, code: "invalid", detail: "seq 2 does not follow 5" });

    expect(connection.state().status).toBe("connected");
  });

  it("calls a retry that gets no welcome after an earlier success bridge lost", () => {
    const { latest, connection } = connected();
    latest().bridgeCloses();
    vi.advanceTimersByTime(1000);
    latest().open();

    vi.advanceTimersByTime(2000);

    expect(connection.state()).toEqual({ status: "failed", cause: "bridge_lost" });
  });

  it("does not count malformed telemetry as telemetry", () => {
    const { socket, connection, telemetry } = connected();
    vi.advanceTimersByTime(TELEMETRY_TIMEOUT_MS - 1);

    socket.receive({ ...TELEMETRY, mode: "race" });
    vi.advanceTimersByTime(1);

    expect(telemetry).toEqual([]);
    expect(connection.state()).toEqual({ status: "failed", cause: "bridge_lost" });
  });

  it("sends a command with the next seq once connected", () => {
    const { socket, connection } = connected();

    command(connection, "takeoff");

    expect(socket.sent[1]).toEqual({ ...example("command-takeoff"), seq: 2, t_ms: 5321.7, args: { drones: ["cf1"] } });
  });

  it("numbers commands from 2 again on a new socket", () => {
    const { latest, connection } = connected();
    command(connection, "takeoff");
    latest().bridgeCloses();
    vi.advanceTimersByTime(1000);
    latest().open();
    latest().receive(WELCOME);

    command(connection, "land");

    expect(latest().sent.map(m => [m["type"], m["seq"]])).toEqual([["hello", 1], ["command", 2]]);
  });

  it("ignores telemetry before welcome", () => {
    const { socket, telemetry } = start();
    socket.open();

    socket.receive(TELEMETRY);

    expect(telemetry).toEqual([]);
  });
});

const inputs = (socket: FakeSocket) => socket.sent.filter(m => m["type"] === "input");
const lastHeld = (socket: FakeSocket) => inputs(socket).at(-1)?.["held"];

function telemetryFor(ms: number, socket: FakeSocket): void {
  for (let t = 0; t < ms; t += 100) { vi.advanceTimersByTime(100); socket.receive(TELEMETRY); }
}

describe("input stream", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends input at 30 Hz from welcome, with no held drone and the idle gesture stub", () => {
    const { socket } = connected();
    expect(inputs(socket)).toEqual([]);

    telemetryFor(1000, socket);

    expect(inputs(socket)).toHaveLength(30);
    expect(inputs(socket).map(m => m["seq"])).toEqual(Array.from({ length: 30 }, (_, i) => i + 2));
    expect(inputs(socket)[0]).toEqual({
      type: "input", v: 1, seq: 2, t_ms: 5321.7, rtt_ms: null, held: [],
      gesture: { state: "idle", rate: 0, neutral_y: null }, frames: [],
    });
  });

  it("keeps a still finger's drone in held at its commanded target, with the press time", () => {
    const { socket, connection } = connected();
    socket.receive(TELEMETRY);

    expect(connection.hold({ pointerId: 7, timeStamp: 5300.5 }, "cf1")).toBe(true);
    telemetryFor(1000, socket);

    const held = inputs(socket).map(m => m["held"]);
    expect(held).toHaveLength(30);
    expect(new Set(held.map(h => JSON.stringify(h)))).toEqual(new Set([JSON.stringify([
      { id: "cf1", x: 1.2, y: 0.85, touch_ms: 5300.5, follow: true },
    ])]));
  });

  function holdingCf1() {
    const c = connected();
    c.socket.receive(TELEMETRY);
    c.connection.hold({ pointerId: 7, timeStamp: 5300.5 }, "cf1");
    return c;
  }

  it("sends the dragged finger's position as the target, with the move time", () => {
    const { socket, connection } = holdingCf1();

    const accepted = connection.drag({ pointerId: 7, timeStamp: 5310.25, x: 1.6, y: 1.0 });
    telemetryFor(100, socket);

    expect(accepted).toEqual({ x: 1.6, y: 1.0, blocked: false });
    expect(lastHeld(socket)).toEqual([{ id: "cf1", x: 1.6, y: 1.0, touch_ms: 5310.25, follow: true }]);
  });

  it("stops a drag into the restricted zone at the zone margin, never inside it", () => {
    const { socket, connection } = holdingCf1();

    const accepted = connection.drag({ pointerId: 7, timeStamp: 5310, x: 2.655, y: 1.775 });
    telemetryFor(100, socket);

    const [target] = lastHeld(socket) as { x: number; y: number }[];
    const outside = Math.max(Math.abs(target!.x - 2.655), Math.abs(target!.y - 1.775)) - (0.59 + 0.06);
    expect(accepted?.blocked).toBe(true);
    expect(outside).toBeGreaterThanOrEqual(0);
    expect(outside).toBeLessThan(0.01);
  });

  it("keeps the target inside the capture volume", () => {
    const { socket, connection } = holdingCf1();

    connection.drag({ pointerId: 7, timeStamp: 5310, x: -1, y: 0.85 });
    telemetryFor(100, socket);

    expect(lastHeld(socket)).toEqual([{ id: "cf1", x: 0.25, y: 0.85, touch_ms: 5310, follow: true }]);
  });

  it("ignores a drag from a pointer that holds nothing", () => {
    const { socket, connection } = holdingCf1();

    expect(connection.drag({ pointerId: 8, timeStamp: 5310, x: 1.6, y: 1.0 })).toBeNull();
    telemetryFor(100, socket);

    expect(lastHeld(socket)).toEqual([{ id: "cf1", x: 1.2, y: 0.85, touch_ms: 5300.5, follow: true }]);
  });

  it("removes a lifted finger's drone from held", () => {
    const { socket, connection } = holdingCf1();

    connection.lift(7);
    telemetryFor(100, socket);

    expect(lastHeld(socket)).toEqual([]);
    expect(connection.drag({ pointerId: 7, timeStamp: 5310, x: 1.6, y: 1.0 })).toBeNull();
  });

  it.each([
    ["before any telemetry", (c: ReturnType<typeof connected>) => c, "cf1"],
    ["for a drone that is not flying", (c: ReturnType<typeof connected>) => {
      c.socket.receive({ ...TELEMETRY, drones: (TELEMETRY["drones"] as object[]).map(d => ({ ...d, state: "grounded" })) });
      return c;
    }, "cf1"],
    ["for a drone telemetry does not name", (c: ReturnType<typeof connected>) => { c.socket.receive(TELEMETRY); return c; }, "cf9"],
    ["for a drone another finger holds", (c: ReturnType<typeof connected>) => {
      c.socket.receive(TELEMETRY); c.connection.hold({ pointerId: 1, timeStamp: 1 }, "cf1"); return c;
    }, "cf1"],
  ])("refuses a hold %s", (_, setUp, drone) => {
    const c = setUp(connected());

    expect(c.connection.hold({ pointerId: 7, timeStamp: 5300 }, drone)).toBe(false);
    telemetryFor(100, c.socket);
    expect((lastHeld(c.socket) as Held[]).filter(h => h.touch_ms === 5300)).toEqual([]);
  });

  it("sends rtt_ms as null until telemetry acknowledges an input, then the latest round-trip time", () => {
    let now = 5321.7;
    const { socket } = connected(() => now);
    vi.advanceTimersByTime(100);
    socket.receive({ ...TELEMETRY, host_ms: 1003.0, ack: { seq: null, t_ms: null, host_rx_ms: null } });
    vi.advanceTimersByTime(100);
    const early = inputs(socket).map(m => m["rtt_ms"]);

    now = 5420.0;
    socket.receive({ ...TELEMETRY, host_ms: 1003.0, ack: { seq: 2, t_ms: 5400.0, host_rx_ms: 1000.0 } });
    vi.advanceTimersByTime(40);

    expect(new Set(early)).toEqual(new Set([null]));
    expect(inputs(socket).at(-1)?.["rtt_ms"]).toBe(17);
  });

  it("takes the altitude channel from the gesture function on each tick", () => {
    const frame = { t_ms: 5320, label: "Open_Palm", score: 0.9, wrist_x: 0.4, wrist_y: 0.38 };
    const { socket } = connected(undefined, () => ({ state: "active", rate: 0.12, frames: [frame] }));

    vi.advanceTimersByTime(40);

    expect(inputs(socket)[0]).toMatchObject({ gesture: { state: "active", rate: 0.12, neutral_y: null }, frames: [frame] });
  });

  it("releases every hold when the bridge is lost, so a reconnect needs a new finger", () => {
    const { sockets, connection } = holdingCf1();
    vi.advanceTimersByTime(TELEMETRY_TIMEOUT_MS);
    const sentBeforeLoss = inputs(sockets[0]!).length;
    vi.advanceTimersByTime(1000);
    sockets[1]!.open();
    sockets[1]!.receive(WELCOME);

    telemetryFor(1000, sockets[1]!);

    expect(connection.drag({ pointerId: 7, timeStamp: 5310, x: 1.6, y: 1.0 })).toBeNull();
    expect(inputs(sockets[0]!)).toHaveLength(sentBeforeLoss);
    expect(inputs(sockets[1]!)).toHaveLength(30);
    expect(new Set(inputs(sockets[1]!).map(m => JSON.stringify(m["held"])))).toEqual(new Set(["[]"]));
  });

  it("refuses a hold before the bridge welcomes the tablet", () => {
    const { socket, connection } = start();
    socket.open();

    expect(connection.hold({ pointerId: 7, timeStamp: 5300 }, "cf1")).toBe(false);
  });
});

describe("parseHostMessage", () => {
  const telemetry = example("telemetry-cf3-defensive-hover");
  const drone = (telemetry["drones"] as Record<string, unknown>[])[0]!;

  it("accepts the telemetry example", () => {
    expect(parseHostMessage(JSON.stringify(telemetry))).toEqual(telemetry);
  });

  it("accepts telemetry with null positions, no trial, and an empty ack", () => {
    const early = { ...telemetry, trial: null, ack: { seq: null, t_ms: null, host_rx_ms: null },
      drones: [{ ...drone, x: null, y: null, z: null, yaw: null, pos_age_ms: null }] };
    expect(parseHostMessage(JSON.stringify(early))).toEqual(early);
  });

  it.each([
    ["an unknown mode", { ...telemetry, mode: "race" }],
    ["drones that are not a list", { ...telemetry, drones: {} }],
    ["a drone with a text position", { ...telemetry, drones: [{ ...drone, x: "1" }] }],
    ["a drone with an unknown state", { ...telemetry, drones: [{ ...drone, state: "hovering" }] }],
    ["a drone with no cmd", { ...telemetry, drones: [{ ...drone, cmd: null }] }],
    ["a drone with a missing range", { ...telemetry, drones: [{ ...drone, ranges: { front: 1 } }] }],
    ["an ack with seq 0", { ...telemetry, ack: { ...(telemetry["ack"] as object), seq: 0 } }],
    ["an ack with a text t_ms", { ...telemetry, ack: { ...(telemetry["ack"] as object), t_ms: "1" } }],
    ["a trial with no id", { ...telemetry, trial: { running: true, elapsed_ms: 1 } }],
    ["an unknown altitude block reason", { ...telemetry, altitude: { rate: 0, blocked_by: null, reason: "wind" } }],
    ["a numeric altitude blocked_by", { ...telemetry, altitude: { rate: 0, blocked_by: 3, reason: null } }],
    ["a drone with a text held", { ...telemetry, drones: [{ ...drone, held: "yes" }] }],
    ["a drone with an unknown link", { ...telemetry, drones: [{ ...drone, link: "weak" }] }],
    ["a defensive hover with an unknown direction", { ...telemetry, drones: [{ ...drone, defensive_hover: { dir: "down", range: 0.2 } }] }],
  ])("rejects telemetry with %s", (_, message) => {
    expect(parseHostMessage(JSON.stringify(message))).toBeNull();
  });
});

function parsedWelcome(): Welcome {
  const welcome = parseHostMessage(JSON.stringify(WELCOME));
  if (welcome?.type !== "welcome") throw new Error("the welcome example does not parse as welcome");
  return welcome;
}

describe("linkLabel", () => {
  it.each<[ConnectionState, string, string | null]>([
    [{ status: "connecting" }, "Connecting", null],
    [{ status: "connected", welcome: parsedWelcome(), command: () => {} }, "Connected", null],
    [{ status: "failed", cause: "bridge_lost" }, "Connection failed", "Bridge lost, retrying"],
    [{ status: "failed", cause: "no_bridge" }, "Connection failed", "No bridge, retrying"],
    [{ status: "failed", cause: "operator_busy" }, "Connection failed", "Operator busy, retrying"],
    [{ status: "failed", cause: "version_mismatch" }, "Connection failed", "Version mismatch, not retrying"],
    [{ status: "failed", cause: "rejected" }, "Connection failed", "Rejected, not retrying"],
  ])("labels %j", (state, headline, detail) => {
    expect(linkLabel(state)).toEqual({ headline, detail });
  });
});

describe("socketUrl", () => {
  it("uses a secure socket on an HTTPS page, on the page's own host", () => {
    expect(socketUrl({ protocol: "https:", host: "10.0.0.5:5173" })).toBe("wss://10.0.0.5:5173/ws");
    expect(socketUrl({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/ws");
  });
});
