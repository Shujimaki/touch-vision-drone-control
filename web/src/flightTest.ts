import "./flightTest.css";
import { connect, linkLabel, type ConnectionState } from "./connection";
import type { CommandName, DroneTelemetry, Rect, Reply, Telemetry } from "./protocol";
import { inBox, takeoffView, toScreen, toTakeoff, type FramePoint, type TakeoffView } from "./takeoffView";

const DRONE = "cf1";
const ARROW_WALL = "the wall the floor arrow points to";
const PAD_PX = 48;
const DRONE_R_PX = 26;
const HIT_R_PX = 48;

const byId = <T extends Element = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`flight-test.html has no element #${id}`);
  return el as unknown as T;
};

const svg = byId<SVGSVGElement>("boxSvg");
const takeoffButton = byId<HTMLButtonElement>("btnTakeoff"), landButton = byId<HTMLButtonElement>("btnLand");
const stopButton = byId<HTMLButtonElement>("btnStop"), buttons = [takeoffButton, landButton, stopButton];
let link: ConnectionState = { status: "connecting" };
let drone: DroneTelemetry | null = null;
let view: TakeoffView | null = null;
let finger: number | null = null;

function fitView(size: { width: number; height: number }, box: Rect): TakeoffView {
  const inner = takeoffView(Math.max(1, size.width - 2 * PAD_PX), Math.max(1, size.height - 2 * PAD_PX), box);
  return { ...inner, left: inner.left + PAD_PX, top: inner.top + PAD_PX };
}

const TAKEOFF_SPOT: FramePoint = { x: 0, y: 0 };

function dronePoint(d: DroneTelemetry | null): FramePoint | null {
  if (d === null) return TAKEOFF_SPOT;
  if (d.x === null || d.y === null) return null;
  return { x: d.x, y: d.y };
}

function drawBox(v: TakeoffView): string {
  const b = v.box, tl = toScreen(v, { x: b.x_max, y: b.y_max }), br = toScreen(v, { x: b.x_min, y: b.y_min });
  const o = toScreen(v, { x: 0, y: 0 }), arrow = 0.15 * v.scale;
  return `
    <rect x="${tl.px}" y="${tl.py}" width="${br.px - tl.px}" height="${br.py - tl.py}" fill="#151A15" stroke="#3E8F46" stroke-width="2"/>
    <line x1="${o.px - 10}" y1="${o.py}" x2="${o.px + 10}" y2="${o.py}" stroke="#687566"/>
    <line x1="${o.px}" y1="${o.py - 10}" x2="${o.px}" y2="${o.py + 10}" stroke="#687566"/>
    <g stroke="#9DAA9B" stroke-width="2" fill="none">
      <path d="M${o.px} ${o.py} V${o.py - arrow} m-6 8 l6 -8 l6 8"/>
      <path d="M${o.px} ${o.py} H${o.px - arrow} m8 -6 l-8 6 l8 6"/>
    </g>
    <text x="${o.px + 8}" y="${o.py - arrow}" fill="#9DAA9B">+x</text>
    <text x="${o.px - arrow}" y="${o.py - 8}" fill="#9DAA9B" text-anchor="middle">+y</text>
    <text x="${(tl.px + br.px) / 2}" y="${tl.py - 14}" fill="#E1E8DF" text-anchor="middle">+x points to ${ARROW_WALL}</text>
    <text x="${br.px}" y="${br.py + 22}" fill="#687566" text-anchor="end">${(b.x_max - b.x_min).toFixed(1)} m by ${(b.y_max - b.y_min).toFixed(1)} m</text>`;
}

function drawDrone(v: TakeoffView, d: DroneTelemetry | null, held: boolean): string {
  let marker = "";
  if (d !== null) {
    const t = toScreen(v, d.cmd);
    marker = `<circle cx="${t.px}" cy="${t.py}" r="${DRONE_R_PX * 0.5}" fill="none" stroke="#25C6E8" stroke-width="2" stroke-dasharray="4 3"/>`;
  }
  const measured = dronePoint(d);
  if (measured === null) return marker;
  const here = toScreen(v, measured);
  return `${marker}<circle cx="${here.px}" cy="${here.py}" r="${DRONE_R_PX}" fill="${held ? "#25C6E8" : "#16301A"}"
    stroke="#25C6E8" stroke-width="3"/><text x="${here.px}" y="${here.py + 5}" fill="${held ? "#07120A" : "#E1E8DF"}"
    text-anchor="middle" font-weight="600">1</text>`;
}

