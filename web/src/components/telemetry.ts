// Telemetry tab components: drones table, altitude-channel card, trial card, health table and the event log.
import { U, batteryLevel, fmtMS, fmtT, sg } from "../format";
import type { Dir, Drone, Gesture, LogEntry, TrialRecord } from "../sample";
import { airborne } from "./map";

// the range columns, in the same order as their headers
export const RANGE_COLS: Dir[] = ["front", "back", "left", "right", "up"];

function rangeCell(d: Drone, k: Dir, trig: number, show: number): string {
  if (!airborne(d) || !(k in d.ranges)) return `<td class="dim">--</td>`;
  const r = d.ranges[k];
  if (r == null) return `<td class="dim">&gt;4 m</td>`;
  return `<td class="${r < trig ? "crit" : r < show ? "warn" : ""}">${r.toFixed(2)}</td>`;
}

export function dronesTable(drones: Drone[], trig: number, show: number): string {
  let h = `<thead><tr><th rowspan="2">Drone</th><th rowspan="2">state</th><th rowspan="2">defensive_hover</th><th colspan="2" class="grp">Radio</th><th colspan="2" class="grp">Battery</th><th colspan="4" class="grp">Pose, motion capture (m, °)</th><th colspan="3" class="grp">cmd (m)</th><th colspan="5" class="grp">ranges, Multi-ranger (m)</th><th rowspan="2">Below (m)<br><span style="font-weight:400">computed</span></th><th rowspan="2">held</th></tr>
    <tr><th>link</th><th>quality</th><th>pm.vbat</th><th>level</th><th>x</th><th>y</th><th>z</th><th>yaw</th><th>x</th><th>y</th><th>z</th>${RANGE_COLS.map(k => `<th>${k}</th>`).join("")}</tr></thead><tbody>`;
  for (const d of drones) {
    const st = d.z > 0.02 ? "flying" : "grounded";
    h += `<tr><td><b>${U(d.id)}</b></td><td class="${st === "flying" ? "ok" : "dim"}">${st}</td><td class="dim">null</td>
      <td class="ok">ok</td><td class="${d.link < 70 ? "warn" : ""}">${d.link}%</td>
      <td class="${d.vbat < 3.2 ? "warn" : ""}">${d.vbat.toFixed(2)} V</td><td>${batteryLevel(d.vbat)}%</td>
      <td>${d.x.toFixed(2)}</td><td>${d.y.toFixed(2)}</td><td>${d.z.toFixed(2)}</td><td>${Math.round(((d.yaw + 180) % 360 + 360) % 360 - 180)}</td>
      <td>${d.tx.toFixed(2)}</td><td>${d.ty.toFixed(2)}</td><td>${d.z.toFixed(2)}</td>${RANGE_COLS.map(k => rangeCell(d, k, trig, show)).join("")}${d.below && airborne(d) ? `<td class="${d.below.dist < trig ? "crit" : d.below.dist < show ? "warn" : ""}">${d.below.dist.toFixed(2)} <span class="dim">${d.below.what}</span></td>` : `<td class="dim">--</td>`}<td class="${d.held ? "own" : "dim"}">${d.held}</td></tr>`;
  }
  return h + "</tbody>";
}

const GESTURE_NAME: Record<Gesture, string> = { idle: "Idle", confirming: "Confirming", climb: "Active", descend: "Active", locked: "Locked", lost: "Hand lost", unrecognized: "Unrecognised pose" };
export const altitudeCard = (g: Gesture, requested: number, applied: number, z: { min: number; max: number }, rateMax: number): string =>
  `<dt>Gesture state</dt><dd>${GESTURE_NAME[g]}</dd><dt>Source</dt><dd>Hand camera</dd>
   <dt>Requested rate</dt><dd>${sg(requested)} m/s</dd><dt>Applied rate</dt><dd>${sg(applied)} m/s</dd>
   <dt>Paused by</dt><dd>--</dd><dt>Limits</dt><dd>${z.min.toFixed(2)}–${z.max.toFixed(2)} m, max ${rateMax.toFixed(2)} m/s</dd>`;

export const trialCard = (t: { id: string; running: boolean; dh: number; restrict: number }, elapsed: number, limit: number): string =>
  `<dt>Trial</dt><dd>${t.id}</dd><dt>Restricted zone</dt><dd>Blocking drags</dd>
   <dt>Status</dt><dd class="${t.running ? "ok" : ""}">${t.running ? "Running" : "Not started"}</dd>
   <dt>Elapsed</dt><dd>${fmtMS(elapsed)} / ${fmtMS(limit)}</dd>
   <dt>Defensive hovers</dt><dd>${t.dh}</dd><dt>Drag restrictions</dt><dd>${t.restrict}</dd><dt>Layout</dt><dd>Figure 5</dd>`;

