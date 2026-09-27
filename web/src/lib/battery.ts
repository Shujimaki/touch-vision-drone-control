// Crazyflie battery values, as in crazyflie-firmware 2026.08 (DEC-21): pm.batteryLevel is 10 x the step reached on
// LiPoTypicalChargeCurve (0 to 90 %); pm.state goes to lowPower below pm.lowVoltage 3.2 V for 5 s; pm.criticalLowVoltage
// is 3.0 V; health.batterySag passes at 0.70 V or less.
export const LIPO = [3.00, 3.78, 3.83, 3.87, 3.89, 3.92, 3.96, 4.00, 4.04, 4.10] as const;
export const BAT_LOW = 3.2, BAT_CRIT = 3.0, BAT_LOW_S = 5, SAG_MAX = 0.70;

export function batteryLevel(v: number): number {
  if (v < LIPO[0]) return 0;
  if (v > LIPO[9]) return 90;
  let c = 0;
  while (v > LIPO[c]) c++;
  return c * 10;
}
