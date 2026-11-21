import "./flightTest.css";
import { connect, linkLabel, type ConnectionState } from "./connection";
import { commandTargets, dronePoint, isPicked, pickAfterWelcome, swarm, type DronePick, type SwarmDrone } from "./flightSwarm";
import type { CommandName, FlightCommand, HostConfig, Rect, Reply, Telemetry } from "./protocol";
import { inBox, nearestWithin, takeoffView, toScreen, toTakeoff, type TakeoffView } from "./takeoffView";

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
const picker = byId("picker");
let link: ConnectionState = { status: "connecting" };
let telemetry: Telemetry | null = null;
let pick: DronePick | null = null;
let view: TakeoffView | null = null;

function fitView(size: { width: number; height: number }, box: Rect): TakeoffView {
  const inner = takeoffView(Math.max(1, size.width - 2 * PAD_PX), Math.max(1, size.height - 2 * PAD_PX), box);
  return { ...inner, left: inner.left + PAD_PX, top: inner.top + PAD_PX };
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

const drones = (): SwarmDrone[] => link.status === "connected" ? swarm(link.welcome.config, telemetry) : [];

function drawDrone(v: TakeoffView, d: SwarmDrone, look: { picked: boolean; held: boolean }): string {
  const ring = look.picked ? "#25C6E8" : "#687566";
  let marker = "";
  if (d.tel !== null) {
    const t = toScreen(v, d.tel.cmd);
    marker = `<circle cx="${t.px}" cy="${t.py}" r="${DRONE_R_PX * 0.5}" fill="none" stroke="#25C6E8" stroke-width="2" stroke-dasharray="4 3"/>`;
  }
  const measured = dronePoint(d);
  if (measured === null) return marker;
  const here = toScreen(v, measured);
  return `${marker}<circle cx="${here.px}" cy="${here.py}" r="${DRONE_R_PX}" fill="${look.held ? "#25C6E8" : "#16301A"}"
    stroke="${ring}" stroke-width="3"/><text x="${here.px}" y="${here.py + 5}" fill="${look.held ? "#07120A" : "#E1E8DF"}"
    text-anchor="middle" font-weight="600">${d.id}</text>`;
}

function render(): void {
  if (link.status === "connected") {
    const r = svg.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    view = fitView(r, link.welcome.config.course.capture_volume);
  }
  svg.style.opacity = link.status === "failed" ? "0.4" : "1";
  const swarmNow = drones(), v = view, heldIds = new Set(bridge.held().values());
  const stale = link.status === "connected" ? link.welcome.config.stale_position_ms : Infinity;
  const p = link.status === "connected" ? pick : null, picked = (id: string) => p !== null && isPicked(p, id);
  svg.innerHTML = v === null ? "" : drawBox(v) + swarmNow.map(d => drawDrone(v, d, { picked: picked(d.id), held: heldIds.has(d.id) })).join("");
  renderPick(p);
  byId("telRows").innerHTML = swarmNow.map(d => telemetryCard(d, picked(d.id), stale)).join("");
}

const meters = (p: { x: number; y: number }) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)} m`;

function renderPick(p: DronePick | null): void {
  byId("pickLabel").textContent = p === null ? "--" : p.kind === "all" ? "All" : p.id;
  for (const button of picker.querySelectorAll<HTMLButtonElement>("button")) {
    const id = button.dataset["drone"];
    button.setAttribute("aria-checked", String(p !== null && (p.kind === "all" ? id === undefined : id === p.id)));
  }
}

function buildPicker(config: HostConfig | null): void {
  if (config === null) { picker.innerHTML = ""; return; }
  const droneButtons = config.drones.map(id => `<button role="radio" data-drone="${id}">${id}</button>`);
  picker.innerHTML = [...droneButtons, `<button role="radio">All</button>`].join("");
}

function telemetryCard(d: SwarmDrone, picked: boolean, stale: number): string {
  const t = d.tel, posAge = t?.pos_age_ms ?? null, battery = t?.battery_v ?? null;
  const pos = t && t.x !== null && t.y !== null ? meters({ x: t.x, y: t.y }) : "--";
  const target = t ? `${meters(t.cmd)}, z ${t.cmd.z.toFixed(2)} m` : "--";
  return `<section class="ft-card" data-picked="${picked}"><h2>${d.id}</h2><dl>
    <dt>State</dt><dd>${t?.state ?? "--"}</dd>
    <dt>Position</dt><dd>${pos}</dd>
    <dt>Target</dt><dd>${target}</dd>
    <dt>Position age</dt><dd data-warn="${posAge !== null && posAge > stale}">${posAge !== null ? `${Math.round(posAge)} ms` : "--"}</dd>
    <dt>Radio link</dt><dd data-warn="${t?.link === "lost"}">${t?.link ?? "--"}</dd>
    <dt>Battery</dt><dd>${battery !== null ? `${battery.toFixed(2)} V` : "--"}</dd>
  </dl></section>`;
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
  if (state.status === "connected") pick = pickAfterWelcome(pick, state.welcome.config);
  buildPicker(state.status === "connected" ? state.welcome.config : null);
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
  onTelemetry: (t: Telemetry) => { telemetry = t; renderSoon(); },
  onHostLost: () => { telemetry = null; renderSoon(); },
  onCommandReply: showReply,
});

const screenPoint = (e: PointerEvent) => { const r = svg.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };

picker.addEventListener("click", e => {
  const button = e.target instanceof Element ? e.target.closest("button") : null;
  if (button === null) return;
  const id = button.dataset["drone"];
  if (id === undefined) pick = { kind: "all" };
  else if (drones().some(d => d.id === id)) pick = { kind: "one", id };
  renderSoon();
});

svg.addEventListener("pointerdown", e => {
  if (view === null) return;
  const id = nearestWithin(view, screenPoint(e), drones().map(d => ({ id: d.id, at: dronePoint(d) })), HIT_R_PX);
  if (id === null || !bridge.hold(e, id)) return;
  e.preventDefault();
  svg.setPointerCapture(e.pointerId);
  renderSoon();
});
svg.addEventListener("pointermove", e => {
  if (view === null) return;
  const p = toTakeoff(view, screenPoint(e));
  if (!inBox(view.box, p)) return;
  const accepted = bridge.drag({ pointerId: e.pointerId, timeStamp: e.timeStamp, x: p.x, y: p.y });
  if (accepted !== null) e.preventDefault();
});
function release(e: PointerEvent): void {
  bridge.lift(e.pointerId);
  renderSoon();
}
svg.addEventListener("pointerup", release);
svg.addEventListener("pointercancel", release);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  bridge.releaseAllAndSendInput();
  renderSoon();
});

const whenConnected = (action: (s: Extract<ConnectionState, { status: "connected" }>) => void) => () => {
  if (link.status === "connected") action(link);
};
const flightCommand = (name: FlightCommand) => whenConnected(s => { if (pick !== null) s.command(name, commandTargets(pick, drones())); });
takeoffButton.addEventListener("click", flightCommand("takeoff"));
landButton.addEventListener("click", flightCommand("land"));
stopButton.addEventListener("click", whenConnected(s => s.stop()));
new ResizeObserver(renderSoon).observe(byId("boxArea"));
