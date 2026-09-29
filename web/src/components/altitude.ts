// Altitude column: one bar per drone beside the hand camera, with the flight limits hatched outside.
import { clamp } from "../format";
import type { Pal } from "../theme";
import type { Course, Drone } from "../sample";
import { airborne } from "./map";

const FONT = 'font-family="Helvetica Neue,Helvetica,Arial,sans-serif"';

// rate: the climb (+) or descent (−) applied to held drones, m/s; shown as arrows on their bars
export function altitudeBars(drones: Drone[], c: Course, rate: number, TW: number, TH: number, K: Pal): string {
  const Z = c.z, top = 44, bot = TH - 44, h = bot - top, zy = (z: number) => bot - (z / Z.displayMax) * h;
  let s = `<defs><linearGradient id="heatT" gradientUnits="userSpaceOnUse" x1="0" y1="${bot}" x2="0" y2="${top}"><stop offset="0" stop-color="#F2453D"/><stop offset=".3" stop-color="#FF9A1F"/><stop offset=".6" stop-color="#F5D90A"/><stop offset="1" stop-color="#5FD068"/></linearGradient>
    <pattern id="hx" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="${K.caut}" stroke-opacity=".35" stroke-width="1.4"/></pattern></defs>`;
  const slot = (TW - 32) / 3, W = Math.max(14, Math.min(40, slot - 8));
  for (let i = 0; i <= 20; i++) {
    const v = i / 10, mj = i % 5 === 0;
    s += `<line x1="${mj ? 17 : 20}" y1="${zy(v)}" x2="24" y2="${zy(v)}" stroke="${mj ? K.grn : K.tx3}"/>`;
    if (mj) s += `<text x="15" y="${zy(v) + 3}" fill="${K.grn}" font-size="9" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  drones.forEach((d, i) => {
    const x = 28 + slot * i + (slot - W) / 2, held = d.held, col = held ? K.own : K.tx2, cz = clamp(d.z, 0, Z.displayMax);
    s += `<g opacity="${held ? 1 : .6}">`;
    s += `<rect x="${x}" y="${top}" width="${W}" height="${h}" fill="${K.tagBg}" stroke="${held ? K.own : K.line2}"/>`;
    s += `<rect x="${x + 1}" y="${top + 1}" width="${W - 2}" height="${zy(Z.max) - top - 1}" fill="url(#hx)"/><rect x="${x + 1}" y="${zy(Z.min)}" width="${W - 2}" height="${bot - zy(Z.min) - 1}" fill="url(#hx)"/>`;
    s += `<line x1="${x}" y1="${zy(Z.max)}" x2="${x + W}" y2="${zy(Z.max)}" stroke="${K.caut}" stroke-width="1.5"/><line x1="${x}" y1="${zy(Z.min)}" x2="${x + W}" y2="${zy(Z.min)}" stroke="${K.caut}" stroke-width="1.5"/>`;
    s += `<rect x="${x + W * 0.2}" y="${zy(cz)}" width="${W * 0.6}" height="${bot - zy(cz)}" fill="url(#heatT)" opacity=".9"/>`;
    s += `<path d="M${x - 2} ${zy(cz)}L${x + 6} ${zy(cz) - 6}H${x + W + 2}V${zy(cz) + 6}H${x + 6}Z" fill="${K.tagBg}" stroke="${col}" stroke-width="1.5"/>`;
    const r = held && airborne(d) ? rate : 0;
    if (r) { const cx = x + W / 2, dir = r > 0 ? -1 : 1; for (let k = 0; k < 2; k++) { const ay = zy(cz) + dir * (16 + k * 8); s += `<path d="M${cx - 6} ${ay - dir * 3}L${cx} ${ay + dir * 3}L${cx + 6} ${ay - dir * 3}" fill="none" stroke="${K.own}" stroke-width="2"/>`; } }
    s += `<text x="${x + W / 2}" y="${top - 24}" fill="${K.iconTx}" font-size="${Math.min(11, slot / 2.6).toFixed(1)}" text-anchor="middle">${d.z.toFixed(2)}</text>`;
    s += `<circle cx="${x + W / 2}" cy="${top - 10}" r="7" fill="${K.iconFill}" stroke="${d.z > 0.02 ? K.own : K.tx3}" stroke-width="1.5"/><text x="${x + W / 2}" y="${top - 6.5}" fill="${K.iconTx}" font-size="9" font-weight="700" text-anchor="middle" ${FONT}>${d.n}</text>`;
    s += `<text x="${x + W / 2}" y="${bot + 16}" fill="${held ? K.own : K.tx3}" font-size="9" text-anchor="middle" ${FONT}>${held ? (slot < 24 ? "H" : "Held") : ""}</text></g>`;
  });
  return s;
}
