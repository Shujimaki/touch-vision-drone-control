import type { Rect } from "./protocol";

export interface TakeoffView { box: Rect; scale: number; left: number; top: number }
export interface ScreenPoint { px: number; py: number }
export interface FramePoint { x: number; y: number }

export function takeoffView(width: number, height: number, box: Rect): TakeoffView {
  const across = box.y_max - box.y_min, along = box.x_max - box.x_min;
  const scale = Math.min(width / across, height / along);
  return { box, scale, left: (width - across * scale) / 2, top: (height - along * scale) / 2 };
}

export function toScreen(v: TakeoffView, p: FramePoint): ScreenPoint {
  const rightOfLeftEdge = v.box.y_max - p.y, belowTopEdge = v.box.x_max - p.x;
  return { px: v.left + rightOfLeftEdge * v.scale, py: v.top + belowTopEdge * v.scale };
}

export function toTakeoff(v: TakeoffView, s: ScreenPoint): FramePoint {
  const belowTopEdge = (s.py - v.top) / v.scale, rightOfLeftEdge = (s.px - v.left) / v.scale;
  return { x: v.box.x_max - belowTopEdge, y: v.box.y_max - rightOfLeftEdge };
}

export const inBox = (box: Rect, p: FramePoint): boolean =>
  p.x >= box.x_min && p.x <= box.x_max && p.y >= box.y_min && p.y <= box.y_max;

export interface Placed { id: string; at: FramePoint | null }

export function nearestWithin(v: TakeoffView, finger: ScreenPoint, items: readonly Placed[], radiusPx: number): string | null {
  let best: string | null = null, bestPx = Infinity;
  for (const { id, at } of items) {
    if (at === null) continue;
    const s = toScreen(v, at), px = Math.hypot(s.px - finger.px, s.py - finger.py);
    if (px <= radiusPx && px < bestPx) { best = id; bestPx = px; }
  }
  return best;
}
