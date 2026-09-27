// Message format v1 between the tablet and the host (protocol/README.md). Types describe each message; checkMessage
// applies the wire rules the tablet can check on its own: every field present and no extra field, `v` is 1, `seq` is a
// positive integer, numbers are finite, and enumerated fields hold an allowed value.

export type DroneName = string;
export type Role = "operator" | "experimenter";
export interface Rect { x_min: number; x_max: number; y_min: number; y_max: number }
export interface Course {
  room: Rect; capture_volume: Rect; restricted_zone: Rect;
  obstacles: { id: string; x_min: number; x_max: number; y_min: number; y_max: number; height: number }[];
  hoops: { id: string; x: number; y: number; z: number; diameter: number; plane: "horizontal" | "vertical"; yaw: number }[];
  pads: { id: string; x: number; y: number }[];
}
interface TabletHead { v: 1; seq: number; t_ms: number }
interface HostHead { v: 1; seq: number; host_ms: number }

export interface Hello extends TabletHead { type: "hello"; role: Role; client: string; user_agent: string }
export interface Welcome extends HostHead {
  type: "welcome"; session: string; role: Role;
  config: {
    id: string; drones: DroneName[]; input_hz: number; telemetry_hz: number; input_timeout_ms: number;
    telemetry_timeout_ms: number; stale_position_ms: number; rate_max: number; zone_margin: number;
    z_min: number; z_max: number; course: Course;
  };
}
export type GestureState = "idle" | "confirming" | "active" | "locked" | "hand_loss" | "unrecognized";
export interface Input extends TabletHead {
  type: "input"; rtt_ms: number | null;
  held: { id: DroneName; x: number; y: number; touch_ms: number; follow: boolean }[];
  gesture: { state: GestureState; rate: number; neutral_y: number | null };
  frames: { t_ms: number; label: string | null; score: number | null; wrist_x: number | null; wrist_y: number | null }[];
}
export type EventName = "release" | "restriction_start" | "restriction_end" | "capture_limit_start" | "capture_limit_end" | "touch_ignored" | "video_switch" | "visibility";
export interface TabletEvent extends TabletHead { type: "event"; name: EventName; drone: DroneName | null; data: Record<string, unknown> }
export type CommandName = "takeoff" | "land" | "stop" | "stop_reset" | "trial_start" | "trial_end" | "layout_read" | "layout_apply" | "health_check";
export interface Command extends TabletHead { type: "command"; name: CommandName; args: Record<string, unknown> }
export type ReplyCode = "invalid" | "version" | "busy" | "unknown_drone" | "not_allowed";
export interface Reply extends HostHead { type: "reply"; ref: number | null; ok: boolean; code: ReplyCode | null; detail: string | null }
export type Outcome = "completed" | "collision" | "timeout" | "hardware_abort";
export type Dir = "front" | "back" | "left" | "right" | "up";
export interface DroneTelemetry {
  id: DroneName; held: boolean; state: "grounded" | "taking_off" | "flying" | "landing" | "stopped"; link: "ok" | "lost";
  x: number | null; y: number | null; z: number | null; yaw: number | null; pos_age_ms: number | null;
  cmd: { x: number; y: number; z: number }; ranges: Record<Dir, number | null>;
  defensive_hover: { dir: Dir; range: number } | null; battery_v: number | null; battery_level: number | null;
  pm_state: "battery" | "charging" | "charged" | "lowPower" | "shutDown" | null; can_fly: boolean | null; tumbled: boolean | null;
  health: { motor_pass: boolean[]; battery_sag_v: number; battery_pass: boolean; host_ms: number } | null; link_quality: number | null;
}
export interface Telemetry extends HostHead {
  type: "telemetry";
  ack: { seq: number | null; t_ms: number | null; host_rx_ms: number | null };
  trial: { id: string; running: boolean; elapsed_ms: number; outcome: Outcome | null; hoops: Record<DroneName, number> } | null;
  altitude: { rate: number; blocked_by: DroneName | null; reason: "z_max" | "z_min" | "defensive_hover" | null };
  drones: DroneTelemetry[];
}
export interface CourseMessage extends HostHead { type: "course"; config_id: string; pending: boolean; course: Course; bodies_found: number; bodies_expected: number }

export type Message = Hello | Welcome | Input | TabletEvent | Command | Reply | Telemetry | CourseMessage;

