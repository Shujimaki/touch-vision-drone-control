// Mockup of the tablet interface. Components draw the fixed sample data into index.html, and the UI responds to the
// operator: drag drones on the map, pick the video, switch tabs and theme, filter the log. This file keeps only what
// the operator changes on screen. Nothing is simulated (no flight, sensors, gestures or trials) and no messages are sent.
import "./styles.css";
import { COURSE, SAMPLE, sampleDrones, sampleLog, type TrialRecord } from "./sample";
import { PAL, type Pal } from "./theme";
import { U, batteryLevel, clamp, fmtMS, sg } from "./format";
import { TRAIL_MS, airborne, courseLayer, droneLayer, fitView, toCourse, type View } from "./components/map";
import { altitudeBars } from "./components/altitude";
import { handFrame } from "./components/handCamera";
import { batteryClass, batteryWidth, feedScene, feedTile, flightState } from "./components/videoFeed";
import { altitudeCard, dronesTable, healthTable, logView, trialCard } from "./components/telemetry";
import { gestureStatus, heldAltitude } from "./components/panel";
import { dragTarget } from "./zone";
import { glideStep } from "./glide";

export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html has no element #${id}`);
  return el as T;
};

// ---------- on-screen state ----------
const ui = {
  drones: sampleDrones(),
  holdOrder: ["cf1"],          // most recently touched last; the video follows the last one still held
  video: "cf1",
  tab: "map" as "map" | "tel",
  light: false,
  lefty: false,
  stopped: false,              // E-STOP pressed: only the control changes, nothing is flown
  camera: null as MediaStream | null,
  logSes: "all",
  logTrial: "all",
  settings: { zmin: 0.50, zmax: 1.44, rate: 0.20, dhtrig: 0.15, tlim: 300 },
  restrict: SAMPLE.trial.restrict,   // drags rejected at the restricted zone, shown in the Trial card
};
const log = sampleLog();
const trials: TrialRecord[] = [{ id: SAMPLE.trial.id, session: SAMPLE.trial.session, t0: SAMPLE.trial.t0, t1: null, outcome: null, dh: 0, restrict: 0 }];
let K: Pal = PAL.dark, view: View = fitView(600, 600, COURSE.arena);
const course = () => ({ ...COURSE, z: { ...COURSE.z, min: ui.settings.zmin, max: ui.settings.zmax } });
const readings = () => ({ trig: ui.settings.dhtrig, show: 0.60 });
const drone = (id: string) => ui.drones.find(d => d.id === id)!;
const heldDrones = () => ui.drones.filter(d => d.held);

// ---------- rendering ----------
const mapSvg = byId("mapSvg") as unknown as SVGSVGElement;

function renderCourse(): void {
  const r = byId("mapbody").getBoundingClientRect();
  view = fitView(r.width, r.height, COURSE.arena);
  mapSvg.setAttribute("viewBox", `0 0 ${view.VW} ${view.VH}`);
  byId("scaleBar").style.width = view.SC.toFixed(0) + "px";
  byId("mapStatic").innerHTML = courseLayer(course(), view, K);
}
const renderDrones = () => { byId("mapDyn").innerHTML = droneLayer(ui.drones, course(), view, K, readings(), performance.now()); };

function renderTapes(): void {
  const svg = byId("tapeSvg"), r = svg.getBoundingClientRect(), TW = Math.max(60, r.width), TH = Math.max(200, r.height);
  svg.setAttribute("viewBox", `0 0 ${TW} ${TH}`);
  svg.innerHTML = altitudeBars(ui.drones, course(), SAMPLE.appliedRate, TW, TH, K);
}

