// Left-panel components: the altitude-channel status line and the held-altitude list.
import { U } from "../format";
import type { Drone, Gesture } from "../sample";


export function gestureStatus(g: Gesture, held: Drone[], rate: number, confirmPct?: number): { main: string; sub: string; k: string } {
  const to = held.length ? held.map(d => U(d.id)).join(" + ") : "no drone held";

  if (g === "confirming") {
    return { main: "Hold the open palm steady", sub: confirmPct === undefined ? "Confirming" : `Confirming, ${confirmPct}%`, k: "idle" };
  }
  if (g === "lost") return { main: "Hand lost, holding altitude", sub: "Show an open palm to activate again", k: "warn" };
  if (g === "unrecognized") return { main: "Pose not recognised, holding", sub: "Open palm resumes, fist locks", k: "warn" };

  if (g === "climb" || g === "descend") {
    if (!held.length) return { main: "Hold a drone to use altitude", sub: "Gesture active", k: "idle" };
    return { main: Math.abs(rate) < 0.005 ? "Palm at neutral, holding" : `${rate > 0 ? "▲ Climbing" : "▼ Descending"} ${Math.abs(rate).toFixed(2)} m/s`, sub: to, k: "ok" };
  }
  if (g === "locked") return { main: "Altitude locked", sub: to, k: "lock" };
  return { main: "Show an open palm to start", sub: "", k: "idle" };
}

export const heldAltitude = (held: Drone[]): string =>
  `<span class="t">HELD ALTITUDE</span>` + (held.length
    ? held.map(d => `<div><span>${U(d.id)}</span><b class="m">${d.z.toFixed(2)} m</b></div>`).join("")
    : `<div class="none">No drone held</div>`);
