import { VERSION, parseHostMessage, type Hello, type Welcome } from "./protocol";

export type ConnectionState =
  | { status: "connecting" }
  | { status: "connected"; welcome: Welcome }
  | { status: "disconnected" };

export interface SocketLike {
  send(data: string): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
}

export interface ConnectionOptions {
  tabletClockMs: () => number;
  client: string;
  userAgent: string;
  onState: (state: ConnectionState) => void;
  openSocket?: () => SocketLike;
  warn?: (message: string) => void;
}

export interface Connection {
  state(): ConnectionState;
}

export const socketUrl = (location: { protocol: string; host: string }): string =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export function connect(options: ConnectionOptions): Connection {
  const { tabletClockMs, onState, openSocket = () => new WebSocket(socketUrl(location)), warn = console.warn } = options;
  let state: ConnectionState = { status: "connecting" }, seq = 0;
  const setState = (next: ConnectionState) => { state = next; onState(state); };

  function receive(data: unknown): void {
    const message = parseHostMessage(data);
    if (message === null) warn(`ignored a message from the bridge: ${String(data).slice(0, 120)}`);
    else if (message.type === "welcome") setState({ status: "connected", welcome: message });
    else if (!message.ok) warn(`the bridge rejected message ${message.ref}: ${message.code} (${message.detail})`);
  }

  setState(state);
  const socket = openSocket();
  socket.onopen = () => {
    const hello: Hello = {
      type: "hello", v: VERSION, seq: ++seq, t_ms: tabletClockMs(), role: "operator", client: options.client, user_agent: options.userAgent,
    };
    socket.send(JSON.stringify(hello));
  };
  socket.onmessage = event => receive(event.data);
  socket.onclose = () => { if (state.status !== "disconnected") setState({ status: "disconnected" }); };

  return { state: () => state };
}
