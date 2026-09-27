// Text formats shared by the map, panels and event log.
export const sg = (v: number, d = 2): string => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(d);

// Seconds as hh:mm:ss.
export const fmtT = (s: number): string => {
  s = Math.max(0, Math.floor(s));
  return [s / 3600, s % 3600 / 60, s % 60].map(n => String(Math.floor(n)).padStart(2, "0")).join(":");
};

// Seconds as mm:ss.
export const fmtMS = (s: number): string => {
  s = Math.max(0, Math.floor(s));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};

// Drone names: cf1 -> DRONE 1; anything else in capitals.
export const U = (s: string): string => /^cf\d$/i.test(s) ? `DRONE ${s.slice(2)}` : s.toUpperCase();
