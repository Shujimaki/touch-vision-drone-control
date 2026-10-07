// Map component: the room drawn to scale, the course, and one entity per drone. Returns SVG markup.
import { clamp } from "../format";
import { threatColor, type Pal } from "../theme";
import type { Course, Dir, Drone } from "../sample";

export interface View { SC: number; OX: number; OY: number; VW: number; VH: number }
export interface Readings { trig: number; show: number }   // defensive-hover and ring display distances, m

const FONT = 'font-family="Helvetica Neue,Helvetica,Arial,sans-serif"';
export const PROX_R = 40;   // ring radius in px: about 2.5 fingertip radii, so a finger on the drone leaves it visible

// Fit the room into a w x h px map body, leaving a small band at the bottom for the scale and the event ticker.
export function fitView(w: number, h: number, a: Course["arena"]): View {
  const VW = Math.max(300, w), VH = Math.max(300, h), padL = 16, padT = 16, padB = 26, availW = VW - padL - 10, availH = VH - padT - padB;
  const SC = Math.min(availW / (a.xMax - a.xMin), availH / (a.yMax - a.yMin));
  return { SC, VW, VH, OX: padL + availW / 2 - ((a.xMax + a.xMin) / 2) * SC, OY: padT + availH / 2 + ((a.yMax + a.yMin) / 2) * SC };
}
const px = (v: View, x: number) => v.OX + x * v.SC, py = (v: View, y: number) => v.OY - y * v.SC;
export const toCourse = (v: View, sx: number, sy: number): [number, number] => [(sx - v.OX) / v.SC, (v.OY - sy) / v.SC];

// Unit vector of a range sensor in the course frame, from the drone's heading.
export function dirVec(d: Drone, k: Dir): [number, number, number] {
  const y = d.yaw * Math.PI / 180, f = [Math.sin(y), Math.cos(y)] as const, r = [Math.cos(y), -Math.sin(y)] as const;
  return k === "front" ? [f[0], f[1], 0] : k === "back" ? [-f[0], -f[1], 0] : k === "right" ? [r[0], r[1], 0] : k === "left" ? [-r[0], -r[1], 0] : [0, 0, 1];
}
export const airborne = (d: Drone) => d.z > 0.08;
const near = (r: number | null | undefined, R: Readings) => r == null ? 0 : clamp((R.show - r) / (R.show - R.trig), 0, 1);

