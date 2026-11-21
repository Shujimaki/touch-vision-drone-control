import type { DroneTelemetry, HostConfig, Telemetry } from "./protocol";
import type { FramePoint } from "./takeoffView";

export type DronePick = { kind: "one"; id: string } | { kind: "all" };
export interface SwarmDrone { id: string; pad: FramePoint | null; tel: DroneTelemetry | null }

export function swarm(config: HostConfig, t: Telemetry | null): SwarmDrone[] {
  return config.drones.map(id => {
    const pad = config.course.pads.find(p => p.id === id);
    return { id, pad: pad ? { x: pad.x, y: pad.y } : null, tel: t?.drones.find(d => d.id === id) ?? null };
  });
}

export function dronePoint(d: SwarmDrone): FramePoint | null {
  if (d.tel === null) return d.pad;
  if (d.tel.x === null || d.tel.y === null) return null;
  return { x: d.tel.x, y: d.tel.y };
}

export function firstPick(config: HostConfig): DronePick {
  const first = config.drones[0];
  return first === undefined ? { kind: "all" } : { kind: "one", id: first };
}

export function pickAfterWelcome(previous: DronePick | null, config: HostConfig): DronePick {
  if (previous === null) return firstPick(config);
  const stillValid = previous.kind === "all" ? config.drones.length > 0 : config.drones.includes(previous.id);
  return stillValid ? previous : firstPick(config);
}

export const isPicked = (p: DronePick, id: string): boolean => p.kind === "all" || p.id === id;

export function commandTargets(p: DronePick, drones: readonly SwarmDrone[]): string[] {
  if (p.kind === "all") return drones.map(d => d.id);
  return drones.some(d => d.id === p.id) ? [p.id] : [];
}
