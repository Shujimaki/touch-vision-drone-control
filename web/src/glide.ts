// Screen animation for a dragged drone: it eases toward the target the finger set, at up to 1 m/s, and records
// recent positions for the fading trail. This is drawing only; it does not model how a real drone flies.
import { clamp } from "./format";
import type { Drone } from "./sample";

export const MAX_SPEED = 1.0;   // m/s on screen

// Advances one drone by dt seconds at time now (ms). Returns true while the drone is still moving.
export function glideStep(d: Drone, dt: number, now: number): boolean {
  if (!d.gliding) return false;
  const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy);
  if (dist < 0.002) { d.x = d.tx; d.y = d.ty; d.gliding = false; return false; }
  const step = Math.min(dist, clamp(dist * 2.2, 0.08, MAX_SPEED) * Math.max(0, dt));
  d.x += dx / dist * step; d.y += dy / dist * step;
  (d.trail ??= []).push([d.x, d.y, now]);
  return true;
}
