// Restricted-zone drag check (REQ-08): the touch surface rejects any drag that would place a drone inside the zone
// or its margin. The part of a drag that would enter the zone is cut off, so the drone stops at the edge.
import type { Course } from "./sample";

// True when segment a-b passes through the rectangle centred on (cx, cy) with half sizes hx, hy (Liang-Barsky).
export function segHitsRect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, hx: number, hy: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay, P = [-dx, dx, -dy, dy], Q = [ax - (cx - hx), (cx + hx) - ax, ay - (cy - hy), (cy + hy) - ay];
  for (let i = 0; i < 4; i++) {
    const p = P[i]!, q = Q[i]!;
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
    else { const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
  }
  return t1 - t0 > 1e-4;
}

const inside = (x: number, y: number, z: Course["zone"]) => Math.abs(x - z.x) < z.h + z.margin && Math.abs(y - z.y) < z.h + z.margin;

// Where a drag from (ax, ay) toward (bx, by) may go. A drone already inside the zone may always move.
export function dragTarget(ax: number, ay: number, bx: number, by: number, z: Course["zone"]): { x: number; y: number; blocked: boolean } {
  const half = z.h + z.margin, hits = (tx: number, ty: number) => segHitsRect(ax, ay, tx, ty, z.x, z.y, half, half);
  if (inside(ax, ay, z) || !hits(bx, by)) return { x: bx, y: by, blocked: false };
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) { const t = (lo + hi) / 2; if (hits(ax + (bx - ax) * t, ay + (by - ay) * t)) hi = t; else lo = t; }
  return { x: ax + (bx - ax) * lo, y: ay + (by - ay) * lo, blocked: true };
}