function renderFeeds(): void {
  for (const d of ui.drones) {
    const tile = document.querySelector<HTMLElement>(`.dfeed[data-f="${d.id}"]`)!, on = d.id === ui.video;
    tile.classList.toggle("off", !on); tile.classList.toggle("on", on); tile.classList.toggle("held", d.held);
    (on ? byId("sideFeed") : byId("feeds")).appendChild(tile);
    const svg = byId("fv-" + d.id), r = svg.getBoundingClientRect(), scene = feedScene(d, { w: Math.max(40, r.width), h: Math.max(30, r.height) }, K);
    svg.setAttribute("viewBox", scene.viewBox); svg.innerHTML = scene.svg;
    const [st, k] = flightState(d, SAMPLE.appliedRate), stEl = byId("fst-" + d.id);
    stEl.textContent = st; stEl.style.color = k === "ok" ? K.grn : k === "own" ? K.own : K.tx2;
    const bat = byId("fbat-" + d.id), cls = batteryClass(d.vbat);
    bat.className = "bat " + cls; (bat.firstElementChild as HTMLElement).style.width = batteryWidth(d.vbat, 14) + "px";
    const bv = byId("fbatv-" + d.id); bv.textContent = d.vbat.toFixed(2) + " V"; bv.className = "m " + cls;
  }
  document.querySelectorAll<HTMLElement>("[data-fs]").forEach(b => b.setAttribute("aria-checked", String(b.dataset["fs"] === ui.video)));
}

function renderPanel(): void {
  const held = heldDrones(), gs = gestureStatus(SAMPLE.gesture, held, SAMPLE.appliedRate);
  byId("gstat").dataset["k"] = gs.k; byId("gMain").textContent = gs.main; byId("gSub").textContent = gs.sub;
  byId("heldAlt").innerHTML = heldAltitude(held);
  // one button for the selected drone: Land while it flies, Take off while it is grounded
  const v = drone(ui.video), up = v.z > 0.02;
  byId("btnLandSel").hidden = !up; byId("btnTakeoffSel").hidden = up;
  document.querySelectorAll<HTMLElement>("#btnTakeoffSel small, #btnLandSel small").forEach(s => { s.textContent = U(v.id); });
  // battery and signal on each video button
  for (const d of ui.drones) {
    const el = document.getElementById("ds-" + d.id);
    if (!el) continue;
    const pct = batteryLevel(d.vbat), bars = d.link > 90 ? 4 : d.link > 70 ? 3 : d.link > 45 ? 2 : 1, bt = el.querySelector<HTMLElement>(".bt")!;
    bt.className = "bt " + batteryClass(d.vbat); (bt.firstElementChild as HTMLElement).style.width = batteryWidth(d.vbat, 12) + "px";
    el.querySelector<HTMLElement>(".v")!.textContent = pct + "%";
    [...el.querySelector<HTMLElement>(".sg")!.children].forEach((b, i) => b.classList.toggle("on", i < bars));
    el.title = `${U(d.id)}: pm.vbat ${d.vbat.toFixed(2)} V, pm.batteryLevel ${pct}%, link quality ${d.link}%`;
  }
  byId("trGo").hidden = SAMPLE.trial.running; byId("trRun").hidden = !SAMPLE.trial.running;
  const last = log[log.length - 1]!;
  byId("logLatest").textContent = last.text; byId("lastDot").dataset["k"] = last.k;
}

function renderTelemetry(): void {
  const s = ui.settings, elapsed = SAMPLE.now - SAMPLE.trial.t0;
  byId("telTable").innerHTML = dronesTable(ui.drones, s.dhtrig, 0.60);
  byId("telAlt").innerHTML = altitudeCard(SAMPLE.gesture, SAMPLE.requestedRate, SAMPLE.appliedRate, { min: s.zmin, max: s.zmax }, s.rate);
  byId("telTrial").innerHTML = trialCard({ ...SAMPLE.trial, restrict: ui.restrict }, elapsed, s.tlim);
  byId("telHealth").innerHTML = healthTable(ui.drones);
  const lv = logView(log, trials, SAMPLE.sessions, { session: ui.logSes, trial: ui.logTrial }, SAMPLE.now, s.tlim);
  const ses = byId<HTMLSelectElement>("logSes"), tr = byId<HTMLSelectElement>("logView");
  ses.innerHTML = `<option value="all">All</option>` + SAMPLE.sessions.map(x => `<option value="${x}">${x}</option>`).join(""); ses.value = ui.logSes;
  tr.innerHTML = `<option value="all">All</option>` + lv.trialOptions.map(t => `<option value="${t.id}">${t.id.split("-")[1]} · ${t.outcome ?? "running"}</option>`).join("");
  tr.value = ui.logTrial; tr.disabled = ui.logSes === "all" || !lv.trialOptions.length;
  const sum = byId("logSum"); sum.hidden = !lv.summary; sum.innerHTML = lv.summary ?? "";
  byId("logCount").textContent = lv.count; byId("telLog").innerHTML = lv.rows;
}