// ---------- checks ----------
type Shape = { keys: readonly string[]; sub?: Record<string, Shape>; each?: Record<string, Shape> };
const RECT: Shape = { keys: ["x_min", "x_max", "y_min", "y_max"] };
const COURSE: Shape = {
  keys: ["room", "capture_volume", "restricted_zone", "obstacles", "hoops", "pads"],
  sub: { room: RECT, capture_volume: RECT, restricted_zone: RECT },
  each: {
    obstacles: { keys: ["id", "x_min", "x_max", "y_min", "y_max", "height"] },
    hoops: { keys: ["id", "x", "y", "z", "diameter", "plane", "yaw"] },
    pads: { keys: ["id", "x", "y"] },
  },
};
const TABLET = ["type", "v", "seq", "t_ms"] as const, HOST = ["type", "v", "seq", "host_ms"] as const;
const SHAPES: Record<Message["type"], Shape> = {
  hello: { keys: [...TABLET, "role", "client", "user_agent"] },
  welcome: {
    keys: [...HOST, "session", "role", "config"],
    sub: { config: { keys: ["id", "drones", "input_hz", "telemetry_hz", "input_timeout_ms", "telemetry_timeout_ms", "stale_position_ms", "rate_max", "zone_margin", "z_min", "z_max", "course"], sub: { course: COURSE } } },
  },
  input: {
    keys: [...TABLET, "rtt_ms", "held", "gesture", "frames"],
    sub: { gesture: { keys: ["state", "rate", "neutral_y"] } },
    each: { held: { keys: ["id", "x", "y", "touch_ms", "follow"] }, frames: { keys: ["t_ms", "label", "score", "wrist_x", "wrist_y"] } },
  },
  event: { keys: [...TABLET, "name", "drone", "data"] },
  command: { keys: [...TABLET, "name", "args"] },
  reply: { keys: [...HOST, "ref", "ok", "code", "detail"] },
  telemetry: {
    keys: [...HOST, "ack", "trial", "altitude", "drones"],
    sub: {
      ack: { keys: ["seq", "t_ms", "host_rx_ms"] },
      trial: { keys: ["id", "running", "elapsed_ms", "outcome", "hoops"] },
      altitude: { keys: ["rate", "blocked_by", "reason"] },
    },
    each: {
      drones: {
        keys: ["id", "held", "state", "link", "x", "y", "z", "yaw", "pos_age_ms", "cmd", "ranges", "defensive_hover", "battery_v", "battery_level", "pm_state", "can_fly", "tumbled", "health", "link_quality"],
        sub: { cmd: { keys: ["x", "y", "z"] }, ranges: { keys: ["front", "back", "left", "right", "up"] } },
      },
    },
  },
  course: { keys: [...HOST, "config_id", "pending", "course", "bodies_found", "bodies_expected"], sub: { course: COURSE } },
};
// enumerated values, by field path; "[]" marks an array element
const ENUMS: Record<string, readonly (string | null)[]> = {
  "hello.role": ["operator", "experimenter"],
  "welcome.role": ["operator", "experimenter"],
  "input.gesture.state": ["idle", "confirming", "active", "locked", "hand_loss", "unrecognized"],
  "event.name": ["release", "restriction_start", "restriction_end", "capture_limit_start", "capture_limit_end", "touch_ignored", "video_switch", "visibility"],
  "command.name": ["takeoff", "land", "stop", "stop_reset", "trial_start", "trial_end", "layout_read", "layout_apply", "health_check"],
  "reply.code": [null, "invalid", "version", "busy", "unknown_drone", "not_allowed"],
  "telemetry.trial.outcome": [null, "completed", "collision", "timeout", "hardware_abort"],
  "telemetry.altitude.reason": [null, "z_max", "z_min", "defensive_hover"],
  "telemetry.drones[].state": ["grounded", "taking_off", "flying", "landing", "stopped"],
  "telemetry.drones[].link": ["ok", "lost"],
  "telemetry.drones[].pm_state": [null, "battery", "charging", "charged", "lowPower", "shutDown"],
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function checkShape(o: Record<string, unknown>, shape: Shape, path: string, out: string[]): void {
  for (const k of shape.keys) if (!(k in o)) out.push(`${path}.${k} is missing`);
  for (const k of Object.keys(o)) if (!shape.keys.includes(k)) out.push(`${path}.${k} is not a field`);
  for (const [k, sub] of Object.entries(shape.sub ?? {})) {
    const v = o[k];
    if (v === null) continue;
    if (isObj(v)) checkShape(v, sub, `${path}.${k}`, out); else if (k in o) out.push(`${path}.${k} must be an object`);
  }
  for (const [k, sub] of Object.entries(shape.each ?? {})) {
    const v = o[k];
    if (!Array.isArray(v)) { if (k in o) out.push(`${path}.${k} must be an array`); continue; }
    v.forEach((e, i) => { if (isObj(e)) checkShape(e, sub, `${path}.${k}[${i}]`, out); else out.push(`${path}.${k}[${i}] must be an object`); });
  }
}

function checkNumbers(x: unknown, path: string, out: string[]): void {
  if (typeof x === "number") { if (!Number.isFinite(x)) out.push(`${path} is not a finite number`); }
  else if (Array.isArray(x)) x.forEach((e, i) => checkNumbers(e, `${path}[${i}]`, out));
  else if (isObj(x)) for (const [k, v] of Object.entries(x)) checkNumbers(v, `${path}.${k}`, out);
}

function valuesAt(o: unknown, parts: string[]): unknown[] {
  if (!parts.length) return [o];
  const [head, ...rest] = parts as [string, ...string[]];
  const arr = head.endsWith("[]");
  const v = isObj(o) ? o[arr ? head.slice(0, -2) : head] : undefined;
  if (v === undefined) return [];
  if (arr) return Array.isArray(v) ? v.flatMap(e => valuesAt(e, rest)) : [];
  if (v === null && rest.length) return [];
  return valuesAt(v, rest);
}

// Returns the problems found; an empty list means the message follows the v1 wire rules.
export function checkMessage(x: unknown): string[] {
  const out: string[] = [];
  if (!isObj(x)) return ["the message is not a JSON object"];
  const type = x["type"];
  if (typeof type !== "string" || !(type in SHAPES)) return [`unknown type ${JSON.stringify(type)}`];
  if (x["v"] !== 1) out.push("v must be 1");
  const seq = x["seq"];
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) out.push("seq must be a positive integer");
  checkShape(x, SHAPES[type as Message["type"]], type, out);
  checkNumbers(x, type, out);
  for (const [path, allowed] of Object.entries(ENUMS)) {
    const [t, ...parts] = path.split(".");
    if (t !== type) continue;
    for (const v of valuesAt(x, parts)) if (!allowed.includes(v as string | null)) out.push(`${path} has value ${JSON.stringify(v)}`);
  }
  return out;
}

export const isMessage = (x: unknown): x is Message => checkMessage(x).length === 0;
