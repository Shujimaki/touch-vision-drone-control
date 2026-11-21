import { describe, expect, it } from "vitest";
import { commandTargets, dragTarget, dronePoint, firstPick, fleet, isPicked, type FleetDrone } from "../src/flightFleet";
import type { DroneTelemetry, HostConfig, Telemetry } from "../src/protocol";

const BOX = { x_min: -0.5, x_max: 0.5, y_min: -1, y_max: 1 };

const config = (drones: string[], pads: { id: string; x: number; y: number }[]): HostConfig => ({
  id: "test", drones,
  input_hz: 30, telemetry_hz: 20, input_timeout_ms: 500, telemetry_timeout_ms: 1000, stale_position_ms: 300,
  rate_max: 0.5, zone_margin: 0.1, z_min: 0.3, z_max: 1,
  course: { room: BOX, capture_volume: BOX, restricted_zone: BOX, obstacles: [], hoops: [], pads },
});

const drone = (id: string, x: number | null, y: number | null): DroneTelemetry => ({
  id, held: false, state: "flying", link: "ok", x, y, z: 0.5, yaw: 0, pos_age_ms: 10,
  cmd: { x: 0, y: 0, z: 0.5 },
  ranges: { front: null, back: null, left: null, right: null, up: null },
  defensive_hover: null, battery_v: 3.9,
});

const telemetry = (drones: DroneTelemetry[]): Telemetry => ({
  type: "telemetry", v: 1, seq: 1, host_ms: 0,
  ack: { seq: null, t_ms: null, host_rx_ms: null },
  mode: "course", trial: null, altitude: { rate: 0, blocked_by: null, reason: null },
  drones,
});

const THREE = config(["cf1", "cf2", "cf3"], [
  { id: "cf3", x: 0, y: -0.6 }, { id: "cf1", x: 0, y: 0 }, { id: "cf2", x: 0, y: 0.6 },
]);

const entry = (id: string, pad: FleetDrone["pad"], tel: DroneTelemetry | null = null): FleetDrone => ({ id, pad, tel });

describe("flight fleet", () => {
  it("lists one drone per configured drone, in config order, with its pad and no telemetry yet", () => {
    expect(fleet(THREE, null)).toEqual([
      entry("cf1", { x: 0, y: 0 }), entry("cf2", { x: 0, y: 0.6 }), entry("cf3", { x: 0, y: -0.6 }),
    ]);
  });

  it("matches telemetry to drones by id, not by position in the list", () => {
    const cf3 = drone("cf3", 0.1, -0.5);
    const cf1 = drone("cf1", 0.2, 0.1);
    const drones = fleet(THREE, telemetry([cf3, cf1]));
    expect(drones.map(d => [d.id, d.tel])).toEqual([["cf1", cf1], ["cf2", null], ["cf3", cf3]]);
  });

  it("gives a drone without a pad a null pad", () => {
    const drones = fleet(config(["cf1", "cf2"], [{ id: "cf1", x: 0, y: 0 }]), null);
    expect(drones.map(d => [d.id, d.pad])).toEqual([["cf1", { x: 0, y: 0 }], ["cf2", null]]);
  });

  it("ignores telemetry for a drone the config does not list", () => {
    const drones = fleet(config(["cf1"], [{ id: "cf1", x: 0, y: 0 }]), telemetry([drone("cf9", 0, 0)]));
    expect(drones).toEqual([entry("cf1", { x: 0, y: 0 })]);
  });
});

describe("drone point", () => {
  it("is the measured position when telemetry has one", () => {
    expect(dronePoint(entry("cf2", { x: 0, y: 0.6 }, drone("cf2", 0.3, 0.4)))).toEqual({ x: 0.3, y: 0.4 });
  });
  it("is the pad before any telemetry for the drone arrives", () => {
    expect(dronePoint(entry("cf3", { x: 0, y: -0.6 }))).toEqual({ x: 0, y: -0.6 });
  });
  it("is null when telemetry has no x or no y", () => {
    expect(dronePoint(entry("cf1", { x: 0, y: 0 }, drone("cf1", null, 0.2)))).toBeNull();
    expect(dronePoint(entry("cf1", { x: 0, y: 0 }, drone("cf1", 0.2, null)))).toBeNull();
  });
  it("is null with neither telemetry nor a pad", () => {
    expect(dronePoint(entry("cf1", null))).toBeNull();
  });
});

describe("drone pick", () => {
  const drones = fleet(THREE, null);

  it("starts on the first configured drone, so one finger can drag it right away", () => {
    expect(firstPick(THREE)).toEqual({ kind: "one", id: "cf1" });
  });
  it("starts on All when no drone is configured", () => {
    expect(firstPick(config([], []))).toEqual({ kind: "all" });
  });

  it("sends takeoff and land to the picked drone only", () => {
    expect(commandTargets({ kind: "one", id: "cf3" }, drones)).toEqual(["cf3"]);
  });
  it("sends a picked drone the config no longer lists to nobody", () => {
    expect(commandTargets({ kind: "one", id: "cf9" }, drones)).toEqual([]);
  });
  it("sends takeoff and land to every configured drone in config order when All is picked", () => {
    expect(commandTargets({ kind: "all" }, drones)).toEqual(["cf1", "cf2", "cf3"]);
  });

  it("marks every drone picked under All, and only the picked one otherwise", () => {
    expect(["cf1", "cf2"].map(id => isPicked({ kind: "all" }, id))).toEqual([true, true]);
    expect(["cf1", "cf2"].map(id => isPicked({ kind: "one", id: "cf2" }, id))).toEqual([false, true]);
  });

  it("drags the picked drone", () => {
    expect(dragTarget({ kind: "one", id: "cf2" }, drones)).toEqual(entry("cf2", { x: 0, y: 0.6 }));
  });
  it("drags nothing when All is picked", () => {
    expect(dragTarget({ kind: "all" }, drones)).toBeNull();
  });
});