const renderCam = () => { byId("camSvg").innerHTML = handFrame(SAMPLE.gesture, K); };

function renderAll(): void { renderCourse(); renderDrones(); renderTapes(); renderCam(); renderFeeds(); renderPanel(); renderTelemetry(); }
let queued = false;
const renderSoon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; renderDrones(); renderTapes(); renderFeeds(); renderPanel(); renderTelemetry(); }); };

// ---------- layout: left panel, altitude and map; mirrored for left-handed use; map on top in portrait ----------
function layout(): void {
  const app = byId("app"), st = app.style, SIDE = "clamp(200px,22vw,310px)", ALT = "clamp(56px,6vw,90px)", portrait = innerWidth < innerHeight;
  app.classList.toggle("lefty", ui.lefty); app.dataset["mode"] = portrait ? "portrait" : "landscape";
  if (portrait) {
    st.gridTemplateRows = "minmax(0,.8fr) minmax(0,1.2fr)";
    st.gridTemplateColumns = ui.lefty ? `minmax(0,1fr) ${ALT}` : `${ALT} minmax(0,1fr)`;
    st.gridTemplateAreas = ui.lefty ? `"main main" "side alt"` : `"main main" "alt side"`;
  } else {
    st.gridTemplateRows = "minmax(0,1fr)";
    st.gridTemplateColumns = ui.lefty ? `minmax(0,1fr) ${ALT} ${SIDE}` : `${SIDE} ${ALT} minmax(0,1fr)`;
    st.gridTemplateAreas = ui.lefty ? `"main alt side"` : `"side alt main"`;
  }
  requestAnimationFrame(renderAll);
}

// ---------- map: hold and drag drones (several fingers at once) ----------
const pointers = new Map<number, { id: string; x0: number; y0: number; moved: boolean }>();
function toMap(e: PointerEvent): [number, number] {
  const p = mapSvg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(mapSvg.getScreenCTM()!.inverse());
  return toCourse(view, q.x, q.y);
}
function followVideo(): void {
  ui.holdOrder = ui.holdOrder.filter(id => drone(id).held);
  const id = ui.holdOrder[ui.holdOrder.length - 1];
  if (id) ui.video = id;
}
mapSvg.addEventListener("pointerdown", e => {
  const g = (e.target as Element).closest<SVGElement>("[data-drone]");
  if (!g) return;
  const d = drone(g.dataset["drone"]!);
  if ([...pointers.values()].some(p => p.id === d.id)) return;
  e.preventDefault(); mapSvg.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { id: d.id, x0: e.clientX, y0: e.clientY, moved: false });
  d.held = true; ui.holdOrder = [...ui.holdOrder.filter(x => x !== d.id), d.id]; followVideo(); renderSoon();
});
mapSvg.addEventListener("pointermove", e => {
  const [mx, my] = toMap(e), a = COURSE.arena, inside = mx >= a.xMin && mx <= a.xMax && my >= a.yMin && my <= a.yMax;
  byId("cursor").textContent = inside ? `${sg(mx)}, ${sg(my)} m` : "--";
  const p = pointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  const d = drone(p.id);
  if (!airborne(d)) return;                                   // a grounded drone can be held, not moved
  if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 6) return;
  p.moved = true;
  const m = a.margin, fx = clamp(mx, a.xMin + m, a.xMax - m), fy = clamp(my, a.yMin + m, a.yMax - m);
  // the finger sets the drone's target and the drone glides to it (REQ-02). The sample trial is running, so neither the
  // target nor the straight line the drone takes to it may enter the restricted zone (REQ-08)
  const aim = dragTarget(d.tx, d.ty, fx, fy, COURSE.zone), path = dragTarget(d.x, d.y, aim.x, aim.y, COURSE.zone);
  const to = { x: path.x, y: path.y, blocked: aim.blocked || path.blocked };
  if (to.blocked && !d.blockPt) {
    ui.restrict++; trials[0]!.restrict = ui.restrict;
    log.push({ t: SAMPLE.now, text: `${U(d.id)} drag rejected: restricted zone`, k: "warn", ses: SAMPLE.trial.session, tr: SAMPLE.trial.id });
  }
  d.blockPt = to.blocked ? [fx, fy] : null;
  d.tx = to.x; d.ty = to.y; d.gliding = true;
  d.ranges = {}; d.below = null;                              // the sample readings belong to the old spot
  startGlide();
});
// Screen animation only: a dragged drone eases toward its target, up to 1 m/s, leaving a short fading trail.
// A released drone keeps its last target and stays there once it arrives (REQ-07).
let gliding = false, lastFrame = 0, lastPanels = 0;
function startGlide(): void {
  if (gliding) return;
  gliding = true; lastFrame = performance.now(); requestAnimationFrame(glide);
}
function glide(now: number): void {
  const dt = Math.min(0.05, Math.max(0, now - lastFrame) / 1000);
  lastFrame = now;
  let busy = false;
  for (const d of ui.drones) {
    const T = (d.trail ??= []);
    while (T.length && now - T[0]![2] > TRAIL_MS) T.shift();
    if (T.length) busy = true;
    if (glideStep(d, dt, now)) busy = true;
  }
  renderDrones();
  if (now - lastPanels > 100) { lastPanels = now; renderSoon(); }   // panels follow at about 10 per second
  if (busy) requestAnimationFrame(glide); else { gliding = false; renderSoon(); }
}
function release(e: PointerEvent): void {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId); const d = drone(p.id); d.held = false; d.blockPt = null; followVideo(); renderSoon();
}
mapSvg.addEventListener("pointerup", release);
mapSvg.addEventListener("pointercancel", release);
mapSvg.addEventListener("pointerleave", () => { byId("cursor").textContent = "--"; });

