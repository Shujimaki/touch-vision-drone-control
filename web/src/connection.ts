import {
  VERSION, parseHostMessage,
  type Command, type DroneTelemetry, type FlightCommand, type Frame, type GestureState, type Held, type Hello, type HostConfig,
  type Input, type Reply, type Telemetry, type Welcome,
} from "./protocol";
import { clamp } from "./format";
import { acceptedTarget, type AcceptedTarget } from "./zone";

export type FailureCause = "bridge_lost" | "no_bridge" | "operator_busy" | "version_mismatch" | "rejected";

export type ConnectionState =
  | { status: "connecting" }
  | { status: "connected"; welcome: Welcome; command: (name: FlightCommand, drones: string[]) => void }
  | { status: "failed"; cause: FailureCause };

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
}

/** What the gesture channel reports each input tick. */
export interface GestureReading { state: GestureState; rate: number; frames: Frame[] }

export const idleGesture = (): GestureReading => ({ state: "idle", rate: 0, frames: [] });

export interface ConnectionOptions {
  tabletClockMs: () => number;
  client: string;
  userAgent: string;
  onState: (state: ConnectionState) => void;
  onTelemetry: (telemetry: Telemetry) => void;
  onHostLost: (reason: "host_lost") => void;
  gesture?: () => GestureReading;
  openSocket?: () => SocketLike;
  warn?: (message: string) => void;
}

/** One finger on the map: its pointer and where it is, in course meters. */
export interface Contact { pointerId: number; timeStamp: number; x: number; y: number }

export interface Connection {
  state(): ConnectionState;
  /** Holds a flying drone with a new finger. Returns false when the drone cannot be held. */
  hold(contact: Pick<Contact, "pointerId" | "timeStamp">, drone: string): boolean;
  /** Moves a held drone's target toward the finger. Returns the accepted target, or null when the bridge is not connected or the pointer holds no drone with telemetry. */
  drag(contact: Contact): AcceptedTarget | null;
  /** Releases the drone a finger holds, if any. */
  lift(pointerId: number): void;
}

function coveringSquareZone(config: HostConfig) {
  const r = config.course.restricted_zone;
  return {
    x: (r.x_min + r.x_max) / 2, y: (r.y_min + r.y_max) / 2,
    h: Math.max(r.x_max - r.x_min, r.y_max - r.y_min) / 2, margin: config.zone_margin,
  };
}

const WELCOME_TIMEOUT_MS = 2000;
const RETRY_MS = 1000;

const CAUSES: Record<FailureCause, { label: string; retries: boolean }> = {
  bridge_lost: { label: "Bridge lost", retries: true },
  no_bridge: { label: "No bridge", retries: true },
  operator_busy: { label: "Operator busy", retries: true },
  version_mismatch: { label: "Version mismatch", retries: false },
  rejected: { label: "Rejected", retries: false },
};

export function linkLabel(state: ConnectionState): { headline: string; detail: string | null } {
  if (state.status === "connecting") return { headline: "Connecting", detail: null };
  if (state.status === "connected") return { headline: "Connected", detail: null };
  const { label, retries } = CAUSES[state.cause];
  return { headline: "Connection failed", detail: `${label}, ${retries ? "retrying" : "not retrying"}` };
}

export const socketUrl = (location: { protocol: string; host: string }): string =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

function causeOf(reply: Reply, connected: boolean): FailureCause | null {
  if (reply.code === "busy") return "operator_busy";
  if (reply.code === "version") return "version_mismatch";
  if (reply.code === "invalid" && !connected) return "rejected";
  return null;
}

