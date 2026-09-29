// Static mockup of the tablet interface. index.html holds one captured state of the screen; this script only wires
// the controls that change what is shown: the Map and Telemetry tabs, the settings drawer, collapsible panels, the
// video source buttons, the light theme and fullscreen. It simulates nothing and sends no messages.
import "./styles.css";

export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html has no element #${id}`);
  return el as T;
};

function showTab(tab: "map" | "tel"): void {
  byId("tabMap").setAttribute("aria-selected", String(tab === "map"));
  byId("tabTel").setAttribute("aria-selected", String(tab === "tel"));
  byId("mapbody").hidden = tab !== "map";
  byId("telPane").hidden = tab !== "tel";
}

function toggleSettings(open?: boolean): void {
  const drawer = byId("settings"), show = open ?? drawer.hidden;
  drawer.hidden = !show;
  byId("setBtn").setAttribute("aria-expanded", String(show));
}

// The chosen drone's video tile sits under the camera panel; the others wait in the hidden feed column.
function showVideo(id: string): void {
  document.querySelectorAll<HTMLElement>("[data-fs]").forEach(b => b.setAttribute("aria-checked", String(b.dataset["fs"] === id)));
  document.querySelectorAll<HTMLElement>(".dfeed").forEach(tile => {
    const on = tile.dataset["f"] === id;
    tile.classList.toggle("off", !on);
    tile.classList.toggle("on", on);
    (on ? byId("sideFeed") : byId("feeds")).appendChild(tile);
  });
  document.querySelectorAll<HTMLElement>("#btnTakeoffSel small, #btnLandSel small").forEach(s => { s.textContent = `DRONE ${id.slice(2)}`; });
}

function setLight(light: boolean): void {
  document.documentElement.classList.toggle("light", light);
  document.querySelector<HTMLElement>('[data-o="light"]')?.setAttribute("aria-pressed", String(light));
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = light ? "#EEF3FA" : "#181C18";
}

byId("tabMap").addEventListener("click", () => showTab("map"));
byId("tabTel").addEventListener("click", () => showTab("tel"));
byId("logToggle").addEventListener("click", () => showTab("tel"));
byId("setBtn").addEventListener("click", () => toggleSettings());
byId("setClose").addEventListener("click", () => toggleSettings(false));
document.querySelectorAll<HTMLElement>(".sec>button, .camhead>button:first-child").forEach(b => b.addEventListener("click", () => {
  const closed = b.closest(".sec")!.classList.toggle("closed");
  b.setAttribute("aria-expanded", String(!closed));
}));
document.addEventListener("click", e => {
  const b = (e.target as Element).closest<HTMLElement>("[data-fs]");
  if (b?.dataset["fs"]) showVideo(b.dataset["fs"]);
});
document.querySelector<HTMLElement>('[data-o="light"]')?.addEventListener("click", () => setLight(!document.documentElement.classList.contains("light")));
byId("fsBtn").addEventListener("click", () => { document.documentElement.requestFullscreen?.().catch(() => {}); });