function render(): void {
  if (link.status === "connected") {
    const r = svg.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    view = fitView(r, link.welcome.config.course.capture_volume);
  }
  svg.style.opacity = link.status === "failed" ? "0.4" : "1";
  const droneLayer = view !== null && link.status === "connected" ? drawDrone(view, drone, finger !== null) : "";
  svg.innerHTML = view === null ? "" : drawBox(view) + droneLayer;
  renderTelemetry();
}

const meters = (p: { x: number; y: number }) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)} m`;

function renderTelemetry(): void {
  const stale = link.status === "connected" ? link.welcome.config.stale_position_ms : Infinity, d = drone;
  byId("telState").textContent = d?.state ?? "--";
  byId("telPos").textContent = d && d.x !== null && d.y !== null ? meters({ x: d.x, y: d.y }) : "--";
  byId("telCmd").textContent = d ? `${meters(d.cmd)}, z ${d.cmd.z.toFixed(2)} m` : "--";
  const age = byId("telAge");
  const posAge = d?.pos_age_ms ?? null, battery = d?.battery_v ?? null;
  age.textContent = posAge !== null ? `${Math.round(posAge)} ms` : "--";
  age.dataset["warn"] = String(posAge !== null && posAge > stale);
  const radio = byId("telLink");
  radio.textContent = d?.link ?? "--";
  radio.dataset["warn"] = String(d?.link === "lost");
  byId("telBattery").textContent = battery !== null ? `${battery.toFixed(2)} V` : "--";
}

let queued = false;
const renderSoon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); };

function showLink(state: ConnectionState): void {
  link = state;
  const { headline, detail } = linkLabel(state), detailEl = byId("linkDetail");
  byId("linkState").dataset["state"] = state.status;
  byId("linkHead").textContent = headline;
  detailEl.textContent = detail ?? "";
  detailEl.hidden = detail === null;
  byId("configId").textContent = state.status === "connected" ? `Configuration ${state.welcome.config.id}` : "No configuration yet";
  for (const button of buttons) button.disabled = state.status !== "connected";
  renderSoon();
}

function showReply(name: CommandName, reply: Reply): void {
  const el = byId("reply");
  el.hidden = false;
  el.dataset["ok"] = String(reply.ok);
  el.textContent = reply.ok ? `${name}: accepted` : `${name} refused: ${reply.code}${reply.detail ? `, ${reply.detail}` : ""}`;
}

const bridge = connect({
  tabletClockMs: () => performance.now(),
  client: "tablet-web-flight-test 0.1.0",
  userAgent: navigator.userAgent,
  onState: showLink,
  onTelemetry: (t: Telemetry) => { drone = t.drones.find(d => d.id === DRONE) ?? null; renderSoon(); },
  onHostLost: () => { finger = null; drone = null; renderSoon(); },
  onCommandReply: showReply,
});

const screenPoint = (e: PointerEvent) => { const r = svg.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };

svg.addEventListener("pointerdown", e => {
  const measured = dronePoint(drone);
  if (finger !== null || view === null || measured === null) return;
  const p = screenPoint(e), here = toScreen(view, measured);
  if (Math.hypot(p.px - here.px, p.py - here.py) > HIT_R_PX || !bridge.hold(e, DRONE)) return;
  e.preventDefault();
  svg.setPointerCapture(e.pointerId);
  finger = e.pointerId;
  renderSoon();
});
svg.addEventListener("pointermove", e => {
  if (e.pointerId !== finger || view === null) return;
  e.preventDefault();
  const p = toTakeoff(view, screenPoint(e));
  if (!inBox(view.box, p)) return;
  bridge.drag({ pointerId: e.pointerId, timeStamp: e.timeStamp, x: p.x, y: p.y });
});
function release(e: PointerEvent): void {
  if (e.pointerId !== finger) return;
  bridge.lift(e.pointerId);
  finger = null;
  renderSoon();
}
svg.addEventListener("pointerup", release);
svg.addEventListener("pointercancel", release);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  bridge.releaseAllAndSendInput();
  finger = null;
  renderSoon();
});

const whenConnected = (action: (s: Extract<ConnectionState, { status: "connected" }>) => void) => () => {
  if (link.status === "connected") action(link);
};
takeoffButton.addEventListener("click", whenConnected(s => s.command("takeoff", [DRONE])));
landButton.addEventListener("click", whenConnected(s => s.command("land", [DRONE])));
stopButton.addEventListener("click", whenConnected(s => s.stop()));
new ResizeObserver(renderSoon).observe(byId("boxArea"));
