// Fixed sample data for the mockup: the course, three drones in one moment of a trial, and the event log so far.
// Nothing here changes over time. The UI only moves what the operator drags and shows what the operator selects.

export type Dir = "front" | "back" | "left" | "right" | "up";
export type LogKind = "info" | "ok" | "warn" | "crit";
export type Gesture = "idle" | "confirming" | "climb" | "descend" | "locked" | "lost" | "unrecognized";

export interface Box { id: string; x: number; y: number; hx: number; hy: number; h: number }
export interface Hoop { id: string; x: number; y: number; z: number; r: number; horizontal: boolean; ang: number }
export interface Course {
  arena: { xMin: number; xMax: number; yMin: number; yMax: number; margin: number };
  z: { min: number; max: number; displayMax: number };
  zone: { x: number; y: number; h: number; margin: number };
  boxes: Box[];
  hoops: Hoop[];
}
export interface Health { motorPass: boolean[]; sag: number; at: number }
export interface Drone {
  id: string; n: number;
  x: number; y: number; z: number; yaw: number;
  tx: number; ty: number;                         // where the drone is heading (the operator's last target)
  vbat: number; link: number;                     // volts; radio link quality in %
  ranges: Partial<Record<Dir, number | null>>;   // Multi-ranger readings in m; null = nothing within range; missing = no sample reading
  below: { dist: number; what: string } | null;  // clearance below, computed from motion capture and the course
  held: boolean;
  health: Health;
}
export interface LogEntry { t: number; text: string; k: LogKind; ses: string; tr: string }
export interface TrialRecord { id: string; session: string; t0: number; t1: number | null; outcome: string | null; dh: number; restrict: number }

// Miguel 409 course, Figure 5 of the proposal: 531 x 355 cm room, 118 cm restricted zone at the centre
export const COURSE: Course = {
  arena: { xMin: 0, xMax: 5.31, yMin: 0, yMax: 3.55, margin: 0.25 },
  z: { min: 0.50, max: 1.44, displayMax: 2.00 },
  zone: { x: 2.655, y: 1.775, h: 0.59, margin: 0.06 },
  boxes: [
    { id: "O1", x: 1.31, y: 1.56, hx: 0.265, hy: 0.255, h: 1.02 },
    { id: "O2", x: 2.60, y: 2.71, hx: 0.265, hy: 0.255, h: 1.53 },
  ],
  hoops: [
    { id: "H1", x: 1.31, y: 2.70, z: 1.00, r: 0.20, horizontal: true, ang: 0 },
    { id: "H2", x: 3.99, y: 2.70, z: 0.50, r: 0.20, horizontal: false, ang: 90 },
    { id: "H3", x: 3.99, y: 1.49, z: 1.50, r: 0.20, horizontal: false, ang: 90 },
  ],
};

// The moment shown: DRONE 1 is held and climbing next to O1, DRONE 2 flies toward a target, DRONE 3 is on its pad.
export const sampleDrones = (): Drone[] => [
  { id: "cf1", n: 1, x: 0.855, y: 1.56, z: 0.82, yaw: 0, tx: 0.855, ty: 1.56, vbat: 4.02, link: 98, held: true,
    ranges: { front: 1.99, back: 1.56, left: 0.855, right: 0.19, up: 1.73 }, below: { dist: 0.82, what: "floor" },
    health: { motorPass: [true, true, true, true], sag: 0.32, at: 791 } },
  { id: "cf2", n: 2, x: 1.95, y: 0.95, z: 0.90, yaw: 350, tx: 1.62, ty: 1.02, vbat: 3.98, link: 97, held: false,
    ranges: { front: 0.94, back: 0.96, left: 1.98, right: 2.12, up: 1.65 }, below: { dist: 0.90, what: "floor" },
    health: { motorPass: [true, true, true, true], sag: 0.36, at: 791 } },
  { id: "cf3", n: 3, x: 2.95, y: 0.45, z: 0, yaw: 95, tx: 2.95, ty: 0.45, vbat: 3.94, link: 96, held: false,
    ranges: {}, below: null,
    health: { motorPass: [true, true, true, true], sag: 0.39, at: 791 } },
];

export const SAMPLE = {
  now: 851,                   // seconds since the session clock started (T+00:14:11)
  gesture: "climb" as Gesture,
  requestedRate: 0.15,        // m/s from the hand
  appliedRate: 0.12,          // m/s applied to the held drones
  trial: { id: "S1-T1", session: "S1", t0: 821, running: true, timeLimit: 300, dh: 0, restrict: 0 },
  sessions: ["S1"],
};

export const sampleLog = (): LogEntry[] => [
  { t: 600, text: "Session S1 started", k: "info", ses: "S1", tr: "" },
  { t: 603, text: "MoCap lock, 3 of 3 rigid bodies", k: "ok", ses: "S1", tr: "" },
  { t: 742, text: "Drones on start pads D1–D3, 30 cm spacing", k: "ok", ses: "S1", tr: "" },
  { t: 791, text: "Health check: propeller and battery tests on all drones", k: "info", ses: "S1", tr: "" },
  { t: 791, text: "DRONE 1 health: Passed", k: "ok", ses: "S1", tr: "" },
  { t: 791, text: "DRONE 2 health: Passed", k: "ok", ses: "S1", tr: "" },
  { t: 791, text: "DRONE 3 health: Passed", k: "ok", ses: "S1", tr: "" },
  { t: 821, text: "Trial S1-T1 started: telemetry and video feed up", k: "ok", ses: "S1", tr: "S1-T1" },
  { t: 825, text: "Take off all, target 0.60 m", k: "info", ses: "S1", tr: "S1-T1" },
  { t: 840, text: "DRONE 2 held", k: "info", ses: "S1", tr: "S1-T1" },
  { t: 843, text: "DRONE 2 released, target +1.62, +1.02 m", k: "info", ses: "S1", tr: "S1-T1" },
  { t: 848, text: "DRONE 1 held", k: "info", ses: "S1", tr: "S1-T1" },
  { t: 848, text: "Video: DRONE 1", k: "info", ses: "S1", tr: "S1-T1" },
  { t: 850, text: "Open palm seen, confirming", k: "info", ses: "S1", tr: "S1-T1" },
  { t: 851, text: "Open palm confirmed, neutral point captured", k: "ok", ses: "S1", tr: "S1-T1" },
];