export function connect(options: ConnectionOptions): Connection {
  const { tabletClockMs, onState, onTelemetry, onHostLost } = options;
  const { openSocket = () => new WebSocket(socketUrl(location)), warn = console.warn, gesture = idleGesture } = options;
  let state: ConnectionState = { status: "connecting" }, everConnected = false;
  const setState = (next: ConnectionState) => { state = next; onState(state); };
  const lostCause = (): FailureCause => everConnected ? "bridge_lost" : "no_bridge";
  const tabletMs = () => Math.round(tabletClockMs() * 10) / 10;
  const contacts = new Map<number, Held>();
  let latestDrones = new Map<string, DroneTelemetry>();

  function hold(contact: Pick<Contact, "pointerId" | "timeStamp">, drone: string): boolean {
    const seen = latestDrones.get(drone);
    const taken = [...contacts.values()].some(h => h.id === drone);
    if (state.status !== "connected" || seen?.state !== "flying" || taken) return false;
    contacts.set(contact.pointerId, { id: drone, x: seen.cmd.x, y: seen.cmd.y, touch_ms: contact.timeStamp, follow: true });
    return true;
  }

  function drag(contact: Contact): AcceptedTarget | null {
    const held = contacts.get(contact.pointerId), seen = held && latestDrones.get(held.id);
    if (state.status !== "connected" || !held || !seen) return null;
    const config = state.welcome.config, v = config.course.capture_volume;
    const measured = seen.x !== null && seen.y !== null ? { x: seen.x, y: seen.y } : null;
    const fx = clamp(contact.x, v.x_min, v.x_max), fy = clamp(contact.y, v.y_min, v.y_max);
    const to = acceptedTarget(held, measured, fx, fy, coveringSquareZone(config));
    contacts.set(contact.pointerId, { ...held, x: to.x, y: to.y, touch_ms: contact.timeStamp });
    return to;
  }

  function attempt(): void {
    const socket = openSocket();
    let seq = 0, refused: FailureCause | null = null, rttMs: number | null = null;
    let deadline = setTimeout(() => fail(lostCause()), WELCOME_TIMEOUT_MS), inputTimer: ReturnType<typeof setInterval> | undefined;
    const expectTelemetryWithin = (ms: number) => { clearTimeout(deadline); deadline = setTimeout(() => fail("bridge_lost"), ms); };

    function sendInput(): void {
      const reading = gesture();
      const input: Input = {
        type: "input", v: VERSION, seq: ++seq, t_ms: tabletMs(), rtt_ms: rttMs, held: [...contacts.values()],
        gesture: { state: reading.state, rate: reading.rate, neutral_y: null }, frames: reading.frames,
      };
      socket.send(JSON.stringify(input));
    }

    function fail(cause: FailureCause): void {
      clearTimeout(deadline);
      clearInterval(inputTimer);
      contacts.clear();
      latestDrones = new Map();
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
      const wasConnected = state.status === "connected";
      setState({ status: "failed", cause });
      if (wasConnected) onHostLost("host_lost");
      if (CAUSES[cause].retries) setTimeout(attempt, RETRY_MS);
    }

    function receive(data: unknown): void {
      const message = parseHostMessage(data);
      if (message === null) warn(`ignored a message from the bridge: ${String(data).slice(0, 120)}`);
      else if (message.type === "welcome") {
        everConnected = true;
        const command = (name: FlightCommand, drones: string[]) => {
          const message: Command = { type: "command", v: VERSION, seq: ++seq, t_ms: tabletMs(), name, args: { drones } };
          socket.send(JSON.stringify(message));
        };
        setState({ status: "connected", welcome: message, command });
        expectTelemetryWithin(message.config.telemetry_timeout_ms);
        inputTimer = setInterval(sendInput, 1000 / message.config.input_hz);
      } else if (message.type === "telemetry") {
        if (state.status !== "connected") return;
        expectTelemetryWithin(state.welcome.config.telemetry_timeout_ms);
        latestDrones = new Map(message.drones.map(d => [d.id, d]));
        const { t_ms, host_rx_ms } = message.ack;
        if (t_ms !== null && host_rx_ms !== null) {
          rttMs = Math.round(((tabletClockMs() - t_ms) - (message.host_ms - host_rx_ms)) * 10) / 10;
        }
        onTelemetry(message);
      } else if (!message.ok) {
        refused = causeOf(message, state.status === "connected") ?? refused;
        warn(`the bridge rejected message ${message.ref}: ${message.code} (${message.detail})`);
      }
    }

    socket.onopen = () => {
      const hello: Hello = {
        type: "hello", v: VERSION, seq: ++seq, t_ms: tabletMs(), role: "operator", client: options.client, user_agent: options.userAgent,
      };
      socket.send(JSON.stringify(hello));
    };
    socket.onmessage = event => receive(event.data);
    socket.onclose = () => fail(refused ?? lostCause());
  }

  setState(state);
  attempt();
  return { state: () => state, hold, drag, lift: pointerId => { contacts.delete(pointerId); } };
}
