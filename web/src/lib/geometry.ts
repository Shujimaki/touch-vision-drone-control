// Plane geometry for drag checks and hoop passes. Units are metres in the course frame.
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

// Shortest distance from point (cx, cy) to the segment a-b.
export function segMinDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? clamp(((cx - ax) * dx + (cy - ay) * dy) / L, 0, 1) : 0;
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
}

// True when the segment a-b passes through the rectangle centred on (cx, cy) with half sizes hx, hy (Liang-Barsky).
export function segHitsRect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, hx: number, hy: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const P = [-dx, dx, -dy, dy], Q = [ax - (cx - hx), (cx + hx) - ax, ay - (cy - hy), (cy + hy) - ay];
  for (let i = 0; i < 4; i++) {
    const p = P[i]!, q = Q[i]!;
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
    else {
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return t1 - t0 > 1e-4;
}

// True when segments a-b and c-d properly cross.
export function segCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx),
    d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
