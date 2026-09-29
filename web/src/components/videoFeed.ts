// Video feed tile: a drawn stand-in for the drone's forward camera (no onboard camera exists yet), with its
// header (drone and flight state) and footer (link and battery).
import { U, batteryLevel } from "../format";
import type { Pal } from "../theme";
import type { Drone } from "../sample";

export const feedTile = (d: Drone): string => `<div class="dfeed" data-f="${d.id}" role="img" aria-label="${U(d.id)} video">
    <span class="fh"><span class="num">${d.n}</span>${U(d.id)}<span class="st" id="fst-${d.id}">--</span></span>
    <svg id="fv-${d.id}" viewBox="0 0 240 190" preserveAspectRatio="xMidYMid meet" style="overflow:hidden"></svg>
    <span class="fstat"><span class="lnk">LINK OK</span>
      <span class="bat" id="fbat-${d.id}" title="Battery"><i></i></span><span class="m" id="fbatv-${d.id}">--</span></span></div>`;

// Grounded, moving (heading for a target or climbing while held) or hovering, with its colour key
export function flightState(d: Drone, rate: number): [string, "" | "ok" | "own"] {
  if (d.z <= 0.02) return ["Grounded", ""];
  const moving = Math.hypot(d.tx - d.x, d.ty - d.y) > 0.03 || (d.held && rate !== 0);
  return moving ? ["Moving", "own"] : ["Hovering", "ok"];
}

// The scene: wall and floor grid in perspective, which shift with the drone's position and heading.
export function feedScene(d: Drone, box: { w: number; h: number }, K: Pal): { viewBox: string; svg: string } {
  const W = 240, H = 190, cx = W / 2, z = Math.max(0.06, d.z), yr = d.yaw * Math.PI / 180, F = 150, hy = H / 2;
  const lat = d.x * Math.cos(yr) - d.y * Math.sin(yr), fwd = d.x * Math.sin(yr) + d.y * Math.cos(yr);
  let s = `<rect x="-900" y="-900" width="2040" height="${hy + 900}" fill="#3A3D3A"/><rect x="-900" y="${hy}" width="2040" height="1200" fill="#262826"/>`;
  const yo = ((d.yaw % 30) + 30) % 30;
  for (let k = -22; k < 34; k++) { const wx = k * 40 - yo * 40 / 30; s += `<line x1="${wx}" y1="${hy - 70}" x2="${wx}" y2="${hy}" stroke="#4A4E4A" stroke-width="1"/>`; }
  s += `<rect x="-900" y="${hy - 74}" width="2040" height="4" fill="#2E312E"/>`;
  const lo = ((lat % 0.5) + 0.5) % 0.5;
  for (let k = -24; k <= 24; k++) { const bx = cx + (k * 0.5 - lo) * F / z * 0.8; s += `<line x1="${cx + (bx - cx) * 0.02}" y1="${hy}" x2="${cx + (bx - cx) * 3}" y2="${hy + 3 * F * 0.35}" stroke="#555A55" stroke-width=".8"/>`; }
  const fo = ((fwd % 0.5) + 0.5) % 0.5;
  for (let n = 1; n < 14; n++) { const y = hy + F * z / (n * 0.5 - fo + 0.25) * 0.9; if (y <= H + 40) s += `<line x1="-900" y1="${y}" x2="1140" y2="${y}" stroke="#555A55" stroke-width=".8"/>`; }
  s += `<g stroke="#E1E8DF" stroke-width="1.2" fill="none" opacity=".85"><path d="M${cx - 18} ${H / 2}H${cx - 6}M${cx + 6} ${H / 2}H${cx + 18}M${cx} ${H / 2 - 12}V${H / 2 - 4}M${cx} ${H / 2 + 4}V${H / 2 + 12}"/></g>`;
  s += `<g stroke="${K.grn}" stroke-width="1.4" fill="none"><path d="M${cx - 60} ${H / 2}H${cx - 30}M${cx + 30} ${H / 2}H${cx + 60}"/></g>`;
  // widen or heighten the view so the scene fills the tile without letterboxing
  const ar = box.w / box.h;
  const viewBox = ar > W / H ? `${(W - H * ar) / 2} 0 ${H * ar} ${H}` : `0 ${(H - W / ar) / 2} ${W} ${W / ar}`;
  return { viewBox, svg: s };
}

export const batteryClass = (v: number): string => v < 3.0 ? "crit" : v < 3.2 ? "warn" : "";
export const batteryWidth = (v: number, full: number): number => Math.max(1, batteryLevel(v) / 90 * full);