// ---------- panel controls ----------
function showTab(tab: "map" | "tel"): void {
  ui.tab = tab;
  byId("tabMap").setAttribute("aria-selected", String(tab === "map"));
  byId("tabTel").setAttribute("aria-selected", String(tab === "tel"));
  byId("mapbody").hidden = tab !== "map"; byId("telPane").hidden = tab !== "tel";
  if (tab === "map") requestAnimationFrame(renderAll);
}
byId("tabMap").addEventListener("click", () => showTab("map"));
byId("tabTel").addEventListener("click", () => showTab("tel"));
byId("logToggle").addEventListener("click", () => showTab("tel"));
document.querySelectorAll<HTMLElement>(".sec>button, .camhead>button:first-child").forEach(b => b.addEventListener("click", () => {
  const closed = b.closest(".sec")!.classList.toggle("closed");
  b.setAttribute("aria-expanded", String(!closed));
  requestAnimationFrame(renderAll);
}));
document.addEventListener("click", e => {
  const b = (e.target as Element).closest<HTMLElement>("[data-fs]");
  if (b?.dataset["fs"]) { ui.video = b.dataset["fs"]; renderSoon(); }
});
byId("logSes").addEventListener("change", e => { ui.logSes = (e.target as HTMLSelectElement).value; ui.logTrial = "all"; renderTelemetry(); });
byId("logView").addEventListener("change", e => { ui.logTrial = (e.target as HTMLSelectElement).value; renderTelemetry(); });

// E-STOP: press and hold 1 s. Only the control changes; Take off all clears it.
const estop = byId("estop"), ring = byId("estopRing") as unknown as SVGCircleElement, CIRC = 94.25;
let holdStart: number | null = null, holdFrame = 0;
function estopTick(): void {
  const p = Math.min(1, (performance.now() - holdStart!) / 1000);
  ring.style.strokeDashoffset = String(CIRC * (1 - p)); byId("estopSub").textContent = `Arming ${p.toFixed(1)} s`;
  if (p >= 1) { ui.stopped = true; estop.classList.add("fired"); byId("estopTitle").textContent = "MOTORS CUT"; estopCancel(); byId("estopSub").textContent = "Take off all to clear"; return; }
  holdFrame = requestAnimationFrame(estopTick);
}
function estopCancel(): void {
  cancelAnimationFrame(holdFrame); holdStart = null; ring.style.strokeDashoffset = String(CIRC);
  if (!ui.stopped) byId("estopSub").textContent = "Hold 1 s";
}
estop.addEventListener("pointerdown", e => { if (ui.stopped) return; estop.setPointerCapture(e.pointerId); holdStart = performance.now(); holdFrame = requestAnimationFrame(estopTick); });
estop.addEventListener("pointerup", estopCancel);
estop.addEventListener("pointercancel", estopCancel);
byId("btnTakeoff").addEventListener("click", () => {
  if (!ui.stopped) return;
  ui.stopped = false; estop.classList.remove("fired"); byId("estopTitle").textContent = "E-STOP"; byId("estopSub").textContent = "Hold 1 s";
});

