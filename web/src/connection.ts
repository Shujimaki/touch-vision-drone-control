import { VERSION, parseHostMessage, type Hello, type Reply, type Telemetry, type Welcome } from "./protocol";

export type FailureCause = "bridge_lost" | "no_bridge" | "operator_busy" | "version_mismatch" | "rejected";

export type ConnectionState =
  | { status: "connecting" }
  | { status: "connected"; welcome: Welcome }
  | { status: "failed"; cause: FailureCause };

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
}

export interface ConnectionOptions {
  tabletClockMs: () => number;
  client: string;
  userAgent: string;
  onState: (state: ConnectionState) => void;
  onTelemetry: (telemetry: Telemetry) => void;
  onHostLost: (reason: "host_lost") => void;
  openSocket?: () => SocketLike;
  warn?: (message: string) => void;
}

export interface Connection {
  state(): ConnectionState;
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
  const { openSocket = () => new WebSocket(socketUrl(location)), warn = console.warn } = options;
  let state: ConnectionState = { status: "connecting" }, everConnected = false;
  const setState = (next: ConnectionState) => { state = next; onState(state); };
  const lostCause = (): FailureCause => everConnected ? "bridge_lost" : "no_bridge";

  function attempt(): void {
    const socket = openSocket();
    let seq = 0, refused: FailureCause | null = null;
    let deadline = setTimeout(() => fail(lostCause()), WELCOME_TIMEOUT_MS);
    const expectTelemetryWithin = (ms: number) => { clearTimeout(deadline); deadline = setTimeout(() => fail("bridge_lost"), ms); };

    function fail(cause: FailureCause): void {
      clearTimeout(deadline);
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
        setState({ status: "connected", welcome: message });
        expectTelemetryWithin(message.config.telemetry_timeout_ms);
      } else if (message.type === "telemetry") {
        if (state.status !== "connected") return;
        expectTelemetryWithin(state.welcome.config.telemetry_timeout_ms);
        onTelemetry(message);
      } else if (!message.ok) {
        refused = causeOf(message, state.status === "connected") ?? refused;
        warn(`the bridge rejected message ${message.ref}: ${message.code} (${message.detail})`);
      }
    }

    socket.onopen = () => {
      const hello: Hello = {
        type: "hello", v: VERSION, seq: ++seq, t_ms: Math.round(tabletClockMs() * 10) / 10, role: "operator", client: options.client, user_agent: options.userAgent,
      };
      socket.send(JSON.stringify(hello));
    };
    socket.onmessage = event => receive(event.data);
    socket.onclose = () => fail(refused ?? lostCause());
  }

  setState(state);
  attempt();
  return { state: () => state };
}
