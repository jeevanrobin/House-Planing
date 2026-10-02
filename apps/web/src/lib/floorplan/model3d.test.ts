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

describe("roofs and pillars", () => {
  const FT = 0.3048;
  const traditional = (buildingType: "manduva" | "cottage", w: number, d: number) => generatePlan({
    ...req, buildingType, floors: 1, plotWidth: w * FT, plotDepth: d * FT, facing: "E", bedrooms: 3, bathrooms: 3, garden: false,
  });
  /** Is plan point (x, z) under any triangle of the mesh (seen from above)? */
  const covered = (positions: number[], x: number, z: number) => {
    for (let i = 0; i < positions.length; i += 9) {
      const [ax, , az, bx, , bz, cx, , cz] = positions.slice(i, i + 9);
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return true;
    }
    return false;
  };

  it("a manduva's tiled roof rings the courtyard and leaves it open to the sky", () => {
    const p = traditional("manduva", 50, 60);
    const m = buildModel(p, { roofStyle: "sloped" });
    expect(m.meshes).toHaveLength(1);
    const pos = m.meshes[0].positions;
    expect(pos.length % 9).toBe(0);
    const court = p.floors[0].rooms.find((r) => /courtyard/i.test(r.label))!;
    expect(covered(pos, court.x + court.w / 2, court.y + court.h / 2)).toBe(false);
    // The rooms round it are covered.
    for (const r of p.floors[0].rooms.filter((x) => x.type === "bedroom" || x.type === "master_bedroom")) {
      expect(covered(pos, r.x + r.w / 2, r.y + r.h / 2), r.label).toBe(true);
    }
    // No flat slab on the top floor under a sloped roof.
    expect(m.boxes.some((b) => b.material === "roof")).toBe(false);
    // Teak pillars stand round the courtyard.
    const pillars = m.rounds.filter((r) => r.material === "pillar");
    const nearCourt = pillars.filter((q) => q.x >= court.x - 0.05 && q.x <= court.x + court.w + 0.05 && q.z >= court.y - 0.05 && q.z <= court.y + court.h + 0.05);
    expect(nearCourt.length).toBeGreaterThanOrEqual(4);
  });

  it("a cottage gets a hip roof over the whole house, verandahs included", () => {
    const p = traditional("cottage", 50, 60);
    const m = buildModel(p, { roofStyle: "sloped" });
    expect(m.meshes).toHaveLength(1);
    for (const r of p.floors[0].rooms) expect(covered(m.meshes[0].positions, r.x + r.w / 2, r.y + r.h / 2), r.label).toBe(true);
    const ys = m.meshes[0].positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys) + 1);
  });

  it("flat roofs carry a parapet on the outside walls", () => {
    const parapets = model.boxes.filter((b) => b.kind === "roof" && b.material === "wallExt");
    expect(parapets.length).toBeGreaterThan(4);
    for (const b of parapets) expect(b.y - b.sy / 2).toBeGreaterThanOrEqual(FLOOR_H - 1e-6);
  });
});
