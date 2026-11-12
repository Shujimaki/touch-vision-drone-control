export const VERSION = 1;

const ROLES = ["operator", "experimenter"] as const;
export type Role = (typeof ROLES)[number];

export interface Hello {
  type: "hello"; v: 1; seq: number; t_ms: number;
  role: Role; client: string; user_agent: string;
}

export interface Rect { x_min: number; x_max: number; y_min: number; y_max: number }

export interface HostConfig {
  id: string;
  drones: string[];
  input_hz: number; telemetry_hz: number;
  input_timeout_ms: number; telemetry_timeout_ms: number; stale_position_ms: number;
  rate_max: number; zone_margin: number; z_min: number; z_max: number;
  course: {
    room: Rect; capture_volume: Rect; restricted_zone: Rect;
    obstacles: (Rect & { id: string; height: number })[];
    hoops: { id: string; x: number; y: number; z: number; diameter: number; plane: "horizontal" | "vertical"; yaw: number }[];
    pads: { id: string; x: number; y: number }[];
  };
}

export interface Welcome {
  type: "welcome"; v: 1; seq: number; host_ms: number;
  session: string; role: Role; config: HostConfig;
}

const REPLY_CODES = ["invalid", "version", "busy", "unknown_drone", "not_allowed"] as const;
export type ReplyCode = (typeof REPLY_CODES)[number];

export interface Reply {
  type: "reply"; v: 1; seq: number; host_ms: number;
  ref: number | null; ok: boolean; code: ReplyCode | null; detail: string | null;
}

export type HostMessage = Welcome | Reply;

type Fields = Record<string, unknown>;
const isObject = (x: unknown): x is Fields => typeof x === "object" && x !== null && !Array.isArray(x);
const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isSeq = (x: unknown): x is number => isNumber(x) && Number.isInteger(x) && x >= 1;
const isString = (x: unknown): x is string => typeof x === "string";
const isRole = (x: unknown): x is Role => (ROLES as readonly unknown[]).includes(x);
const isReplyCode = (x: unknown): x is ReplyCode => (REPLY_CODES as readonly unknown[]).includes(x);
const numbers = (o: Fields, keys: string[]) => keys.every(k => isNumber(o[k]));
const isRect = (x: unknown): x is Rect => isObject(x) && numbers(x, ["x_min", "x_max", "y_min", "y_max"]);
const all = (x: unknown, ok: (item: unknown) => boolean) => Array.isArray(x) && x.every(ok);

const isCourse = (x: unknown): x is HostConfig["course"] =>
  isObject(x) && isRect(x["room"]) && isRect(x["capture_volume"]) && isRect(x["restricted_zone"])
  && all(x["obstacles"], o => isRect(o) && isObject(o) && isString(o["id"]) && isNumber(o["height"]))
  && all(x["hoops"], h => isObject(h) && isString(h["id"]) && numbers(h, ["x", "y", "z", "diameter", "yaw"])
    && (h["plane"] === "horizontal" || h["plane"] === "vertical"))
  && all(x["pads"], p => isObject(p) && isString(p["id"]) && numbers(p, ["x", "y"]));

const isHostConfig = (x: unknown): x is HostConfig =>
  isObject(x) && isString(x["id"]) && all(x["drones"], isString) && isCourse(x["course"])
  && numbers(x, ["input_hz", "telemetry_hz", "input_timeout_ms", "telemetry_timeout_ms", "stale_position_ms",
    "rate_max", "zone_margin", "z_min", "z_max"]);

/** Checks one text frame from the bridge against message format v1. Returns null for anything else. */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isString(data)) return null;
  let m: unknown;
  try { m = JSON.parse(data); } catch { return null; }
  if (!isObject(m) || m["v"] !== VERSION || !isSeq(m["seq"]) || !isNumber(m["host_ms"])) return null;
  if (m["type"] === "welcome" && isString(m["session"]) && isRole(m["role"]) && isHostConfig(m["config"])) {
    return m as unknown as Welcome;
  }
  if (m["type"] === "reply" && (m["ref"] === null || isSeq(m["ref"])) && typeof m["ok"] === "boolean"
    && (m["code"] === null || isReplyCode(m["code"])) && (m["detail"] === null || isString(m["detail"]))) {
    return m as unknown as Reply;
  }
  return null;
}
