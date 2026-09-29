// Colours for the drawn parts (map, altitude bars, camera and video). The page styles in styles.css match them.
export type Pal = Record<"bg" | "panel" | "line" | "line2" | "tx" | "tx2" | "tx3" | "grn" | "grnDim" | "friend" | "own" | "sel" | "selDim" | "caut" | "crit" | "critBg" | "tagBg" | "iconFill" | "iconTx" | "heldTx" | "grid0" | "gridMaj" | "gridMin" | "arena" | "boxFill" | "boxLine", string> & { threatA: [number, number, number] };

export const PAL: { dark: Pal; light: Pal } = {
  dark: { bg: "#0A0E0B", panel: "#181C18", line: "#2C342C", line2: "#3E483D", tx: "#E1E8DF", tx2: "#9DAA9B", tx3: "#687566", grn: "#5FD068", grnDim: "#1B2E1D", friend: "#5FD068", own: "#25C6E8", sel: "#F5D90A", selDim: "#D9C95A", caut: "#FF9A1F", crit: "#F2453D",
    critBg: "#1A0605", tagBg: "#0B100C", iconFill: "#121712", iconTx: "#FFFFFF", heldTx: "#07120A", grid0: "#101A12", gridMaj: "#1F3A24", gridMin: "#14231A", arena: "#3E8F46", boxFill: "#2B312B", boxLine: "#C9D1C7", threatA: [95, 208, 104] },
  light: { bg: "#F3F7FD", panel: "#FFFFFF", line: "#CCD8EA", line2: "#A9BCD9", tx: "#07132A", tx2: "#3C4E6B", tx3: "#7486A3", grn: "#0066FF", grnDim: "#E1ECFF", friend: "#0066FF", own: "#00A6C8", sel: "#E0147C", selDim: "#B0106A", caut: "#EA7300", crit: "#E5173F",
    critBg: "#FFECEF", tagBg: "#FFFFFF", iconFill: "#FFFFFF", iconTx: "#07132A", heldTx: "#FFFFFF", grid0: "#EDF3FC", gridMaj: "#A8C2EC", gridMin: "#DCE6F6", arena: "#0066FF", boxFill: "#DDE6F5", boxLine: "#1D2E4D", threatA: [0, 102, 255] },
};

// Proximity colour for a closeness t from 0 (clear) to 1 (at the defensive-hover distance): green, amber, red.
export function threatColor(K: Pal, t: number): string {
  const L = (a: number, b: number, k: number) => Math.round(a + (b - a) * k), A = K.threatA, B = [255, 154, 31], C = [242, 69, 61];
  const [p, q, k] = t < 0.5 ? [A, B, t / 0.5] : [B, C, (t - 0.5) / 0.5];
  return `rgb(${L(p[0]!, q[0]!, k)},${L(p[1]!, q[1]!, k)},${L(p[2]!, q[2]!, k)})`;
}
