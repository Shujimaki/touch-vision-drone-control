// Restricted-zone drag check (REQ-08): the touch surface rejects any drag that would place a drone inside the zone
// or its margin. The part of a drag that would enter is cut off, so the drone stops just outside the margin.
import type { Course } from "./sample";

const GAP = 0.002;   // m: a stopped drone sits this far outside the margin, so the next drag starts clearly outside

// Where segment a-b first enters the square centred on (cx, cy) with half size h, as a fraction t of the segment
// (0 at a, 1 at b), or null if it never enters. Liang-Barsky clipping; a segment that only touches an edge or a
// corner does not enter.
export function entryT(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, h: number): number | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay, P = [-dx, dx, -dy, dy], Q = [ax - (cx - h), (cx + h) - ax, ay - (cy - h), (cy + h) - ay];
  for (let i = 0; i < 4; i++) {
    const p = P[i]!, q = Q[i]!;
    if (Math.abs(p) < 1e-12) { if (q <= 0) return null; }                       // parallel to this edge and not inside it
    else { const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; } }
  }
  return t1 - t0 > 1e-9 ? t0 : null;
}

const inside = (x: number, y: number, cx: number, cy: number, h: number) => Math.abs(x - cx) < h && Math.abs(y - cy) < h;

// Where a drag from (ax, ay) toward (bx, by) may go.
export function dragTarget(ax: number, ay: number, bx: number, by: number, z: Course["zone"]): { x: number; y: number; blocked: boolean } {
  const outer = z.h + z.margin, free = { x: bx, y: by, blocked: false };
  // a drone inside the zone itself (for example after the course layout changes) may always be dragged out
  if (inside(ax, ay, z.x, z.y, z.h)) return free;
  // a drone in the margin band may move away, but never into the zone itself
  const h = inside(ax, ay, z.x, z.y, outer) ? z.h : outer;
  const t = entryT(ax, ay, bx, by, z.x, z.y, h);
  if (t == null) return free;
  const len = Math.hypot(bx - ax, by - ay), s = Math.max(0, t - (len > 0 ? GAP / len : 0));
  return { x: ax + (bx - ax) * s, y: ay + (by - ay) * s, blocked: true };
}
