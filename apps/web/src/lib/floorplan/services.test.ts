import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { pointInPolygon } from "./polygon-ops";
import { planServices } from "./services";
import type { BuildingType, Requirements } from "./types";

const FT = 0.3048;

function req(type: BuildingType, w: number, d: number, beds: number, floors: number, extra: Partial<Requirements> = {}): Requirements {
  return {
    buildingType: type, plotWidth: w * FT, plotDepth: d * FT, facing: "E", floors, bedrooms: beds, bathrooms: beds,
    parking: 1, balconies: 1, vastu: true, garden: false, pool: false, homeOffice: false,
    budget: "standard", style: "modern", luxury: 3, ...extra,
  };
}

const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;

describe("plumbing and drainage", () => {
  for (const [label, r] of [
    ["30×50 3 BHK G+1 house", req("house", 30, 50, 3, 2)],
    ["40×60 4 BHK duplex", req("duplex", 40, 60, 4, 2)],
    ["30×40 2 BHK rental G+2", req("rental", 30, 40, 2, 3)],
    ["50×80 apartment G+4", req("apartment", 50, 80, 2, 5, { flatsPerFloor: 2 })],
    ["50×60 manduva", req("manduva", 50, 60, 3, 1)],
  ] as const) {
    it(`${label}: every wet room drains to the final chamber`, () => {
      const plan = generatePlan(r);
      const s = planServices(plan, r);
      const wet = plan.floors.flatMap((f) => f.rooms).filter((x) => ["bathroom", "toilet", "kitchen", "utility"].includes(x.type));
      // Every wet room is served by a stack in it.
      for (const room of wet) {
        expect(s.stacks.some((st) => st.x >= room.x - 0.01 && st.x <= room.x + room.w + 0.01 && st.y >= room.y - 0.01 && st.y <= room.y + room.h + 0.01),
          `${room.label}`).toBe(true);
      }
      // Each stack has a branch to a chamber.
      expect(s.branches).toHaveLength(s.stacks.length);
      for (const b of s.branches) expect(s.chambers.some((c) => near([c.x, c.y], b[1]))).toBe(true);
      // Chambers drain, link by link, to the final chamber.
      const final = s.chambers.find((c) => c.final)!;
      expect(final).toBeDefined();
      const ends = s.drains.map((d) => [d[0], d[d.length - 1]] as const);
      for (const c of s.chambers.filter((x) => !x.final)) {
        let at: [number, number] = [c.x, c.y];
        for (let hop = 0; hop < s.chambers.length && !near(at, [final.x, final.y]); hop++) {
          const next = ends.find(([a]) => near(a, at));
          expect(next, `${c.id} drains on`).toBeDefined();
          at = next![1] as [number, number];
        }
        expect(near(at, [final.x, final.y]), `${c.id} reaches the final chamber`).toBe(true);
      }
      // Everything outdoors sits on the plot.
      for (const c of s.chambers) expect(pointInPolygon([c.x, c.y], plan.site.plot), c.id).toBe(true);
      for (const t of s.tanks.filter((k) => k.kind !== "oht")) {
        expect(pointInPolygon([t.x + t.w / 2, t.y + t.h / 2], plan.site.plot), t.label).toBe(true);
      }
      expect(s.schedule.length).toBeGreaterThan(8);
    });
  }

  it("stacks run straight down through identical rental floors", () => {
    const r = req("rental", 30, 50, 2, 3);
    const s = planServices(generatePlan(r), r);
    const soil = s.stacks.filter((x) => x.kind === "soil");
    expect(soil).toHaveLength(2); // two baths per home, one stack each
    for (const st of soil) expect(st.floors.sort()).toEqual([0, 1, 2]);
  });

  it("septic tank and soak pit for plots without a sewer, sump kept away from them", () => {
    const r = req("house", 40, 60, 3, 2, { drainage: "septic" });
    const s = planServices(generatePlan(r), r);
    const septic = s.tanks.find((t) => t.kind === "septic")!;
    const pit = s.tanks.find((t) => t.kind === "soakpit")!;
    const sump = s.tanks.find((t) => t.kind === "sump")!;
    expect(septic && pit && sump).toBeTruthy();
    const c = (t: typeof sump): [number, number] => [t.x + t.w / 2, t.y + t.h / 2];
    expect(Math.hypot(c(sump)[0] - c(septic)[0], c(sump)[1] - c(septic)[1])).toBeGreaterThan(3);
    expect(s.schedule.some((row) => /Septic/.test(row.item))).toBe(true);
  });

  it("sizes water storage for every household in the building", () => {
    const r = req("apartment", 50, 80, 2, 5, { flatsPerFloor: 2 });
    const s = planServices(generatePlan(r), r);
    // 8 flats × 5 people × 135 L ≈ 5.4 kL a day.
    expect(s.tanks.find((t) => t.kind === "oht")!.litres).toBeGreaterThanOrEqual(5400);
    expect(s.tanks.find((t) => t.kind === "sump")!.litres).toBeGreaterThanOrEqual(8100);
  });
});
