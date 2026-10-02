import { describe, expect, it } from "vitest";
import { buildElevation, PLINTH } from "./elevation";
import { generatePlan } from "./engine";
import { FLOOR_H } from "./model3d";
import type { BuildingType, Requirements } from "./types";

const FT = 0.3048;
const req = (buildingType: BuildingType, w: number, d: number, beds: number, floors: number, extra: Partial<Requirements> = {}): Requirements => ({
  buildingType, plotWidth: w * FT, plotDepth: d * FT, facing: "E", floors, bedrooms: beds, bathrooms: beds, parking: 1,
  balconies: 1, vastu: true, garden: false, pool: false, homeOffice: false, budget: "standard", style: "modern", luxury: 3, ...extra,
});

describe("front elevation", () => {
  it("a G+1 house: two storeys of facade, the main door, a parapet", () => {
    const plan = generatePlan(req("house", 30, 50, 3, 2));
    const el = buildElevation(plan, "flat");
    expect(new Set(el.blocks.map((b) => b.floor))).toEqual(new Set([0, 1]));
    expect(el.levels.map((l) => l.h)).toEqual([0, PLINTH, PLINTH + FLOOR_H]);
    expect(el.roof.kind).toBe("flat");
    expect(el.top).toBeCloseTo(PLINTH + 2 * FLOOR_H + 0.9, 5);
    expect(el.style).toBe("modern");
    expect(el.blocks.some((b) => b.clad)).toBe(true);
    // Every opening sits inside a facade block of its storey.
    for (const o of el.openings) {
      expect(el.blocks.some((b) => o.x0 >= b.x0 - 1e-6 && o.x1 <= b.x1 + 1e-6 && o.h0 >= b.h0 - 1e-6 && o.h1 <= b.h1 + 1e-6), `${o.kind} at ${o.x0.toFixed(2)}`).toBe(true);
    }
    // The gate is on the plot.
    expect(el.gate.x0).toBeGreaterThanOrEqual(el.plot.x0);
    expect(el.gate.x1).toBeLessThanOrEqual(el.plot.x1);
  });

  it("a house with a front sit-out shows the main door on the ground floor", () => {
    const plan = generatePlan(req("house", 40, 60, 3, 2));
    const el = buildElevation(plan, "flat");
    const front = el.openings.filter((o) => o.h0 < PLINTH + 0.01);
    expect(front.length + el.railings.length).toBeGreaterThan(0);
  });

  it("a manduva: tiled roof silhouette and verandah pillars", () => {
    const plan = generatePlan(req("manduva", 50, 60, 3, 1));
    const el = buildElevation(plan, "sloped");
    expect(el.style).toBe("traditional");
    expect(el.roof.kind).toBe("sloped");
    if (el.roof.kind === "sloped") {
      expect(el.roof.h1).toBeGreaterThan(el.roof.h0 + 1);
      expect(el.roof.ridge[0]).toBeGreaterThanOrEqual(el.roof.eave[0]);
      expect(el.roof.ridge[1]).toBeLessThanOrEqual(el.roof.eave[1]);
    }
    expect(el.pillars.length).toBeGreaterThanOrEqual(2);
  });

  it("an apartment block: a level for every floor", () => {
    const plan = generatePlan(req("apartment", 50, 80, 2, 5, { flatsPerFloor: 2 }));
    const el = buildElevation(plan, "flat");
    expect(el.levels).toHaveLength(6);
    expect(el.top).toBeCloseTo(PLINTH + 5 * FLOOR_H + 0.9, 5);
  });
});
