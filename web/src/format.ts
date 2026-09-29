// Small shared helpers for text and numbers.
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const sg = (v: number, d = 2): string => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);
export const fmtT = (s: number): string => {
  s = Math.max(0, Math.floor(s));
  return [s / 3600, s % 3600 / 60, s % 60].map(n => String(Math.floor(n)).padStart(2, "0")).join(":");
};
export const fmtMS = (s: number): string => {
  s = Math.max(0, Math.floor(s));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};
export const U = (id: string): string => /^cf\d$/i.test(id) ? `DRONE ${id.slice(2)}` : id.toUpperCase();

// Crazyflie pm.batteryLevel: 10 x the step reached on the firmware's LiPo charge curve (0 to 90 %).
const LIPO = [3.00, 3.78, 3.83, 3.87, 3.89, 3.92, 3.96, 4.00, 4.04, 4.10];
export function batteryLevel(v: number): number {
  if (v < LIPO[0]!) return 0;
  if (v > LIPO[9]!) return 90;
  let c = 0;
  while (v > LIPO[c]!) c++;
  return c * 10;
}
