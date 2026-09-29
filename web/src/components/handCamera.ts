// Hand-camera panel: a sample frame showing the altitude gesture (hand skeleton, neutral line and climb arrow).
// With the camera preview on, the live video shows instead and this drawing is hidden.
import type { Pal } from "../theme";
import type { Gesture } from "../sample";

const FONT = 'font-family="Helvetica Neue,Helvetica,Arial,sans-serif"';
const PALM = [[100, 130], [80, 120], [66, 105], [56, 92], [48, 80], [85, 90], [82, 68], [80, 54], [79, 42], [100, 88], [100, 63], [100, 48], [100, 35], [114, 90], [117, 67], [119, 53], [120, 42], [126, 96], [133, 79], [137, 68], [140, 58]] as const;
const FIST = [[100, 130], [80, 120], [74, 108], [82, 100], [92, 98], [85, 90], [84, 76], [90, 82], [92, 92], [100, 88], [100, 74], [104, 82], [104, 92], [114, 90], [114, 76], [116, 84], [114, 93], [126, 96], [128, 84], [128, 92], [124, 98]] as const;
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]] as const;
const HX = 40, HY = 50, OFF = 24, DEAD = 0.03, NEUT = 130 - 5 + HY;   // neutral = wrist height

export function handFrame(g: Gesture, K: Pal): string {
  const act = g === "climb" || g === "descend", dy = g === "climb" ? -OFF : g === "descend" ? OFF : 0;
  let s = `<rect width="320" height="240" fill="#000"/><text x="160" y="22" fill="#687566" font-size="10" font-weight="700" text-anchor="middle" letter-spacing=".08em">SAMPLE HAND FRAME</text>`;
  if (act) {
    const dz = DEAD * 240, cy = NEUT + dy;
    s += `<rect x="0" y="${NEUT - dz}" width="320" height="${2 * dz}" fill="#fff" fill-opacity=".08"/><line x1="0" y1="${NEUT}" x2="320" y2="${NEUT}" stroke="#FFFFFF" stroke-opacity=".75" stroke-dasharray="4 4"/><text x="276" y="${NEUT - dz - 4}" fill="#fff" font-size="9" text-anchor="end">neutral</text>`;
    s += `<line x1="52" y1="${NEUT}" x2="52" y2="${cy}" stroke="${K.own}" stroke-width="2.5"/><path d="M46 ${cy + (dy < 0 ? 6 : -6)}L52 ${cy}L58 ${cy + (dy < 0 ? 6 : -6)}" fill="none" stroke="${K.own}" stroke-width="2.5"/>`;
  }
  const shape = g === "locked" ? FIST : PALM, pts = shape.map(([x, y]) => [x + HX, y - 5 + HY + (act ? dy : 0)] as const);
  s += `<g stroke="${K.own}" stroke-width="1.5" stroke-linecap="round">${BONES.map(([a, b]) => `<line x1="${pts[a]![0]}" y1="${pts[a]![1]}" x2="${pts[b]![0]}" y2="${pts[b]![1]}"/>`).join("")}</g>`;
  pts.forEach(([x, y], i) => { s += `<circle cx="${x}" cy="${y}" r="${i === 9 ? 3 : 2.2}" fill="${K.friend}"/>`; });
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs) - 8, y0 = Math.min(...ys) - 8, x1 = Math.max(...xs) + 8, y1 = Math.max(...ys) + 8;
  const lbl = g === "locked" ? "Closed Fist" : "Open Palm", w = lbl.length * 6.3 + 12;
  s += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${K.sel}" stroke-width="2"/>`;
  s += `<rect x="${(x0 + x1) / 2 - w / 2}" y="${y0 - 24}" width="${w}" height="18" fill="#111"/><text x="${(x0 + x1) / 2}" y="${y0 - 11}" fill="${K.sel}" font-size="11" text-anchor="middle" ${FONT}>${lbl}</text>`;
  return s;
}
