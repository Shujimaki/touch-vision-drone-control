// Live positions from the command bridge (protocol/README.md, version 1): the tablet sends hello, the host answers
// with welcome and then streams telemetry. Only the measured poses of drones, obstacles and hoops are used; every other value
// on screen stays sample data. The page connects only when its address has ?live, so the mockup still opens alone.
import type { Box, Drone, Hoop } from "./sample";

export interface Pose { id: string; x: number | null; y: number | null; z: number | null; yaw: number | null; pos_age_ms: number | null }
export interface Welcome { type: "welcome"; v: 1; config: { drones: string[]; telemetry_timeout_ms: number; stale_position_ms: number; course: { room: { x_min: number; x_max: number; y_min: number; y_max: number } } } }
export interface Telemetry { type: "telemetry"; v: 1; drones: Pose[]; obstacles: Pose[]; hoops?: Pose[] }
export type LiveState = "connecting" | "live" | "lost" | "closed";

export const CLIENT = "tablet-web 0.1.0";

// ?live connects to /ws on this page's host; ?live=wss://host:8765/ws connects to that address.
export function liveUrl(search: string, loc: { protocol: string; host: string }): string | null {
  const q = new URLSearchParams(search);
  if (!q.has("live")) return null;
  const v = q.get("live");
  return v ? v : `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/ws`;
}

// The protocol measures yaw counterclockwise from +x. The map measures heading clockwise from +y.
export const mapYaw = (yaw: number) => ((90 - yaw) % 360 + 360) % 360;

const fresh = (p: Pose, staleMs: number): p is Pose & { x: number; y: number; z: number; yaw: number } =>
  p.x !== null && p.y !== null && p.z !== null && p.yaw !== null && p.pos_age_ms !== null && p.pos_age_ms <= staleMs;

export interface Course { boxes: Box[]; hoops: Hoop[] }

// Moves drones, obstacles and hoops to their measured poses. Anything without a fresh pose is marked stale; an obstacle
// or hoop then returns to its configured place (home). Returns true when an obstacle or hoop changed, so the course redraws.
export function applyTelemetry(t: Telemetry, drones: Drone[], course: Course, home: Course, staleMs: number): boolean {
  for (const p of t.drones) {
    const d = drones.find(x => x.id === p.id);
    if (!d) continue;
    d.stale = !fresh(p, staleMs);
    if (!fresh(p, staleMs)) continue;
    d.x = p.x; d.y = p.y; d.z = p.z; d.yaw = mapYaw(p.yaw); d.gliding = false;
    if (!d.held) { d.tx = p.x; d.ty = p.y; }                 // a released drone's target follows the measurement
    d.ranges = {}; d.below = null;                            // the sample readings belong to the sample positions
  }
  let moved = false;
  for (const p of t.obstacles) {
    const b = course.boxes.find(x => x.id === p.id), h = home.boxes.find(x => x.id === p.id);
    if (!b || !h) continue;
    const [x, y] = fresh(p, staleMs) ? [p.x, p.y] : [h.x, h.y];
    if (b.stale !== !fresh(p, staleMs)) { b.stale = !fresh(p, staleMs); moved = true; }
    if (Math.abs(b.x - x) > 0.005 || Math.abs(b.y - y) > 0.005) { b.x = x; b.y = y; moved = true; }
  }
  for (const p of t.hoops ?? []) {
    const r = course.hoops.find(x => x.id === p.id), h = home.hoops.find(x => x.id === p.id);
    if (!r || !h) continue;
    // A hoop's ang uses the protocol yaw (counterclockwise from +x), so it needs no mapYaw.
    const [x, y, z, ang] = fresh(p, staleMs) ? [p.x, p.y, p.z, p.yaw] : [h.x, h.y, h.z, h.ang];
    if (r.stale !== !fresh(p, staleMs)) { r.stale = !fresh(p, staleMs); moved = true; }
    if (Math.abs(r.x - x) > 0.005 || Math.abs(r.y - y) > 0.005 || Math.abs(r.z - z) > 0.005 || Math.abs(r.ang - ang) > 1) {
      r.x = x; r.y = y; r.z = z; r.ang = ang; moved = true;
    }
  }
  return moved;
}

// Opens the connection, reconnects 2 s after it closes, and reports host loss when no telemetry arrives in time.
export function connectLive(url: string, on: { welcome(w: Welcome): void; telemetry(t: Telemetry): void; state(s: LiveState): void }): void {
  let timeoutMs = 500, last = 0, watch = 0;
  const open = () => {
    let seq = 0;
    const ws = new WebSocket(url);
    on.state("connecting");
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", v: 1, seq: ++seq, t_ms: Math.round(performance.now() * 10) / 10, role: "operator", client: CLIENT, user_agent: navigator.userAgent }));
    ws.onmessage = e => {
      const m = JSON.parse(String(e.data)) as { type?: string; v?: number };
      if (m.v !== 1) { console.warn("live: ignored a message of version", m.v); return; }
      if (m.type === "welcome") { const w = m as Welcome; timeoutMs = w.config.telemetry_timeout_ms; on.welcome(w); }
      else if (m.type === "telemetry") { last = performance.now(); on.state("live"); on.telemetry(m as Telemetry); }
      else if (m.type === "reply") console.warn("live: host reply", m);
      else console.warn("live: ignored message type", m.type);
    };
    ws.onclose = () => { clearTimeout(watch); on.state("closed"); setTimeout(open, 2000); };
    const check = () => { if (last && performance.now() - last > timeoutMs) on.state("lost"); watch = window.setTimeout(check, 100); };
    check();
  };
  open();
}