// Hand camera: a plain preview of the front camera. There is no gesture recognition in the mockup.
function cameraNote(text: string): void { const n = byId("camNote"); n.hidden = !text; n.textContent = text; }
async function toggleCamera(): Promise<void> {
  const btn = byId("camBtn"), video = byId<HTMLVideoElement>("camVideo");
  if (ui.camera) { ui.camera.getTracks().forEach(t => t.stop()); ui.camera = null; }
  else {
    try { ui.camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }); }
    catch { cameraNote("The camera is not available. Allow camera access for this page, then tap the camera icon."); return; }
    video.srcObject = ui.camera; await video.play().catch(() => {});
  }
  const on = !!ui.camera;
  video.hidden = !on; byId("camSvg").style.display = on ? "none" : ""; cameraNote("");
  btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", String(on));
}
byId("camBtn").addEventListener("click", () => { void toggleCamera(); });

// ---------- settings: display only ----------
type StepKey = keyof typeof ui.settings;
const STEP: Record<StepKey, { step: number; lo: () => number; hi: () => number; fmt: (v: number) => string }> = {
  zmin: { step: 0.05, lo: () => 0.10, hi: () => ui.settings.zmax - 0.30, fmt: v => v.toFixed(2) + " m" },
  zmax: { step: 0.05, lo: () => ui.settings.zmin + 0.30, hi: () => 2.00, fmt: v => v.toFixed(2) + " m" },
  rate: { step: 0.05, lo: () => 0.05, hi: () => 0.40, fmt: v => v.toFixed(2) + " m/s" },
  dhtrig: { step: 0.05, lo: () => 0.10, hi: () => 0.50, fmt: v => v.toFixed(2) + " m" },
  tlim: { step: 30, lo: () => 60, hi: () => 900, fmt: v => fmtMS(v) },
};
function syncSettings(): void {
  document.querySelectorAll<HTMLElement>(".stp").forEach(r => { const k = r.dataset["k"] as StepKey; r.querySelector("b")!.textContent = STEP[k].fmt(ui.settings[k]); });
  document.querySelector<HTMLElement>('[data-o="light"]')?.setAttribute("aria-pressed", String(ui.light));
  document.querySelector<HTMLElement>('[data-o="lefty"]')?.setAttribute("aria-pressed", String(ui.lefty));
}
document.querySelectorAll<HTMLElement>(".stp button").forEach(b => b.addEventListener("click", () => {
  const k = b.closest<HTMLElement>(".stp")!.dataset["k"] as StepKey, c = STEP[k];
  ui.settings[k] = clamp(Math.round((ui.settings[k] + Number(b.dataset["d"]) * c.step) * 100) / 100, c.lo(), c.hi());
  syncSettings(); renderAll();
}));
document.querySelector<HTMLElement>('[data-o="light"]')?.addEventListener("click", () => {
  ui.light = !ui.light; K = ui.light ? PAL.light : PAL.dark;
  document.documentElement.classList.toggle("light", ui.light);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = ui.light ? "#EEF3FA" : "#181C18";
  syncSettings(); renderAll();
});
document.querySelector<HTMLElement>('[data-o="lefty"]')?.addEventListener("click", () => { ui.lefty = !ui.lefty; syncSettings(); layout(); });
function toggleSettings(open?: boolean): void {
  const drawer = byId("settings"), show = open ?? drawer.hidden;
  drawer.hidden = !show; byId("setBtn").setAttribute("aria-expanded", String(show));
}
byId("setBtn").addEventListener("click", () => toggleSettings());
byId("setClose").addEventListener("click", () => toggleSettings(false));
byId("fsBtn").addEventListener("click", () => { document.documentElement.requestFullscreen?.().catch(() => {}); });

// ---------- start ----------
byId("feeds").innerHTML = ui.drones.map(feedTile).join("");
addEventListener("resize", layout);
new ResizeObserver(() => requestAnimationFrame(renderAll)).observe(byId("mapbody"));
syncSettings();
layout();