export function healthTable(drones: Drone[]): string {
  let h = `<thead><tr><th>Drone</th><th>Status</th><th>pm.state</th><th>sys.canfly</th><th>sys.isTumbled</th><th>health.motorPass</th><th>health.batterySag</th><th>Last check</th></tr></thead><tbody>`;
  for (const d of drones) {
    const hl = d.health, pass = hl.sag <= 0.70 && hl.motorPass.every(Boolean);
    h += `<tr><td><b>${U(d.id)}</b></td><td class="${pass ? "ok" : "crit"}">${pass ? "Passed" : "Failed"}</td><td>battery</td><td>true</td><td>false</td>
      <td>${hl.motorPass.map((p, i) => `<span class="${p ? "ok" : "crit"}">M${i + 1}</span>`).join(" ")}</td>
      <td class="${hl.sag <= 0.70 ? "" : "crit"}">${hl.sag.toFixed(2)} V ${hl.sag <= 0.70 ? "pass" : "fail"}</td><td>T+${fmtT(hl.at)}</td></tr>`;
  }
  return h + "</tbody>";
}

export interface LogFilter { session: string; trial: string }   // "all" or an ID
export interface LogView { events: LogEntry[]; count: string; summary: string | null; rows: string; trialOptions: TrialRecord[] }

// The event log filtered by participant session, then by one of that session's trials.
export function logView(log: LogEntry[], trials: TrialRecord[], sessions: string[], f: LogFilter, now: number, limit: number): LogView {
  const OUT: Record<string, string> = { completed: "Completed", hardware_abort: "Voided, hardware fault", collision: "Failed, collision", timeout: "Failed, time limit" };
  const trialOptions = trials.filter(t => t.session === f.session);
  const tr = trialOptions.find(t => t.id === f.trial), ses = !tr && sessions.includes(f.session) ? f.session : null;
  const events = tr ? log.filter(e => e.tr === tr.id) : ses ? log.filter(e => e.ses === ses) : log;
  let summary: string | null = null;
  if (tr) summary = `<dt>Trial</dt><dd>${tr.id}</dd><dt>Outcome</dt><dd>${tr.outcome ? OUT[tr.outcome] : "Running"}</dd><dt>Started</dt><dd>T+${fmtT(tr.t0)}</dd><dt>Ended</dt><dd>${tr.t1 != null ? "T+" + fmtT(tr.t1) : "running"}</dd>
      <dt>Time</dt><dd>${fmtMS((tr.t1 ?? now) - tr.t0)} / ${fmtMS(limit)}</dd><dt>Defensive hovers</dt><dd>${tr.dh}</dd><dt>Drag restrictions</dt><dd>${tr.restrict}</dd><dt>Events</dt><dd>${events.length}</dd>`;
  else if (ses) {
    const T = trials.filter(t => t.session === ses);
    summary = `<dt>Participant session</dt><dd>${ses}</dd><dt>Trials</dt><dd>${T.length}</dd><dt>Started</dt><dd>${events.length ? "T+" + fmtT(events[0]!.t) : "--"}</dd><dt>Last event</dt><dd>${events.length ? "T+" + fmtT(events[events.length - 1]!.t) : "--"}</dd>
      <dt>Completed</dt><dd class="ok">${T.filter(t => t.outcome === "completed").length}</dd><dt>Failed</dt><dd>${T.filter(t => t.outcome === "collision" || t.outcome === "timeout").length}</dd><dt>Events</dt><dd>${events.length}</dd>`;
  }
  let rows = `<li class="lh"><span>Time</span><span>${tr ? "In trial" : "ID"}</span><span></span><span>Event</span></li>`, prev = "";
  [...events].reverse().forEach((e, i) => {
    const k = e.tr || e.ses;
    if (!tr && (i === 0 || k !== prev)) {
      const t = e.tr ? trials.find(x => x.id === e.tr) : undefined;
      rows += `<li class="ldiv" role="separator"><span>${e.tr ? `${e.tr} · ${t?.outcome ? OUT[t.outcome] : "running"}` : `${e.ses} · between trials`}</span></li>`;
    }
    prev = k;
    rows += `<li><span class="t">T+${fmtT(e.t)}</span><span class="m">${tr ? fmtMS(Math.max(0, e.t - tr.t0)) : k}</span><span class="dot" data-k="${e.k}"></span><span>${e.text}</span></li>`;
  });
  const count = tr || ses ? `${events.length} of ${log.length} events` : `${log.length} events`;
  return { events, count, summary, rows, trialOptions };
}
