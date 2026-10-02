import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { DOOR_H, FLOOR_H, SILL_H, buildModel, type Box } from "./model3d";
import type { Requirements } from "./types";

const req: Requirements = {
  plotWidth: 12, plotDepth: 18, facing: "N", floors: 2, bedrooms: 3, bathrooms: 3, parking: 1,
  balconies: 1, vastu: true, garden: true, pool: false, homeOffice: false,
  budget: "standard", style: "modern", luxury: 3,
};
const plan = generatePlan(req);
const model = buildModel(plan);

const overlaps = (b: Box, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) =>
  b.x - b.sx / 2 < x1 - 1e-6 && b.x + b.sx / 2 > x0 + 1e-6 &&
  b.z - b.sz / 2 < z1 - 1e-6 && b.z + b.sz / 2 > z0 + 1e-6 &&
  b.y - b.sy / 2 < y1 - 1e-6 && b.y + b.sy / 2 > y0 + 1e-6;

describe("3D model", () => {
  it("builds finite, positive solids for every floor", () => {
    expect(model.floors).toBe(2);
    for (const b of model.boxes) {
      for (const v of [b.x, b.y, b.z, b.sx, b.sy, b.sz]) expect(Number.isFinite(v)).toBe(true);
      expect(Math.min(b.sx, b.sy, b.sz)).toBeGreaterThan(0);
    }
    expect(new Set(model.boxes.filter((b) => b.kind === "wall").map((b) => b.floor))).toEqual(new Set([0, 1]));
  });

  it("leaves every doorway open up to door height", () => {
    plan.floors.forEach((f, i) => {
      const walls = model.boxes.filter((b) => b.kind === "wall" && b.floor === i);
      for (const d of f.doors) {
        const base = i * FLOOR_H;
        const [x0, x1, z0, z1] = d.orientation === "v"
          ? [d.x - 0.05, d.x + 0.05, d.y + 0.05, d.y + d.width - 0.05]
          : [d.x + 0.05, d.x + d.width - 0.05, d.y - 0.05, d.y + 0.05];
        const blocking = walls.filter((w) => overlaps(w, x0, x1, z0, z1, base + 0.05, base + DOOR_H - 0.05));
        expect(blocking, `door into ${d.roomId}`).toEqual([]);
      }
    });
  });

  it("glazes every window between sill and lintel", () => {
    const glass = model.boxes.filter((b) => b.kind === "glass");
    const windows = plan.floors.reduce((a, f) => a + f.windows.length, 0);
    expect(glass.length).toBe(windows);
    for (const g of glass) {
      const base = g.floor * FLOOR_H;
      expect(g.y - g.sy / 2).toBeCloseTo(base + SILL_H, 5);
      expect(g.y + g.sy / 2).toBeCloseTo(base + DOOR_H, 5);
    }
  });

  it("climbs exactly one storey per stair", () => {
    for (let i = 0; i < plan.floors.length; i++) {
      const steps = model.boxes.filter((b) => b.kind === "stair" && b.floor === i);
      expect(steps.length).toBeGreaterThan(10);
      const top = Math.max(...steps.map((s) => s.y + s.sy / 2));
      expect(top).toBeCloseTo(i * FLOOR_H + FLOOR_H, 5);
    }
  });

  it("can leave furniture out", () => {
    expect(buildModel(plan, { furniture: false }).boxes.some((b) => b.kind === "furniture")).toBe(false);
    expect(model.boxes.some((b) => b.kind === "furniture")).toBe(true);
  });
});
