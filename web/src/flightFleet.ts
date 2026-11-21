import type { DroneTelemetry, HostConfig, Telemetry } from "./protocol";
import type { FramePoint } from "./takeoffView";

export type DronePick = { kind: "one"; id: string } | { kind: "all" };
export interface FleetDrone { id: string; pad: FramePoint | null; tel: DroneTelemetry | null }

export function fleet(config: HostConfig, t: Telemetry | null): FleetDrone[] {
  return config.drones.map(id => {
    const pad = config.course.pads.find(p => p.id === id);
    return { id, pad: pad ? { x: pad.x, y: pad.y } : null, tel: t?.drones.find(d => d.id === id) ?? null };
  });
}

export function dronePoint(d: FleetDrone): FramePoint | null {
  if (d.tel === null) return d.pad;
  if (d.tel.x === null || d.tel.y === null) return null;
  return { x: d.tel.x, y: d.tel.y };
}

export function firstPick(config: HostConfig): DronePick {
  const first = config.drones[0];
  return first === undefined ? { kind: "all" } : { kind: "one", id: first };
}

export const isPicked = (p: DronePick, id: string): boolean => p.kind === "all" || p.id === id;

export function commandTargets(p: DronePick, drones: readonly FleetDrone[]): string[] {
  if (p.kind === "all") return drones.map(d => d.id);
  return drones.some(d => d.id === p.id) ? [p.id] : [];
}

export const dragTarget = (p: DronePick, drones: readonly FleetDrone[]): FleetDrone | null =>
  p.kind === "all" ? null : drones.find(d => d.id === p.id) ?? null;