// Room, grid, obstacles, hoops and the restricted zone.
export function courseLayer(c: Course, v: View, K: Pal): string {
  const a = c.arena, X = (x: number) => px(v, x), Y = (y: number) => py(v, y), SC = v.SC;
  let g = `<rect x="0" y="0" width="${v.VW}" height="${v.VH}" fill="${K.bg}"/>`;
  const gx0 = Math.floor((0 - v.OX) / SC * 2) / 2, gx1 = Math.ceil((v.VW - v.OX) / SC * 2) / 2, gy0 = Math.floor((v.OY - v.VH) / SC * 2) / 2, gy1 = Math.ceil(v.OY / SC * 2) / 2;
  for (let u = gx0; u <= gx1; u += 0.5) g += `<line x1="${X(u)}" y1="0" x2="${X(u)}" y2="${v.VH}" stroke="${K.grid0}"/>`;
  for (let u = gy0; u <= gy1; u += 0.5) g += `<line x1="0" y1="${Y(u)}" x2="${v.VW}" y2="${Y(u)}" stroke="${K.grid0}"/>`;
  g += `<rect x="${X(a.xMin)}" y="${Y(a.yMax)}" width="${(a.xMax - a.xMin) * SC}" height="${(a.yMax - a.yMin) * SC}" fill="${K.bg}"/>`;
  for (let u = Math.ceil(a.xMin * 2) / 2; u <= a.xMax + 1e-6; u += 0.5) {
    const mj = Math.abs(u % 1) < 1e-6;
    g += `<line x1="${X(u)}" y1="${Y(a.yMax)}" x2="${X(u)}" y2="${Y(a.yMin)}" stroke="${mj ? K.gridMaj : K.gridMin}"/>`;
    if (mj) g += `<text x="${X(u)}" y="${Y(a.yMax) - 8}" fill="${K.grn}" fill-opacity=".75" font-size="10" text-anchor="middle">${u.toFixed(0)}</text>`;
  }
  for (let u = Math.ceil(a.yMin * 2) / 2; u <= a.yMax + 1e-6; u += 0.5) {
    const mj = Math.abs(u % 1) < 1e-6;
    g += `<line x1="${X(a.xMin)}" y1="${Y(u)}" x2="${X(a.xMax)}" y2="${Y(u)}" stroke="${mj ? K.gridMaj : K.gridMin}"/>`;
    if (mj) g += `<text x="${X(a.xMin) - 8}" y="${Y(u) + 3}" fill="${K.grn}" fill-opacity=".75" font-size="10" text-anchor="end">${u.toFixed(0)}</text>`;
  }
  const m = a.margin;
  g += `<rect x="${X(a.xMin)}" y="${Y(a.yMax)}" width="${(a.xMax - a.xMin) * SC}" height="${(a.yMax - a.yMin) * SC}" fill="none" stroke="${K.arena}" stroke-width="1.5"/>`;
  g += `<rect x="${X(a.xMin + m)}" y="${Y(a.yMax - m)}" width="${(a.xMax - a.xMin - 2 * m) * SC}" height="${(a.yMax - a.yMin - 2 * m) * SC}" fill="none" stroke="${K.caut}" stroke-opacity=".5" stroke-dasharray="6 5"/>`;
  g += `<defs><linearGradient id="altGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5FD068" stop-opacity=".9"/><stop offset="40%" stop-color="#F5D90A" stop-opacity=".82"/><stop offset="70%" stop-color="#FF9A1F" stop-opacity=".78"/><stop offset="100%" stop-color="#F2453D" stop-opacity=".75"/></linearGradient>
    <filter id="proxGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>
    <pattern id="nfzHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${K.crit}" stroke-opacity=".45" stroke-width="3"/></pattern>
    <pattern id="boxHatch" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L7 0" stroke="${K.boxLine}" stroke-opacity=".35" stroke-width="1.2"/></pattern></defs>`;
  for (const b of c.boxes) {
    const x = X(b.x - b.hx), y = Y(b.y + b.hy), W = 2 * b.hx * SC, H = 2 * b.hy * SC;
    if (b.stale) g += `<g opacity=".45">`;   // live mode, no fresh pose: drawn at its configured place
    g += `<rect x="${x + 4}" y="${y + 4}" width="${W}" height="${H}" fill="#000" opacity=".35"/>`;
    g += `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${K.boxFill}" stroke="${K.boxLine}" stroke-width="1.5"/><rect x="${x}" y="${y}" width="${W}" height="${H}" fill="url(#boxHatch)"/>`;
    g += `<text x="${X(b.x)}" y="${Y(b.y) - 2}" fill="${K.tx}" font-size="11" font-weight="700" text-anchor="middle" ${FONT}>${b.id}</text>`;
    g += `<text x="${X(b.x)}" y="${Y(b.y) + 11}" fill="${K.tx2}" font-size="9" text-anchor="middle">${b.h.toFixed(2)} m</text>`;
    if (b.stale) g += `</g>`;
  }
  for (const h of c.hoops) {
    const label = `${h.id}<tspan fill="${K.selDim}" font-weight="400" font-size="9" dx="4">${h.z.toFixed(2)} m</tspan>`;
    g += h.stale ? `<g opacity=".45">` : `<g>`;   // live mode, no fresh pose: drawn at its configured place
    if (h.horizontal) {
      const cx = X(h.x), cy = Y(h.y), r = h.r * SC;
      g += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${K.sel}" fill-opacity=".06" stroke="${K.sel}" stroke-width="3.5"/><circle cx="${cx}" cy="${cy}" r="2.5" fill="${K.sel}"/>`;
      g += `<text x="${cx}" y="${cy - r - 8}" fill="${K.sel}" font-size="11" font-weight="700" text-anchor="middle" ${FONT}>${label}</text></g>`;
      continue;
    }
    const an = h.ang * Math.PI / 180, ux = Math.cos(an), uy = Math.sin(an), x1 = X(h.x - ux * h.r), y1 = Y(h.y - uy * h.r), x2 = X(h.x + ux * h.r), y2 = Y(h.y + uy * h.r), cx = X(h.x), cy = Y(h.y), nx = -uy, ny = ux, L = 16;
    g += `<line x1="${cx - nx * L}" y1="${cy + ny * L}" x2="${cx + nx * L}" y2="${cy - ny * L}" stroke="${K.sel}" stroke-opacity=".5" stroke-dasharray="3 3"/>`;
    g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${K.sel}" stroke-width="4" stroke-linecap="round"/>`;
    g += `<circle cx="${x1}" cy="${y1}" r="4" fill="${K.tagBg}" stroke="${K.sel}" stroke-width="2"/><circle cx="${x2}" cy="${y2}" r="4" fill="${K.tagBg}" stroke="${K.sel}" stroke-width="2"/>`;
    g += `<text x="${cx + nx * 22}" y="${cy - ny * 22 + (ny > 0.5 ? 0 : 4)}" fill="${K.sel}" font-size="11" font-weight="700" text-anchor="${nx < -0.5 ? "end" : nx > 0.5 ? "start" : "middle"}" ${FONT}>${label}</text></g>`;
  }
  const z = c.zone, s0 = z.h * SC, B = z.margin;
  g += `<rect x="${X(z.x - z.h - B)}" y="${Y(z.y + z.h + B)}" width="${2 * (z.h + B) * SC}" height="${2 * (z.h + B) * SC}" fill="none" stroke="${K.tx}" stroke-opacity=".18" stroke-dasharray="2 4"/>`;
  g += `<rect x="${X(z.x) - s0}" y="${Y(z.y) - s0}" width="${2 * s0}" height="${2 * s0}" fill="${K.crit}" fill-opacity=".10"/>`;
  g += `<rect x="${X(z.x) - s0}" y="${Y(z.y) - s0}" width="${2 * s0}" height="${2 * s0}" fill="url(#nfzHatch)" stroke="${K.crit}" stroke-width="2.5"/>`;
  g += `<rect x="${X(z.x) - 52}" y="${Y(z.y) - 10}" width="104" height="20" fill="${K.critBg}" stroke="${K.crit}"/><text x="${X(z.x)}" y="${Y(z.y) + 4}" fill="${K.crit}" font-size="10.5" font-weight="700" text-anchor="middle" ${FONT}>RESTRICTED</text>`;
  return g;
}

