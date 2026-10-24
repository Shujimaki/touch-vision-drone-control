import { DIRECTIONS, type Direction, type Telemetry } from "./protocol";
import type { Drone } from "./sample";

/** Moves each drone entity to its measured position. Returns the telemetry drone ids the map has no entity for. */
export function applyTelemetry(drones: Drone[], telemetry: Telemetry, staleMs: number): string[] {
  const unknown: string[] = [];
  for (const t of telemetry.drones) {
    const d = drones.find(e => e.id === t.id);
    if (!d) { unknown.push(t.id); continue; }
    const { x, y, z } = t, measured = x !== null && y !== null && z !== null;
    if (measured) { d.x = x; d.y = y; d.z = z; }
    d.stale = !measured || t.pos_age_ms === null || t.pos_age_ms > staleMs;
    if (!d.held) { d.tx = t.cmd.x; d.ty = t.cmd.y; }
    d.gliding = false;
    const ranges: Partial<Record<Direction, number>> = {};
    for (const k of DIRECTIONS) { const r = t.ranges[k]; if (r !== null) ranges[k] = r; }
    d.ranges = ranges;
    d.below = null;
  }
  return unknown;
}