// One drone entity: target line, proximity ring, above/below indicators, heading, icon and altitude bar.
export function droneEntity(d: Drone, c: Course, v: View, K: Pal, R: Readings): string {
  const X = px(v, d.x), Y = py(v, d.y), held = d.held, grounded = d.z <= 0.02;
  let g = "";
  if (Math.hypot(d.tx - d.x, d.ty - d.y) > 0.03) {
    const TX = px(v, d.tx), TY = py(v, d.ty), gid = `wisp-${d.id}`;
    g += `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${X}" y1="${Y}" x2="${TX}" y2="${TY}"><stop offset="0" stop-color="${K.own}" stop-opacity="0"/><stop offset=".45" stop-color="${K.own}" stop-opacity=".22"/><stop offset="1" stop-color="${K.own}" stop-opacity=".6"/></linearGradient>`;
    g += `<path d="M${X.toFixed(1)} ${Y.toFixed(1)}L${TX.toFixed(1)} ${TY.toFixed(1)}" fill="none" stroke="url(#${gid})" stroke-width="2.2" stroke-linecap="round"/>`;
    g += `<circle cx="${TX}" cy="${TY}" r="11" fill="${K.own}" fill-opacity=".07"/><circle cx="${TX}" cy="${TY}" r="6" fill="none" stroke="${K.own}" stroke-opacity=".55" stroke-width="1.2"/><circle cx="${TX}" cy="${TY}" r="1.8" fill="${K.own}" fill-opacity=".8"/>`;
  }
  if (d.blockPt) {   // a drag rejected at the restricted zone: the drone stops at the edge, a red trace points at the finger
    const BX = px(v, d.blockPt[0]), BY = py(v, d.blockPt[1]), gb = `blk-${d.id}`;
    g += `<linearGradient id="${gb}" gradientUnits="userSpaceOnUse" x1="${X}" y1="${Y}" x2="${BX}" y2="${BY}"><stop offset="0" stop-color="${K.crit}" stop-opacity=".6"/><stop offset="1" stop-color="${K.crit}" stop-opacity="0"/></linearGradient>`;
    g += `<path d="M${X} ${Y} L${BX} ${BY}" stroke="url(#${gb})" stroke-width="6" stroke-linecap="round" opacity=".5"/><circle cx="${X}" cy="${Y}" r="${PROX_R + 4}" fill="none" stroke="${K.crit}" stroke-opacity=".7" stroke-width="1.5"/>`;
    g += `<text x="${X}" y="${Y + PROX_R + 18}" fill="${K.crit}" font-size="10" font-weight="700" text-anchor="middle" ${FONT}>DRAG REJECTED: restricted zone</text>`;
  }
  g += `<g data-drone="${d.id}" style="cursor:pointer"${d.stale ? ' opacity=".35"' : ""}><circle cx="${X}" cy="${Y}" r="30" fill="transparent"/>`;
  if (airborne(d)) {
    // full ring; each side sensor colours the part facing it, fading around the circle, green -> amber -> red as it nears
    const N = 72, FALL = 55 * Math.PI / 180, pt = (a: number) => `${(X + PROX_R * Math.cos(a)).toFixed(1)} ${(Y + PROX_R * Math.sin(a)).toFixed(1)}`;
    const src = (["front", "right", "back", "left"] as Dir[]).map(k => { const u = dirVec(d, k); return { a: Math.atan2(-u[1], u[0]), t: near(d.ranges[k], R) }; }).filter(o => o.t > 0);
    let ring = "", glow = "";
    for (let i = 0; i < N; i++) {
      const a0 = i / N * 2 * Math.PI, a1 = (i + 1) / N * 2 * Math.PI + 0.004, am = (a0 + a1) / 2;
      let t = 0;
      for (const o of src) { const da = Math.abs(((am - o.a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (da < FALL) t = Math.max(t, o.t * Math.cos(da / FALL * Math.PI / 2)); }
      const col = threatColor(K, t), seg = `M${pt(a0)}A${PROX_R} ${PROX_R} 0 0 1 ${pt(a1)}`;
      ring += `<path d="${seg}" stroke="${col}" stroke-opacity="${(0.55 + 0.45 * t).toFixed(2)}" stroke-width="${(2.5 + 3 * t).toFixed(1)}"/>`;
      if (t > 0.05) glow += `<path d="${seg}" stroke="${col}" stroke-opacity="${(0.25 + 0.6 * t).toFixed(2)}" stroke-width="${(6 + 14 * t).toFixed(1)}"/>`;
    }
    if (glow) g += `<g fill="none" filter="url(#proxGlow)">${glow}</g>`;
    g += `<g fill="none">${ring}</g>`;
    // above (up sensor) and below (motion capture + course) indicators, in a cluster above the drone
    const xa = X + 7, yc = Y - PROX_R - 20;
    for (const [r, dir] of [[d.ranges.up, -1], [d.below?.dist, 1]] as [number | null | undefined, number][]) {
      const t = near(r, R), col = t > 0 ? threatColor(K, t) : K.line2, y0 = yc + dir * 5;
      g += `<path d="M${xa - 4.5} ${y0}L${xa} ${y0 + dir * 6}L${xa + 4.5} ${y0}Z" fill="${col}" fill-opacity="${t > 0 ? 1 : .8}"/>`;
      if (t > 0 && r != null) g += `<text x="${xa + 8}" y="${y0 + dir * 5 + 3}" fill="${col}" font-size="9.5" font-weight="700">${r.toFixed(2)}</text>`;
    }
  }
  const hr = (d.yaw - 90) * Math.PI / 180;
  g += `<line x1="${X + 17 * Math.cos(hr)}" y1="${Y + 17 * Math.sin(hr)}" x2="${X + 21 * Math.cos(hr)}" y2="${Y + 21 * Math.sin(hr)}" stroke="${K.own}" stroke-width="2.5"/>`;
  g += `<circle cx="${X}" cy="${Y}" r="15" fill="${held ? K.own : K.iconFill}" stroke="${grounded ? K.tx3 : held ? K.iconTx : K.own}" stroke-width="2.5" ${grounded ? 'stroke-dasharray="4 3"' : ""}/>`;
  g += `<text x="${X}" y="${Y + 5}" fill="${held ? K.heldTx : K.iconTx}" font-size="14" font-weight="700" text-anchor="middle" ${FONT}>${d.n}</text>`;
  // altitude bar above the drone, clear of a fingertip
  const Z = c.z, bh = 28, bw = 5, bx = X - 11, by = Y - PROX_R - 34, f = clamp(d.z / Z.displayMax, 0, 1), ly = by + bh * (1 - f), zy = (z: number) => by + bh * (1 - z / Z.displayMax), cid = `ac-${d.id}`;
  g += `<clipPath id="${cid}"><rect x="${bx}" y="${ly}" width="${bw}" height="${by + bh - ly}"/></clipPath>`;
  g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="2.5" fill="${K.iconTx}" fill-opacity=".07" stroke="${K.iconTx}" stroke-opacity=".22" stroke-width=".8"/>`;
  g += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="2.5" fill="url(#altGlass)" clip-path="url(#${cid})"/>`;
  g += `<path d="M${bx - 2} ${zy(Z.max)}H${bx + bw + 2}M${bx - 2} ${zy(Z.min)}H${bx + bw + 2}" stroke="${K.caut}" stroke-opacity=".7" stroke-width="1"/>`;
  g += `<circle cx="${bx + bw / 2}" cy="${ly}" r="6" fill="${K.iconTx}" fill-opacity=".12"/><circle cx="${bx + bw / 2}" cy="${ly}" r="3" fill="${K.iconTx}" fill-opacity=".95"/>`;
  g += `<text x="${X}" y="${Y - PROX_R - 39}" fill="${K.tx2}" font-size="10" text-anchor="middle">${d.z.toFixed(2)} m</text></g>`;
  return g;
}

export const TRAIL_MS = 700;   // a trail point fades out over this long

// Short fading trail behind a drone that is moving on screen.
export function trailLayer(drones: Drone[], v: View, K: Pal, now: number): string {
  let g = "";
  for (const d of drones) {
    const T = d.trail ?? [];
    for (let i = 1; i < T.length; i++) {
      const age = now - T[i]![2];
      if (age > TRAIL_MS) continue;
      const a = 1 - age / TRAIL_MS, [x0, y0] = T[i - 1]!, [x1, y1] = T[i]!;
      g += `<line x1="${px(v, x0).toFixed(1)}" y1="${py(v, y0).toFixed(1)}" x2="${px(v, x1).toFixed(1)}" y2="${py(v, y1).toFixed(1)}" stroke="${K.grn}" stroke-width="${(0.8 + 2.6 * a).toFixed(2)}" stroke-opacity="${(0.75 * a * a).toFixed(3)}" stroke-linecap="round"/>`;
    }
  }
  return g;
}

export const droneLayer = (drones: Drone[], c: Course, v: View, K: Pal, R: Readings, now = 0): string =>
  trailLayer(drones, v, K, now) + drones.map(d => droneEntity(d, c, v, K, R)).join("");
